import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from './ui/button';
import { BookOpen, Highlighter, Loader2, MessageSquareText, PanelRightClose, X } from 'lucide-react';

GlobalWorkerOptions.workerSrc = workerUrl as string;

/** 相对页内容框的 0~1 矩形，随侧栏宽度缩放仍对齐 */
export type NormRect = { x: number; y: number; w: number; h: number };

export type PdfHighlight = {
  id: string;
  page: number;
  color: string;
  rects: NormRect[];
};

const HIGHLIGHT_PRESETS: { id: string; color: string; label: string }[] = [
  { id: 'yellow', color: 'rgba(255, 240, 120, 0.55)', label: '黄' },
  { id: 'green', color: 'rgba(120, 255, 180, 0.45)', label: '绿' },
  { id: 'blue', color: 'rgba(120, 200, 255, 0.5)', label: '蓝' },
  { id: 'pink', color: 'rgba(255, 160, 220, 0.45)', label: '粉' },
];

const STORAGE_KEY_PREFIX = 'tree-viz-pdf-annotations-';

function loadHighlights(key: string): PdfHighlight[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p as PdfHighlight[];
  } catch {
    return [];
  }
}

function saveHighlights(key: string, list: PdfHighlight[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function normRectsFromRange(pageBox: HTMLElement, range: Range): NormRect[] {
  const br = pageBox.getBoundingClientRect();
  if (br.width < 1 || br.height < 1) return [];
  const out: NormRect[] = [];
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects.item(i);
    if (!r || (r.width < 1 && r.height < 1)) continue;
    out.push({
      x: (r.left - br.left) / br.width,
      y: (r.top - br.top) / br.height,
      w: r.width / br.width,
      h: r.height / br.height,
    });
  }
  return out;
}

type PdfPageContentProps = {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  highlightForPage: PdfHighlight[];
};

/**
 * 单页：canvas + 高亮层 + pdf.js TextLayer（可选中文本、与官方 viewer 一致）
 */
function PdfPageContent({ doc, pageNumber, width, highlightForPage }: PdfPageContentProps) {
  const pageBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const textTaskRef = useRef<TextLayer | null>(null);
  const [vpSize, setVpSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const textDiv = textLayerRef.current;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const vp0 = page.getViewport({ scale: 1 });
      const scale = width / vp0.width;
      const vp = page.getViewport({ scale });
      setVpSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = Math.floor(vp.width);
      const h = Math.floor(vp.height);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const parent = textDiv.parentElement;
      if (parent) {
        (parent as HTMLDivElement).style.setProperty('--scale-factor', String(vp.scale));
      }
      textDiv.innerHTML = '';
      textTaskRef.current?.cancel();
      textTaskRef.current = null;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (cancelled) return;
      const tl = new TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: textDiv,
        viewport: vp,
      });
      textTaskRef.current = tl;
      try {
        await tl.render();
      } catch (e) {
        if (cancelled) return;
        console.warn('TextLayer', e);
      }
    })();
    return () => {
      cancelled = true;
      textTaskRef.current?.cancel();
      textTaskRef.current = null;
    };
  }, [doc, pageNumber, width]);

  return (
    <div className="mb-3 w-full" data-page={pageNumber}>
      <p className="text-[10px] text-muted-foreground mb-0.5">第 {pageNumber} 页</p>
      <div
        ref={pageBoxRef}
        className="pdf-page-outer relative overflow-hidden rounded border border-border/60 bg-white shadow-sm"
        style={
          vpSize
            ? { width: vpSize.w, height: vpSize.h }
            : { minHeight: 200, width: '100%' }
        }
      >
        <canvas ref={canvasRef} className="block" />
        <div className="pointer-events-none absolute inset-0 z-[1]">
          {highlightForPage.map((h) =>
            h.rects.map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className="absolute rounded-sm"
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  background: h.color,
                }}
                title="高亮"
              />
            ))
          )}
        </div>
        <div
          ref={textLayerRef}
          className="textLayer"
          style={{ zIndex: 2 }}
        />
      </div>
    </div>
  );
}

