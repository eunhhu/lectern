import { describe, expect, test } from "bun:test";
import { AskCitation } from "@lectern/domain";
import {
  AnswerStreamFilter,
  claimsByLabel,
  labelPassages,
  narrowTranscript,
  NO_ANSWER_SENTINEL,
  recordingChunks,
  supportScore,
  verifyAnswer,
} from "../src/index.ts";
import { resolveAccessScope } from "../src/scope.ts";
import { FOLDERS, ME, REC, RECORDINGS, scopeOf, seededDb, WS } from "./fixtures.ts";

function feed(filter: AnswerStreamFilter, pieces: string[]) {
  const out: string[] = [];
  const labels: string[] = [];
  for (const p of pieces) {
    const r = filter.push(p);
    out.push(r.text);
    labels.push(...r.newLabels);
  }
  const end = filter.end();
  out.push(end.text);
  labels.push(...end.newLabels);
  return { text: out.join(""), labels };
}

describe("answer stream filter", () => {
  test("keeps known markers, drops unknown ones, even when split across chunks", () => {
    const f = new AnswerStreamFilter(["c1", "c2"]);
    const r = feed(f, ["ECB는 위험합니다 [c", "1][c9]. 시험에 나옵니다 [c2", "]."]);
    expect(r.text).toBe("ECB는 위험합니다 [c1]. 시험에 나옵니다 [c2].");
    expect(r.labels).toEqual(["c1", "c2"]);
    expect(f.text).toBe(r.text);
  });

  test("normalizes lists and full-width brackets", () => {
    const f = new AnswerStreamFilter(["c1", "c3"]);
    expect(feed(f, ["두 가지입니다 [c1, c3, c4]. 그리고 【c3】"]).text).toBe("두 가지입니다 [c1][c3]. 그리고 [c3]");
  });

  test("leaves ordinary brackets alone", () => {
    const f = new AnswerStreamFilter(["c1"]);
    expect(feed(f, ["[참고] 내용", " [1] 각주"]).text).toBe("[참고] 내용 [1] 각주");
  });

  test("detects the 모름 sentinel even when it arrives in pieces", () => {
    const f = new AnswerStreamFilter(["c1"]);
    const r = feed(f, ["  [[", "모름]] 노트에 시험 날짜가 없습니다."]);
    expect(f.noAnswer).toBe(true);
    expect(r.text).toBe("노트에 시험 날짜가 없습니다.");
    expect(NO_ANSWER_SENTINEL).toBe("[[모름]]");
  });

  test("a citation label added by a tool round becomes valid", () => {
    const f = new AnswerStreamFilter(["c1"]);
    f.addLabels(["c2"]);
    expect(feed(f, ["더 있습니다 [c2]."]).labels).toEqual(["c2"]);
  });
});

describe("claims and support", () => {
  test("a marker belongs to the sentence before it, before or after the period", () => {
    const claims = claimsByLabel("ECB는 패턴이 드러납니다 [c1]. CBC는 IV가 필요합니다.[c2]\n- IV는 예측 불가 [c2]");
    expect(claims.get("c1")).toEqual(["ECB는 패턴이 드러납니다"]);
    expect(claims.get("c2")).toEqual(["CBC는 IV가 필요합니다", "IV는 예측 불가"]);
  });

  test("support is the share of the sentence's tokens found in the passage", () => {
    expect(supportScore("CBC는 IV가 필요", "CBC에는 IV가 필요하고")).toBeGreaterThan(0.6);
    expect(supportScore("출시일은 11월 3일", "CBC에는 IV가 필요하고")).toBe(0);
    expect(supportScore("", "x")).toBe(1);
  });
});

describe("verify", () => {
  const db = seededDb();
  const scope = resolveAccessScope({
    workspaceId: WS,
    caller: { userId: ME, role: "owner" },
    scope: scopeOf({ kind: "recording", recording_id: REC.crypto }),
    recordings: RECORDINGS,
    folders: FOLDERS,
  });
  if ("code" in scope) throw new Error(scope.message);
  const passages = labelPassages(scope, recordingChunks(db, WS, REC.crypto));
  const transcript = passages.find((p) => p.chunk.kind === "transcript" && p.chunk.startIdx === 0)!;
  const doc = passages.find((p) => p.chunk.blockId === "b3")!;

  test("narrows a transcript citation to the matching segments", () => {
    const n = narrowTranscript(transcript, "평문의 패턴이 암호문에 그대로 드러나서 위험합니다")!;
    expect([n.startIdx, n.endIdx]).toEqual([3, 3]);
    const seg = transcript.chunk.spans!.find((s) => s[0] === 3)!;
    expect(n.startMs).toBe(seg[1]);
  });

  test("answered: supported and weak citations, domain-valid DTOs", () => {
    const answer = `ECB는 평문의 패턴이 암호문에 드러나서 위험합니다 [${transcript.label}]. 출시일은 11월 3일입니다 [${doc.label}].`;
    const v = verifyAnswer({ answer, noAnswer: false, passages, access: scope });
    expect(v.outcome).toBe("answered");
    const byLabel = new Map(v.citations.map((c) => [c.label, c]));
    expect(byLabel.get(transcript.label)!.support).toBe("supported");
    expect(byLabel.get(doc.label)!.support).toBe("weak");
    // Citations come back in label order (documents are labelled before the transcript).
    expect(v.citations.map((c) => c.label)).toEqual([doc.label, transcript.label]);
    for (const c of v.citations) expect(AskCitation.safeParse(c).success).toBe(true);
    const t = byLabel.get(transcript.label)!;
    expect(t.kind === "transcript" && [t.start_idx, t.end_idx]).toEqual([3, 3]);
    const d = byLabel.get(doc.label)!;
    expect(d.kind === "document" ? (d.block_id as string | null) : null).toBe("b3");
  });

  test("unsupported when no valid citation survives", () => {
    const v = verifyAnswer({ answer: "ECB는 위험합니다.", noAnswer: false, passages, access: scope });
    expect(v.outcome).toBe("unsupported");
    expect(v.citations).toEqual([]);
  });

  test("no_answer keeps the model's reason or a default", () => {
    expect(verifyAnswer({ answer: "", noAnswer: true, passages, access: scope })).toMatchObject({ outcome: "no_answer" });
    expect(verifyAnswer({ answer: "", noAnswer: true, passages, access: scope }).answer).toContain("찾지 못했습니다");
  });

  test("a passage outside the scope is rejected even if it was labelled", () => {
    const foreign = { label: "c99", chunk: { ...transcript.chunk, recordingId: REC.meeting } };
    expect(() => verifyAnswer({ answer: "회의 [c99].", noAnswer: false, passages: [...passages, foreign], access: scope })).toThrow();
  });
});
