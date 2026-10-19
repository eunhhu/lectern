import { describe, expect, test } from "bun:test";
import { GapKind, TranscriptGap } from "../../domain/src/index.ts";
import {
  buildSpeechMap,
  encodingArgs,
  encodingExtension,
  encodingMime,
  formatClock,
  formatGapMarker,
  GAP_MARKER_LABELS,
  isSupportedCodec,
  loudnessGainDb,
  parseCreationTime,
  parseEbur128Integrated,
  parsePacketDurationMs,
  parseProbeJson,
  parseSilenceDetect,
  parseVolumeDetect,
  sampleWindows,
  TRANSCRIBE_ENCODING,
  type CutKind,
  type GapMarkerKind,
} from "../src/index.ts";

describe("parseSilenceDetect", () => {
  const log = [
    "[Parsed_silencedetect_0 @ 0x79f2c10900] silence_start: -0.00175",
    "[Parsed_silencedetect_0 @ 0x79f2c10900] silence_end: 2.5 | silence_duration: 2.50175",
    "size=N/A time=00:00:30.00 bitrate=N/A speed= 787x",
    "[Parsed_silencedetect_0 @ 0x79f2c10900] silence_start: 59.008",
    "[Parsed_silencedetect_0 @ 0x79f2c10900] silence_end: 1260.032 | silence_duration: 1201.024",
    "[Parsed_silencedetect_0 @ 0x79f2c10900] silence_start: 1319.03975",
  ].join("\n");

  test("pairs starts and ends, clips to the recording, closes a silence open at EOF", () => {
    expect(parseSilenceDetect(log, 1_440_000)).toEqual([
      { start_ms: 0, end_ms: 2_500 },
      { start_ms: 59_008, end_ms: 1_260_032 },
      { start_ms: 1_319_040, end_ms: 1_440_000 },
    ]);
  });

  test("newer ffmpeg closes the trailing silence itself", () => {
    expect(parseSilenceDetect("silence_start: 10\nsilence_end: 30 | silence_duration: 20\n", 30_000)).toEqual([
      { start_ms: 10_000, end_ms: 30_000 },
    ]);
  });

  test("no silence lines, no silences", () => {
    expect(parseSilenceDetect("", 5_000)).toEqual([]);
  });
});

describe("parseVolumeDetect", () => {
  test("takes the last summary (ffmpeg logs an empty one from graph setup first)", () => {
    const log = [
      "[Parsed_volumedetect_0 @ 0x773cc44480] n_samples: 0",
      "[Parsed_volumedetect_0 @ 0x773cc44900] n_samples: 264600",
      "[Parsed_volumedetect_0 @ 0x773cc44900] mean_volume: -24.1 dB",
      "[Parsed_volumedetect_0 @ 0x773cc44900] max_volume: -20.6 dB",
      "[Parsed_volumedetect_0 @ 0x773cc44900] histogram_20db: 4009",
    ].join("\n");
    expect(parseVolumeDetect(log)).toEqual({ max_volume_db: -20.6, mean_volume_db: -24.1, n_samples: 264600 });
  });

  test("digital silence and nothing decoded", () => {
    expect(parseVolumeDetect("n_samples: 32000\nmean_volume: -91.0 dB\nmax_volume: -91.0 dB\n")!.max_volume_db).toBe(-91);
    expect(parseVolumeDetect("n_samples: 100\nmean_volume: -inf dB\nmax_volume: -inf dB\n")!.max_volume_db).toBe(-Infinity);
    expect(parseVolumeDetect("n_samples: 0\n")).toEqual({ max_volume_db: -Infinity, mean_volume_db: null, n_samples: 0 });
    expect(parseVolumeDetect("Error opening input")).toBeNull();
  });
});

