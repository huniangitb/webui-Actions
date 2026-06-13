import { state, CONST } from "./state.js";
import { run, showToast, ICONS } from "./utils.js";
import { prepare, layout } from "@chenglou/pretext";
// =============================================
// Virtual log list (Pretext-powered)
// =============================================
class VirtualLogList {
  constructor(containerEl, contentEl, options = {}) {
    this.container = containerEl;
    this.contentEl = contentEl;
    this.buffer = options.buffer || 10;
    this.estimatedLineHeight = options.estimatedLineHeight || 20;
    this.font = options.font || '13px monospace';
    this.lineHeight = options.lineHeight || 20;
    this.gap = options.gap || 0;
    this.padding = options.padding || 0; 
    this.chromeHeight = options.chromeHeight || 0; 
    this.textWidthOffset = options.textWidthOffset || 0; 
    this.prepareFn = options.prepareFn || null;
    this.onEmpty = options.onEmpty || "";
    this.entries = [];
    this.prefixHeights = []; // 存储累积高度以实现极速检索
    this.totalHeight = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.isDirty = true;
    this._ticking = false;
    this._onScroll = this._onScroll.bind(this);
    this.container.addEventListener("scroll", this._onScroll);
    this.contentEl.style.position = "relative";
  }
  append(entryList) {
    // 缓存容器宽度，避免循环内部重复读取引发强制同步布局
    const availWidth = this.container.clientWidth - (this.padding * 2) - this.textWidthOffset;
    const safeAvailWidth = Math.max(availWidth, 100);
    for (const entry of entryList) {
      let h = this.estimatedLineHeight;
      let prep = null;
      let cHeight = typeof this.chromeHeight === 'function' ? this.chromeHeight(entry) : this.chromeHeight;
      if (entry.text) {
        try {
          prep = prepare(entry.text, this.font);
          const { height } = layout(prep, safeAvailWidth, this.lineHeight);
          h = height + cHeight;
        } catch {
          h = this.estimatedLineHeight;
        }
      } else {
        h = cHeight;
      }
      this.entries.push({ height: h, prepared: prep, data: entry });
    }
    this._recalcTotalHeight();
    this.isDirty = true;
    this._render();
  }
  clear() {
    this.entries = [];
    this.prefixHeights = [];
    this._recalcTotalHeight();
    this.isDirty = true;
    this.container.scrollTop = 0;
    this._render();
  }
  replace(entryList) {
    this.clear();
    this.append(entryList);
  }
  get scrollHeight() {
    return this.totalHeight;
  }
  destroy() {
    this.container.removeEventListener("scroll", this._onScroll);
  }
  _recalcTotalHeight() {
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
  _onScroll() {
    // 物理隔离：若主视图已被冻结，完全屏蔽背景虚拟列表的任何逻辑及重绘
    if (document.querySelector(".mx-app")?.classList.contains("frozen")) {
      return;
    }
    if (!this._ticking) {
      window.requestAnimationFrame(() => {
        this._render();
        this._ticking = false;
      });
      this._ticking = true;
    }
  }
  _render() {
    // 物理隔离：冻结保护
    if (document.querySelector(".mx-app")?.classList.contains("frozen")) {
      return;
    }
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
      const content = this.prepareFn ? this.prepareFn(entry.data) : entry.data.text || "";
      html += `<div class="virtual-log-item" style="position:absolute;top:${y}px;left:${this.padding}px;right:${this.padding}px;height:${entry.height}px;">${content}</div>`;
      y += entry.height + this.gap;
    }
    this.contentEl.innerHTML = html;
  }
  _findIndex(scrollTop) {
    let lo = 0, hi = this.prefixHeights.length - 1;
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
// =============================================
// IO log state & functions
// =============================================
let ioVirtualList = null;
export const initIoLogs = () => {
  const container = document.getElementById("ioLogContainer");
  const content = document.getElementById("ioLogList");
  if (!container || !content) return;
  ioVirtualList = new VirtualLogList(container, content, {
    font: "12px monospace",
    lineHeight: 18,
    estimatedLineHeight: 60,
    gap: 6, 
    padding: 8, 
    textWidthOffset: 44, 
    chromeHeight: 60, 
    prepareFn: renderIoEntry,
    onEmpty: '<div style="padding:40px;text-align:center;color:var(--mx-t2);">暂无记录</div>',
  });
};
export const resetIoLogs = () => {
  ioVirtualList?.clear();
  state.ioState.offset = 0;
  state.ioState.hasMore = true;
};
export const clearIoLogs = async () => {
  await run(`${CONST.LOG_CTL} clear-io`);
  showToast("监控记录已清理");
  resetIoLogs();
  fetchIoLogs();
};
const renderIoEntry = (entry) => {
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
};
export const fetchIoLogs = async () => {
  if (state.ioState.loading || !state.ioState.hasMore) return;
  state.ioState.loading = true;
  try {
    const res = await run(`${CONST.LOG_CTL} search-io "${state.ioState.term}" ${CONST.PAGE_LIMIT} ${state.ioState.offset} api`);
    if (!res) {
      state.ioState.hasMore = false;
      if (state.ioState.offset === 0) ioVirtualList?.clear();
    } else {
      const lines = res.split("\n");
      let dataLines = lines;
      const lastLine = lines[lines.length - 1];
      if (lastLine.startsWith("DONE|")) {
        state.ioState.hasMore = parseInt(lastLine.split("|")[2]) > 0;
        dataLines = lines.slice(0, -1);
      } else if (lastLine === "OK") {
        state.ioState.hasMore = false;
        dataLines = lines.slice(0, -1);
      }
      if (dataLines.length > 0) {
        state.ioState.offset += dataLines.length;
        const entries = parseIoLines(dataLines);
        if (ioVirtualList) ioVirtualList.append(entries);
        else {
          const listEl = document.getElementById("ioLogList");
          if (listEl.innerHTML.includes("暂无记录")) listEl.innerHTML = "";
          listEl.insertAdjacentHTML("beforeend", renderIoLegacy(dataLines));
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
}
const parseIoLines = (lines) => {
  return lines
    .map((line) => {
      if (!line.trim()) return null;
      const parts = line.split("|");
      if (parts.length < 2) return null;
      let timeStr = "--:--:--";
      const rawTs = parts[0];
      if (/^\d+$/.test(rawTs)) {
        const d = new Date(parseInt(rawTs) * 1000);
        if (!isNaN(d)) timeStr = d.toLocaleTimeString("zh-CN", { hour12: false });
      } else if (rawTs.includes(" ")) {
        const dt = rawTs.split(" ");
        timeStr = dt[1] || dt[0];
      } else {
        timeStr = rawTs;
      }
      let pkg = "未知", op = "INFO", details = parts.slice(1).join("|");
      const m = details.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
      if (m) { pkg = m[1]; op = m[2]; details = m[3]; }
      const appName = state.appMap.has(pkg) ? state.appMap.get(pkg).appLabel : pkg;
      return { text: details, timeStr, appName, op, details };
    })
    .filter(Boolean);
};
const renderIoLegacy = (lines) => {
  return lines
    .map((line) => {
      if (!line.trim()) return "";
      const parts = line.split("|");
      if (parts.length < 2) return "";
      let timeStr = "--:--:--";
      const rawTs = parts[0];
      if (/^\d+$/.test(rawTs)) {
        const d = new Date(parseInt(rawTs) * 1000);
        if (!isNaN(d)) timeStr = d.toLocaleTimeString("zh-CN", { hour12: false });
      } else if (rawTs.includes(" ")) {
        const dt = rawTs.split(" ");
        timeStr = dt[1] || dt[0];
      } else {
        timeStr = rawTs;
      }
      let pkg = "未知", op = "INFO", details = parts.slice(1).join("|");
      const m = details.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
      if (m) { pkg = m[1]; op = m[2]; details = m[3]; }
      const appName = state.appMap.has(pkg) ? state.appMap.get(pkg).appLabel : pkg;
      return `<div class="io-item"><div class="io-header"><span class="io-time">${ICONS.CLOCK}<span>${timeStr}</span><span class="io-app">${appName}</span></span><span class="io-op op-${op}">${op}</span></div><div class="io-detail">${details}</div></div>`;
    }).join("");
};
// =============================================
// Sys log state & functions
// =============================================
let sysVirtualList = null;
export const initSysLogs = () => {
  const viewer = document.getElementById("logViewer");
  if (!viewer) return;
  sysVirtualList = new VirtualLogList(viewer, viewer, {
    font: "12px monospace",
    lineHeight: 18,
    estimatedLineHeight: 36,
    gap: 6,
    padding: 8,
    textWidthOffset: 26, 
    chromeHeight: (entry) => (entry.tag || entry.timeStr) ? 36 : 14,
    prepareFn: renderSysEntry,
    onEmpty: "",
  });
};
export const resetSysLogs = () => {
  sysVirtualList?.clear();
  state.sysState.offset = 0;
  state.sysState.hasMore = true;
};
export const clearSysLogs = async () => {
  const source = document.getElementById("logSourceSelect")?.value;
  if (source === "zygisk") {
    await run("logcat -c");
  } else {
    await run(`${CONST.LOG_CTL} clear-sys`);
  }
  showToast("日志已清空");
  if (source === "internal") resetSysLogs();
  fetchSysLogs();
};
const renderSysEntry = (entry) => {
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
};
export const fetchSysLogs = async () => {
  const source = document.getElementById("logSourceSelect").value;
  const viewer = document.getElementById("logViewer");
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
    if (!res) {
      state.sysState.hasMore = false;
    } else {
      const lines = res.split("\n");
      let dataLines = lines;
      const lastLine = lines[lines.length - 1];
      if (lastLine.startsWith("DONE|")) {
        state.sysState.hasMore = parseInt(lastLine.split("|")[2]) > 0;
        dataLines = lines.slice(0, -1);
      } else if (lastLine === "OK") {
        state.sysState.hasMore = false;
        dataLines = lines.slice(0, -1);
      }
      if (dataLines.length > 0) {
        state.sysState.offset += dataLines.length;
        const entries = parseSysLines(dataLines);
        if (sysVirtualList) sysVirtualList.append(entries);
      }
    }
  } catch {
    state.sysState.hasMore = false;
  } finally {
    state.sysState.loading = false;
  }
};
const parseSysLines = (lines) => {
  return lines.map((line) => {
    const matchTag = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|\[(.*?)\](.*)$/);
    const matchSimple = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(.*)$/);
    if (matchTag) {
      return { text: matchTag[3], timeStr: matchTag[1], tag: matchTag[2], msg: matchTag[3] };
    } else if (matchSimple) {
      return { text: matchSimple[2], timeStr: matchSimple[1], tag: null, msg: matchSimple[2] };
    }
    return { text: line, timeStr: null, tag: null, msg: line };
  });
};