// Synthetic audio for the load scripts: a tone plus noise, different for every seed (the server
// treats identical audio as one recording by sha256). No recording of anyone.
//
// The sound comes in bursts: BURST_SECONDS of tone and noise at the start of every
// BURST_EVERY_SECONDS, digital silence in between. start.ts's fake transcription answers every
// chunk with the same three sentences (12 s), and the transcript checks
// (packages/harness/src/transcript/validate.ts) refuse that for a chunk with 20 s of speech or
// more (coverage under 30%). A 6-minute chunk (up to about 8 minutes with overlap and seam
// moves) then holds at most ~16 s of speech, so processing runs end to end. No burst island
// reaches 20 s, so the speech map cuts nothing and the whole duration is chunked and processed.

import { join } from "node:path";
import { isFfmpegAvailable } from "../../../packages/media/src/ffmpeg.ts";

export interface SynthAudio {
  path: string;
  bytes: number;
  seconds: number;
  format: "wav";
}

export const SAMPLE_RATE = 16_000;
export const BURST_SECONDS = 1;
export const BURST_EVERY_SECONDS = 30;

/** Size of a 16-bit mono WAV: the 44-byte header plus the samples. */
export function wavBytes(seconds: number, sampleRate = SAMPLE_RATE): number {
  return 44 + Math.round(seconds * sampleRate) * 2;
}

/**
 * 16 kHz mono 16-bit WAV of a tone plus noise (in bursts, see above). ffmpeg when present, a
 * streamed TypeScript writer otherwise. Use at least 61 s: shorter files have too little sound
 * for the fake transcript's length (more than 30 letters per second of speech is refused).
 */
export async function synthAudio(dir: string, name: string, seconds: number, seed: number): Promise<SynthAudio> {
  const path = join(dir, `${name}.wav`);
  if (isFfmpegAvailable()) await ffmpegWav(path, seconds, seed);
  else await writeWav(path, seconds, seed);
  return { path, bytes: Bun.file(path).size, seconds, format: "wav" };
}

async function ffmpegWav(path: string, seconds: number, seed: number): Promise<void> {
  const duration = String(seconds);
  const proc = Bun.spawn(
    [
      "ffmpeg", "-v", "error", "-y",
      "-f", "lavfi", "-i", `sine=frequency=${300 + seed * 37}:sample_rate=${SAMPLE_RATE}:duration=${duration}`,
      "-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=${SAMPLE_RATE}:duration=${duration}:amplitude=0.05:seed=${seed}`,
      "-filter_complex", `amix=inputs=2:duration=first,volume='if(lt(mod(t,${BURST_EVERY_SECONDS}),${BURST_SECONDS}),1,0)':eval=frame`,
      "-ac", "1", "-c:a", "pcm_s16le", path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${(await new Response(proc.stderr).text()).trim()}`);
}

/**
 * The TypeScript path: the header, then one second of samples at a time, so a three-hour file
 * (about 345 MB) never sits in memory. A sine whose pitch and phase depend on the seed, with a
 * little seeded noise, in bursts.
 */
export async function writeWav(path: string, seconds: number, seed: number, sampleRate = SAMPLE_RATE): Promise<void> {
  const samples = Math.round(seconds * sampleRate);
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, samples * 2, true);

  const writer = Bun.file(path).writer();
  writer.write(new Uint8Array(header.buffer));
  const frequency = 300 + seed * 37;
  let state = (seed * 2654435761) >>> 0 || 1;
  const block = new DataView(new ArrayBuffer(sampleRate * 2));
  for (let start = 0; start < samples; start += sampleRate) {
    const count = Math.min(sampleRate, samples - start);
    for (let i = 0; i < count; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0; // LCG noise
      const noise = (state / 0xffffffff - 0.5) * 600;
      const t = (start + i) / sampleRate;
      const sounding = t % BURST_EVERY_SECONDS < BURST_SECONDS;
      block.setInt16(i * 2, sounding ? Math.round(Math.sin(2 * Math.PI * frequency * t + seed) * 6000 + noise) : 0, true);
    }
    writer.write(new Uint8Array(block.buffer, 0, count * 2));
    await writer.flush();
  }
  await writer.end();
}
