// The PDF viewer of the files panel (D-P3-7): one page at a time on a single canvas, so a
// 300-page deck costs what one page costs, with an invisible text layer for selecting and
// copying text. Pages move with the buttons, the keyboard (on the page area) or the page
// field; a source chip or an ask citation opens its page through `targetPage`. A scanned
// PDF offers OCR behind a cost confirmation (OcrDialog).
//
// No inline styles: sizes reach CSS as custom properties on the page box (CSSOM, which
// `style-src 'self'` allows), the same way pdf.js sizes its own text layer.

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useApi, useAssetPages } from "../../../api/queries.ts";
import { isImeComposing } from "../../../lib/keyboard.ts";
import { clampPage, nextZoom, ZOOM_STEPS } from "../../../lib/pdf-view.ts";
import { Badge, Button, ErrorBox } from "../../../ui/controls.tsx";
import { OcrDialog } from "./OcrDialog.tsx";
import { loadPdfjs, PDF_OPEN_OPTIONS } from "./pdfjs.ts";
import s from "./pdf.module.css";

/** CSS pixels per PDF point at 100% when the panel is wide enough (pdf.js's own default). */
const BASE_SCALE = 1.25;

export interface PdfViewerProps {
  assetId: string;
  recordingId: string;
  name: string;
  /** Page count the server extracted; the document's own count wins once it is open. */
  pageCount: number;
  /** A page to show, re-applied whenever `token` changes (source chips, ask citations). */
  targetPage: { page: number; token: number } | null;
}

