// APNs payloads (CONTRACTS D-P6-2, D-P6-12). Pure functions: the apps (P6-A11) decode the same
// JSON, kept as fixtures in apps/server/test/fixtures/apns/.

/** The Live Activity's content state; the app's `ContentState` has the same shape (D-P6-12). */
export interface ContentState {
  stage: string;
  stage_label: string;
  progress: number | null;
  recording_id: string;
  document_ready: boolean;
}

/** Korean label per processing stage, plus the two endings. */
export const STAGE_LABEL: Record<string, string> = {
  ingest: "준비 중",
  transcribe: "전사 중",
  align: "전사 정리 중",
  speakers: "전사 정리 중",
  classify: "분류 중",
  structure: "노트 구성 중",
  extract: "일정·할 일 찾는 중",
  verify: "검증 중",
  publish: "마무리 중",
  done: "문서 준비됨",
  failed: "처리 실패",
  canceled: "취소됨",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? "처리 중";
}

/** The `attributes-type` of a push-to-start; the app's ActivityAttributes type has this name. */
export const ACTIVITY_ATTRIBUTES_TYPE = "ProcessingActivityAttributes";
const TITLE_MAX = 100;

const cut = (title: string) => (title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title);

export function liveActivityUpdate(state: ContentState, nowSec: number): object {
  return { aps: { timestamp: nowSec, event: "update", "content-state": state } };
}

export function liveActivityEnd(state: ContentState, nowSec: number): object {
  return { aps: { timestamp: nowSec, event: "end", "content-state": state, "dismissal-date": nowSec + 3600 } };
}

export function liveActivityStart(state: ContentState, attrs: { recording_id: string; title: string }, nowSec: number): object {
  const attributes = { recording_id: attrs.recording_id, title: cut(attrs.title) };
  return {
    aps: {
      timestamp: nowSec,
      event: "start",
      "content-state": state,
      "attributes-type": ACTIVITY_ATTRIBUTES_TYPE,
      attributes,
      alert: { title: "녹음을 처리하고 있습니다", body: attributes.title },
    },
  };
}

function alert(title: string, p: { recordingId: string; title: string; url: string }): object {
  return {
    aps: {
      alert: { title, body: cut(p.title) },
      sound: "default",
      "thread-id": `recording-${p.recordingId}`,
      "interruption-level": "active",
    },
    recording_id: p.recordingId,
    url: p.url,
  };
}

export function documentReadyAlert(p: { recordingId: string; title: string; url: string; partial: boolean }): object {
  return alert(p.partial ? "전사가 준비되었습니다" : "문서가 준비되었습니다", p);
}

export function processingFailedAlert(p: { recordingId: string; title: string; url: string }): object {
  return alert("녹음을 처리하지 못했습니다", p);
}
