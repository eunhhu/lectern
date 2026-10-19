// The real media clock over a stand-in <audio> element: original-audio ms across parts
// played back to back, seeks that cross a part boundary, the next part starting when one
// ends, and the error status the player turns into "오디오 준비 중".

import { describe, expect, test } from "bun:test";
import { createAudioClock } from "../src/lib/media-clock.ts";

/** Just enough of HTMLAudioElement: src, currentTime, duration, paused, rate, events. */
class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  loads: string[] = [];
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {}
  /** The browser finished reading the metadata of the current src. */
  ready(durationSec: number) {
    this.loads.push(this.src);
    this.duration = durationSec;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}

const make = (parts: { url: string; durationMs: number | null }[], fallback = 0) => {
  const audio = new FakeAudio();
  const clock = createAudioClock(audio as unknown as HTMLAudioElement, parts, fallback);
  return { audio, clock };
};

describe("createAudioClock", () => {
  test("one part: times follow the element; loading until metadata, then ready", () => {
    const { audio, clock } = make([{ url: "/api/v2/assets/a1/content", durationMs: null }], 90_000);
    expect(audio.src).toBe("/api/v2/assets/a1/content");
    expect(clock.status).toBe("loading");
    expect(clock.duration).toBe(90_000);
    audio.ready(120);
    expect(clock.status).toBe("ready");
    expect(clock.duration).toBe(120_000);
    clock.seek(30_500);
    expect(audio.currentTime).toBeCloseTo(30.5);
    expect(clock.currentTime).toBeCloseTo(30_500);
    clock.setPlaybackRate(1.5);
    expect(clock.playbackRate).toBe(1.5);
  });

  test("parts play back to back on one timeline; seeking crosses into the right part", () => {
    const { audio, clock } = make([
      { url: "/p1", durationMs: 60_000 },
      { url: "/p2", durationMs: 30_000 },
    ]);
    audio.ready(60);
    expect(clock.duration).toBe(90_000);
    clock.seek(75_000);
    expect(audio.src).toBe("/p2");
    expect(audio.currentTime).toBeCloseTo(15);
    audio.ready(30);
    expect(clock.currentTime).toBeCloseTo(75_000);
    clock.seek(10_000);
    expect(audio.src).toBe("/p1");
    expect(clock.currentTime).toBeCloseTo(10_000);

    // The first part ends while playing: the second continues from its start.
    clock.play();
    audio.currentTime = 60;
    audio.paused = true;
    audio.dispatchEvent(new Event("ended"));
    expect(audio.src).toBe("/p2");
    expect(audio.currentTime).toBe(0);
    expect(clock.paused).toBe(false);
    expect(clock.currentTime).toBeCloseTo(60_000);
  });

  test("without the durations of later parts only the first part plays", () => {
    const { clock } = make([
      { url: "/p1", durationMs: 60_000 },
      { url: "/p2", durationMs: null },
    ], 95_000);
    expect(clock.duration).toBe(95_000);
  });

  test("a load error is the `error` status; play does nothing then", () => {
    const { audio, clock } = make([{ url: "/api/v2/assets/missing/content", durationMs: null }]);
    let changes = 0;
    clock.subscribe(() => changes++);
    audio.dispatchEvent(new Event("error"));
    expect(clock.status).toBe("error");
    expect(changes).toBe(1);
    clock.play();
    expect(audio.paused).toBe(true);
    clock.dispose();
    expect(audio.src).toBe("");
  });
});