export function PdfViewer({ assetId, recordingId, name, pageCount, targetPage }: PdfViewerProps) {
  const api = useApi();
  const url = api.assetContentUrl(assetId);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [drawFailed, setDrawFailed] = useState(false);
  const [page, setPage] = useState(() => (targetPage ? clampPage(targetPage.page, pageCount) : 1));
  const [zoom, setZoom] = useState(1);
  const [pageField, setPageField] = useState(String(page));
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const lastRender = useRef<RenderTask | null>(null);
  const count = doc?.numPages ?? Math.max(1, pageCount);

  // Open the document. Destroying the loading task also destroys the document and its worker port.
  useEffect(() => {
    setDoc(null);
    setOpenFailed(false);
    if (!url) {
      setOpenFailed(true);
      return;
    }
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    loadPdfjs()
      .then((pdfjs) => {
        if (cancelled) return;
        task = pdfjs.getDocument({ url, ...PDF_OPEN_OPTIONS });
        return task.promise.then((opened) => {
          if (!cancelled) setDoc(opened);
        });
      })
      .catch(() => {
        if (!cancelled) setOpenFailed(true);
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  // Keep the page inside the document once its real page count is known.
  useEffect(() => {
    if (doc) setPage((p) => clampPage(p, doc.numPages));
  }, [doc]);

  // A source chip or an ask citation asked for a page.
  const targetToken = targetPage?.token;
  useEffect(() => {
    if (!targetPage) return;
    setPage(clampPage(targetPage.page, count));
    stageRef.current?.scrollIntoView?.({ block: "nearest" });
    // Only a new token re-applies the target; a later count change must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetToken]);

  useEffect(() => setPageField(String(page)), [page]);

  // Draw the current page: the canvas at device resolution, then its text layer.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let text: TextLayer | null = null;
    setDrawFailed(false);
    void (async () => {
      try {
        // pdf.js refuses a canvas that an earlier render still holds; wait for it to let go.
        await lastRender.current?.promise.catch(() => undefined);
        const [pdfjs, pg] = await Promise.all([loadPdfjs(), doc.getPage(page)]);
        const canvas = canvasRef.current;
        const layer = layerRef.current;
        const box = boxRef.current;
        if (cancelled || !canvas || !layer || !box) return;
        const natural = pg.getViewport({ scale: 1 });
        const room = stageRef.current?.clientWidth ?? 0;
        const fit = room > 0 ? room / natural.width : BASE_SCALE;
        const scale = Math.min(BASE_SCALE, fit) * zoom;
        const viewport = pg.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        box.style.setProperty("--scale-factor", String(scale));
        box.style.setProperty("--page-width", `${viewport.width / scale}px`);
        box.style.setProperty("--page-height", `${viewport.height / scale}px`);
        task = pg.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        lastRender.current = task;
        layer.replaceChildren();
        text = new pdfjs.TextLayer({ textContentSource: pg.streamTextContent(), container: layer, viewport });
        await Promise.all([task.promise, text.render()]);
      } catch {
        if (!cancelled) setDrawFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, page, zoom]);

  const go = useCallback(
    (next: number) => {
      const p = clampPage(next, count);
      setPage(p);
      // A button that becomes disabled would drop focus to the document: keep it on the page area.
      if ((p === 1 || p === count) && document.activeElement instanceof HTMLButtonElement) stageRef.current?.focus();
    },
    [count],
  );

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const next = nextZoom(z, dir);
      if ((next === ZOOM_STEPS[0] || next === ZOOM_STEPS.at(-1)) && document.activeElement instanceof HTMLButtonElement) {
        stageRef.current?.focus();
      }
      return next;
    });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(e.nativeEvent) || e.altKey || e.ctrlKey || e.metaKey) return;
    // Keys from the OCR dialog reach here through the React tree (it is portalled): not ours.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => go(page - 1),
      PageUp: () => go(page - 1),
      ArrowRight: () => go(page + 1),
      PageDown: () => go(page + 1),
      Home: () => go(1),
      End: () => go(count),
      "+": () => zoomBy(1),
      "=": () => zoomBy(1),
      "-": () => zoomBy(-1),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const commitPageField = () => {
    const p = clampPage(Number.parseInt(pageField, 10), count);
    setPage(p);
    setPageField(String(p));
  };

  if (openFailed) return <ErrorBox title="PDF를 열지 못했습니다. 원본을 다시 올려 주세요." />;

  return (
    <div className={s.viewer}>
      <ScanNotice assetId={assetId} recordingId={recordingId} />
      {!doc && (
        <p className={s.status} role="status">
          PDF를 불러오는 중…
        </p>
      )}
      {doc && (
        <div className={s.toolbar}>
          <div className={s.controls}>
            <Button size="sm" variant="ghost" icon="chevronLeft" iconOnly aria-label="이전 쪽" isDisabled={page <= 1} onPress={() => go(page - 1)} />
            <input
              className={s.pageField}
              aria-label="쪽 번호"
              inputMode="numeric"
              enterKeyHint="go"
              value={pageField}
              onChange={(e) => setPageField(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isImeComposing(e.nativeEvent)) {
                  e.preventDefault();
                  commitPageField();
                }
              }}
              onBlur={() => setPageField(String(page))}
            />
            <span className={s.position} aria-live="polite">
              {page} / {count}
            </span>
            <Button size="sm" variant="ghost" icon="chevronRight" iconOnly aria-label="다음 쪽" isDisabled={page >= count} onPress={() => go(page + 1)} />
          </div>
          <div className={s.controls}>
            <Button size="sm" variant="ghost" aria-label="축소" isDisabled={zoom <= ZOOM_STEPS[0]} onPress={() => zoomBy(-1)}>
              −
            </Button>
            <span className={s.zoom}>{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="ghost" icon="plus" iconOnly aria-label="확대" isDisabled={zoom >= ZOOM_STEPS.at(-1)!} onPress={() => zoomBy(1)} />
          </div>
        </div>
      )}
      {/* The page area is the keyboard target: focusable, so it also scrolls by keyboard. */}
      <div
        ref={stageRef}
        className={s.stage}
        data-ready={doc ? true : undefined}
        role="group"
        aria-label={`${name} 뷰어`}
        tabIndex={doc ? 0 : -1}
        onKeyDown={onKeyDown}
      >
        <div ref={boxRef} className={s.page}>
          <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />
          <div ref={layerRef} className={s.textLayer} />
        </div>
      </div>
      {drawFailed && (
        <p className={s.error} role="alert">
          이 쪽을 그리지 못했습니다. 다른 쪽으로 넘기거나 다시 열어 보세요.
        </p>
      )}
    </div>
  );
}

/** "스캔본" and the OCR offer, when most pages have no text layer and the server offers OCR. */
function ScanNotice({ assetId, recordingId }: { assetId: string; recordingId: string }) {
  const pages = useAssetPages(assetId);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  if (!pages.data?.scanned || unavailable) return null;
  return (
    <div className={s.scan}>
      <Badge tone="attention">스캔본</Badge>
      <span className={s.scanText}>글자 정보가 없는 PDF라 검색과 인용에 쓰이지 않습니다.</span>
      <Button size="sm" onPress={() => setOpen(true)}>
        글자 인식(OCR)…
      </Button>
      <OcrDialog
        assetId={assetId}
        recordingId={recordingId}
        isOpen={open}
        onOpenChange={setOpen}
        onUnavailable={() => {
          setOpen(false);
          setUnavailable(true);
        }}
      />
    </div>
  );
}
