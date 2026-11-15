import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentReadyAlert,
  liveActivityEnd,
  liveActivityStart,
  liveActivityUpdate,
  processingFailedAlert,
  stageLabel,
  type ContentState,
} from "../src/apns/payload.ts";

// APNs payloads (P6-02, D-P6-12), compared character for character. The same JSON is kept in
// test/fixtures/apns/: the Apple app (P6-A11) decodes those files in its own tests.

const FIXTURES = join(import.meta.dir, "fixtures", "apns");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const RECORDING = "0199f0a0-1000-7000-8000-00000000abcd";
const NOW = 1_794_700_000;
const URL = `https://lectern.example/app/recordings/${RECORDING}`;
const running: ContentState = { stage: "structure", stage_label: "노트 구성 중", progress: 80, recording_id: RECORDING, document_ready: false };
const done: ContentState = { stage: "done", stage_label: "문서 준비됨", progress: 100, recording_id: RECORDING, document_ready: true };

describe("APNs payloads", () => {
  test("live activity update", () => {
    const payload = liveActivityUpdate(running, NOW);
    expect(payload).toEqual({ aps: { timestamp: NOW, event: "update", "content-state": running } });
    expect(payload).toEqual(fixture("live-activity-update.json"));
  });

  test("live activity end", () => {
    const payload = liveActivityEnd(done, NOW);
    expect(payload).toEqual({ aps: { timestamp: NOW, event: "end", "content-state": done, "dismissal-date": NOW + 3600 } });
    expect(payload).toEqual(fixture("live-activity-end.json"));
  });

  test("live activity start", () => {
    const payload = liveActivityStart(running, { recording_id: RECORDING, title: "자료구조 3주차" }, NOW);
    expect(payload).toEqual({
      aps: {
        timestamp: NOW,
        event: "start",
        "content-state": running,
        "attributes-type": "ProcessingActivityAttributes",
        attributes: { recording_id: RECORDING, title: "자료구조 3주차" },
        alert: { title: "녹음을 처리하고 있습니다", body: "자료구조 3주차" },
      },
    });
    expect(payload).toEqual(fixture("live-activity-start.json"));
  });

  test("document ready alert", () => {
    const payload = documentReadyAlert({ recordingId: RECORDING, title: "자료구조 3주차", url: URL, partial: false });
    expect(payload).toEqual({
      aps: {
        alert: { title: "문서가 준비되었습니다", body: "자료구조 3주차" },
        sound: "default",
        "thread-id": `recording-${RECORDING}`,
        "interruption-level": "active",
      },
      recording_id: RECORDING,
      url: URL,
    });
    expect(payload).toEqual(fixture("alert-ready.json"));
    expect((documentReadyAlert({ recordingId: RECORDING, title: "x", url: URL, partial: true }) as any).aps.alert.title).toBe("전사가 준비되었습니다");
  });

  test("processing failed alert", () => {
    const payload = processingFailedAlert({ recordingId: RECORDING, title: "자료구조 3주차", url: URL });
    expect(payload).toEqual({
      aps: {
        alert: { title: "녹음을 처리하지 못했습니다", body: "자료구조 3주차" },
        sound: "default",
        "thread-id": `recording-${RECORDING}`,
        "interruption-level": "active",
      },
      recording_id: RECORDING,
      url: URL,
    });
    expect(payload).toEqual(fixture("alert-failed.json"));
  });

  test("title is cut at 100 chars", () => {
    const title = "가".repeat(150);
    expect((documentReadyAlert({ recordingId: RECORDING, title, url: URL, partial: false }) as any).aps.alert.body).toHaveLength(100);
    const start = liveActivityStart(running, { recording_id: RECORDING, title }, NOW) as any;
    expect(start.aps.attributes.title).toHaveLength(100);
    expect(start.aps.alert.body).toHaveLength(100);
  });

  test("payload stays under 4096 bytes", () => {
    const title = "녹".repeat(1000);
    for (const payload of [
      liveActivityStart(running, { recording_id: RECORDING, title }, NOW),
      documentReadyAlert({ recordingId: RECORDING, title, url: URL, partial: false }),
      processingFailedAlert({ recordingId: RECORDING, title, url: URL }),
      liveActivityUpdate(running, NOW),
      liveActivityEnd(done, NOW),
    ]) {
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4096);
    }
  });

  test("unknown stage label is 처리 중", () => {
    expect(stageLabel("speech_map")).toBe("처리 중");
    expect(stageLabel("transcribe")).toBe("전사 중");
    expect(stageLabel("align")).toBe("전사 정리 중");
    expect(stageLabel("speakers")).toBe("전사 정리 중");
    expect(stageLabel("extract")).toBe("일정·할 일 찾는 중");
  });
});