describe("parseEbur128Integrated", () => {
  const summary = (i: string) =>
    `[Parsed_ebur128_2 @ 0x7958c44a80] Summary:\n\n  Integrated loudness:\n    I:         ${i} LUFS\n    Threshold: -31.7 LUFS\n`;

  test("reads the integrated loudness from the summary", () => {
    expect(parseEbur128Integrated(`t: 2.9 M: -21.7 S: -21.7 I: -30.0 LUFS\n${summary("-21.7")}`)).toBe(-21.7);
  });

  test("silence (the -70 LUFS gate) and a missing summary are null", () => {
    expect(parseEbur128Integrated(summary("-70.0"))).toBeNull();
    expect(parseEbur128Integrated("I: -20.0 LUFS")).toBeNull();
  });
});

describe("parseProbeJson", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const probe = {
    streams: [
      { codec_type: "video", codec_name: "mjpeg" },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "44100",
        channels: 2,
        duration: "3.000000",
        bit_rate: "64286",
        tags: { creation_time: "2026-10-19T05:03:00.000000Z", language: "und" },
      },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000", bit_rate: "68330" },
  };

  test("first audio stream, container fallbacks", () => {
    expect(parseProbeJson(probe, now)).toEqual({
      format: "mov,mp4,m4a,3gp,3g2,mj2",
      codec: "aac",
      duration_ms: 3000,
      channels: 2,
      sample_rate: 44100,
      bit_rate: 64286,
      creation_time: "2026-10-19T05:03:00.000Z",
    });
  });

  test("no audio stream, no duration", () => {
    expect(parseProbeJson({ streams: [{ codec_type: "video" }], format: {} })).toBeNull();
    expect(parseProbeJson(null)).toBeNull();
    const noDuration = parseProbeJson({ streams: [{ codec_type: "audio", codec_name: "opus" }], format: { duration: "N/A" } });
    expect(noDuration!.duration_ms).toBe(0);
    expect(noDuration!.bit_rate).toBeNull();
  });
});

describe("parseCreationTime", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  test("container tags first, then stream tags; QuickTime local dates with offsets", () => {
    expect(parseCreationTime([{ creation_time: "2026-10-19T05:03:00.000000Z" }, { creation_time: "2026-01-01T00:00:00Z" }], now)).toBe(
      "2026-10-19T05:03:00.000Z",
    );
    expect(parseCreationTime([{}, { "com.apple.quicktime.creationdate": "2026-10-19T14:03:00+0900" }], now)).toBe("2026-10-19T05:03:00.000Z");
    expect(parseCreationTime([{ CREATION_TIME: "2026-10-18T23:00:00Z" }], now)).toBe("2026-10-18T23:00:00.000Z");
  });

  test("ignores epoch, zero, unparseable and future dates", () => {
    expect(parseCreationTime([{ creation_time: "1970-01-01T00:00:00.000000Z" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: "1904-01-01T00:00:00Z" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: "0000-00-00 00:00:00" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: "2026-10-21T00:00:00Z" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: 12345 }], now)).toBeNull();
    // No zone: the server's own zone would decide the instant, so it is not trusted.
    expect(parseCreationTime([{ creation_time: "2026-10-19T14:03:00" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: "2026-10-19 14:03:00" }], now)).toBeNull();
    expect(parseCreationTime([{ creation_time: "2026-10-19 05:03:00Z" }], now)).toBe("2026-10-19T05:03:00.000Z");
  });
});

test("parsePacketDurationMs: the furthest packet end", () => {
  expect(parsePacketDurationMs("0.000000,0.020000\n0.020000,0.020000\n59.980000,0.020000\nN/A,N/A\n")).toBe(60_000);
  expect(parsePacketDurationMs("")).toBe(0);
});

