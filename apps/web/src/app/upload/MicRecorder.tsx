// Browser-native microphone recorder with Screen Wake Lock, Web Locks, AudioContext
// level metering, beforeunload guard, and IndexedDB crash-recovery checkpointing.

import { useEffect, useRef, useState } from "react";
import { Badge, Button, CheckboxField, Dot, Progress, uiStyles } from "../../ui/controls.tsx";
import { announce, showToast } from "../../ui/toast.tsx";
import s from "./upload.module.css";

const DB_NAME = "lectern_audio_vault_v1";
const CHECKPOINT_STORE = "checkpoints";
const CHECKPOINT_KEY = "active_v2_recording";

interface StoredCheckpoint {
  id: string;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  blob: Blob;
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("pending_uploads")) {
          db.createObjectStore("pending_uploads", { keyPath: "localId" });
        }
        if (!db.objectStoreNames.contains(CHECKPOINT_STORE)) {
          db.createObjectStore(CHECKPOINT_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveCheckpoint(mimeType: string, chunks: Blob[], startedAt: number): Promise<void> {
  if (chunks.length === 0) return;
  const db = await openVaultDb();
  if (!db) return;
  try {
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(CHECKPOINT_STORE, "readwrite");
      tx.objectStore(CHECKPOINT_STORE).put({
        id: CHECKPOINT_KEY,
        mimeType: blob.type,
        startedAt,
        updatedAt: Date.now(),
        blob,
      } satisfies StoredCheckpoint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Best-effort checkpoint
  } finally {
    db.close();
  }
}

async function loadCheckpoint(): Promise<StoredCheckpoint | null> {
  const db = await openVaultDb();
  if (!db) return null;
  try {
    return await new Promise<StoredCheckpoint | null>((resolve) => {
      const tx = db.transaction(CHECKPOINT_STORE, "readonly");
      const req = tx.objectStore(CHECKPOINT_STORE).get(CHECKPOINT_KEY);
      req.onsuccess = () => {
        const val = req.result as StoredCheckpoint | undefined;
        resolve(val && val.blob && val.blob.size > 0 ? val : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function clearCheckpoint(): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(CHECKPOINT_STORE, "readwrite");
      tx.objectStore(CHECKPOINT_STORE).delete(CHECKPOINT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    db.close();
  }
}

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  for (const candidate of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function buildRecordedFile(blob: Blob, startedAt: number): File {
  const mime = blob.type || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const kst = new Date(startedAt + 9 * 3600 * 1000);
  const stamp = kst.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
  return new File([blob], `강의녹음_${stamp}.${ext}`, { type: mime, lastModified: startedAt });
}

function triggerLocalDownload(file: File) {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Best-effort local backup download
  }
}

function formatTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

export function MicRecorder({
  disabled,
  onRecorded,
  onActiveChange,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [level, setLevel] = useState(0);
  const [wakeLocked, setWakeLocked] = useState(false);
  const [autoDownload, setAutoDownload] = useState(true);
  const [checkpoint, setCheckpoint] = useState<StoredCheckpoint | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const tabLockReleaseRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const pausedAccumMsRef = useRef<number>(0);
  const pauseStartedAtRef = useRef<number | null>(null);
  const autoDownloadRef = useRef(autoDownload);
  autoDownloadRef.current = autoDownload;

  const canRecord = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    void loadCheckpoint().then(setCheckpoint);
  }, []);

  const acquireWakeLock = async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLocked(true);
      lock.addEventListener("release", () => {
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
          setWakeLocked(false);
        }
      });
    } catch {
      setWakeLocked(false);
    }
  };

  const releaseWakeLock = () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    setWakeLocked(false);
    if (lock) {
      void lock.release().catch(() => {});
    }
  };

  const cleanupResources = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (tabLockReleaseRef.current) {
      tabLockReleaseRef.current();
      tabLockReleaseRef.current = null;
    }
    releaseWakeLock();
    setLevel(0);
  };

  useEffect(() => {
    if (state === "idle") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible" && recorderRef.current && recorderRef.current.state !== "inactive") {
        void acquireWakeLock();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [state]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {}
      }
      cleanupResources();
    };
  }, []);

  const startRecording = async () => {
    if (!canRecord || disabled || state !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      await acquireWakeLock();

      if (navigator.locks?.request) {
        let release!: () => void;
        const held = new Promise<void>((res) => {
          release = res;
        });
        tabLockReleaseRef.current = release;
        void navigator.locks.request("lectern-recording", { ifAvailable: true }, (lock) => (lock ? held : undefined)).catch(() => {});
      }

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      pausedAccumMsRef.current = 0;
      pauseStartedAtRef.current = null;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
          if (chunks.length % 3 === 0) {
            void saveCheckpoint(recorder.mimeType || mimeType, chunks, startedAt);
          }
        }
      };

      recorder.onstop = async () => {
        const finalMime = recorder.mimeType || mimeType || "audio/webm";
        recorderRef.current = null;
        cleanupResources();
        setState("idle");
        setElapsedSec(0);
        onActiveChange?.(false);

        const blob = new Blob(chunks, { type: finalMime });
        if (blob.size === 0) {
          await clearCheckpoint();
          showToast({ title: "녹음된 오디오가 없습니다.", tone: "danger" });
          return;
        }
        const file = buildRecordedFile(blob, startedAt);
        if (autoDownloadRef.current) {
          triggerLocalDownload(file);
        }
        await clearCheckpoint();
        setCheckpoint(null);
        onRecorded(file);
        announce(`마이크 녹음을 마쳤습니다. ${file.name} 파일을 목록에 추가했습니다.`);
      };

      recorder.start(1000);
      setState("recording");
      setElapsedSec(0);
      onActiveChange?.(true);
      announce("마이크 녹음을 시작했습니다. 화면 절전 방지가 켜졌습니다.");

      timerRef.current = setInterval(() => {
        const now = Date.now();
        const currentPause = pauseStartedAtRef.current ? now - pauseStartedAtRef.current : 0;
        const activeMs = Math.max(0, now - startedAtRef.current - pausedAccumMsRef.current - currentPause);
        setElapsedSec(Math.floor(activeMs / 1000));
      }, 500);

      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 128;
          src.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (!audioCtxRef.current) return;
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i]!;
            const avg = buf.length ? sum / buf.length / 255 : 0;
            setLevel(Math.min(1, avg * 2.2));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        // Cosmetic meter failure never aborts recording
      }
    } catch (err) {
      cleanupResources();
      setState("idle");
      onActiveChange?.(false);
      showToast({
        title: "마이크 권한을 확인할 수 없습니다.",
        description: err instanceof Error ? err.message : "브라우저 설정에서 마이크 권한을 허용해 주세요.",
        tone: "danger",
      });
    }
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      pauseStartedAtRef.current = Date.now();
      setState("paused");
      announce("녹음을 일시정지했습니다.");
    } else if (rec.state === "paused") {
      rec.resume();
      if (pauseStartedAtRef.current) {
        pausedAccumMsRef.current += Date.now() - pauseStartedAtRef.current;
        pauseStartedAtRef.current = null;
      }
      setState("recording");
      announce("녹음을 재개했습니다.");
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  };

  const recoverCheckpoint = async () => {
    if (!checkpoint) return;
    const file = buildRecordedFile(checkpoint.blob, checkpoint.startedAt);
    await clearCheckpoint();
    setCheckpoint(null);
    onRecorded(file);
    showToast({ title: "임시 저장된 녹음을 복구했습니다.", description: file.name, tone: "info" });
  };

  const discardCheckpoint = async () => {
    await clearCheckpoint();
    setCheckpoint(null);
  };

  if (!canRecord) return null;

  return (
    <section className={s.recorder} aria-label="브라우저 마이크 녹음">
      <div className={s.recorderRow}>
        <div className={s.recorderInfo}>
          <div className={s.recorderHead}>
            {state !== "idle" && <Dot tone={state === "recording" ? "danger" : "attention"} live={state === "recording"} />}
            <span className={s.recorderTitle}>
              {state === "idle" ? "마이크로 바로 녹음" : state === "recording" ? `녹음 중 · ${formatTimer(elapsedSec)}` : `일시정지 · ${formatTimer(elapsedSec)}`}
            </span>
            {state !== "idle" && (
              <Badge tone={wakeLocked ? "success" : "neutral"}>
                {wakeLocked ? "절전 방지 켜짐" : "절전 방지 대기"}
              </Badge>
            )}
          </div>
          <p className={uiStyles.hint}>
            {state === "idle"
              ? "절전 방지(Wake Lock)와 브라우저 임시 백업(IndexedDB)을 켜고 강의를 직접 녹음합니다."
              : "녹음을 마치면 아래 업로드 목록에 바로 추가되며 PDF와 함께 올릴 수 있습니다."}
          </p>
        </div>
        <div className={s.recorderActions}>
          {state === "idle" ? (
            <Button variant="secondary" icon="audio" onPress={startRecording} isDisabled={disabled}>
              마이크 녹음 시작
            </Button>
          ) : (
            <>
              <Button variant="secondary" icon={state === "paused" ? "play" : "pause"} onPress={togglePause}>
                {state === "paused" ? "재개" : "일시정지"}
              </Button>
              <Button variant="danger" icon="stop" onPress={stopRecording}>
                녹음 완료
              </Button>
            </>
          )}
        </div>
      </div>

      {state !== "idle" && (
        <div className={s.recorderLive}>
          <Progress
            value={level}
            label="마이크 입력 레벨"
            valueLabel={state === "paused" ? "일시정지됨" : `입력 감도 ${Math.round(level * 100)}%`}
          />
          <CheckboxField isSelected={autoDownload} onChange={setAutoDownload}>
            녹음 완료 시 내 기기에도 원본 오디오 파일 자동 저장
          </CheckboxField>
        </div>
      )}

      {state === "idle" && checkpoint && (
        <div className={s.checkpointBar} role="status">
          <span>이전에 중단된 임시 녹음이 브라우저에 남아 있습니다.</span>
          <div className={s.recorderActions}>
            <Button size="sm" variant="secondary" onPress={recoverCheckpoint}>
              임시 녹음 복구
            </Button>
            <Button size="sm" variant="ghost" onPress={discardCheckpoint}>
              비우기
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
