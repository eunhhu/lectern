import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { prepareAudio, cleanupPreparedAudio } from "./audio.ts";
import { extractExcerpt } from "./markdown.ts";
import type { DistillOptions, DistillationResult } from "./types.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export function resolveGeminiApiKey(explicitKey?: string): string {
  if (explicitKey && explicitKey.trim()) return explicitKey.trim();
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  const localEnvPath = join(homedir(), "local.env");
  if (existsSync(localEnvPath)) {
    const content = readFileSync(localEnvPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("GEMINI_API_KEY=")) {
        return line
          .slice("GEMINI_API_KEY=".length)
          .trim()
          .replace(/^['"]|['"]$/g, "");
      }
    }
  }
  throw new Error(
    "GEMINI_API_KEY is not configured. Pass an API key, set GEMINI_API_KEY in env, or configure ~/local.env."
  );
}

interface UploadedGeminiFile {
  uri: string;
  name: string;
}

async function uploadToGeminiFileApi(
  apiKey: string,
  filePath: string,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<UploadedGeminiFile> {
  const bunFile = Bun.file(filePath);
  const fileSize = bunFile.size;
  const displayName = basename(filePath);

  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    }
  );

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Gemini File API init failed (${initRes.status}): ${text}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini File API did not return x-goog-upload-url header.");
  }

  const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB zero-copy slices
  let offset = 0;
  let finalJson: any = null;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const isLast = end === fileSize;
    const command = isLast ? "upload, finalize" : "upload";
    const slice = bunFile.slice(offset, end);

    const chunkRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(end - offset),
        "X-Goog-Upload-Offset": String(offset),
        "X-Goog-Upload-Command": command,
      },
      body: slice,
    });

    if (!chunkRes.ok) {
      const errBody = await chunkRes.text();
      throw new Error(
        `Gemini File API chunk upload failed at ${offset} (${chunkRes.status}): ${errBody}`
      );
    }

    offset = end;
    onProgress?.(Math.round((offset / fileSize) * 100));

    if (isLast) {
      finalJson = await chunkRes.json();
    }
  }

  const fileInfo = finalJson?.file;
  if (!fileInfo?.uri || !fileInfo?.name) {
    throw new Error("Invalid Gemini File API response after upload finalize.");
  }

  // Poll until state is ACTIVE
  let state = fileInfo.state;
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 60) {
    await Bun.sleep(2500);
    attempts++;
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${encodeURIComponent(apiKey)}`
    );
    if (statusRes.ok) {
      const statusJson: any = await statusRes.json();
      state = statusJson.state;
    }
  }

  if (state !== "ACTIVE") {
    throw new Error(`Gemini File processing did not reach ACTIVE state (state=${state}).`);
  }

  return { uri: fileInfo.uri, name: fileInfo.name };
}

async function deleteGeminiFile(apiKey: string, fileName: string): Promise<void> {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { method: "DELETE" }
    );
  } catch {
    // ignore cleanup network error
  }
}

function formatDurationMmSs(sec?: number): { label: string; maxTs: string } {
  if (!sec || sec <= 0) {
    return { label: "오디오 실제 길이 기준", maxTs: "실제 오디오 끝 지점" };
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return {
    label: m > 0 ? `약 ${m}분 ${s}초 (총 ${sec}초)` : `약 ${s}초`,
    maxTs: `${mm}:${ss}`,
  };
}

export function buildDistillationPrompt(
  courseName: string,
  customVocabulary?: string[],
  durationSec?: number
): string {
  const vocabHint =
    customVocabulary && customVocabulary.length > 0
      ? `\n- **과목 주요 용어 참고**: ${customVocabulary.join(", ")}`
      : "";
  const dur = formatDurationMmSs(durationSec);

  return `당신은 대학교 강의 오디오 분석 및 시험 대비 학습 노트 증류(Distillation) 전문가입니다.
첨부된 오디오는 **'${courseName}'** 과목 카테고리로 업로드된 실제 녹음본입니다.
- **측정된 실제 오디오 재생 길이**: **${dur.label} (타임스탬프 범위: \`00:00 ~ ${dur.maxTs}\`)**${vocabHint}

### 🚨 0단계: 절대 환각(Hallucination) 및 가상 창작 금지 (최우선 규칙)
1. **오직 첨부된 오디오에서 실제로 들리는 음성(발화)만 정리하세요**:
   - 과목명('${courseName}')이나 사전 배경지식만 보고 **오디오에서 실제로 발화되지 않은 이론, 코드, 예시, 강의 내용을 절대 추측하거나 창작하지 마세요.**
2. **실제 오디오 길이(\`00:00 ~ ${dur.maxTs}\`) 엄수**:
   - 이 오디오 파일의 끝 지점은 **\`${dur.maxTs}\`**입니다. 어떠한 경우에도 **\`${dur.maxTs}\`를 초과하는 타임스탬프나 분량을 지어내지 마세요.**
3. **짧은 녹음·테스트 발화·음성 불분명 시 정직하게 기록**:
   - 몇 분 이내의 짧은 녹음이거나 마이크 테스트, 일상 대화라면 실제로 들린 발화 내용과 실제 길이(\`${dur.label}\`)만 있는 그대로 요약하세요.
   - 만약 소음만 있거나 음성이 명확히 들리지 않는다면 "오디오에서 명확한 강의 발화가 식별되지 않습니다"라고만 기록하고 가상의 강의 노트를 절대 작성하지 마세요.

### 🛡️ 1단계: 노이즈·쉬는시간·방치 녹음 자동 필터링 규칙 (필수)
1. **쉬는 시간(Break Time) 감지 및 생략**:
   - 수업 도중 교수님 발언이 멈추고 학생 잡담, 발소리, 침묵, 교실 소음만 이어지거나 "잠깐 쉬었다 합시다" 등의 멘트가 나오면 내용에서 완전히 제외하고 타임라인에만 \`[쉬는 시간 생략: MM:SS ~ MM:SS]\`로 표기하세요.
2. **수업 종료 후 미종료 녹음(Forgotten Recording Tail) 절단**:
   - "수고하셨습니다", "오늘 수업은 여기까지" 등 수업 종료 이후 녹음기를 끄지 않아 가방 싸는 소리, 복도 이동, 외부 대화, 무음 등이 이어지면 즉시 절단하고 \`[수업 종료 후 녹음 절단: MM:SS ~ 끝]\`으로만 기록하세요.
3. **출석 호명 및 행정 잡담 제외**:
   - 단순 이름 호명(출석 체크)이나 학문적 내용과 무관한 신변잡기는 과감히 건너뛰고, 과제 마감일·시험 일정·배점 공지는 **🎯 시험/과제 핵심 포인트**에 정확히 남기세요.

---

### 📝 2단계: 마크다운 출력 구조 (반드시 한국어로 작성)

# 📚 ${courseName} 강의 노트

## 📊 1. 녹음 타임라인 및 필터링 요약
- **전체 녹음 길이 및 실제 발화 구간**: 총 ${dur.label} (\`00:00 ~ ${dur.maxTs}\`) 중 실제 발화 구간 표기
- **자동 필터링 내역**:
  - \`[쉬는 시간 생략: MM:SS ~ MM:SS]\` (해당 시에만 기재, 없으면 '해당 없음')
  - \`[수업 종료 후 녹음 절단: MM:SS ~ 끝]\` (해당 시에만 기재, 없으면 '해당 없음')
- **녹음 핵심 요약**: (실제 오디오에서 들린 핵심 내용을 한 문장으로 요약)

## 🎯 2. 강조 사항 및 시험/과제 핵심 포인트
- 오디오에서 실제로 강조되었거나 반복 설명된 개념을 \`[MM:SS]\` 타임스탬프(\`00:00 ~ ${dur.maxTs}\` 이내)와 함께 정리하세요. (언급이 없었다면 '별도 시험/과제 공지 언급 없음'으로 표기)

## 📖 3. 핵심 내용 및 상세 노트
- 실제 오디오 발화 흐름에 따라 대주제(###)와 소주제로 구조화하여 정리하세요.
- 각 섹션 제목 옆에 실제 오디오 내 시작 타임스탬프 \`[MM:SS]\`를 표기하세요.
- 오디오에서 실제로 설명된 용어, 공식, 알고리즘, 코드 예시만 정확하게 복원하세요.

## 💬 4. 주요 발언 발췌 (Verbatim Highlights)
- 오디오에서 실제로 발화된 주요 문장이나 설명을 \`[MM:SS]\` 타임스탬프와 함께 인용구(\`>\`)로 발췌하세요.
`;
}

export async function distillLectureAudio(
  opts: DistillOptions
): Promise<DistillationResult> {
  const apiKey = resolveGeminiApiKey(opts.apiKey);
  const courseName = (opts.courseName || "대학교 전공 강의").trim();
  const modelRequested = (opts.model || DEFAULT_GEMINI_MODEL).trim();

  opts.onProgress?.({
    stage: "preparing",
    message: "오디오 스트림 검사 및 최적화 확인 중...",
    progress: 10,
  });

  const prep = await prepareAudio(opts.audioPath);
  let uploaded: UploadedGeminiFile | null = null;

  try {
    if (typeof prep.maxVolumeDb === "number" && prep.maxVolumeDb <= -60.0) {
      throw new Error(
        `녹음된 오디오에 음성 신호가 감지되지 않았습니다 (최대 음량 ${prep.maxVolumeDb.toFixed(
          1
        )}dB 무음 파일). 기기의 마이크 권한 허용 여부나 입력 마이크 설정을 확인해 주세요.`
      );
    }

    opts.onProgress?.({
      stage: "uploading",
      message: `오디오 스트림 전송 중 (${(prep.sizeBytes / 1048576).toFixed(1)} MB)...`,
      progress: 25,
    });

    uploaded = await uploadToGeminiFileApi(
      apiKey,
      prep.filePath,
      prep.mimeType,
      (pct) => {
        opts.onProgress?.({
          stage: "uploading",
          message: `오디오 스트림 전송 중 (${pct}%)...`,
          progress: 25 + Math.round(pct * 0.3),
        });
      }
    );

    opts.onProgress?.({
      stage: "analyzing",
      message: `쉬는시간 필터링 및 강의 핵심 노트 구조화 중...`,
      progress: 65,
    });

    const prompt = buildDistillationPrompt(
      courseName,
      opts.customVocabulary,
      prep.durationSec
    );
    const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelRequested
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const genRes = await fetch(genUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { mime_type: prep.mimeType, file_uri: uploaded.uri } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    if (!genRes.ok) {
      const errBody = await genRes.text();
      throw new Error(`Gemini generateContent failed (${genRes.status}): ${errBody}`);
    }

    const data: any = await genRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const markdown = parts
      .map((p: any) => p.text || "")
      .join("")
      .trim();

    if (!markdown) {
      throw new Error("Gemini returned an empty response.");
    }

    const modelUsed: string = data?.modelVersion || modelRequested;
    const derivedTitle =
      opts.title?.trim() ||
      extractTitleFromMarkdown(markdown) ||
      `${courseName} 강의 노트`;

    opts.onProgress?.({
      stage: "done",
      message: `강의 노트 정리 완료`,
      progress: 100,
    });

    return {
      markdown,
      title: derivedTitle,
      courseName,
      excerpt: extractExcerpt(markdown),
      modelRequested,
      modelUsed,
      durationSec: prep.durationSec,
      sizeBytes: prep.sizeBytes,
    };
  } finally {
    if (uploaded?.name) {
      await deleteGeminiFile(apiKey, uploaded.name);
    }
    cleanupPreparedAudio(prep);
  }
}

function extractTitleFromMarkdown(md: string): string | null {
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].replace(/^📚\s*/, "").trim();
  }
  return null;
}
