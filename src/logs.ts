import { state, CONST } from "./state.js";
import { run, showToast, ICONS } from "./utils.js";
import { prepare, layout } from "@chenglou/pretext";
import type { IoLogEntry, SysLogEntry, VirtualLogEntry, VirtualLogOptions } from "./types/index";
import { extractApiData, cachedLogCount } from "./logctl.js";

// ── Helpers ──

/** Build a fast content hash from an entry for dedup comparison.
 *  纳入 timeStr，使"msg 相同但时间不同"的日志条目不被误判为重复
 *  （如 [injector] 配置广播每 30s 重复一次，msg 完全相同但时间戳不同）。 */
function entryHash<E extends IoLogEntry | SysLogEntry>(e: E): string {
  const t = e.timeStr ?? "";
  return `${t}|${e.text}`;
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
  /** Total number of log entries expected (from log-count API), 0 = unknown */
  private _expectedTotal = 0;
  private visibleStart: number;
  private visibleEnd: number;
  private isDirty: boolean;
  private _ticking: boolean;
  private _resizeObserver: ResizeObserver | null;
  private _contentHashes: Set<string>;
  private _renderedNodes: Map<number, HTMLElement>;
  /** 缓存池：存放松出可视区但尚未销毁的 DOM 节点，滚动回来时直接复用 */
  private _nodeCache: HTMLElement[] = [];
  private static readonly MAX_CACHE = 50;
  private _leaveDuration = 200;
  /** Incremented on every prefixHeights rebuild to detect layout changes */
  private _layoutVersion = 0;
  /** Snapshots _layoutVersion at the last full render to detect stale early-return */
  private _lastRenderLayoutVersion = -1;

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
    this.container.addEventListener("scroll", this._onScroll, { passive: true });
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.container);
    this.contentEl.style.position = "relative";
  }

  /** Set total expected log count from log-count API for stable scrollbar sizing */
  setExpectedTotal(total: number): void {
    this._expectedTotal = total;
    this._recalcTotalHeight();
    this.contentEl.style.height = this.totalHeight + "px";
  }

  /** Bottom Y position of the last loaded (not estimated) item */
  getLastLoadedBottom(): number {
    const n = this.entries.length;
    if (n === 0) return this.totalHeight;
    return this.prefixHeights[n - 1] + this.entries[n - 1].height;
  }

  append(entryList: E[]): void {
    const availWidth = this.container.clientWidth - this.padding * 2 - this.textWidthOffset;
    // 容器未就绪时用 100px 兜底，Pretext 计算结果会偏高而非偏低，
    // 后续 _correctHeights 测量实际 DOM 高度后收缩修正，视觉跳动最小
    const safeAvailWidth = Math.max(availWidth, 100);
    for (const entry of entryList) {
      const hash = entryHash(entry);
      if (this._contentHashes.has(hash)) continue;  // skip duplicate
      let h = this.estimatedLineHeight;
      let prep: object | null = null;
      const cHeight = typeof this.chromeHeight === "function" ? this.chromeHeight(entry) : this.chromeHeight;
      if (safeAvailWidth > 0 && ((entry as IoLogEntry).text || (entry as SysLogEntry).text)) {
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
      this._contentHashes.add(hash);
      this.entries.push({ height: h, prepared: prep, data: entry });
    }
    this._recalcTotalHeight();
    this.isDirty = true;
    this._scheduleRender();
  }

  private _fadeOutTimer: ReturnType<typeof setTimeout> | null = null;

  /** 清空节点缓存池，销毁所有缓存的 DOM */
  private _clearCache(): void {
    for (const el of this._nodeCache) {
      if (el?.parentNode) el.parentNode.removeChild(el);
    }
    this._nodeCache = [];
  }

  clear(): void {
    this.entries = [];
    this.prefixHeights = [];
    this._contentHashes.clear();
    this._expectedTotal = 0;
    this._recalcTotalHeight();
    this.isDirty = true;
    this.container.scrollTop = 0;
    this._fadeOutAndClear(false);
  }

  private _fadeOutAndClear(delayClear = false): void {
    const nodes = Array.from(this._renderedNodes.values());
    this._clearCache();  // 清除缓存，下次渲染全部重建
    if (nodes.length === 0) {
      this._renderedNodes.clear();
      this.contentEl.innerHTML = this.onEmpty || "";
      return;
    }
    // 所有节点渐隐后清除
    for (const el of nodes) {
      el.style.transition = 'opacity 0.2s ease';
      el.style.opacity = '0';
    }
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
    /* Cancel any pending fade-out from previous replace */
    if (this._fadeOutTimer) { clearTimeout(this._fadeOutTimer); this._fadeOutTimer = null; }

    if (entryList.length === 0) { this.clear(); return; }

    /* 1. Build new entries with Pretext heights (dedup by content hash) */
    const availWidth = this.container.clientWidth - this.padding * 2 - this.textWidthOffset;
    // 容器未就绪时用 100px 兜底，Pretext 计算结果会偏高而非偏低
    const safeAvailWidth = Math.max(availWidth, 100);
    const newEntries: VirtualLogEntry[] = [];
    const newHashes = new Set<string>();

    for (const data of entryList) {
      const hash = entryHash(data);
      if (newHashes.has(hash)) continue;
      newHashes.add(hash);

      let h = this.estimatedLineHeight;
      let prep: object | null = null;
      const cHeight = typeof this.chromeHeight === "function" ? this.chromeHeight(data) : this.chromeHeight;
      if (safeAvailWidth > 0 && ((data as IoLogEntry).text || (data as SysLogEntry).text)) {
        try {
          prep = prepare(data.text ?? "", this.font);
          const { height } = layout(prep as object, safeAvailWidth, this.lineHeight);
          h = height + cHeight;
        } catch { h = this.estimatedLineHeight; }
      } else { h = cHeight; }
      newEntries.push({ height: h, prepared: prep, data });
    }

    /* 2. Fade out stale nodes (hash no longer in new list) */
    const staleNodes: HTMLElement[] = [];
    const oldHashIdx = new Map<string, number>();
    for (let i = 0; i < this.entries.length; i++) {
      oldHashIdx.set(entryHash(this.entries[i].data as E), i);
    }
    for (const [hash, idx] of oldHashIdx) {
      if (!newHashes.has(hash)) {
        const el = this._renderedNodes.get(idx);
        if (el) { el.style.transition = 'opacity 0.2s ease'; el.style.opacity = '0'; staleNodes.push(el); }
      }
    }

    /* 3. Rebuild state: keep surviving nodes, update data */
    const survivingNodes = new Map<number, HTMLElement>(); /* new index -> old DOM node */
    for (let i = 0; i < newEntries.length; i++) {
      const hash = entryHash(newEntries[i].data as E);
      const oldIdx = oldHashIdx.get(hash);
      if (oldIdx !== undefined) {
        /* Preserve previously corrected height */
        const oldHeight = this.entries[oldIdx].height;
        newEntries[i].height = oldHeight;
        const el = this._renderedNodes.get(oldIdx);
        if (el) {
          // 同步 DOM 节点到新索引，避免 _render 缓存查找按旧 vlogIdx 错误命中
          el.dataset.vlogIdx = String(i);
          // 重置 hc 标记，让 _correctHeights 重新测量复用节点的真实高度
          delete el.dataset.hc;
          el.style.height = '';
          survivingNodes.set(i, el);
        }
      }
    }

    this.entries = newEntries;
    this._contentHashes = newHashes;
    this._renderedNodes.clear();
    for (const [i, el] of survivingNodes) this._renderedNodes.set(i, el);

    this._recalcTotalHeight();
    this.isDirty = true;
    // 重置视口范围标记以强制 _render 重新计算可见区间；
    // 不再强制 scrollTop = 0，保留用户当前滚动位置，避免刷新日志时跳到顶部
    this.visibleStart = -1;
    this.visibleEnd = -1;
    this._scheduleRender();

    /* 4. Remove stale DOM nodes after fade-out completes */
    if (staleNodes.length > 0) {
      this._fadeOutTimer = setTimeout(() => {
        this._fadeOutTimer = null;
        for (const el of staleNodes) {
          if (el?.parentNode) el.parentNode.removeChild(el);
        }
      }, this._leaveDuration);
    }
    // 清除旧缓存（replace 是数据替换，之前的缓存已失效）
    this._clearCache();
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
    this._clearCache();
  }

  private _recalcTotalHeight(): void {
    const avgHeight = this._calcAvgEntryHeight();
    this.prefixHeights = [];
    let currentY = this.padding;
    for (let i = 0; i < this.entries.length; i++) {
      this.prefixHeights.push(currentY);
      currentY += this.entries[i].height + this.gap;
    }
    // Add estimated height for expected-but-not-yet-loaded entries,
    // ensuring the scrollbar stays stable as pages are appended
    const loadedCount = this.entries.length;
    if (this._expectedTotal > loadedCount) {
      currentY += (this._expectedTotal - loadedCount) * (avgHeight + this.gap);
    }
    this.totalHeight = this.entries.length > 0 || this._expectedTotal > 0
      ? currentY - this.gap + this.padding
      : 0;
    this._layoutVersion++;
  }

  /** Average height of loaded entries (used for unloaded estimate) */
  private _calcAvgEntryHeight(): number {
    if (this.entries.length === 0) {
      const cHeight = typeof this.chromeHeight === "function" ? DEFAULT_CHROME_HEIGHT : this.chromeHeight;
      return this.estimatedLineHeight + cHeight;
    }
    let sum = 0;
    for (const e of this.entries) sum += e.height;
    return sum / this.entries.length;
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

    // 容器刚由 display:none 切换过来时 clientHeight 可能为 0，
    // 此时跳过渲染，调度下一帧重试，避免瞬态空白
    if (viewHeight <= 0) {
      this._scheduleRender();
      return;
    }

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
      // 视口范围未变但布局版本已变（被 _correctHeights 递增），
      // 需要将最新位置同步到 DOM，避免因位置未更新导致条目漂出可视区
      if (this._lastRenderLayoutVersion !== this._layoutVersion) {
        this._updateNodePositions(renderStart, renderEnd);
        this._lastRenderLayoutVersion = this._layoutVersion;
      }
      return;
    }

    this._lastRenderLayoutVersion = this._layoutVersion;

    const oldStart = this.visibleStart;
    const oldEnd = this.visibleEnd;
    this.visibleStart = renderStart;
    this.visibleEnd = renderEnd;
    this.isDirty = false;

    // Build wanted indices
    const wanted = new Set<number>();
    for (let i = renderStart; i < renderEnd; i++) wanted.add(i);

    // 1. 将滚出可视区的节点移入缓存池，避免销毁重建
    const toCache: number[] = [];
    for (const [idx, el] of this._renderedNodes) {
      if (!wanted.has(idx)) {
        // CSS transition: opacity 0.2s 自动处理渐隐
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.2s ease';
        el.dataset.vlogFade = 'out';
        toCache.push(idx);
      }
    }
    for (const idx of toCache) {
      const el = this._renderedNodes.get(idx);
      if (el) {
        this._renderedNodes.delete(idx);
        this._nodeCache.push(el);
      }
    }
    // 限制缓存大小，超出的真正移除
    while (this._nodeCache.length > VirtualLogList.MAX_CACHE) {
      const stale = this._nodeCache.shift();
      if (stale?.parentNode) stale.parentNode.removeChild(stale);
    }
    // 200ms 后从 DOM 移除已缓存的渐隐节点（但缓存引用保留，可复用）
    if (toCache.length > 0) {
      setTimeout(() => {
        for (const idx of toCache) {
          const el = this._renderedNodes.get(idx);
          // 如果节点没有被重新放入 _renderedNodes（即还在缓存中未被复用），从 DOM 移除
          if (!el) {
            const cached = this._nodeCache.find(n => n.dataset && n.dataset.vlogIdx === String(idx));
            if (cached?.parentNode) cached.parentNode.removeChild(cached);
          }
        }
      }, this._leaveDuration);
    }

    // 2. 添加 / 更新可视区内的节点
    let y = this.prefixHeights[renderStart];
    // 跳过仍在渐隐中的旧节点，新节点插入到它们前面
    let insertBefore: Node | null = this.contentEl.firstChild;
    while (insertBefore && insertBefore instanceof HTMLElement && insertBefore.dataset.vlogFade === 'out') {
      insertBefore = insertBefore.nextSibling;
    }
    let hasNewNodes = false;
    for (let i = renderStart; i < renderEnd; i++) {
      const entry = this.entries[i];
      const existing = this._renderedNodes.get(i);

      if (existing) {
        existing.style.transform = `translateY(${y}px)`;
        existing.style.height = `${entry.height}px`;
      } else {
        // 先从缓存池找可用节点（按新索引 vlogIdx 匹配）
        const cacheIdx = this._nodeCache.findIndex(n => n.dataset && n.dataset.vlogIdx === String(i));
        let el: HTMLElement;
        if (cacheIdx >= 0) {
          el = this._nodeCache.splice(cacheIdx, 1)[0];
          delete el.dataset.vlogFade;
          el.style.opacity = '0';
          el.style.transition = 'opacity 0.2s ease';
          el.style.transform = `translateY(${y}px)`;
          // 下一帧触发渐显
          requestAnimationFrame(() => { el.style.opacity = '1'; });
        } else {
          const content = this.prepareFn
            ? this.prepareFn(entry.data as E)
            : ((entry.data as IoLogEntry).text ?? "");
          el = document.createElement("div");
          el.className = "virtual-log-item";
          el.dataset.vlogIdx = String(i);
          /* 初始透明度 0，CSS transition 自动渐显 */
          el.style.cssText = `position:absolute;left:${this.padding}px;right:${this.padding}px;opacity:0;transition:opacity 0.2s ease;transform:translateY(${y}px);`;
          el.innerHTML = content;
          // 下一帧触发渐显
          requestAnimationFrame(() => { el.style.opacity = '1'; });
        }
        this._renderedNodes.set(i, el);
        this.contentEl.insertBefore(el, insertBefore);
        if (!el.dataset.hc) {
          hasNewNodes = true;
        }
      }
      y += entry.height + this.gap;
      const node = this._renderedNodes.get(i);
      if (node) insertBefore = node.nextSibling ?? null;
    }

    /* Post-render: measure actual heights and correct (仅对全新节点) */
    if (hasNewNodes) this._correctHeights();
  }

  private _updateNodePositions(from: number, to: number): void {
    let y = this.prefixHeights[from];
    for (let i = from; i < to; i++) {
      const el = this._renderedNodes.get(i);
      if (el) {
        el.style.transform = `translateY(${y}px)`;
        el.style.height = `${this.entries[i].height}px`;
      }
      y += this.entries[i].height + this.gap;
    }
  }

  /** Measure actual rendered height of newly created items and correct entry heights */
  private _correctHeights(): void {
    // Phase 0: 清除固定高度限制，使 offsetHeight 读取到自然流真实高度
    for (const [idx, el] of this._renderedNodes) {
      if (el.dataset.hc === "1") continue;
      el.style.height = '';
    }

    // Phase 1: 批量读取所有 offsetHeight（只有一次强制布局，此时节点无固定高度）
    const measurements: Array<{ idx: number; natural: number }> = [];
    for (const [idx, el] of this._renderedNodes) {
      if (el.dataset.hc === "1") continue;
      measurements.push({ idx, natural: el.offsetHeight });
    }

    // Phase 2: 用实际 DOM 高度校正 entry 高度
    let changed = false;
    let firstIdx = -1;
    for (const { idx, natural } of measurements) {
      const el = this._renderedNodes.get(idx)!;
      if (natural > 0 && natural !== this.entries[idx].height) {
        this.entries[idx].height = natural;
        if (firstIdx < 0 || idx < firstIdx) firstIdx = idx;
        changed = true;
      }
      el.style.height = `${this.entries[idx].height}px`;
      el.dataset.hc = "1";
    }

    /* Always recalculate totalHeight after measurement to keep scrollbar accurate */
    this._recalcTotalHeight();
    this.contentEl.style.height = this.totalHeight + "px";
    if (changed && firstIdx >= 0) {
      // Reposition ALL rendered nodes, not just [visibleStart, visibleEnd),
      // because buffer-zone nodes also shift when prefixHeights changes
      let minIdx = firstIdx, maxIdx = firstIdx;
      for (const idx of this._renderedNodes.keys()) {
        if (idx < minIdx) minIdx = idx;
        if (idx > maxIdx) maxIdx = idx;
      }
      this._updateNodePositions(minIdx, maxIdx + 1);
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
  // Unix 秒级时间戳 → "M/d HH:mm:ss"
  if (/^\d+$/.test(rawTs)) {
    const d = new Date(parseInt(rawTs) * 1000);
    if (isNaN(d.getTime())) return "--:--:--";
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${month}/${day} ${hh}:${mm}:${ss}`;
  }
  // "YYYY-MM-DD HH:mm:ss" → 去掉年份
  const m = rawTs.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (m) return `${parseInt(m[1])}/${parseInt(m[2])} ${m[3]}`;
  return rawTs;
}

interface ParsedLogMeta { pkg: string; op: string; details: string; }
function parseLogMeta(rawDetails: string): ParsedLogMeta {
  const m = rawDetails.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
  if (m) {
    // Strip trailing (uid) from package name, e.g. "com.tencent.mobileqq(10232)" → "com.tencent.mobileqq"
    const pkg = m[1].replace(/\(\d+\)$/, "");
    return { pkg, op: m[2], details: m[3] };
  }
  return { pkg: "未知", op: "INFO", details: rawDetails };
}
function resolveAppName(pkg: string): string {
  return state.appMap.has(pkg) ? state.appMap.get(pkg)!.appLabel : pkg;
}

// ── IO log state & functions ──

export let ioVirtualList: VirtualLogList<IoLogEntry> | null = null;
let _lastIoRaw = "";

// ── 前端过滤兜底（monitor_ignore.conf）──
// 后端 log_monitor 已按规则过滤写入缓冲区前的日志，前端再做一次同样规则的过滤，
// 让用户改了规则后即时生效（不必 clear-io 清空缓冲），并兜底后端遗漏。
// 规则行格式（与 monitor_ignore.conf 一致）：
//   - 纯包名（含 .）→ 命中条目的 pkg/appName 即丢弃
//   - 以 / 开头 → 路径前缀匹配条目 details 的路径
let _ioIgnorePkgs: Set<string> = new Set();
let _ioIgnorePaths: string[] = [];
let _ioIgnoreLoaded: boolean = false;

async function loadIoIgnoreRules(): Promise<void> {
  try {
    const content = await run(`cat ${CONST.MONITOR_IGNORE_CONF} 2>/dev/null`);
    _ioIgnorePkgs = new Set();
    _ioIgnorePaths = [];
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("/")) {
        _ioIgnorePaths.push(line);
      } else if (line.includes(".")) {
        _ioIgnorePkgs.add(line);
      }
    }
  } catch {
    _ioIgnorePkgs = new Set();
    _ioIgnorePaths = [];
  }
  _ioIgnoreLoaded = true;
}

/** 按前端过滤规则筛选 IO 日志条目，返回应保留的子集 */
function filterIoEntries(entries: IoLogEntry[]): IoLogEntry[] {
  if (_ioIgnorePkgs.size === 0 && _ioIgnorePaths.length === 0) return entries;
  return entries.filter((e) => {
    // pkg 匹配：appName 实际是 resolveAppName(pkg) 的结果，原始 pkg 已丢失，
    // 但当无应用映射时 appName === pkg，故对 appName 双向比对（pkg 集合与应用名集合）
    if (_ioIgnorePkgs.has(e.appName)) return false;
    // 路径前缀匹配：details 形如 "/path" 或 "/src -> /dst"，取首段路径前缀比对
    if (_ioIgnorePaths.length > 0) {
      const detailPath = e.details.split(" -> ")[0];
      for (const p of _ioIgnorePaths) {
        if (detailPath.startsWith(p)) return false;
      }
    }
    return true;
  });
}

/** 重新加载过滤规则并刷新 IO 日志（保存 monitor_ignore.conf 后调用） */
export const refreshIoIgnore = async (): Promise<void> => {
  _ioIgnoreLoaded = false;
  await loadIoIgnoreRules();
  resetIoLogs();
  fetchIoLogs();
};

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

export const clearIoLogs = async (): Promise<void> => {
  await run(`${CONST.LOG_CTL} clear-io api`);
  showToast.info("监控记录已清理");
  resetIoLogs();
  fetchIoLogs();
};

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

function sortIoEntries(a: IoLogEntry, b: IoLogEntry): number { return b.timeStr.localeCompare(a.timeStr); }

export const fetchIoLogs = async (): Promise<void> => {
  if (state.ioState.loading || !state.ioState.hasMore) return;
  state.ioState.loading = true;
  try {
    // 首屏加载前端过滤规则（monitor_ignore.conf），续页复用已加载的规则
    if (!_ioIgnoreLoaded) await loadIoIgnoreRules();
    const counts = await cachedLogCount();
    const dynamicLimit = counts && counts.io > 0 ? Math.min(counts.io, 1000) : 500;
    // On first load, set expected total for stable scrollbar sizing
    if (state.ioState.offset === 0 && counts?.io && ioVirtualList) {
      ioVirtualList.setExpectedTotal(counts.io);
    }
    const raw = await run(`${CONST.LOG_CTL} search-io "${state.ioState.term}" ${dynamicLimit} ${state.ioState.offset} api`);
    const data = extractApiData(raw);
    const res = data?.raw ?? "";
    if (!res) {
      state.ioState.hasMore = false;
      if (state.ioState.offset === 0) ioVirtualList?.clear();
    } else {
      if (res === _lastIoRaw && state.ioState.offset > 0) { state.ioState.hasMore = false; return; }
      _lastIoRaw = res;
      const dataLines = res.split("\n");
      state.ioState.hasMore = (data?.done?.remaining ?? 0) > 0;
      if (dataLines.length > 0) {
        const prevOffset = state.ioState.offset;
        state.ioState.offset += dataLines.length;
        if (ioVirtualList) {
          if (prevOffset === 0) {
            // 首次加载 — 替换全部内容（解析后应用前端过滤）
            const filtered = filterIoEntries(parseIoLines(dataLines));
            if (filtered.length > 0) {
              ioVirtualList.replace(filtered.sort(sortIoEntries));
            } else {
              ioVirtualList.clear();
            }
          } else {
            // 续页加载 — 追加到末尾（offset>0 表示后面还有更旧的日志）
            const parsed = filterIoEntries(parseIoLines(dataLines)).sort(sortIoEntries);
            if (parsed.length > 0) ioVirtualList.append(parsed);
          }
        } else {
          (document.getElementById("ioLogList")!.innerHTML = renderIoLegacy(dataLines));
        }
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

export let sysVirtualList: VirtualLogList<SysLogEntry> | null = null;
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
  if (src === "zygisk") {
    await run("logcat -c");
  } else {
    await run(`${CONST.LOG_CTL} clear-sys api`);
  }
  showToast.info("日志已清空");
  if (src === "internal") resetSysLogs();
  fetchSysLogs();
};

function renderSysEntry(entry: SysLogEntry): string {
  if (entry.appName) {
    return `<div class="sys-log-item"><div class="sys-log-header"><span class="sys-log-time">${entry.timeStr}</span><span class="sys-log-app">${entry.appName}</span></div><div class="sys-log-msg">${entry.msg}</div></div>`;
  }
  if (entry.tag) return `<div class="sys-log-item"><div class="sys-log-header"><span class="sys-log-time">${entry.timeStr}</span><span class="sys-log-tag">[${entry.tag}]</span></div><div class="sys-log-msg">${entry.msg}</div></div>`;
  if (entry.timeStr) return `<div class="sys-log-item"><div class="sys-log-header"><span class="sys-log-time">${entry.timeStr}</span></div><div class="sys-log-msg">${entry.msg}</div></div>`;
  return `<div class="sys-log-raw">${entry.msg}</div>`;
}

export const fetchSysLogs = async (): Promise<void> => {
  const source = (document.getElementById("logSourceSelect") as HTMLSelectElement).value;
  const viewer = document.getElementById("logViewer") as HTMLElement;
  const zygiskEl = document.getElementById("zygiskViewer") as HTMLElement;
  if (source === "zygisk") {
    if (state.sysState.loading) return;
    state.sysState.loading = true;
    viewer.style.display = "none";
    zygiskEl.style.display = "";
    zygiskEl.textContent = (await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector")) || "无 Zygisk 日志";
    zygiskEl.scrollTop = zygiskEl.scrollHeight;
    state.sysState.loading = false;
    return;
  }
  viewer.style.display = "";
  zygiskEl.style.display = "none";
  if (state.sysState.loading || !state.sysState.hasMore) return;
  state.sysState.loading = true;
  try {
    const levelArg = state.sysState.level > -1 ? `--level ${state.sysState.level}` : "";
    const counts = await cachedLogCount();
    const dynamicLimit = counts && counts.sys > 0 ? Math.min(counts.sys, 1000) : 500;
    // On first load, set expected total for stable scrollbar sizing
    if (state.sysState.offset === 0 && counts?.sys && sysVirtualList) {
      sysVirtualList.setExpectedTotal(counts.sys);
    }
    const raw = await run(`${CONST.LOG_CTL} search-sys ${levelArg} "" ${dynamicLimit} ${state.sysState.offset} api`);
    const data = extractApiData(raw);
    const res = data?.raw ?? "";
    if (!res) { state.sysState.hasMore = false; return; }
    if (res === _lastSysRaw && state.sysState.offset > 0) { state.sysState.hasMore = false; return; }
    _lastSysRaw = res;
    const dataLines = res.split("\n");
    state.sysState.hasMore = (data?.done?.remaining ?? 0) > 0;
    if (dataLines.length > 0) {
      const prevOffset = state.sysState.offset;
      state.sysState.offset += dataLines.length;
      if (sysVirtualList) {
        if (prevOffset === 0) {
          // 首次加载 — 替换全部内容
          sysVirtualList.replaceSorted(dataLines, parseSysLines, sortSysEntries);
        } else {
          // 续页加载 — 追加到末尾
          const parsed = parseSysLines(dataLines).sort(sortSysEntries);
          sysVirtualList.append(parsed);
        }
      }
    }
  } catch { state.sysState.hasMore = false; } finally { state.sysState.loading = false; }
};

/**
 * Extract package name from a sys log tag like "com.tencent.mobileqq(10123)".
 * Returns the package name portion, or null if it doesn't look like a package.
 */
function extractPkgFromTag(tag: string): string | null {
  const m = tag.match(/^([a-zA-Z0-9_.]+)\(\d+\)$/);
  return m && m[1].includes(".") ? m[1] : null;
}

/**
 * Strip trailing "(uid)" from a tag for clean display.
 */
function stripUidSuffix(tag: string): string {
  return tag.replace(/\(\d+\)$/, "");
}

function parseSysLines(lines: string[]): SysLogEntry[] {
  return lines.map((line: string) => {
    // New format with LOG_SYS:<level>: prefix (e.g. "2026-07-04 11:14:55|LOG_SYS:1:[fuse_daemon] ...")
    const mLogSys = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|LOG_SYS:(\d+):\[(.*?)\](.*)$/);
    // Old format without level prefix (e.g. "2026-07-04 11:14:55|[injector] ...")
    const mTag = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|\[(.*?)\](.*)$/);
    const mSim = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(.*)$/);
    if (mLogSys) {
      const rawTag = mLogSys[3];
      const level = parseInt(mLogSys[2], 10);
      const pkg = extractPkgFromTag(rawTag);
      const appName = pkg ? resolveAppName(pkg) : undefined;
      const displayTag = pkg ? stripUidSuffix(rawTag) : rawTag;
      return { text: mLogSys[4], timeStr: parseTimestamp(mLogSys[1]), tag: displayTag, msg: mLogSys[4], appName, level };
    }
    if (mTag) {
      const rawTag = mTag[2];
      const pkg = extractPkgFromTag(rawTag);
      const appName = pkg ? resolveAppName(pkg) : undefined;
      const displayTag = pkg ? stripUidSuffix(rawTag) : rawTag;
      return { text: mTag[3], timeStr: parseTimestamp(mTag[1]), tag: displayTag, msg: mTag[3], appName };
    }
    if (mSim) return { text: mSim[2], timeStr: parseTimestamp(mSim[1]), tag: null, msg: mSim[2] };
    return { text: line, timeStr: null, tag: null, msg: line };
  });
}
