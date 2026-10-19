import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSpeechMap,
  detectSilences,
  formatGapMarker,
  isFfmpegAvailable,
  measureLoudness,
  measureWindowPeaks,
  normalizeAudio,
  planChunks,
  probeAudio,
  readStreamInfo,
  renderChunks,
  renderSpeechAudio,
  screenAudio,
  sha256File,
  toOriginalMs,
} from "../src/index.ts";

// Integration tests on synthetic audio only (`-f lavfi`: sine tones and digital silence).
// Skipped without ffmpeg, like the server's compaction tests.

const hasFfmpeg = isFfmpegAvailable();
const dir = mkdtempSync(join(process.env.LECTERN_TEST_SANDBOX ?? tmpdir(), "media-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const S = 1000;

/**
 * Writes `name` from lavfi: a 300 Hz tone (lavfi's sine peaks at 1/8, -18 dBFS, before `volume`)
 * muted where `muteWhen` (an ffmpeg expression in t) is true, optionally over white noise of
 * peak amplitude `noise`.
 */
async function synth(
  name: string,
  opts: { seconds: number; muteWhen?: string; rate?: number; volume?: number; noise?: number; args?: string[] },
) {
  const path = join(dir, name);
  const rate = opts.rate ?? 16000;
  const tone = [`volume=${opts.volume ?? 1}`, ...(opts.muteWhen ? [`volume=0:enable='${opts.muteWhen}'`] : [])].join(",");
  const source = opts.noise
    ? ["-f", "lavfi", "-i", `sine=frequency=300:sample_rate=${rate}:duration=${opts.seconds}`,
       "-f", "lavfi", "-i", `anoisesrc=sample_rate=${rate}:amplitude=${opts.noise}:duration=${opts.seconds}:seed=7`,
       "-filter_complex", `[0:a]${tone}[t];[t][1:a]amix=inputs=2:normalize=0`]
    : ["-f", "lavfi", "-i", `sine=frequency=300:sample_rate=${rate}:duration=${opts.seconds}`, "-af", tone];
  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...source, ...(opts.args ?? ["-c:a", "aac", "-b:a", "48k"]), path],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`ffmpeg fixture failed: ${stderr}`);
  return path;
}

/** Speech stand-in: 4 s of tone, 1 s off (a short gap, kept). */
const talkGaps = "gte(mod(t,5),4)";

const near = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

