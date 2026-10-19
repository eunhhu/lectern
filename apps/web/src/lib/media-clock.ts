// The playback clock the transcript follows. The recording view reads `currentTime` on
// every animation frame and never touches an <audio> element directly, so the fixture
// build can run on a silent simulated clock and the real API build on the audio element
// (createAudioClock, bytes from /assets/{id}/content with Range requests) without
// changing the sync code. Times are original-audio ms, the transcript's clock: a
// recording uploaded in parts plays them back to back on one timeline.

export interface MediaClock {
  /** Total length in original-audio ms. */
  readonly duration: number;
  /** Current position in original-audio ms. Cheap; read it every frame. */
  readonly currentTime: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  /** False for the simulated clock: there is no sound to hear. */
  readonly audible: boolean;
  /** `error`: the audio could not be loaded (the player says so; seeking still moves the transcript). */
  readonly status: "loading" | "ready" | "error";
  play(): void;
  pause(): void;
  seek(ms: number): void;
  setPlaybackRate(rate: number): void;
  /** Called on play, pause, seek, rate change and end (not on every frame). */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const clamp = (ms: number, max: number) => Math.min(Math.max(0, ms), max);

/** A silent clock driven by performance.now(), for fixture recordings without audio. */
export class SimulatedClock implements MediaClock {
  readonly audible = false;
  readonly status = "ready";
  #listeners = new Set<() => void>();
  #base = 0;
  #startedAt: number | null = null;
  #rate = 1;
  #endTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly duration: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get currentTime(): number {
    if (this.#startedAt === null) return this.#base;
    return clamp(this.#base + (this.now() - this.#startedAt) * this.#rate, this.duration);
  }

  get paused(): boolean {
    return this.#startedAt === null;
  }

  get playbackRate(): number {
    return this.#rate;
  }

  play(): void {
    if (!this.paused) return;
    if (this.#base >= this.duration) this.#base = 0;
    this.#startedAt = this.now();
    this.#scheduleEnd();
    this.#emit();
  }

  pause(): void {
    if (this.paused) return;
    this.#base = this.currentTime;
    this.#startedAt = null;
    clearTimeout(this.#endTimer);
    this.#emit();
  }

  seek(ms: number): void {
    this.#base = clamp(ms, this.duration);
    if (!this.paused) {
      this.#startedAt = this.now();
      this.#scheduleEnd();
    }
    this.#emit();
  }

  setPlaybackRate(rate: number): void {
    const position = this.currentTime;
    this.#rate = rate;
    this.#base = position;
    if (!this.paused) {
      this.#startedAt = this.now();
      this.#scheduleEnd();
    }
    this.#emit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    clearTimeout(this.#endTimer);
    this.#listeners.clear();
  }

  #scheduleEnd(): void {
    clearTimeout(this.#endTimer);
    const remaining = (this.duration - this.currentTime) / this.#rate;
    this.#endTimer = setTimeout(() => {
      this.#base = this.duration;
      this.#startedAt = null;
      this.#emit();
    }, remaining);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

export interface AudioPart {
  /** Where the bytes are (the browser fetches them with Range requests). */
  url: string;
  /** Length of the part; needed to place the parts after the first on the timeline. */
  durationMs: number | null;
}

/**
 * The real clock: one <audio> element playing the parts of a recording in order. Part
 * `i` starts where the parts before it end, so `currentTime` is original-audio ms across
 * the whole recording. Parts after the first need a known duration; without one only the
 * first part plays.
 */
export function createAudioClock(audio: HTMLAudioElement, allParts: AudioPart[], fallbackDurationMs: number): MediaClock {
  const parts = allParts.length > 1 && allParts.every((p) => p.durationMs !== null) ? allParts : allParts.slice(0, 1);
  const offsets: number[] = [];
  parts.reduce((at, p, i) => ((offsets[i] = at), at + (p.durationMs ?? 0)), 0);
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  let index = 0;
  let status: MediaClock["status"] = "loading";
  // True while the next part loads after the previous one ended during playback.
  let continuing = false;

  const partDuration = (i: number) => parts[i]?.durationMs ?? (i === index && Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
  const total = () => {
    if (parts.length > 1) return offsets.at(-1)! + (parts.at(-1)!.durationMs ?? 0);
    return Number.isFinite(audio.duration) ? audio.duration * 1000 : fallbackDurationMs;
  };
  const load = (i: number, positionMs: number, play: boolean) => {
    index = i;
    status = "loading";
    audio.src = parts[i]!.url;
    // Before metadata arrives this sets the start position the element seeks to.
    audio.currentTime = positionMs / 1000;
    if (play) void audio.play().catch(() => {});
  };

  const handlers: Record<string, () => void> = {
    loadedmetadata: () => {
      status = "ready";
      emit();
    },
    error: () => {
      status = "error";
      continuing = false;
      emit();
    },
    playing: () => {
      continuing = false;
      emit();
    },
    ended: () => {
      if (index < parts.length - 1) {
        continuing = true;
        load(index + 1, 0, true);
      }
      emit();
    },
  };
  for (const type of ["play", "pause", "seeked", "ratechange", "durationchange"]) handlers[type] = emit;
  for (const [type, handler] of Object.entries(handlers)) audio.addEventListener(type, handler);
  if (parts[0]) load(0, 0, false);
  else status = "error";

  return {
    audible: true,
    get status() {
      return status;
    },
    get duration() {
      return total();
    },
    get currentTime() {
      return (offsets[index] ?? 0) + audio.currentTime * 1000;
    },
    get paused() {
      return audio.paused && !continuing;
    },
    get playbackRate() {
      return audio.playbackRate;
    },
    play: () => {
      if (status === "error") return;
      void audio.play().catch(() => {});
    },
    pause: () => {
      continuing = false;
      audio.pause();
    },
    seek: (ms) => {
      const target = Math.min(Math.max(0, ms), total());
      let i = parts.length - 1;
      while (i > 0 && offsets[i]! > target) i--;
      if (i !== index) load(i, target - offsets[i]!, !audio.paused);
      else audio.currentTime = Math.min(target - offsets[i]!, partDuration(i)) / 1000;
      emit();
    },
    setPlaybackRate: (rate) => {
      audio.playbackRate = rate;
      audio.defaultPlaybackRate = rate;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const [type, handler] of Object.entries(handlers)) audio.removeEventListener(type, handler);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      listeners.clear();
    },
  };
}
