// Synthetic recordings for the search benchmark (P3-10). Every word comes from WORDS, a
// list of everyday Korean words: no real lecture, person or recording. A fixed seed gives
// the same corpus on every machine, so numbers from two runs compare.

/** Everyday Korean words (exactly 200). Not taken from any real lecture. */
export const WORDS: readonly string[] = [
  "사과", "바다", "하늘", "구름", "나무", "기차", "버스", "자전거", "도서관", "학교",
  "공원", "시장", "식당", "가방", "연필", "공책", "책상", "의자", "창문", "문서",
  "시계", "달력", "전화", "편지", "우산", "신발", "모자", "안경", "지갑", "열쇠",
  "아침", "점심", "저녁", "주말", "계절", "봄날", "여름", "가을", "겨울", "날씨",
  "바람", "햇빛", "소나기", "눈사람", "강물", "호수", "산책", "등산", "여행", "지도",
  "사진", "음악", "노래", "영화", "그림", "소설", "잡지", "신문", "방송", "광고",
  "커피", "녹차", "우유", "빵집", "과자", "케이크", "김밥", "라면", "국수", "만두",
  "냉장고", "세탁기", "청소기", "텔레비전", "컴퓨터", "프린터", "마우스", "키보드", "모니터", "스피커",
  "고양이", "강아지", "토끼", "거북이", "참새", "비둘기", "나비", "꿀벌", "금붕어", "다람쥐",
  "친구", "가족", "이웃", "손님", "동료", "선배", "후배", "아이", "어른", "형제",
  "운동", "축구", "야구", "농구", "배구", "수영", "달리기", "줄넘기", "체조", "탁구",
  "계단", "복도", "현관", "지붕", "마당", "골목", "거리", "다리", "터널", "광장",
  "약속", "계획", "준비", "정리", "청소", "요리", "설거지", "빨래", "장보기", "산보",
  "생각", "기억", "느낌", "마음", "기분", "웃음", "눈물", "걱정", "기쁨", "용기",
  "숫자", "모양", "색깔", "크기", "무게", "길이", "높이", "속도", "방향", "거리감",
  "빨강", "파랑", "노랑", "초록", "보라", "주황", "하양", "검정", "분홍", "회색",
  "시작", "중간", "마무리", "순서", "차례", "기회", "선택", "결정", "변화", "습관",
  "질문", "대답", "설명", "예시", "연습", "복습", "숙제", "발표", "토론", "메모",
  "자동차", "비행기", "배편", "지하철", "택시", "정류장", "터미널", "공항", "항구", "주차장",
  "봉투", "상자", "그릇", "숟가락", "젓가락", "냄비", "주전자", "접시", "컵받침", "수건",
];

/** Deterministic PRNG (mulberry32): the same seed gives the same sequence everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in [min, max]. */
export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pickWord(rand: () => number): string {
  return WORDS[Math.floor(rand() * WORDS.length)]!;
}

export const SEGMENTS_PER_RECORDING = 300;

export interface SynthSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

export interface SynthRecording {
  id: string;
  title: string;
  segments: SynthSegment[];
}

/** Recording `i`: 300 segments of 12–20 words, ascending times, two or three speakers. */
export function synthRecording(i: number, rand: () => number): SynthRecording {
  const speakers = randInt(rand, 2, 3);
  const segments: SynthSegment[] = [];
  let at = 0;
  for (let idx = 0; idx < SEGMENTS_PER_RECORDING; idx++) {
    const words = Array.from({ length: randInt(rand, 12, 20) }, () => pickWord(rand));
    // Mostly short pauses, now and then a longer one, so windows close at varied places.
    const start = at + (rand() < 0.1 ? randInt(rand, 2_000, 5_000) : randInt(rand, 100, 900));
    const end = start + words.length * randInt(rand, 250, 400);
    segments.push({ idx, start_ms: start, end_ms: end, speaker: `spk_${randInt(rand, 1, speakers)}`, text: `${words.join(" ")}.` });
    at = end;
  }
  return { id: `rec_bench_${String(i).padStart(5, "0")}`, title: `합성 녹음 ${i} ${pickWord(rand)}`, segments };
}

/** A query of 2–3 words from WORDS. */
export function synthQuery(rand: () => number): string {
  return Array.from({ length: randInt(rand, 2, 3) }, () => pickWord(rand)).join(" ");
}

/** Nearest-rank percentile of an ascending array (`p` in 0–100). NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(1, rank) - 1]!;
}