describe("sampleWindows", () => {
  test("short recordings are one window over the whole file", () => {
    expect(sampleWindows(90_000, 12, 10_000)).toEqual([{ start_ms: 0, end_ms: 90_000 }]);
    expect(sampleWindows(0, 12, 10_000)).toEqual([]);
  });

  test("windows are spread over the whole length, not the first five minutes", () => {
    const duration = 3 * 3600_000;
    const windows = sampleWindows(duration, 12, 10_000);
    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({ start_ms: 0, end_ms: 10_000 });
    expect(windows.at(-1)).toEqual({ start_ms: duration - 10_000, end_ms: duration });
    const strides = windows.slice(1).map((w, i) => w.start_ms - windows[i]!.start_ms);
    expect(Math.max(...strides) - Math.min(...strides)).toBeLessThanOrEqual(1);
    expect(windows.filter((w) => w.start_ms >= 5 * 60_000)).toHaveLength(11);
  });
});

test("loudnessGainDb: towards the target, clamped, 0 for silence", () => {
  expect(loudnessGainDb(-28.4, -16, 30)).toBe(12.4);
  expect(loudnessGainDb(-8, -16, 30)).toBe(-8);
  expect(loudnessGainDb(-60, -16, 30)).toBe(30);
  expect(loudnessGainDb(null, -16, 30)).toBe(0);
});

test("isSupportedCodec", () => {
  for (const codec of ["aac", "mp3", "opus", "vorbis", "flac", "alac", "amr_nb", "amr_wb", "pcm_s16le", "pcm_s24be", "pcm_f32le", "adpcm_ima_wav", "adpcm_ms"]) {
    expect(isSupportedCodec(codec)).toBe(true);
  }
  for (const codec of ["ac3", "eac3", "dts", "wmav2", "mjpeg", ""]) expect(isSupportedCodec(codec)).toBe(false);
});

test("encodings", () => {
  expect(TRANSCRIBE_ENCODING).toEqual({ codec: "aac", bitrateKbps: 32 });
  expect(encodingArgs(TRANSCRIBE_ENCODING)).toContain("32k");
  expect([encodingExtension(TRANSCRIBE_ENCODING), encodingMime(TRANSCRIBE_ENCODING)]).toEqual([".m4a", "audio/mp4"]);
  expect([encodingExtension({ codec: "opus", bitrateKbps: 24 }), encodingMime({ codec: "flac" })]).toEqual([".ogg", "audio/flac"]);
});

describe("markers", () => {
  test("formatClock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5_999)).toBe("0:05");
    expect(formatClock(3_012_000)).toBe("50:12");
    expect(formatClock(3_599_999)).toBe("59:59");
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(3_760_000)).toBe("1:02:40");
    expect(formatClock(36_000_000 + 61_000)).toBe("10:01:01");
    expect(() => formatClock(-1)).toThrow(RangeError);
  });

  test("the example from AI_HARNESS §3.2", () => {
    expect(formatGapMarker({ kind: "break", start_ms: 3_012_400, end_ms: 3_760_900 })).toBe("[쉬는 시간: 50:12~1:02:40]");
    expect(formatGapMarker({ kind: "tail", start_ms: 4_335_000, end_ms: 4_800_000 })).toBe("[종료 후: 1:12:15~1:20:00]");
    expect(formatGapMarker({ kind: "missing_transcript", start_ms: 600_000, end_ms: 960_000 })).toBe("[전사 누락: 10:00~16:00]");
  });
});

describe("matches @lectern/domain (type-level and schema)", () => {
  test("cut and marker kinds are GapKind values; a Cut parses as a TranscriptGap", () => {
    const kinds: GapKind[] = ["break", "tail"] satisfies CutKind[];
    const markerKinds = Object.keys(GAP_MARKER_LABELS) as GapMarkerKind[];
    expect(new Set(markerKinds)).toEqual(new Set(GapKind.options));
    expect(kinds.every((k) => GapKind.options.includes(k))).toBe(true);

    const map = buildSpeechMap({ duration_ms: 40 * 60_000, silences: [{ start_ms: 10 * 60_000, end_ms: 40 * 60_000 }] });
    expect(map.cuts).toHaveLength(1);
    expect(TranscriptGap.parse(map.cuts[0])).toEqual({ kind: "tail", start_ms: 10 * 60_000 + 1_500, end_ms: 40 * 60_000 });
  });
});
