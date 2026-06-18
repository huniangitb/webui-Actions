import { state, CONST } from "./state.js";
import { run, showToast, ICONS } from "./utils.js";
import { prepare, layout } from "@chenglou/pretext";
import type { IoLogEntry, SysLogEntry, VirtualLogEntry, VirtualLogOptions } from "./types/index";

// ── Helpers ──

/** Build a fast content hash from an entry for dedup comparison */
function entryHash<E extends IoLogEntry | SysLogEntry>(e: E): string {
  return (e as IoLogEntry).text ?? (e as SysLogEntry).text ?? "";
}

// ── VirtualLogList default constants ──

const DEFAULT_BUFFER = 10;
const DEFAULT_ESTIMATED_LINE_HEIGHT = 20;
const DEFAULT_FONT = "13px monospace";
const DEFAULT_LINE_HEIGHT = 20;
const DEFAULT_GAP = 0;
const DEFAULT_PADDING = 0;
const DEFAULT_CHROME_HEIGHT = 0;
const DEFAULT_TEXT_WIDTH_OFFSET = 0;
const DEFAULT_ON_EMPTY = "";

// ── Virtual log list (Pretext-powered) with per-item DOM diffing ──

class VirtualLogList<E extends IoLogEntry | SysLogEntry = IoLogEntry | SysLogEntry> {
  private container: HTMLElement;
  private contentEl: HTMLElement;
  private buffer: number;
  private estimatedLineHeight: number;
  private font: string;
  private lineHeight: number;
  private gap: number;
  private padding: number;
  private chromeHeight: number | ((entry: E) => number);
  private textWidthOffset: number;
  private prepareFn: ((entry: E) => string) | null;
  private onEmpty: string;
  private entries: VirtualLogEntry[];
  private prefixHeights: number[];
  private totalHeight: number;
  private visibleStart: number;
  private visibleEnd: number;
  private isDirty: boolean;
  private _ticking: boolean;
  private _resizeObserver: ResizeObserver | null;
  private _contentHashes: Set<string>;
  /** DOM node cache keyed by data-index for per-item transitions */
  private _renderedNodes: Map<number, HTMLElement>;
  private _leaveDuration = 200;

