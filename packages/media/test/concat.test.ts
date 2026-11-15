import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { concatAudio, isFfmpegAvailable, MediaError, readStreamInfo } from "../src/index.ts";

// Synthetic tones only (`-f lavfi`). Skipped without ffmpeg.

const dir = mkdtempSync(join(process.env.LECTERN_TEST_SANDBOX ?? tmpdir(), "concat-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A `seconds`-long 300 Hz tone at `rate` Hz and `channels`, encoded by `codecArgs`. */
async function tone(name: string, seconds: number, opts: { rate?: number; channels?: number; codecArgs?: string[] } = {}): Promise<string> {
  const path = join(dir, name);
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=300:sample_rate=${opts.rate ?? 16000}:duration=${seconds}`,
      "-ac",
      String(opts.channels ?? 1),
      ...(opts.codecArgs ?? ["-c:a", "aac", "-b:a", "48k"]),
      path,
    ],
    { stdout: "ignore", stderr: "pipe" }
  );
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`ffmpeg fixture failed: ${stderr}`);
  return path;
}

const near = (value: number, target: number, tolerance: number) => expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance);

describe("concatAudio", () => {
  test("concatAudio empty list", async () => {
    const err = await concatAudio([], join(dir, "none.flac")).catch((e) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).code).toBe("empty");
  });

  describe.skipIf(!isFfmpegAvailable())("with ffmpeg", () => {
    test("concatAudio joins in order", async () => {
      const a = await tone("a.m4a", 2);
      const b = await tone("b.m4a", 3);
      const out = join(dir, "ab.flac");
      const result = await concatAudio([a, b], out);
      near(result.duration_ms, 5000, 150);
      expect(result.parts.map((p) => p.path)).toEqual([a, b]);
      near(result.parts[0]!.duration_ms, 2000, 100);
      near(result.parts[1]!.duration_ms, 3000, 100);
      const info = await readStreamInfo(out);
      expect(info).toMatchObject({ codec: "flac", channels: 1, sample_rate: 16000 });
    });

    test("concatAudio single input", async () => {
      const a = await tone("single.m4a", 2);
      const result = await concatAudio([a], join(dir, "single.flac"));
      near(result.duration_ms, 2000, 100);
      expect(result.parts.length).toBe(1);
    });

    test("concatAudio mixed formats", async () => {
      const a = await tone("mixed-a.m4a", 2, { rate: 44100, channels: 2 });
      const b = await tone("mixed-b.wav", 3, { rate: 8000, codecArgs: ["-c:a", "pcm_s16le"] });
      const result = await concatAudio([a, b], join(dir, "mixed.flac"));
      near(result.duration_ms, result.parts[0]!.duration_ms + result.parts[1]!.duration_ms, 150);
      near(result.duration_ms, 5000, 150);
    });

    test("a file without audio fails, and nothing is left under the final name", async () => {
      const a = await tone("ok.m4a", 1);
      const out = join(dir, "broken.flac");
      const err = await concatAudio([a, join(dir, "missing.m4a")], out).catch((e) => e);
      expect(err).toBeInstanceOf(MediaError);
      expect(await Bun.file(out).exists()).toBe(false);
    });
  });
});
