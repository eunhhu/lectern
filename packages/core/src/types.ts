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
  isTemp: boolean;
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