  constructor(containerEl: HTMLElement, contentEl: HTMLElement, options: VirtualLogOptions<E> = {}) {
    this.container = containerEl;
    this.contentEl = contentEl;
    this.buffer = options.buffer ?? DEFAULT_BUFFER;
    this.estimatedLineHeight = options.estimatedLineHeight ?? DEFAULT_ESTIMATED_LINE_HEIGHT;
    this.font = options.font ?? DEFAULT_FONT;
    this.lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
    this.gap = options.gap ?? DEFAULT_GAP;
    this.padding = options.padding ?? DEFAULT_PADDING;
    this.chromeHeight = options.chromeHeight ?? DEFAULT_CHROME_HEIGHT;
    this.textWidthOffset = options.textWidthOffset ?? DEFAULT_TEXT_WIDTH_OFFSET;
    this.prepareFn = options.prepareFn ?? null;
    this.onEmpty = options.onEmpty ?? DEFAULT_ON_EMPTY;
    this.entries = [];
    this.prefixHeights = [];
    this.totalHeight = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.isDirty = true;
    this._ticking = false;
    this._contentHashes = new Set();
    this._renderedNodes = new Map();
    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
    this.container.addEventListener("scroll", this._onScroll);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.container);
    this.contentEl.style.position = "relative";
  }

  append(entryList: E[]): void {
    const availWidth = this.container.clientWidth - this.padding * 2 - this.textWidthOffset;
    const safeAvailWidth = Math.max(availWidth, 100);
    for (const entry of entryList) {
      let h = this.estimatedLineHeight;
      let prep: object | null = null;
      const cHeight = typeof this.chromeHeight === "function" ? this.chromeHeight(entry) : this.chromeHeight;
      if ((entry as IoLogEntry).text || (entry as SysLogEntry).text) {
        try {
          prep = prepare(entry.text ?? "", this.font);
          const { height } = layout(prep as object, safeAvailWidth, this.lineHeight);
          h = height + cHeight;
        } catch {
          h = this.estimatedLineHeight;
        }
      } else {
        h = cHeight;
      }
      this._contentHashes.add(entryHash(entry));
      this.entries.push({ height: h, prepared: prep, data: entry });
    }
    this._recalcTotalHeight();
    this.isDirty = true;
    this._render();
  }

  private _fadeOutTimer: ReturnType<typeof setTimeout> | null = null;

  clear(): void {
    this.entries = [];
    this.prefixHeights = [];
    this._contentHashes.clear();
    this._recalcTotalHeight();
    this.isDirty = true;
    this.container.scrollTop = 0;
    this._fadeOutAndClear(false);
  }

  private _fadeOutAndClear(delayClear = false): void {
    const nodes = Array.from(this._renderedNodes.values());
    if (nodes.length === 0) {
      this._renderedNodes.clear();
      this.contentEl.innerHTML = this.onEmpty || "";
      return;
    }
    for (const el of nodes) el.classList.add("vlog-leave");
    if (this._fadeOutTimer) clearTimeout(this._fadeOutTimer);
    this._fadeOutTimer = setTimeout(() => {
      this._fadeOutTimer = null;
      if (delayClear) return; /* replace() handles timing */
      this._renderedNodes.clear();
      this.contentEl.innerHTML = "";
      if (this.onEmpty) this.contentEl.innerHTML = this.onEmpty;
    }, this._leaveDuration);
  }

  replace(entryList: E[]): void {
    /* Start fade-out on old nodes but mark 'delayClear' so the timeout doesn't nuke content */
    this._fadeOutAndClear(true);
    /* Synchronously clear data and DOM, then append fresh data */
    this.entries = [];
    this.prefixHeights = [];
    this._contentHashes.clear();
    this.totalHeight = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.isDirty = true;
    this._renderedNodes.clear();
    this.contentEl.innerHTML = "";
    this.append(entryList);
  }

  replaceSorted(
    rawLines: string[],
    parser: (lines: string[]) => E[],
    sortFn?: (a: E, b: E) => number,
  ): void {
    let parsed = parser(rawLines);
    if (sortFn) parsed = parsed.sort(sortFn);

    const seen = new Set<string>();
    const deduped: E[] = [];
    for (const e of parsed) {
      const h = entryHash(e);
      if (!seen.has(h)) { seen.add(h); deduped.push(e); }
    }

    if (this.entries.length === deduped.length) {
      for (let i = 0; i < deduped.length; i++) {
        if (entryHash(deduped[i]) !== entryHash(this.entries[i].data as E)) {
          this.replace(deduped);
          return;
        }
      }
      return; // identical — skip
    }
    this.replace(deduped);
  }

  get scrollHeight(): number { return this.totalHeight; }

  destroy(): void {
    this.container.removeEventListener("scroll", this._onScroll);
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
  }

  private _recalcTotalHeight(): void {
    this.prefixHeights = [];
    let currentY = this.padding;
    for (let i = 0; i < this.entries.length; i++) {
      this.prefixHeights.push(currentY);
      currentY += this.entries[i].height + this.gap;
    }
    this.totalHeight = this.entries.length > 0 ? currentY - this.gap + this.padding : 0;
  }

  private _isActive(): boolean {
    if (document.querySelector(".mx-app")?.classList.contains("frozen")) return false;
    const section = this.container.closest(".demo-section");
    return !(section && !section.classList.contains("active"));
  }

  private _scheduleRender(): void {
    if (!this._ticking) {
      window.requestAnimationFrame(() => { this._render(); this._ticking = false; });
      this._ticking = true;
    }
  }

  private _onScroll(): void { if (this._isActive()) this._scheduleRender(); }
  private _onResize(): void { if (this._isActive()) { this.isDirty = true; this._scheduleRender(); } }

  private _render(): void {
    if (!this._isActive()) return;
    const scrollTop = this.container.scrollTop;
    const viewHeight = this.container.clientHeight;
    this.contentEl.style.height = this.totalHeight + "px";

    if (this.entries.length === 0) {
      if (this.onEmpty && this.contentEl.innerHTML !== this.onEmpty) {
        this._renderedNodes.clear();
        this.contentEl.innerHTML = this.onEmpty;
      }
      return;
    }

    const startIdx = this._findIndex(scrollTop);
    const renderStart = Math.max(0, startIdx - this.buffer);
    let endIdx = startIdx;
    const maxBottom = scrollTop + viewHeight + this.buffer * this.estimatedLineHeight;
    while (endIdx < this.entries.length && this.prefixHeights[endIdx] < maxBottom) endIdx++;
    const renderEnd = Math.min(this.entries.length, endIdx + this.buffer);

    if (this.visibleStart === renderStart && this.visibleEnd === renderEnd && !this.isDirty) {
      this._updateNodePositions(renderStart, renderEnd);
      return;
    }

    const oldStart = this.visibleStart;
    const oldEnd = this.visibleEnd;
    this.visibleStart = renderStart;
    this.visibleEnd = renderEnd;
    this.isDirty = false;

    // Build wanted indices
    const wanted = new Set<number>();
    for (let i = renderStart; i < renderEnd; i++) wanted.add(i);

    // 1. Fade-out nodes no longer in range
    const toRemove: number[] = [];
    for (const [idx, el] of this._renderedNodes) {
      if (!wanted.has(idx)) {
        el.classList.add("vlog-leave");
        toRemove.push(idx);
      }
    }
    if (toRemove.length > 0) {
      setTimeout(() => {
        for (const idx of toRemove) {
          const el = this._renderedNodes.get(idx);
          if (el?.parentNode) el.parentNode.removeChild(el);
          this._renderedNodes.delete(idx);
        }
      }, this._leaveDuration);
    }

    // 2. Add / update nodes in range
    let y = this.prefixHeights[renderStart];
    let insertBefore = this.contentEl.firstChild;
    let hasNewNodes = false;
    for (let i = renderStart; i < renderEnd; i++) {
      const entry = this.entries[i];
      const existing = this._renderedNodes.get(i);

      if (existing) {
        existing.style.top = `${y}px`;
        existing.style.height = `${entry.height}px`;
      } else {
        const content = this.prepareFn
          ? this.prepareFn(entry.data as E)
          : ((entry.data as IoLogEntry).text ?? "");
        const el = document.createElement("div");
        el.className = "virtual-log-item vlog-enter";
        /* No fixed height initially — let DOM size naturally for measurement */
        el.style.cssText = `position:absolute;left:${this.padding}px;right:${this.padding}px;top:${y}px;`;
        el.innerHTML = content;
        this._renderedNodes.set(i, el);
        this.contentEl.insertBefore(el, insertBefore);
        hasNewNodes = true;
        setTimeout(() => el.classList.remove("vlog-enter"), 300);
      }
      y += entry.height + this.gap;
      const node = this._renderedNodes.get(i);
      if (node) insertBefore = node.nextSibling ?? null;
    }

    /* Post-render: measure actual heights and correct */
    if (hasNewNodes) this._correctHeights();
  }

  private _updateNodePositions(from: number, to: number): void {
    let y = this.prefixHeights[from];
    for (let i = from; i < to; i++) {
      const el = this._renderedNodes.get(i);
      if (el) {
        el.style.top = `${y}px`;
        el.style.height = `${this.entries[i].height}px`;
      }
      y += this.entries[i].height + this.gap;
    }
  }

  /** Measure actual rendered height of newly created items and correct entry heights */
  private _correctHeights(): void {
    let changed = false;
    let firstIdx = -1;
    for (const [idx, el] of this._renderedNodes) {
      if (el.dataset.hc === "1") continue;
      /* Read natural content height (no fixed height was set on new nodes) */
      const natural = el.offsetHeight;
      if (natural > 0 && natural !== this.entries[idx].height) {
        this.entries[idx].height = natural;
        if (firstIdx < 0 || idx < firstIdx) firstIdx = idx;
        changed = true;
      }
      el.style.height = `${this.entries[idx].height}px`;
      el.dataset.hc = "1";
    }
    if (changed && firstIdx >= 0) {
      this._recalcTotalHeight();
      this.contentEl.style.height = this.totalHeight + "px";
      const repositionFrom = Math.min(firstIdx, this.visibleStart);
      this._updateNodePositions(repositionFrom, this.visibleEnd);
    }
  }

  private _findIndex(scrollTop: number): number {
    let lo = 0, hi = this.prefixHeights.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.prefixHeights[mid] <= scrollTop) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(0, lo - 1);
  }
}

