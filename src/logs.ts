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

// ── Virtual log list (Pretext-powered) ──

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
  /** Hash set of current visible content for flicker-free dedup */
  private _contentHashes: Set<string>;

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
    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
    this.container.addEventListener("scroll", this._onScroll);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.container);
    this.contentEl.style.position = "relative";
  }

  append(entryList: E[]): void {
    const availWidth =
      this.container.clientWidth - this.padding * 2 - this.textWidthOffset;
    const safeAvailWidth = Math.max(availWidth, 100);
    for (const entry of entryList) {
      let h = this.estimatedLineHeight;
      let prep: object | null = null;
      const cHeight =
        typeof this.chromeHeight === "function"
          ? this.chromeHeight(entry)
          : this.chromeHeight;
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

  clear(): void {
    this.entries = [];
    this.prefixHeights = [];
    this._contentHashes.clear();
    this._recalcTotalHeight();
    this.isDirty = true;
    this.container.scrollTop = 0;
    this._render();
  }

  replace(entryList: E[]): void {
    this.clear();
    this.append(entryList);
  }

  /**
   * Fetch → sort → dedup → replace with transition.
   * Accepts raw lines, parses, sorts, deduplicates against current content,
   * and only re-renders when data actually changed.
   */
  replaceSorted(
    rawLines: string[],
    parser: (lines: string[]) => E[],
    sortFn?: (a: E, b: E) => number,
  ): void {
    // Parse
    let parsed = parser(rawLines);

    // Sort if provided
    if (sortFn) {
      parsed = parsed.sort(sortFn);
    }

    // Deduplicate within new data first
    const seen = new Set<string>();
    const deduped: E[] = [];
    for (const e of parsed) {
      const h = entryHash(e);
      if (!seen.has(h)) {
        seen.add(h);
        deduped.push(e);
      }
    }

    // Fast path: compare hashes with current — skip render if identical
    if (this.entries.length === deduped.length) {
      let same = true;
      for (let i = 0; i < deduped.length; i++) {
        if (entryHash(deduped[i]) !== entryHash(this.entries[i].data as E)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    // Data changed; add a brief opacity transition on the container before replacing
    this.contentEl.style.transition = "opacity 0.15s var(--mx-ease)";
    this.contentEl.style.opacity = "0";

    setTimeout(() => {
      this.replace(deduped);
      requestAnimationFrame(() => {
        this.contentEl.style.opacity = "1";
        /* Clean up transition after animation so it doesn't interfere with scroll */
        setTimeout(() => {
          this.contentEl.style.transition = "";
        }, 300);
      });
    }, 80);
  }

  get scrollHeight(): number {
    return this.totalHeight;
  }

  destroy(): void {
    this.container.removeEventListener("scroll", this._onScroll);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  private _recalcTotalHeight(): void {
    this.prefixHeights = [];
    let currentY = this.padding;
    for (let i = 0; i < this.entries.length; i++) {
      this.prefixHeights.push(currentY);
      currentY += this.entries[i].height + this.gap;
    }
    if (this.entries.length > 0) {
      this.totalHeight = currentY - this.gap + this.padding;
    } else {
      this.totalHeight = 0;
    }
  }

  private _isActive(): boolean {
    if (document.querySelector(".mx-app")?.classList.contains("frozen")) return false;
    const section = this.container.closest(".demo-section");
    if (section && !section.classList.contains("active")) return false;
    return true;
  }

  private _scheduleRender(): void {
    if (!this._ticking) {
      window.requestAnimationFrame(() => {
        this._render();
        this._ticking = false;
      });
      this._ticking = true;
    }
  }

  private _onScroll(): void {
    if (!this._isActive()) return;
    this._scheduleRender();
  }

  private _onResize(): void {
    if (!this._isActive()) return;
    this.isDirty = true;
    this._scheduleRender();
  }

  private _render(): void {
    if (!this._isActive()) return;
    const scrollTop = this.container.scrollTop;
    const viewHeight = this.container.clientHeight;
    this.contentEl.style.height = this.totalHeight + "px";
    if (this.entries.length === 0) {
      if (this.onEmpty && this.contentEl.innerHTML !== this.onEmpty) {
        this.contentEl.innerHTML = this.onEmpty;
      }
      return;
    }
    const startIdx = this._findIndex(scrollTop);
    const renderStart = Math.max(0, startIdx - this.buffer);
    let endIdx = startIdx;
    const maxBottom = scrollTop + viewHeight + this.buffer * this.estimatedLineHeight;
    while (endIdx < this.entries.length && this.prefixHeights[endIdx] < maxBottom) {
      endIdx++;
    }
    const renderEnd = Math.min(this.entries.length, endIdx + this.buffer);
    if (this.visibleStart === renderStart && this.visibleEnd === renderEnd && !this.isDirty) {
      return;
    }
    this.visibleStart = renderStart;
    this.visibleEnd = renderEnd;
    this.isDirty = false;
    let y = this.prefixHeights[renderStart];
    let html = "";
    for (let i = renderStart; i < renderEnd; i++) {
      const entry = this.entries[i];
      const content = this.prepareFn
        ? this.prepareFn(entry.data as E)
        : ((entry.data as IoLogEntry).text ?? "");
      html += `<div class="virtual-log-item" style="position:absolute;top:${y}px;left:${this.padding}px;right:${this.padding}px;height:${entry.height}px;">${content}</div>`;
      y += entry.height + this.gap;
    }
    this.contentEl.innerHTML = html;
  }

  private _findIndex(scrollTop: number): number {
    let lo = 0;
    let hi = this.prefixHeights.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.prefixHeights[mid] <= scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return Math.max(0, lo - 1);
  }
}

// ── Shared parsing helpers ──

function parseTimestamp(rawTs: string): string {
  if (/^\d+$/.test(rawTs)) {
    const d = new Date(parseInt(rawTs) * 1000);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("zh-CN", { hour12: false });
    }
    return "--:--:--";
  }
  if (rawTs.includes(" ")) {
    const dt = rawTs.split(" ");
    return dt[1] || dt[0];
  }
  return rawTs;
}

interface ParsedLogMeta {
  pkg: string;
  op: string;
  details: string;
}

function parseLogMeta(rawDetails: string): ParsedLogMeta {
  const m = rawDetails.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
  if (m) {
    return { pkg: m[1], op: m[2], details: m[3] };
  }
  return { pkg: "未知", op: "INFO", details: rawDetails };
}

function resolveAppName(pkg: string): string {
  return state.appMap.has(pkg) ? state.appMap.get(pkg)!.appLabel : pkg;
}

// ── IO log state & functions ──

let ioVirtualList: VirtualLogList<IoLogEntry> | null = null;

// Cache the last raw data to skip redundant fetches
let _lastIoRaw = "";

export const initIoLogs = (): void => {
  const container = document.getElementById("ioLogContainer") as HTMLElement | null;
  const content = document.getElementById("ioLogList") as HTMLElement | null;
  if (!container || !content) return;
  ioVirtualList = new VirtualLogList<IoLogEntry>(container, content, {
    font: "12px monospace",
    lineHeight: 18,
    estimatedLineHeight: 60,
    gap: 6,
    padding: 8,
    textWidthOffset: 44,
    chromeHeight: 60,
    prepareFn: renderIoEntry,
    onEmpty:
      '<div style="padding:40px;text-align:center;color:var(--mx-t2);">暂无记录</div>',
  });
};

export const resetIoLogs = (): void => {
  ioVirtualList?.clear();
  _lastIoRaw = "";
  state.ioState.offset = 0;
  state.ioState.hasMore = true;
};

export const clearIoLogs = async (): Promise<void> => {
  await run(`${CONST.LOG_CTL} clear-io`);
  showToast.info("监控记录已清理");
  resetIoLogs();
  fetchIoLogs();
};

function renderIoEntry(entry: IoLogEntry): string {
  const { timeStr, appName, op, details } = entry;
  return `
    <div class="io-item">
      <div class="io-header">
        <span class="io-time">
          ${ICONS.CLOCK}
          <span>${timeStr}</span>
          <span class="io-app">${appName}</span>
        </span>
        <span class="io-op op-${op}">${op}</span>
      </div>
      <div class="io-detail">${details}</div>
    </div>`;
}

interface StreamedResult {
  dataLines: string[];
  hasMore: boolean;
}

function parseStreamedResult(raw: string): StreamedResult {
  const lines = raw.split("\n");
  const lastLine = lines[lines.length - 1];
  if (lastLine.startsWith("DONE|")) {
    return {
      dataLines: lines.slice(0, -1),
      hasMore: parseInt(lastLine.split("|")[2]) > 0,
    };
  }
  if (lastLine === "OK") {
    return { dataLines: lines.slice(0, -1), hasMore: false };
  }
  return { dataLines: lines, hasMore: false };
}

/** Sort IO entries by timestamp (newest first) */
function sortIoEntries(a: IoLogEntry, b: IoLogEntry): number {
  return b.timeStr.localeCompare(a.timeStr);
}

export const fetchIoLogs = async (): Promise<void> => {
  if (state.ioState.loading || !state.ioState.hasMore) return;
  state.ioState.loading = true;
  try {
    const res = await run(
      `${CONST.LOG_CTL} search-io "${state.ioState.term}" ${CONST.PAGE_LIMIT} ${state.ioState.offset} api`,
    );
    if (!res) {
      state.ioState.hasMore = false;
      if (state.ioState.offset === 0) ioVirtualList?.clear();
    } else {
      /* Dedup against last raw payload to avoid processing identical data */
      if (res === _lastIoRaw && state.ioState.offset > 0) {
        state.ioState.hasMore = false;
        return;
      }
      _lastIoRaw = res;

      const { dataLines, hasMore } = parseStreamedResult(res);
      state.ioState.hasMore = hasMore;
      if (dataLines.length > 0) {
        state.ioState.offset += dataLines.length;
        if (ioVirtualList) {
          ioVirtualList.replaceSorted(dataLines, parseIoLines, sortIoEntries);
        } else {
          const listEl = document.getElementById("ioLogList")!;
          if (listEl.innerHTML.includes("暂无记录")) listEl.innerHTML = "";
          listEl.innerHTML = renderIoLegacy(dataLines);
        }
      } else if (state.ioState.offset === 0) {
        ioVirtualList?.clear();
      }
    }
  } catch {
    state.ioState.hasMore = false;
  } finally {
    state.ioState.loading = false;
  }
};

function parseIoLines(lines: string[]): IoLogEntry[] {
  return lines
    .map((line: string): IoLogEntry | null => {
      if (!line.trim()) return null;
      const parts = line.split("|");
      if (parts.length < 2) return null;
      const timeStr = parseTimestamp(parts[0]);
      const rawDetails = parts.slice(1).join("|");
      const { pkg, op, details } = parseLogMeta(rawDetails);
      const appName = resolveAppName(pkg);
      return { text: details, timeStr, appName, op, details };
    })
    .filter((e): e is IoLogEntry => e !== null);
}

function renderIoLegacy(lines: string[]): string {
  return lines
    .map((line: string) => {
      if (!line.trim()) return "";
      const parts = line.split("|");
      if (parts.length < 2) return "";
      const timeStr = parseTimestamp(parts[0]);
      const rawDetails = parts.slice(1).join("|");
      const { pkg, op, details } = parseLogMeta(rawDetails);
      const appName = resolveAppName(pkg);
      return `<div class="io-item"><div class="io-header"><span class="io-time">${ICONS.CLOCK}<span>${timeStr}</span><span class="io-app">${appName}</span></span><span class="io-op op-${op}">${op}</span></div><div class="io-detail">${details}</div></div>`;
    })
    .join("");
}

// ── Sys log state & functions ──

let sysVirtualList: VirtualLogList<SysLogEntry> | null = null;
let _lastSysRaw = "";

/** Sort sys entries by timestamp (newest first) */
function sortSysEntries(a: SysLogEntry, b: SysLogEntry): number {
  const ta = a.timeStr ?? "";
  const tb = b.timeStr ?? "";
  return tb.localeCompare(ta);
}

export const initSysLogs = (): void => {
  const viewer = document.getElementById("logViewer") as HTMLElement | null;
  if (!viewer) return;
  sysVirtualList = new VirtualLogList<SysLogEntry>(viewer, viewer, {
    font: "12px monospace",
    lineHeight: 18,
    estimatedLineHeight: 36,
    gap: 6,
    padding: 8,
    textWidthOffset: 26,
    chromeHeight: (entry: SysLogEntry): number =>
      entry.tag || entry.timeStr ? 36 : 14,
    prepareFn: renderSysEntry,
    onEmpty: "",
  });
};

export const resetSysLogs = (): void => {
  sysVirtualList?.clear();
  _lastSysRaw = "";
  state.sysState.offset = 0;
  state.sysState.hasMore = true;
};

export const clearSysLogs = async (): Promise<void> => {
  const source = (document.getElementById("logSourceSelect") as HTMLSelectElement)?.value;
  if (source === "zygisk") {
    await run("logcat -c");
  } else {
    await run(`${CONST.LOG_CTL} clear-sys`);
    if (source === "internal") resetSysLogs();
  }
  showToast.info("日志已清空");
  fetchSysLogs();
};

function renderSysEntry(entry: SysLogEntry): string {
  const { timeStr, tag, msg } = entry;
  if (tag) {
    return `<div class="sys-log-item">
      <div class="sys-log-header">
        <span class="sys-log-time">${timeStr}</span>
        <span class="sys-log-tag">[${tag}]</span>
      </div>
      <div class="sys-log-msg">${msg}</div>
    </div>`;
  }
  if (timeStr) {
    return `<div class="sys-log-item">
      <div class="sys-log-header">
        <span class="sys-log-time">${timeStr}</span>
      </div>
      <div class="sys-log-msg">${msg}</div>
    </div>`;
  }
  return `<div class="sys-log-raw">${msg}</div>`;
}

export const fetchSysLogs = async (): Promise<void> => {
  const source = (document.getElementById("logSourceSelect") as HTMLSelectElement).value;
  const viewer = document.getElementById("logViewer") as HTMLElement;
  if (source === "zygisk") {
    viewer.textContent =
      (await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector")) || "无 Zygisk 日志";
    viewer.scrollTop = viewer.scrollHeight;
    return;
  }
  if (state.sysState.loading || !state.sysState.hasMore) return;
  state.sysState.loading = true;
  try {
    const levelArg =
      state.sysState.level > -1 ? `--level ${state.sysState.level}` : "";
    const res = await run(
      `${CONST.LOG_CTL} search-sys ${levelArg} "" ${CONST.PAGE_LIMIT} ${state.sysState.offset} api`,
    );
    if (!res) {
      state.sysState.hasMore = false;
    } else {
      /* Dedup against last raw payload to skip processing when nothing changed */
      if (res === _lastSysRaw && state.sysState.offset > 0) {
        state.sysState.hasMore = false;
        return;
      }
      _lastSysRaw = res;

      const { dataLines, hasMore } = parseStreamedResult(res);
      state.sysState.hasMore = hasMore;
      if (dataLines.length > 0) {
        state.sysState.offset += dataLines.length;
        if (sysVirtualList) {
          sysVirtualList.replaceSorted(dataLines, parseSysLines, sortSysEntries);
        }
      }
    }
  } catch {
    state.sysState.hasMore = false;
  } finally {
    state.sysState.loading = false;
  }
};

function parseSysLines(lines: string[]): SysLogEntry[] {
  return lines.map((line: string) => {
    const matchTag = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|\[(.*?)\](.*)$/,
    );
    const matchSimple = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(.*)$/,
    );
    if (matchTag) {
      return {
        text: matchTag[3],
        timeStr: matchTag[1],
        tag: matchTag[2],
        msg: matchTag[3],
      };
    } else if (matchSimple) {
      return {
        text: matchSimple[2],
        timeStr: matchSimple[1],
        tag: null,
        msg: matchSimple[2],
      };
    }
    return { text: line, timeStr: null, tag: null, msg: line };
  });
}
