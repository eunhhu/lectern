// Plain-text report of an eval run, optionally against a baseline run (§8 comparison report).

import { formatClock } from "@lectern/media";
import type { CostEstimate, EvalRun } from "./run.ts";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;
const sec = (ms: number | undefined) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`);

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => [...(r[c] ?? "")].length)));
  return rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd()).join("\n");
}

export function formatEstimate(estimate: CostEstimate): string {
  return [
    `예상 비용 (상한): ${usd(estimate.max_microusd)} — ${estimate.provider}/${estimate.model}`,
    `  녹음 ${estimate.items}건, ${formatClock(estimate.audio_seconds * 1000)} (휴식 제거·캐시 적중 전 기준)`,
    `  가정: ${estimate.assumptions}`,
  ].join("\n");
}

export function formatReport(run: EvalRun, baseline?: EvalRun): string {
  const rows = [["item", "status", "length", "cut", "chunks", "missing", "CER", "WER", "spk err", "ts p50", "cost", "calls"]];
  for (const item of run.items) {
    rows.push([
      item.id,
      item.status,
      formatClock(item.duration_ms),
      item.status === "ok" && item.duration_ms ? pct(1 - item.cut_duration_ms / item.duration_ms) : "—",
      String(item.chunks),
      String(item.chunk_failures.length),
      pct(item.metrics?.cer),
      pct(item.metrics?.wer),
      pct(item.metrics?.speaker_error),
      sec(item.metrics?.timestamp_offset_ms?.median),
      usd(item.cost_microusd),
      String(item.provider_calls),
    ]);
  }
  const t = run.totals;
  const lines = [
    `eval ${run.label} — set ${run.set.id}, ${run.provider}/${run.model}, ${run.created_at}`,
    "",
    table(rows),
    "",
    `합계: CER ${pct(t.cer)}, WER ${pct(t.wer)}, 화자 오류 ${pct(t.speaker_error)} (채점 ${t.scored}건, 참조 ${t.ref_chars}자)`,
    `비용: ${usd(t.cost_microusd)} (이번 실행에서 실제 호출분), 녹음 1시간당 ${t.usd_per_audio_hour === null ? "—" : `$${t.usd_per_audio_hour.toFixed(3)}`}`,
  ];
  for (const item of run.items.filter((i) => i.error)) lines.push(`- ${item.id}: ${item.error}`);
  if (baseline) {
    const b = baseline.totals;
    const delta = (a: number | null, z: number | null) =>
      a === null || z === null ? "—" : `${a >= z ? "+" : ""}${((a - z) * 100).toFixed(1)}%p`;
    lines.push(
      "",
      `기준(${baseline.label}, ${baseline.created_at}) 대비: CER ${delta(t.cer, b.cer)}, WER ${delta(t.wer, b.wer)}, 화자 오류 ${delta(t.speaker_error, b.speaker_error)}`,
    );
  }
  return lines.join("\n");
}