// ── Shared parsing helpers ──

function parseTimestamp(rawTs: string): string {
  if (/^\d+$/.test(rawTs)) {
    const d = new Date(parseInt(rawTs) * 1000);
    return !isNaN(d.getTime()) ? d.toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
  }
  if (rawTs.includes(" ")) { const dt = rawTs.split(" "); return dt[1] || dt[0]; }
  return rawTs;
}

interface ParsedLogMeta { pkg: string; op: string; details: string; }
function parseLogMeta(rawDetails: string): ParsedLogMeta {
  const m = rawDetails.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
  return m ? { pkg: m[1], op: m[2], details: m[3] } : { pkg: "未知", op: "INFO", details: rawDetails };
}
function resolveAppName(pkg: string): string {
  return state.appMap.has(pkg) ? state.appMap.get(pkg)!.appLabel : pkg;
}

// ── IO log state & functions ──

let ioVirtualList: VirtualLogList<IoLogEntry> | null = null;
let _lastIoRaw = "";

export const initIoLogs = (): void => {
  const container = document.getElementById("ioLogContainer") as HTMLElement | null;
  const content = document.getElementById("ioLogList") as HTMLElement | null;
  if (!container || !content) return;
  ioVirtualList = new VirtualLogList<IoLogEntry>(container, content, {
    font: "11px monospace", lineHeight: 18, estimatedLineHeight: 80, gap: 6, padding: 8,
    textWidthOffset: 46, chromeHeight: (e: IoLogEntry): number => e.details.includes(" -> ") ? 84 : 62,
    prepareFn: renderIoEntry,
    onEmpty: '<div style="padding:40px;text-align:center;color:var(--mx-t2);">暂无记录</div>',
  });
};

