// The playback clock the transcript follows. The recording view reads `currentTime` on
// every animation frame and never touches an <audio> element directly, so the fixture
// build can run on a silent simulated clock and the real API build on the audio element
// (createAudioElementClock) without changing the sync code.

export interface MediaClock {
  /** Total length in original-audio ms. */
  readonly duration: number;
  /** Current position in original-audio ms. Cheap; read it every frame. */
  readonly currentTime: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  /** False for the simulated clock: there is no sound to hear. */
  readonly audible: boolean;
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

/** The real clock for recordings with audio: wraps an <audio> element (times in ms). */
export function createAudioElementClock(audio: HTMLAudioElement, durationMs: number): MediaClock {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const events = ["play", "pause", "seeked", "ratechange", "ended", "durationchange"] as const;
  for (const type of events) audio.addEventListener(type, emit);
  return {
    audible: true,
    get duration() {
      return Number.isFinite(audio.duration) ? audio.duration * 1000 : durationMs;
    },
    get currentTime() {
      return audio.currentTime * 1000;
    },
    get paused() {
      return audio.paused;
    },
    get playbackRate() {
      return audio.playbackRate;
    },
    play: () => void audio.play().catch(() => {}),
    pause: () => audio.pause(),
    seek: (ms) => {
      audio.currentTime = ms / 1000;
    },
    setPlaybackRate: (rate) => {
      audio.playbackRate = rate;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const type of events) audio.removeEventListener(type, emit);
      listeners.clear();
    },
  };
}
