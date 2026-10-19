export type LectureStage =
  | "queued"
  | "preparing"
  | "uploading"
  | "waiting_active"
  | "analyzing"
  | "done"
  | "error";

export interface ProgressEvent {
  stage: LectureStage;
  message: string;
  progress?: number; // 0..100
}

export interface DistillOptions {
  audioPath: string;
  courseName?: string;
  title?: string;
  model?: string;
  apiKey?: string;
  customVocabulary?: string[];
  onProgress?: (ev: ProgressEvent) => void;
}

export interface PreparedAudio {
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  maxVolumeDb?: number | null;
  meanVolumeDb?: number | null;
  isTemp: boolean;
}

/** `usageMetadata` of a generateContent response, as Gemini reports it. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  /** Thinking tokens, billed at the output rate. */
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface DistillationResult {
  markdown: string;
  title: string;
  courseName: string;
  excerpt: string;
  modelRequested: string;
  modelUsed: string;
  durationSec: number;
  sizeBytes: number;
  /** Token usage of the generateContent call (for the cost ledger), when Gemini sent it. */
  usage?: GeminiUsageMetadata;
  /** Gemini's responseId, to correlate a ledger row with provider-side logs. */
  requestId?: string;
  /** Wall time of the generateContent request alone (audio prep and upload excluded). */
  generateMs?: number;
}

export interface TocItem {
  id: string;
  level: number;
  text: string;
}

export interface RenderedMarkdown {
  html: string;
  toc: TocItem[];
  excerpt: string;
}