export const resetIoLogs = (): void => { ioVirtualList?.clear(); _lastIoRaw = ""; state.ioState.offset = 0; state.ioState.hasMore = true; };

export const clearIoLogs = async (): Promise<void> => { await run(`${CONST.LOG_CTL} clear-io`); showToast.info("监控记录已清理"); resetIoLogs(); fetchIoLogs(); };

function renderIoEntry(entry: IoLogEntry): string {
  /* Structured display for path redirect: two separate bordered boxes */
  const arrowSep = " -> ";
  const arrowIdx = entry.details.indexOf(arrowSep);
  if (arrowIdx !== -1) {
    const fromPath = entry.details.substring(0, arrowIdx);
    const toPath = entry.details.substring(arrowIdx + arrowSep.length);
    return `<div class="io-item"><div class="io-header"><span class="io-time">${ICONS.CLOCK}<span>${entry.timeStr}</span><span class="io-app">${entry.appName}</span></span><span class="io-op op-${entry.op}">${entry.op}</span></div><div class="io-path-box">${fromPath}</div><div class="io-path-box">${toPath}</div></div>`;
  }
  return `<div class="io-item"><div class="io-header"><span class="io-time">${ICONS.CLOCK}<span>${entry.timeStr}</span><span class="io-app">${entry.appName}</span></span><span class="io-op op-${entry.op}">${entry.op}</span></div><div class="io-detail">${entry.details}</div></div>`;
}

interface StreamedResult { dataLines: string[]; hasMore: boolean; }
function parseStreamedResult(raw: string): StreamedResult {
  const lines = raw.split("\n");
  const last = lines[lines.length - 1];
  if (last.startsWith("DONE|")) return { dataLines: lines.slice(0, -1), hasMore: parseInt(last.split("|")[2]) > 0 };
  if (last === "OK") return { dataLines: lines.slice(0, -1), hasMore: false };
  return { dataLines: lines, hasMore: false };
}

function sortIoEntries(a: IoLogEntry, b: IoLogEntry): number { return b.timeStr.localeCompare(a.timeStr); }

export const fetchIoLogs = async (): Promise<void> => {
  if (state.ioState.loading || !state.ioState.hasMore) return;
  state.ioState.loading = true;
  try {
    const res = await run(`${CONST.LOG_CTL} search-io "${state.ioState.term}" ${CONST.PAGE_LIMIT} ${state.ioState.offset} api`);
    if (!res) {
      state.ioState.hasMore = false;
      if (state.ioState.offset === 0) ioVirtualList?.clear();
    } else {
      if (res === _lastIoRaw && state.ioState.offset > 0) { state.ioState.hasMore = false; return; }
      _lastIoRaw = res;
      const { dataLines, hasMore } = parseStreamedResult(res);
      state.ioState.hasMore = hasMore;
      if (dataLines.length > 0) {
        state.ioState.offset += dataLines.length;
        ioVirtualList ? ioVirtualList.replaceSorted(dataLines, parseIoLines, sortIoEntries) : (document.getElementById("ioLogList")!.innerHTML = renderIoLegacy(dataLines));
      } else if (state.ioState.offset === 0) ioVirtualList?.clear();
    }
  } catch { state.ioState.hasMore = false; } finally { state.ioState.loading = false; }
};

function parseIoLines(lines: string[]): IoLogEntry[] {
  return lines.map((line: string): IoLogEntry | null => {
    if (!line.trim()) return null;
    const parts = line.split("|");
    if (parts.length < 2) return null;
    const timeStr = parseTimestamp(parts[0]), rawDetails = parts.slice(1).join("|");
    const { pkg, op, details } = parseLogMeta(rawDetails);
    return { text: details, timeStr, appName: resolveAppName(pkg), op, details };
  }).filter((e): e is IoLogEntry => e !== null);
}