describe.skipIf(!hasFfmpeg)("probe", () => {
  test("format, duration, channels, creation_time and a streamed sha256", async () => {
    const path = await synth("probe.m4a", {
      seconds: 12,
      rate: 44100,
      args: ["-ac", "2", "-metadata", "creation_time=2026-10-19T05:03:00Z", "-c:a", "aac", "-b:a", "64k"],
    });
    const probe = await probeAudio(path);
    expect(probe.codec).toBe("aac");
    expect(probe.format).toContain("mp4");
    expect(probe.channels).toBe(2);
    expect(probe.sample_rate).toBe(44100);
    near(probe.duration_ms, 12 * S, 50);
    expect(probe.creation_time).toBe("2026-10-19T05:03:00.000Z");
    expect(probe.size_bytes).toBe(Bun.file(path).size);
    expect(probe.sha256).toBe(new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex"));
    expect(await sha256File(path)).toBe(probe.sha256);
  });
});

describe.skipIf(!hasFfmpeg)("screenAudio", () => {
  test("a recording with sound passes on samples alone", async () => {
    const path = await synth("tone.m4a", { seconds: 40, muteWhen: talkGaps });
    const res = await screenAudio(path, { sampleCount: 4, sampleWindowMs: 2 * S });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sampled).toBe(true);
      near(res.max_volume_db, -18, 1);
    }
  });

  test("digital silence is rejected with the microphone hint", async () => {
    const path = await synth("silent.m4a", { seconds: 30, volume: 0 });
    const res = await screenAudio(path, { sampleCount: 4, sampleWindowMs: 2 * S });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("silent");
      expect(res.message).toContain("마이크");
    }
  });

  test("sound only between the sample windows: the whole-file check saves it", async () => {
    // Windows at 0–2, 29–31 and 58–60 s; the only sound is at 10–12 s.
    const path = await synth("between.m4a", { seconds: 60, muteWhen: "not(between(t,10,12))" });
    const res = await screenAudio(path, { sampleCount: 3, sampleWindowMs: 2 * S });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sampled).toBe(false);
  });

  test("zero bytes and too short are empty", async () => {
    const zero = join(dir, "zero.m4a");
    writeFileSync(zero, "");
    expect(await screenAudio(zero)).toMatchObject({ ok: false, code: "empty" });
    const short = await synth("short.m4a", { seconds: 0.4 });
    expect(await screenAudio(short)).toMatchObject({ ok: false, code: "empty" });
  });

  test("garbage bytes are corrupt", async () => {
    const path = join(dir, "garbage.m4a");
    writeFileSync(path, crypto.getRandomValues(new Uint8Array(64 * 1024)));
    expect(await screenAudio(path)).toMatchObject({ ok: false, code: "corrupt" });
  });

  test("an unsupported codec and a file without audio are rejected", async () => {
    const ac3 = await synth("tone.ac3", { seconds: 3, rate: 48000, args: ["-c:a", "ac3"] });
    expect(await screenAudio(ac3)).toMatchObject({ ok: false, code: "unsupported_codec" });

    const video = join(dir, "video.mp4");
    const proc = Bun.spawn(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5:duration=1", "-c:v", "mpeg4", video],
      { stdout: "ignore", stderr: "ignore" },
    );
    expect(await proc.exited).toBe(0);
    expect(await screenAudio(video)).toMatchObject({ ok: false, code: "no_audio_stream" });
  });
});

