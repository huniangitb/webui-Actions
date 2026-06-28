import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce, quoteArgIfSpaced, splitLineRespectingQuotes } from "./utils.js";
import { exec } from "kernelsu";
import { prepare, layout } from "@chenglou/pretext";
import type { Suggestion } from "./types/index";
import { initCustomSelect } from "./select.js";
import { VirtualScroller } from "./virtual-list.js";
import type { RuleItem } from "./virtual-list.js";
// 触摸手势检测参数
let startX = 0;
let startY = 0;
let isScrolling = false;
// ── VirtualScroller 实例注册表 ──
const _virtualScrollers = new Map<string, VirtualScroller>();
function _getOrCreateVS(containerId: string): VirtualScroller | null {
  let vs = _virtualScrollers.get(containerId);
  if (vs) return vs;
  const container = document.getElementById(containerId);
  if (!container) return null;
  vs = new VirtualScroller(container);
  _virtualScrollers.set(containerId, vs);
  return vs;
}
function _destroyVS(containerId: string): void {
  const vs = _virtualScrollers.get(containerId);
  if (vs) { vs.destroy(); _virtualScrollers.delete(containerId); }
}
function getSelectById(id: string | null): HTMLSelectElement | null {
  if (!id) return null;
  return document.getElementById(id) as HTMLSelectElement | null;
}
function clearSelectValue(id: string | null): void {
  const sel = getSelectById(id);
  if (sel) {
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
function getSelectValue(id: string | null): string {
  const sel = getSelectById(id);
  return sel?.value ?? "";
}
/**
 * 创建一条规则 DOM 元素（游离态，未插入文档）。
 */
export const buildRuleRow = (
  type: string,
  target: string,
  source: string,
): HTMLDivElement => {
  const div = document.createElement("div");
  div.className = "rule-row";
  div.innerHTML = `<select class="mx-select rule-type" style="width:95px; font-size:12px;">
    <option value="REDIRECT">重定向</option>
    <option value="HIDE">隐藏</option>
    <option value="RO">只读</option>
    <option value="ALLOW">豁免</option>
  </select>
  <div class="rule-inputs">
    <div class="mx-input-wrapper">
      <input type="text" class="mx-input rule-target" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="原始路径" value="${target.replace(/"/g, "&quot;")}">
    </div>
    <div class="mx-input-wrapper ${type !== "REDIRECT" ? "hidden" : ""}">
      <input type="text" class="mx-input rule-source" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="重定向至" value="${source.replace(/"/g, "&quot;")}">
    </div>
  </div>
  <button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
  const select = div.querySelector(".rule-type") as HTMLSelectElement;
  select.value = type;
  select.onchange = (e: Event) => {
    const srcWrapper = div.querySelectorAll(".mx-input-wrapper")[1] as HTMLElement;
    if (srcWrapper) {
      srcWrapper.classList.toggle("hidden", (e.target as HTMLSelectElement).value !== "REDIRECT");
    }
  };
  return div;
};
/** 旧接口：创建一条规则并直接追加到容器尾部 */
export const addRuleRow = (
  type: string,
  target: string,
  source: string,
  containerId: string,
): void => {
  const vs = _virtualScrollers.get(containerId);
  if (vs) {
    vs.addItem({ type, target, source });
    return;
  }
  // Fallback：无 VirtualScroller 时使用传统方式
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = buildRuleRow(type, target, source);
  row.querySelector(".btn-del")!.addEventListener("click", () => row.remove());
  container.appendChild(row);
  // 仅首次调用初始化事件委托
  setupContainerAutocomplete(container);
};
export const parseConfigTextToVisual = (
  text: string | null | undefined,
  containerId: string,
  monitorSelectId: string,
  sandboxSelectId: string,
  injectSelectId: string | null,
): void => {
  // 核心改动：每次渲染解析配置前，彻底将旧的 VirtualScroller 销毁以重新挂载 offsetTop
  _destroyVS(containerId);

  const container = document.getElementById(containerId);
  if (container) {
    const box = document.getElementById("suggestionBox");
    if (box && container.contains(box)) {
      document.body.appendChild(box);
    }
  }
  clearSelectValue(monitorSelectId);
  clearSelectValue(sandboxSelectId);
  clearSelectValue(injectSelectId);
  // 解析规则行文本，构造 RuleItem[]
  const items: RuleItem[] = [];
  const selMonitor = getSelectById(monitorSelectId);
  const selSandbox = getSelectById(sandboxSelectId);
  const selInject = getSelectById(injectSelectId);
  if (text) {
    for (const line of text.split("\n")) {
      const parts = splitLineRespectingQuotes(line.trim());
      const cmd = parts[0];
      if (cmd === "REDIRECT" && parts.length >= 3) {
        items.push({ type: "REDIRECT", target: normalizeToDisplay(parts[1]), source: normalizeToDisplay(parts.slice(2).join(" ")) });
      } else if (parts.length >= 2) {
        if (cmd === "HIDE" || cmd === "RO" || cmd === "ALLOW") {
          items.push({ type: cmd, target: normalizeToDisplay(parts[1]), source: "" });
        } else if (cmd === "MONITOR" && selMonitor) {
          selMonitor.value = parts[1];
          selMonitor.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (cmd === "SANDBOX" && selSandbox) {
          selSandbox.value = parts[1];
          selSandbox.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (cmd === "GLOBAL_INJECT" && selInject) {
          selInject.value = parts[1];
          selInject.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
  }
  // 通过 VirtualScroller 或传统方式渲染
  const vs = _getOrCreateVS(containerId);
  if (vs) {
    vs.setItems(items);
    setupContainerAutocomplete(document.getElementById(containerId)!);
  } else if (container) {
    // Fallback：直接 DOM
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = buildRuleRow(item.type, item.target, item.source);
      row.querySelector(".btn-del")!.addEventListener("click", () => row.remove());
      fragment.appendChild(row);
    }
    if (items.length > 0) container.appendChild(fragment);
    setupContainerAutocomplete(container);
  }
};
export const generateConfigTextFromVisual = (
  containerId: string,
  monitorSelectId: string,
  sandboxSelectId: string,
  injectSelectId: string | null,
): string => {
  let res = "";
  const injectVal = getSelectValue(injectSelectId);
  if (injectVal) res += `GLOBAL_INJECT ${injectVal}\n`;
  const monitorVal = getSelectValue(monitorSelectId);
  if (monitorVal) res += `MONITOR ${monitorVal}\n`;
  const sandboxVal = getSelectValue(sandboxSelectId);
  if (sandboxVal) res += `SANDBOX ${sandboxVal}\n`;
  // 优先从 VirtualScroller 获取当前最新的内部实体数据
  const vs = _virtualScrollers.get(containerId);
  if (vs) {
    const items = vs.getCurrentData();
    for (const item of items) {
      const target = item.target.trim();
      if (!target) continue;
      if (item.type === "REDIRECT") {
        const source = item.source.trim();
        if (source) {
          res += `REDIRECT ${quoteArgIfSpaced(normalizeToConfig(target, true))} ${quoteArgIfSpaced(normalizeToConfig(source, false))}\n`;
        }
      } else if (item.type === "HIDE" || item.type === "RO" || item.type === "ALLOW") {
        res += `${item.type} ${quoteArgIfSpaced(normalizeToConfig(target, true))}\n`;
      }
    }
  } else {
    // Fallback：从 DOM 读取
    document.querySelectorAll(`#${containerId} .rule-row`).forEach((row) => {
      const type = (row.querySelector(".rule-type") as HTMLSelectElement).value;
      const target = (row.querySelector(".rule-target") as HTMLInputElement).value.trim();
      if (!target) return;
      if (type === "REDIRECT") {
        const source = (row.querySelector(".rule-source") as HTMLInputElement).value.trim();
        if (source) {
          res += `REDIRECT ${quoteArgIfSpaced(normalizeToConfig(target, true))} ${quoteArgIfSpaced(normalizeToConfig(source, false))}\n`;
        }
      } else if (type === "HIDE" || type === "RO" || type === "ALLOW") {
        res += `${type} ${quoteArgIfSpaced(normalizeToConfig(target, true))}\n`;
      }
    });
  }
  return res.trim();
};
export const setupModeToggle = (
  groupName: string,
  visualId: string,
  rawId: string,
  contentId: string,
  parseFunc: (val: string) => void,
  genFunc: () => string,
): void => {
  const buttons = document.querySelectorAll(`button[name="${groupName}"]`);
  const visualEl = document.getElementById(visualId)!;
  const rawEl = document.getElementById(rawId)!;
  const contentEl = document.getElementById(contentId) as HTMLTextAreaElement;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if ((btn as HTMLElement).dataset.mode === "visual") {
        parseFunc(contentEl.value);
        rawEl.classList.remove("active");
        visualEl.classList.add("active");
      } else {
        contentEl.value = genFunc();
        visualEl.classList.remove("active");
        rawEl.classList.add("active");
      }
    });
  });
};
export const updateSuggestionBoxPosition = (input: HTMLInputElement): void => {
  const box = document.getElementById("suggestionBox");
  if (!box || !input || !box.classList.contains("open")) return;
  const wrapper = input.closest(".mx-input-wrapper");
  if (!wrapper) return;
  if (box.parentNode !== wrapper) {
    wrapper.appendChild(box);
  }
  const container =
    input.closest(".overflow-y-auto") ||
    input.closest(".mx-subpage-body") ||
    input.closest(".editor-scroll");
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const effectiveBottom = Math.min(containerRect.bottom, viewportHeight);
  const spaceBelow = effectiveBottom - inputRect.bottom;
  const spaceAbove = inputRect.top - containerRect.top;
  const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
  box.style.top = placeAbove ? "auto" : "100%";
  box.style.bottom = placeAbove ? "100%" : "auto";
  box.style.marginTop = placeAbove ? "0px" : "4px";
  box.style.marginBottom = placeAbove ? "4px" : "0px";
};
export const centerActiveInput = (input: HTMLElement): void => {
  if (!input) return;
  const row = input.closest(".rule-row") || input.closest(".mx-form-group") || input;
  const container: HTMLElement | null =
    input.closest(".overflow-y-auto") ||
    input.closest(".mx-subpage-body") ||
    input.closest(".editor-scroll");
  if (!row || !container) return;
  if (container._scrollAnimId) {
    cancelAnimationFrame(container._scrollAnimId);
  }
  const keyboardOpen = document.body.classList.contains("keyboard-open");
  if (keyboardOpen) {
    row.scrollIntoView({ block: "nearest" });
    return;
  }
  const duration = 280;
  const startTime = performance.now();
  const startScrollTop = container.scrollTop;
  const step = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const relativeTop = rowRect.top - containerRect.top + container.scrollTop;
    const idealScrollTop = relativeTop - containerRect.height / 2 + rowRect.height / 2;
    const maxScrollTop = container.scrollHeight - containerRect.height;
    const targetScrollTop = Math.max(0, Math.min(idealScrollTop, maxScrollTop));
    container.scrollTop = startScrollTop + (targetScrollTop - startScrollTop) * ease;
    if (progress < 1) {
      container._scrollAnimId = requestAnimationFrame(step);
    } else {
      container._scrollAnimId = null;
    }
  };
  container._scrollAnimId = requestAnimationFrame(step);
};
export const debouncedCenterActive = debounce((input: HTMLElement) => {
  centerActiveInput(input);
}, 80);
interface ParsedAutocompletePath {
  prefixDir: string;
  searchPrefix: string;
  displayBase: string;
}
function parseAutocompletePath(value: string): ParsedAutocompletePath {
  const result: ParsedAutocompletePath = {
    prefixDir: CONST.PATH_PREFIX_REAL + "/",
    searchPrefix: "",
    displayBase: "/",
  };
  const clean = value.replace(/^\/+/, "");
  if (!clean) return result;
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash === -1) {
    result.searchPrefix = clean;
  } else {
    result.prefixDir = CONST.PATH_PREFIX_REAL + "/" + clean.substring(0, lastSlash + 1);
    result.searchPrefix = clean.substring(lastSlash + 1);
    result.displayBase = "/" + clean.substring(0, lastSlash + 1);
  }
  return result;
}
function closeSuggestionBox(box: HTMLElement): void {
  box.classList.remove("open");
  state.currentSuggestions = [];
  state.suggestionBoxHeight = 0;
}
const FONT_STYLE = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const HORIZONTAL_PADDING = 24;
const ICON_AND_GAP = 16 + 8;
function computeSuggestionBoxHeight(sugs: Suggestion[], inputRectWidth: number): number {
  let totalHeight = 2;
  const availTextWidth = inputRectWidth - HORIZONTAL_PADDING - ICON_AND_GAP;
  for (const s of sugs) {
    try {
      const preparedText = prepare(s.t, FONT_STYLE);
      const { height } = layout(preparedText, Math.max(availTextWidth, 50), 18);
      totalHeight += height + 20 + 1;
    } catch {
      totalHeight += 39;
    }
  }
  return totalHeight;
}
function buildSuggestionHtml(sugs: Suggestion[]): string {
  return sugs
    .map(
      (s) =>
        `<div class="suggestion-item" data-path="${s.t.replace(/"/g, "&quot;")}"><span style="display:flex">${s.i}</span><span style="word-break:break-all;flex:1;line-height:18px;">${s.t}</span></div>`,
    )
    .join("");
}
const _navInputsCache = new Map<string, HTMLInputElement[]>();
const setupContainerAutocomplete = (container: HTMLElement): void => {
  if (container.dataset.autocompleteDelegated === "true") return;
  container.dataset.autocompleteDelegated = "true";
  let box = document.getElementById("suggestionBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "suggestionBox";
    box.className = "suggestion-box";
    document.body.appendChild(box);
  }
  if (box.dataset.initialized !== "true") {
    box.dataset.initialized = "true";
    box.addEventListener("pointerdown", (e: PointerEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".suggestion-item");
      if (!item || !item.dataset.path) return;
      box!.dataset.interacting = "true";
      isScrolling = false;
      startX = e.clientX;
      startY = e.clientY;
    });
    box.addEventListener("pointermove", (e: PointerEvent) => {
      if (box!.dataset.interacting !== "true") return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isScrolling = true;
      }
    });
    box.addEventListener("pointerup", (e: PointerEvent) => {
      if (box!.dataset.interacting !== "true") return;
      const item = (e.target as HTMLElement).closest<HTMLElement>(".suggestion-item");
      if (item && item.dataset.path && !isScrolling) {
        const cur = window._currentInput as HTMLInputElement | null;
        if (cur) {
          cur.value = item.dataset.path;
          cur.dispatchEvent(new Event("input"));
          cur.focus();
        }
        box!.classList.remove("open");
        state.currentSuggestions = [];
        box!.dataset.interacting = "false";
      } else {
        setTimeout(() => { box!.dataset.interacting = "false"; }, 100);
      }
    });
    box.addEventListener("pointercancel", () => {
      setTimeout(() => { box!.dataset.interacting = "false"; }, 100);
      isScrolling = false;
    });
  }
  const handleInput = debounce(async (e: Event) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>(".mx-input");
    if (!input) return;
    const b = document.getElementById("suggestionBox")!;
    const val = input.value;
    if (!val.trim()) { input.classList.remove("path-exists"); closeSuggestionBox(b); return; }
    const { prefixDir, searchPrefix, displayBase } = parseAutocompletePath(val);
    try {
      const safeDir = prefixDir.replace(/\/+/g, "/");
      const fullPath = (CONST.PATH_PREFIX_REAL + "/" + val.replace(/^\/+/, "")).replace(/\/+/g, "/");
      const [dirRes, pathRes] = await Promise.all([
        exec(`if [ -d "${safeDir}" ]; then ls -F -1 "${safeDir}" 2>/dev/null | head -n 30; else echo "__NOTDIR__"; fi`),
        exec(`test -d "${fullPath}" && echo "EXISTS"`),
      ]);
      const pathExists = pathRes.stdout?.trim() === "EXISTS";
      input.classList.toggle("path-exists", pathExists);
      if (!dirRes || !dirRes.stdout || dirRes.stdout.trim() === "__NOTDIR__") {
        closeSuggestionBox(b);
        return;
      }
      const sugs: Suggestion[] = dirRes.stdout
        .split("\n")
        .filter((l: string) => l.endsWith("/") && l.startsWith(searchPrefix))
        .map((l: string) => ({ t: displayBase + l, i: ICONS.FOLDER }));
      if (sugs.length === 0) { closeSuggestionBox(b); return; }
      state.currentSuggestions = sugs;
      state.suggestionBoxHeight = computeSuggestionBoxHeight(sugs, input.getBoundingClientRect().width);
      b.innerHTML = buildSuggestionHtml(sugs);
      b.classList.add("open");
      requestAnimationFrame(() => updateSuggestionBoxPosition(input));
    } catch {
      closeSuggestionBox(b);
    }
  }, 250);
  container.addEventListener("input", handleInput);
  container.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "ArrowUp" && ke.key !== "ArrowDown") return;
    const input = (e.target as HTMLElement).closest<HTMLInputElement>(".mx-input");
    if (!input) return;
    const subpage = input.closest<HTMLElement>(".mx-subpage-container.open");
    if (!subpage) return;
    const key = subpage.id;
    if (!key) return;
    let inputs = _navInputsCache.get(key);
    if (!inputs) {
      inputs = Array.from(subpage.querySelectorAll<HTMLInputElement>(".mx-input:not([readonly])"));
      _navInputsCache.set(key, inputs);
    }
    const idx = inputs.indexOf(input);
    if (idx === -1) return;
    if (ke.key === "ArrowUp" && idx > 0) {
      ke.preventDefault();
      inputs[idx - 1].focus();
    } else if (ke.key === "ArrowDown" && idx < inputs.length - 1) {
      ke.preventDefault();
      inputs[idx + 1].focus();
    }
  });
  container.addEventListener("focusin", (e: FocusEvent) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>(".mx-input");
    if (!input) return;
    window._currentInput = input;
    centerActiveInput(input);
    const isFirstFocus = !input.hasAttribute("data-has-focused");
    if (isFirstFocus) input.setAttribute("data-has-focused", "true");
    setTimeout(() => {
      if (document.activeElement === input) {
        input.dispatchEvent(new Event("input"));
      }
    }, isFirstFocus ? 400 : 0);
  });
  container.addEventListener("focusout", (e: FocusEvent) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>(".mx-input");
    if (!input) return;
    setTimeout(() => {
      const sb = document.getElementById("suggestionBox");
      if (sb && sb.dataset.interacting === "true") return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains("mx-input")) {
        if (sb) { sb.classList.remove("open"); state.currentSuggestions = []; }
      }
    }, 150);
  });
  if (!container.hasAttribute("data-nav-observer")) {
    container.setAttribute("data-nav-observer", "true");
    new MutationObserver(() => {
      const sub = container.closest<HTMLElement>(".mx-subpage-container.open");
      if (sub && sub.id) _navInputsCache.delete(sub.id);
    }).observe(container, { childList: true, subtree: false });
  }
};
export const destroyVirtualScroller = (containerId: string): void => {
  _destroyVS(containerId);
};