function renderIoLegacy(lines: string[]): string {
  return lines.map((l: string) => {
    if (!l.trim()) return "";
    const parts = l.split("|");
    if (parts.length < 2) return "";
    const timeStr = parseTimestamp(parts[0]), { pkg, op, details } = parseLogMeta(parts.slice(1).join("|"));
    return `<div class="io-item"><div class="io-header"><span class="io-time">${ICONS.CLOCK}<span>${timeStr}</span><span class="io-app">${resolveAppName(pkg)}</span></span><span class="io-op op-${op}">${op}</span></div><div class="io-detail">${details}</div></div>`;
  }).join("");
}

// ── Sys log state & functions ──

let sysVirtualList: VirtualLogList<SysLogEntry> | null = null;
let _lastSysRaw = "";

function sortSysEntries(a: SysLogEntry, b: SysLogEntry): number { return (b.timeStr ?? "").localeCompare(a.timeStr ?? ""); }

export const initSysLogs = (): void => {
  const viewer = document.getElementById("logViewer") as HTMLElement | null;
  if (!viewer) return;
  sysVirtualList = new VirtualLogList<SysLogEntry>(viewer, viewer, {
    font: "11px monospace", lineHeight: 18, estimatedLineHeight: 38, gap: 6, padding: 8, textWidthOffset: 24,
    chromeHeight: (e: SysLogEntry): number => e.tag || e.timeStr ? 38 : 16, prepareFn: renderSysEntry, onEmpty: "",
  });
};

export const resetSysLogs = (): void => { sysVirtualList?.clear(); _lastSysRaw = ""; state.sysState.offset = 0; state.sysState.hasMore = true; };

export const clearSysLogs = async (): Promise<void> => {
  const src = (document.getElementById("logSourceSelect") as HTMLSelectElement)?.value;
  await run(src === "zygisk" ? "logcat -c" : `${CONST.LOG_CTL} clear-sys`);
  showToast.info("日志已清空");
  if (src === "internal") resetSysLogs();
  fetchSysLogs();
};

function renderSysEntry(entry: SysLogEntry): string {
  if (entry.tag) return `<div class="sys-log-item"><div class="sys-log-header"><span class="sys-log-time">${entry.timeStr}</span><span class="sys-log-tag">[${entry.tag}]</span></div><div class="sys-log-msg">${entry.msg}</div></div>`;
  if (entry.timeStr) return `<div class="sys-log-item"><div class="sys-log-header"><span class="sys-log-time">${entry.timeStr}</span></div><div class="sys-log-msg">${entry.msg}</div></div>`;
  return `<div class="sys-log-raw">${entry.msg}</div>`;
}

export const fetchSysLogs = async (): Promise<void> => {
  const source = (document.getElementById("logSourceSelect") as HTMLSelectElement).value;
  const viewer = document.getElementById("logViewer") as HTMLElement;
  if (source === "zygisk") {
    viewer.textContent = (await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector")) || "无 Zygisk 日志";
    viewer.scrollTop = viewer.scrollHeight;
    return;
  }
  if (state.sysState.loading || !state.sysState.hasMore) return;
  state.sysState.loading = true;
  try {
    const levelArg = state.sysState.level > -1 ? `--level ${state.sysState.level}` : "";
    const res = await run(`${CONST.LOG_CTL} search-sys ${levelArg} "" ${CONST.PAGE_LIMIT} ${state.sysState.offset} api`);
    if (!res) { state.sysState.hasMore = false; return; }
    if (res === _lastSysRaw && state.sysState.offset > 0) { state.sysState.hasMore = false; return; }
    _lastSysRaw = res;
    const { dataLines, hasMore } = parseStreamedResult(res);
    state.sysState.hasMore = hasMore;
    if (dataLines.length > 0) {
      state.sysState.offset += dataLines.length;
      if (sysVirtualList) sysVirtualList.replaceSorted(dataLines, parseSysLines, sortSysEntries);
    }
  } catch { state.sysState.hasMore = false; } finally { state.sysState.loading = false; }
};

function parseSysLines(lines: string[]): SysLogEntry[] {
  return lines.map((line: string) => {
    const mTag = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|\[(.*?)\](.*)$/);
    const mSim = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(.*)$/);
    if (mTag) return { text: mTag[3], timeStr: mTag[1], tag: mTag[2], msg: mTag[3] };
    if (mSim) return { text: mSim[2], timeStr: mSim[1], tag: null, msg: mSim[2] };
    return { text: line, timeStr: null, tag: null, msg: line };
  });
}
