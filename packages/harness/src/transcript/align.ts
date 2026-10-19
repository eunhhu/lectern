// Character alignment for merge (AI_HARNESS §3.5) and the eval metrics. Pure and
// deterministic: integer scores, fixed tie-breaking.

export interface AlignScoring {
  match: number;
  mismatch: number;
  gap: number;
}

/** Same audio heard twice should agree on most syllables; this tolerates about one in three differing. */
export const LOCAL_ALIGN_SCORING: Readonly<AlignScoring> = Object.freeze({ match: 2, mismatch: -1, gap: -1 });

export interface LocalAlignment {
  score: number;
  /** Equal characters aligned to each other, as [index in a, index in b], increasing in both. */
  pairs: Array<[number, number]>;
}

const DIAG = 1;
const UP = 2;
const LEFT = 3;

/**
 * Smith–Waterman local alignment: the stretch of `a` and the stretch of `b` that agree
 * best, wherever they are. Used on the text of two chunks around their shared audio, where
 * one chunk's copy may sit tens of seconds off in time (§3.3 drift). O(|a|·|b|) time and
 * memory; callers bound the inputs. Null when nothing aligns (score 0).
 *
 * Ties: the best cell is the first one in row-major order; the traceback prefers a
 * diagonal step, then a gap in `b`, then a gap in `a`.
 */
export function localAlign(a: readonly string[], b: readonly string[], scoring: AlignScoring = LOCAL_ALIGN_SCORING): LocalAlignment | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return null;
  const width = m + 1;
  const score = new Int32Array((n + 1) * width);
  const step = new Uint8Array((n + 1) * width);
  let best = 0;
  let bestCell = -1;
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const cell = i * width + j;
      const diag = score[cell - width - 1]! + (ai === b[j - 1] ? scoring.match : scoring.mismatch);
      const up = score[cell - width]! + scoring.gap;
      const left = score[cell - 1]! + scoring.gap;
      let value = 0;
      let dir = 0;
      if (diag > value) {
        value = diag;
        dir = DIAG;
      }
      if (up > value) {
        value = up;
        dir = UP;
      }
      if (left > value) {
        value = left;
        dir = LEFT;
      }
      score[cell] = value;
      step[cell] = dir;
      if (value > best) {
        best = value;
        bestCell = cell;
      }
    }
  }
  if (bestCell < 0) return null;

  const pairs: Array<[number, number]> = [];
  let i = Math.floor(bestCell / width);
  let j = bestCell % width;
  while (i > 0 && j > 0 && score[i * width + j]! > 0) {
    const dir = step[i * width + j];
    if (dir === DIAG) {
      if (a[i - 1] === b[j - 1]) pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dir === UP) {
      i--;
    } else if (dir === LEFT) {
      j--;
    } else {
      break;
    }
  }
  pairs.reverse();
  return { score: best, pairs };
}

/** Edit counts of the cheapest transformation of `ref` into `hyp`. */
export interface EditCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Characters (or words) of `ref`. */
  refLength: number;
}

/**
 * Levenshtein distance with its substitution/deletion/insertion split, in two rows of
 * memory (a three-hour transcript is about 30,000 syllables). Ties prefer a substitution,
 * then a deletion, then an insertion, so the split is deterministic.
 */
export function editCounts<T>(ref: readonly T[], hyp: readonly T[]): EditCounts {
  const m = hyp.length;
  // Each cell: cost, and the S/D/I counts of the path that reached it.
  let prevCost = new Int32Array(m + 1);
  let prevS = new Int32Array(m + 1);
  let prevD = new Int32Array(m + 1);
  let prevI = new Int32Array(m + 1);
  let curCost = new Int32Array(m + 1);
  let curS = new Int32Array(m + 1);
  let curD = new Int32Array(m + 1);
  let curI = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) {
    prevCost[j] = j;
    prevI[j] = j;
  }
  for (let i = 1; i <= ref.length; i++) {
    curCost[0] = i;
    curS[0] = 0;
    curD[0] = i;
    curI[0] = 0;
    const r = ref[i - 1];
    for (let j = 1; j <= m; j++) {
      const same = r === hyp[j - 1];
      const diag = prevCost[j - 1]! + (same ? 0 : 1);
      const del = prevCost[j]! + 1;
      const ins = curCost[j - 1]! + 1;
      if (diag <= del && diag <= ins) {
        curCost[j] = diag;
        curS[j] = prevS[j - 1]! + (same ? 0 : 1);
        curD[j] = prevD[j - 1]!;
        curI[j] = prevI[j - 1]!;
      } else if (del <= ins) {
        curCost[j] = del;
        curS[j] = prevS[j]!;
        curD[j] = prevD[j]! + 1;
        curI[j] = prevI[j]!;
      } else {
        curCost[j] = ins;
        curS[j] = curS[j - 1]!;
        curD[j] = curD[j - 1]!;
        curI[j] = curI[j - 1]! + 1;
      }
    }
    [prevCost, curCost] = [curCost, prevCost];
    [prevS, curS] = [curS, prevS];
    [prevD, curD] = [curD, prevD];
    [prevI, curI] = [curI, prevI];
  }
  return { substitutions: prevS[m]!, deletions: prevD[m]!, insertions: prevI[m]!, refLength: ref.length };
}

/**
 * Global alignment (Needleman–Wunsch, unit costs) as aligned index pairs of equal or
 * substituted elements; an index of -1 marks a deletion (hyp side) or insertion (ref
 * side). Full traceback, so callers keep the inputs to a few thousand elements (the eval
 * windows them).
 */
export function globalAlign<T>(ref: readonly T[], hyp: readonly T[]): Array<[number, number]> {
  const n = ref.length;
  const m = hyp.length;
  const width = m + 1;
  const cost = new Int32Array((n + 1) * width);
  for (let j = 0; j <= m; j++) cost[j] = j;
  for (let i = 1; i <= n; i++) {
    cost[i * width] = i;
    for (let j = 1; j <= m; j++) {
      const cell = i * width + j;
      const diag = cost[cell - width - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const del = cost[cell - width]! + 1;
      const ins = cost[cell - 1]! + 1;
      cost[cell] = Math.min(diag, del, ins);
    }
  }
  const out: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cell = i * width + j;
    if (i > 0 && j > 0 && cost[cell] === cost[cell - width - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      out.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (i > 0 && cost[cell] === cost[cell - width]! + 1) {
      out.push([i - 1, -1]);
      i--;
    } else {
      out.push([-1, j - 1]);
      j--;
    }
  }
  return out.reverse();
}
