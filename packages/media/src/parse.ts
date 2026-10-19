import { normalizeIntervals, type Interval } from "./intervals.ts";

// Parsers for ffmpeg/ffprobe output. Pure, so the rules can be tested without ffmpeg.

const toMs = (seconds: number) => Math.round(seconds * 1000);

function parseDb(text: string | undefined): number | null {
  if (text === undefined) return null;
  if (/^-inf$/i.test(text)) return -Infinity;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Silence intervals from `silencedetect` log lines. A silence still open at
 * the end of the log (older ffmpeg does not close it at EOF) runs to
 * `durationMs`. Results are clipped to the recording and merged.
 */
export function parseSilenceDetect(log: string, durationMs: number): Interval[] {
  const silences: Interval[] = [];
  let open: number | null = null;
  for (const match of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const ms = toMs(Number.parseFloat(match[2]!));
    if (match[1] === "start") {
      open = ms;
    } else if (open !== null) {
      silences.push({ start_ms: open, end_ms: ms });
      open = null;
    }
  }
  if (open !== null) silences.push({ start_ms: open, end_ms: durationMs });
  return normalizeIntervals(silences, durationMs);
}

/**
 * Per-window peak levels (dBFS, in order) from `astats` metadata printed by
 * `ametadata=print:key=lavfi.astats.Overall.Peak_level`. `-inf` (digital
 * silence) becomes -Infinity.
 */
export function parseWindowPeaks(text: string): number[] {
  const peaks: number[] = [];
  for (const match of text.matchAll(/lavfi\.astats\.Overall\.Peak_level=(\S+)/g)) {
    const db = parseDb(match[1]);
    if (db !== null) peaks.push(db);
  }
  return peaks;
}

export interface VolumeStats {
  /** Peak sample level in dBFS; -Infinity for digital silence. */
  max_volume_db: number;
  mean_volume_db: number | null;
  /** Samples the filter saw; 0 means nothing decoded. */
  n_samples: number;
}

const lastMatch = (log: string, pattern: RegExp) => [...log.matchAll(pattern)].at(-1)?.[1];

/**
 * `volumedetect` summary, or null when the filter printed none. ffmpeg logs
 * an empty `n_samples: 0` block from graph setup before the real one, so the
 * last block wins.
 */
export function parseVolumeDetect(log: string): VolumeStats | null {
  const samples = lastMatch(log, /n_samples: (\d+)/g);
  if (samples === undefined) return null;
  const n_samples = Number.parseInt(samples, 10);
  const max = parseDb(lastMatch(log, /max_volume: (-?(?:[\d.]+|inf)) dB/gi));
  if (max === null) return n_samples === 0 ? { max_volume_db: -Infinity, mean_volume_db: null, n_samples } : null;
  return {
    max_volume_db: max,
    mean_volume_db: parseDb(lastMatch(log, /mean_volume: (-?(?:[\d.]+|inf)) dB/gi)),
    n_samples,
  };
}

/**
 * Integrated loudness (LUFS) from the `ebur128` summary. Null when the summary
 * is missing or the programme is below the -70 LUFS absolute gate (silence).
 */
export function parseEbur128Integrated(log: string): number | null {
  const at = log.lastIndexOf("Summary:");
  if (at < 0) return null;
  const value = parseDb(log.slice(at).match(/I:\s+(-?(?:[\d.]+|inf)) LUFS/i)?.[1]);
  return value !== null && Number.isFinite(value) && value > -70 ? value : null;
}

export interface ProbeStreamInfo {
  format: string;
  codec: string;
  duration_ms: number;
  channels: number;
  sample_rate: number;
  bit_rate: number | null;
  creation_time: string | null;
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (typeof value === "object" && value !== null ? (value as Json) : {});
const asNumber = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The first audio stream from `ffprobe -print_format json -show_format
 * -show_streams`. Null when there is no audio stream. `duration_ms` is 0 when
 * neither the stream nor the container states a duration.
 */
export function parseProbeJson(json: unknown, now: Date = new Date()): ProbeStreamInfo | null {
  const root = asObject(json);
  const format = asObject(root.format);
  const streams = Array.isArray(root.streams) ? root.streams.map(asObject) : [];
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!audio) return null;
  const seconds = asNumber(audio.duration) ?? asNumber(format.duration);
  return {
    format: typeof format.format_name === "string" ? format.format_name : "",
    codec: typeof audio.codec_name === "string" ? audio.codec_name : "",
    duration_ms: seconds !== null && seconds > 0 ? toMs(seconds) : 0,
    channels: asNumber(audio.channels) ?? 0,
    sample_rate: asNumber(audio.sample_rate) ?? 0,
    bit_rate: asNumber(audio.bit_rate) ?? asNumber(format.bit_rate),
    creation_time: parseCreationTime([asObject(format.tags), asObject(audio.tags)], now),
  };
}

const CREATION_TIME_TAGS = ["creation_time", "com.apple.quicktime.creationdate"];
const EARLIEST_PLAUSIBLE = Date.UTC(2000, 0, 1);

/** ISO-8601 date-time with an explicit zone (`Z`, `+09:00` or `+0900`). */
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Recording start from container or stream tags, as ISO-8601 UTC. Tags that
 * do not parse, carry no time zone (they would be read in the server's zone),
 * predate 2000 (the zero/epoch dates some recorders write) or lie more than a
 * day in the future are ignored.
 */
export function parseCreationTime(tagSets: readonly Json[], now: Date = new Date()): string | null {
  for (const tags of tagSets) {
    const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
    for (const key of CREATION_TIME_TAGS) {
      const raw = lower.get(key);
      if (typeof raw !== "string" || !ZONED_DATE_TIME.test(raw.trim())) continue;
      const ms = Date.parse(raw.trim().replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
      if (Number.isFinite(ms) && ms >= EARLIEST_PLAUSIBLE && ms <= now.getTime() + 86_400_000) {
        return new Date(ms).toISOString();
      }
    }
  }
  return null;
}

/** Duration from `ffprobe -show_entries packet=pts_time,duration_time -of csv=p=0`: the furthest packet end. */
export function parsePacketDurationMs(csv: string): number {
  let end = 0;
  for (const line of csv.split("\n")) {
    const [pts, duration] = line.split(",");
    const start = asNumber(pts);
    if (start === null) continue;
    end = Math.max(end, start + (asNumber(duration) ?? 0));
  }
  return toMs(end);
}