describe.skipIf(!hasFfmpeg)("normalizeAudio", () => {
  test("quiet stereo 44.1 kHz becomes mono 16 kHz FLAC at about -16 LUFS, same length, plus a transcode", async () => {
    const input = await synth("quiet.wav", {
      seconds: 20,
      rate: 44100,
      volume: 0.1, // about -42 LUFS
      muteWhen: talkGaps,
      args: ["-ac", "2", "-c:a", "pcm_s16le"],
    });
    const out = join(dir, "quiet.flac");
    const result = await normalizeAudio(input, out, { transcode: { path: join(dir, "quiet.m4a"), encoding: { codec: "aac", bitrateKbps: 32 } } });
    expect(result.gain_db).toBeGreaterThan(20);
    near(result.duration_ms, 20 * S, 5);
    const info = await readStreamInfo(out);
    expect([info.codec, info.channels, info.sample_rate]).toEqual(["flac", 1, 16000]);
    near((await measureLoudness(out))!, -16, 1);
    expect(result.transcode).toMatchObject({ mime: "audio/mp4" });
    expect(result.transcode!.bytes).toBeGreaterThan(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  test("pauses over room noise stay silent after normalization (no dynamic gain riding)", async () => {
    // 20 s tone, 30 s pause, 20 s tone, over noise 26 dB below the tone peaks. Dynamic
    // loudnorm lifts the noise in the pause above -35 dBFS here and the pause is lost (measured).
    const input = await synth("pauses.wav", { seconds: 70, noise: 0.006, muteWhen: "between(t,20,50)", args: ["-c:a", "pcm_s16le"] });
    const out = join(dir, "pauses.flac");
    await normalizeAudio(input, out);
    const { silences } = await detectSilences(out);
    expect(silences).toHaveLength(1);
    near(silences[0]!.start_ms, 20 * S, 50);
    near(silences[0]!.end_ms, 50 * S, 50);
    // Options passed as undefined (a caller forwarding its own optional settings) keep the defaults.
    const forwarded = await detectSilences(out, { noiseDb: undefined, minSilenceMs: undefined });
    expect(forwarded.silences).toEqual(silences);
    expect(forwarded.threshold.noise_db).toBe(-35);
  });
});

describe.skipIf(!hasFfmpeg)("detectSilences noiseDb: \"auto\"", () => {
  // 1 s gaps in the tone are short gaps (speech); the 30 s pause at 40–70 s is the one to find.
  const muteWhen = `${talkGaps}+between(t,40,70)`;

  test("a noisy room (22 dB peak SNR): the fixed threshold finds no pause, auto does", async () => {
    const input = await synth("noisy.wav", { seconds: 110, noise: 0.01, muteWhen, args: ["-c:a", "pcm_s16le"] });
    const normalized = await normalizeAudio(input, join(dir, "noisy.flac"));

    const fixed = await detectSilences(normalized.path);
    expect(fixed.silences).toEqual([]);
    expect(fixed.threshold).toEqual({ noise_db: -35, adaptive: false, floor_db: null, speech_db: null });

    const auto = await detectSilences(normalized.path, { noiseDb: "auto" });
    expect(auto.threshold.adaptive).toBe(true);
    expect(auto.threshold.noise_db).toBeGreaterThan(-35);
    expect(auto.threshold.noise_db).toBeLessThanOrEqual(-25);
    expect(auto.silences).toHaveLength(1);
    near(auto.silences[0]!.start_ms, 39 * S, 60); // the tone's last 1 s gap runs into the pause
    near(auto.silences[0]!.end_ms, 70 * S, 60);
  });

  test("a clean recording: auto is the fixed threshold", async () => {
    const input = await synth("clean.wav", { seconds: 110, muteWhen, args: ["-c:a", "pcm_s16le"] });
    const normalized = await normalizeAudio(input, join(dir, "clean.flac"));
    const fixed = await detectSilences(normalized.path);
    const auto = await detectSilences(normalized.path, { noiseDb: "auto" });
    expect(auto.threshold).toMatchObject({ noise_db: -35, adaptive: false });
    expect(auto.silences).toEqual(fixed.silences);
  });

  test("window peaks: one value per 100 ms", async () => {
    const input = await synth("peaks.flac", { seconds: 10, args: ["-c:a", "flac"] });
    const peaks = await measureWindowPeaks(input, 16000);
    expect(peaks.length).toBeGreaterThanOrEqual(99);
    expect(peaks.length).toBeLessThanOrEqual(101);
    for (const db of peaks) near(db, -18, 0.5); // lavfi sine peaks at 1/8
  });

  test("in a noisy room only auto lets speech_map cut the break", async () => {
    // Scaled down: 60 s talk, 60 s pause, 60 s talk; a break is anything >= 30 s here.
    const talk = "gte(mod(t,5),4)+between(t,60,120)";
    const input = await synth("noisy-break.wav", { seconds: 180, noise: 0.01, muteWhen: talk, args: ["-c:a", "pcm_s16le"] });
    const normalized = await normalizeAudio(input, join(dir, "noisy-break.flac"));
    const rules = { breakMinMs: 30 * S };
    const fixedMap = buildSpeechMap(await detectSilences(normalized.path), rules);
    const autoMap = buildSpeechMap(await detectSilences(normalized.path, { noiseDb: "auto" }), rules);
    expect(fixedMap.cuts).toEqual([]);
    expect(autoMap.cuts.map((c) => c.kind)).toEqual(["break"]);
    near(autoMap.cut_duration_ms, 180 * S - 61 * S + 2 * autoMap.rules.cutPadMs, 100);
  }, 30_000);
});

describe.skipIf(!hasFfmpeg)("pipeline: a recording with a 20-minute gap and a tail", () => {
  // 0–60 s talk, 60 s–21 min silence (20 min), 21–22 min talk, 22–24 min silence (tail).
  const talk = (from: number, to: number) => `gte(t,${from})*lt(t,${to})*lt(mod(t,5),4)`;
  const muteWhen = `not(${talk(0, 60)}+${talk(1260, 1320)})`;

  test("screen → normalize → speech_map → speech audio → chunks, times consistent end to end", async () => {
    const input = await synth("gap.m4a", { seconds: 1440, muteWhen, args: ["-c:a", "aac", "-b:a", "32k"] });
    expect((await screenAudio(input)).ok).toBe(true);

    const normalized = await normalizeAudio(input, join(dir, "gap.flac"));
    near(normalized.duration_ms, 1440 * S, 30);

    const detected = await detectSilences(normalized.path, { durationMs: normalized.duration_ms });
    const map = buildSpeechMap(detected);
    const pad = map.rules.cutPadMs;

    // The last tone before the gap stops at 59 s (4 s on, 1 s off); the next starts at 1260 s.
    expect(map.cuts.map((c) => c.kind)).toEqual(["break", "tail"]);
    const [gap, tail] = [map.cuts[0]!, map.cuts[1]!];
    near(gap.start_ms, 59 * S + pad, 60);
    near(gap.end_ms, 1260 * S - pad, 60);
    near(tail.start_ms, 1319 * S + pad, 60);
    expect(tail.end_ms).toBe(normalized.duration_ms);
    expect(formatGapMarker(map.cuts[0]!)).toBe("[쉬는 시간: 1:00~20:58]");
    // Kept: 0–59 s and 1260–1319 s of tone plus three pads; about 22 of 24 minutes are cut.
    near(map.cut_duration_ms, 2 * 59 * S + 3 * pad, 100);

    const speech = await renderSpeechAudio(normalized.path, map.time_map, join(dir, "gap-speech.flac"));
    near(speech.duration_ms, map.cut_duration_ms, 2);

    // The rendered cut audio really is the time map: silencedetect on it finds the silences the
    // map predicts in cut time (those still >= 2 s after cutting), and they map back.
    const cutSilences = (await detectSilences(speech.path, { durationMs: speech.duration_ms })).silences;
    const predicted = map.cut_silences.filter((s) => s.end_ms - s.start_ms >= map.rules.shortGapMs);
    expect(cutSilences).toHaveLength(predicted.length);
    cutSilences.forEach((s, i) => {
      near(s.start_ms, predicted[i]!.start_ms, 30);
      near(s.end_ms, predicted[i]!.end_ms, 30);
    });
    const junction = cutSilences.find((s) => s.start_ms > 50 * S && s.start_ms < 70 * S)!;
    near(toOriginalMs(junction.end_ms, map.time_map), 1260 * S, 60); // first tone after the gap

    // LLM-style chunks (scaled down: 40 s target, 3–6 s overlap) and the dedicated-STT single chunk.
    const plan = planChunks(map.cut_duration_ms, map.cut_silences, { targetMs: 40 * S, overlapMinMs: 3 * S, overlapMaxMs: 6 * S });
    expect(plan.length).toBe(Math.ceil(map.cut_duration_ms / (40 * S)));
    const chunkDir = mkdtempSync(join(dir, "chunks-"));
    const manifest = await renderChunks(speech.path, plan, chunkDir);
    expect(manifest).toMatchObject({ version: 1, timebase: "cut", cut_duration_ms: map.cut_duration_ms });
    for (const chunk of manifest.chunks) {
      expect(existsSync(chunk.path)).toBe(true);
      expect(chunk.mime).toBe("audio/mp4");
      near((await readStreamInfo(chunk.path)).duration_ms, chunk.end_ms - chunk.start_ms, 100); // AAC framing
    }
    expect(readdirSync(chunkDir).sort()).toEqual(plan.map((c) => `chunk-${String(c.index).padStart(3, "0")}.m4a`));

    const whole = planChunks(map.cut_duration_ms, map.cut_silences, { targetMs: null });
    const single = await renderChunks(speech.path, whole, mkdtempSync(join(dir, "whole-")), { prefix: "speech" });
    expect(single.chunks).toHaveLength(1);
    near((await readStreamInfo(single.chunks[0]!.path)).duration_ms, map.cut_duration_ms, 100);
  }, 60_000);
});