type PdfReaderPanelProps = {
  pdfUrl: string;
  onBeginQuoteBranch: (excerpt: string, page1Based: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 与 session 绑定，高亮可随会话在 sessionStorage 中恢复 */
  storageKey: string;
};

type SelectionToolbarState = {
  page: number;
  text: string;
  left: number;
  top: number;
  /** 选区已按 pageBox 归一化，避免将 Range 留在 state 中失效 */
  normRects: NormRect[];
};

export function PdfReaderPanel({
  pdfUrl,
  onBeginQuoteBranch,
  open,
  onOpenChange,
  storageKey,
}: PdfReaderPanelProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelWidth, setPanelWidth] = useState(360);
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!open || !storageKey) return;
    setHighlights(loadHighlights(storageKey));
  }, [open, storageKey, pdfUrl]);

  useEffect(() => {
    if (open && storageKey) {
      saveHighlights(storageKey, highlights);
    }
  }, [open, storageKey, highlights]);

  useEffect(() => {
    if (!open || !pdfUrl) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    (async () => {
      try {
        const d = await getDocument({ url: pdfUrl, withCredentials: false }).promise;
        if (cancelled) {
          d.destroy();
          return;
        }
        setDoc(d);
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pdfUrl]);

  const closeToolbar = useCallback(() => {
    setToolbar(null);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, []);

  const onMouseUp = useCallback(() => {
    window.setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setToolbar(null);
        return;
      }
      const text = (sel.toString() || '').trim();
      if (text.length < 1) {
        setToolbar(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const start = range.startContainer;
      const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      const textLayer = el?.closest?.('.textLayer') ?? null;
      if (!textLayer) {
        setToolbar(null);
        return;
      }
      const pageBox = textLayer.parentElement;
      if (!pageBox || !scrollRef.current?.contains(textLayer)) {
        setToolbar(null);
        return;
      }
      const pageNumAttr = textLayer.closest?.('[data-page]')?.getAttribute('data-page');
      const page = pageNumAttr ? parseInt(pageNumAttr, 10) : 1;
      if (Number.isNaN(page)) {
        setToolbar(null);
        return;
      }
      const normRects = normRectsFromRange(pageBox, range);
      if (normRects.length === 0) {
        setToolbar(null);
        return;
      }
      const rects = range.getClientRects();
      const last = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
      const x = last.right + 6;
      const y = last.bottom + 4;
      setToolbar({
        page,
        text: text.slice(0, 8000),
        left: x,
        top: y,
        normRects,
      });
    }, 0);
  }, []);

  const addHighlight = useCallback(
    (color: string) => {
      if (!toolbar) return;
      if (toolbar.normRects.length === 0) {
        closeToolbar();
        return;
      }
      setHighlights((prev) => [
        ...prev,
        {
          id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          page: toolbar.page,
          color,
          rects: toolbar.normRects,
        },
      ]);
      closeToolbar();
    },
    [toolbar, closeToolbar]
  );

  const handleInputAnalyze = useCallback(() => {
    if (!toolbar) return;
    onBeginQuoteBranch(toolbar.text, toolbar.page);
    closeToolbar();
  }, [toolbar, onBeginQuoteBranch, closeToolbar]);

  if (!open) {
    return (
      <div
        className="pdf-reader-viewer--collapsed hidden lg:flex border-l border-border/80 bg-muted/20 flex-col items-center shrink-0 w-11 min-h-0 py-2 gap-2"
        aria-label="PDF 阅读器已收起"
      >
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onOpenChange(true)}
          title="打开 PDF 阅读"
        >
          <BookOpen className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="pdf-reader-viewer hidden lg:flex border-l border-border/80 bg-muted/20 flex-col min-h-0 shrink-0 relative"
      style={{ width: panelWidth, minWidth: 260, maxWidth: 640 }}
    >
      <div
        role="separator"
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-primary/20"
        onMouseDown={(e) => {
          e.preventDefault();
          resizeStartRef.current = { x: e.clientX, w: panelWidth };
          setIsResizing(true);
        }}
        aria-hidden
      />
      {isResizing ? (
        <div
          className="fixed inset-0 z-50 cursor-ew-resize"
          onMouseMove={(e) => {
            const d = resizeStartRef.current;
            if (!d) return;
            const next = d.w - (e.clientX - d.x);
            setPanelWidth(Math.min(640, Math.max(240, next)));
          }}
          onMouseUp={() => {
            resizeStartRef.current = null;
            setIsResizing(false);
          }}
        />
      ) : null}
      <div className="px-2 py-2 border-b border-border/60 flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">阅读（可选字 · 高亮）</span>
        </div>
        <div className="flex items-center gap-1">
          {highlights.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                if (window.confirm('清除本会话在本文档上的所有高亮？')) {
                  setHighlights([]);
                }
              }}
            >
              清除高亮
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onOpenChange(false)}
            title="隐藏侧栏"
          >
            <PanelRightClose className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
        onMouseUp={onMouseUp}
      >
        {loading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            加载 PDF…
          </div>
        )}
        {loadErr && !loading && <p className="p-3 text-sm text-destructive">{loadErr}</p>}
        {doc && !loading && !loadErr && (
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
          >
            {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
              <PdfPageContent
                key={n}
                doc={doc}
                pageNumber={n}
                width={Math.max(220, panelWidth - 24)}
                highlightForPage={highlights.filter((h) => h.page === n)}
              />
            ))}
          </div>
        )}
      </div>
      {toolbar &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="z-[500] w-[min(19rem,92vw)] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg"
            style={{
              position: 'fixed',
              left: Math.min(toolbar.left, window.innerWidth - 300),
              top: Math.min(toolbar.top, window.innerHeight - 200),
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="mb-1.5 text-[10px] text-muted-foreground line-clamp-2 pr-5">
              {toolbar.text}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1"
                onClick={handleInputAnalyze}
                title="将选区挂到主输入，便于针对本章提问、续聊"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                输入并分析
              </Button>
              <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Highlighter className="h-3 w-3" />
                高亮
              </span>
              {HIGHLIGHT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  className="h-7 w-7 rounded border border-border shadow-sm"
                  style={{ background: p.color }}
                  onClick={() => addHighlight(p.color)}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={closeToolbar}
                title="取消"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
