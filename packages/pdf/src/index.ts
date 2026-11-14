// @lectern/pdf: lecture PDF pages (docs/v2/pipeline/CONTRACTS.md §3). P3-02 adds
// `extractPdfPages` on pdfjs-dist (pinned to the same version as apps/web's viewer);
// pdf-lib only builds test PDFs. Nothing here shells out to system PDF tools.

export const PDF_PACKAGE = "@lectern/pdf";
