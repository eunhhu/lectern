// pdf.js for the PDF viewer (D-P3-7). Loaded lazily, so the first screen never pays for it:
// the module is its own chunk and the worker is a separate same-origin file
// (scripts/build.ts emitPdfWorker), whose URL and the data directory come from `define`.
// Eval stays off (`script-src 'self'` has no 'unsafe-eval'), XFA forms are not rendered,
// and the main thread fetches CMaps, fonts and decoders from /app/assets.

type Pdfjs = typeof import("pdfjs-dist");

let loading: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= import("pdfjs-dist").then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = process.env.LECTERN_PDF_WORKER!;
      return pdfjs;
    },
    (err: unknown) => {
      loading = null; // a failed chunk load is retried next time
      throw err;
    },
  );
  return loading;
}

const DATA = process.env.LECTERN_PDF_DATA!;

export const PDF_OPEN_OPTIONS = {
  isEvalSupported: false,
  enableXfa: false,
  useWorkerFetch: false,
  cMapUrl: `${DATA}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${DATA}standard_fonts/`,
  wasmUrl: `${DATA}wasm/`,
  iccUrl: `${DATA}iccs/`,
} as const;
