import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce, quoteArgIfSpaced, splitLineRespectingQuotes } from "./utils.js";
import { exec } from "kernelsu";
import { prepare, layout } from "@chenglou/pretext";
import type { Suggestion } from "./types/index";
import { initCustomSelect } from "./select.js";

// 触摸手势检测参数
let startX = 0;
let startY = 0;
let isScrolling = false;

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

export const addRuleRow = (
  type: string,
  target: string,
  source: string,
  containerId: string,
): void => {
  const container = document.getElementById(containerId);
  if (!container) return;
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

  requestAnimationFrame(() => initCustomSelect(select));
  div.querySelector(".btn-del")?.addEventListener("click", () => div.remove());
  setupAutocomplete(div.querySelectorAll(".mx-input")[0] as HTMLInputElement);
  setupAutocomplete(div.querySelectorAll(".mx-input")[1] as HTMLInputElement);
  container.appendChild(div);
};

export const parseConfigTextToVisual = (
  text: string | null | undefined,
  containerId: string,
  monitorSelectId: string,
  sandboxSelectId: string,
  injectSelectId: string | null,
): void => {
  const container = document.getElementById(containerId);
  if (container) {
    const box = document.getElementById("suggestionBox");
    if (box && container.contains(box)) {
      document.body.appendChild(box);
    }
    container.innerHTML = "";
  }
  clearSelectValue(monitorSelectId);
  clearSelectValue(sandboxSelectId);
  clearSelectValue(injectSelectId);
  if (!text) return;

  const selMonitor = getSelectById(monitorSelectId);
  const selSandbox = getSelectById(sandboxSelectId);
  const selInject = getSelectById(injectSelectId);

  text.split("\n").forEach((line) => {
    const parts = splitLineRespectingQuotes(line.trim());
    const cmd = parts[0];
    if (cmd === "REDIRECT" && parts.length >= 3) {
      addRuleRow("REDIRECT", normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(" ")), containerId);
    } else if (parts.length >= 2) {
      if (cmd === "HIDE" || cmd === "RO" || cmd === "ALLOW") {
        addRuleRow(cmd, normalizeToDisplay(parts[1]), "", containerId);
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
  });
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

const setupAutocomplete = (input: HTMLInputElement | null): void => {
  if (!input) return;
  let box = document.getElementById("suggestionBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "suggestionBox";
    box.className = "suggestion-box";
    document.body.appendChild(box);
  }

  // 保证事件处理器有且仅绑定一次
  if (box.dataset.initialized !== "true") {
    box.dataset.initialized = "true";

    // 1. 拦截指针按压：开启临时选择交互锁，并标记初始触控点坐标
    box.addEventListener("pointerdown", (e: PointerEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".suggestion-item");
      if (!item || !item.dataset.path) return;

      box!.dataset.interacting = "true";
      isScrolling = false;
      startX = e.clientX;
      startY = e.clientY;
    });

    // 2. 指针滑动侦测：5px 位移检测，判定是点击补全还是原生滚动列表
    box.addEventListener("pointermove", (e: PointerEvent) => {
      if (box!.dataset.interacting !== "true") return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isScrolling = true;
      }
    });

    // 3. 指针松开结算：
    //   - 非滑动时：直接执行补全与建议框关闭，释放锁定。
    //   - 判定为滑动时：不执行补全，延迟 100ms 快速归还状态。
    box.addEventListener("pointerup", (e: PointerEvent) => {
      if (box!.dataset.interacting !== "true") return;

      const item = (e.target as HTMLElement).closest<HTMLElement>(".suggestion-item");
      if (item && item.dataset.path && !isScrolling) {
        // 纯粹轻点：填充路径并强制夺回焦点
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
        // 用户滚动：不修改内容，快速释放锁
        setTimeout(() => {
          box!.dataset.interacting = "false";
        }, 100);
      }
    });

    box.addEventListener("pointercancel", () => {
      setTimeout(() => {
        box!.dataset.interacting = "false";
      }, 100);
      isScrolling = false;
    });
  }

  input.addEventListener(
    "input",
    debounce(async (e: Event) => {
      const val = (e.target as HTMLInputElement).value;
      if (!val.trim()) { input.classList.remove("path-exists"); closeSuggestionBox(box!); return; }

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
          closeSuggestionBox(box!);
          return;
        }
        const sugs: Suggestion[] = dirRes.stdout
          .split("\n")
          .filter((l: string) => l.endsWith("/") && l.startsWith(searchPrefix))
          .map((l: string) => ({ t: displayBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          closeSuggestionBox(box!);
          return;
        }

        state.currentSuggestions = sugs;
        state.suggestionBoxHeight = computeSuggestionBoxHeight(sugs, input.getBoundingClientRect().width);
        box!.innerHTML = buildSuggestionHtml(sugs);
        box!.classList.add("open");
        window.requestAnimationFrame(() => {
          updateSuggestionBoxPosition(input);
        });
      } catch {
        closeSuggestionBox(box!);
      }
    }, 250),
  );

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        ".mx-subpage-container.open .mx-input:not([readonly])",
      ),
    );
    const idx = inputs.indexOf(input);
    if (idx === -1) return;
    if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      inputs[idx - 1].focus();
    } else if (e.key === "ArrowDown" && idx < inputs.length - 1) {
      e.preventDefault();
      inputs[idx + 1].focus();
    }
  });

  input.addEventListener("focus", () => {
    window._currentInput = input;
    centerActiveInput(input);
    const isFirstFocus = !input.hasAttribute("data-has-focused");
    if (isFirstFocus) {
      input.setAttribute("data-has-focused", "true");
    }
    setTimeout(() => {
      if (document.activeElement === input) {
        input.dispatchEvent(new Event("input"));
      }
    }, isFirstFocus ? 400 : 0);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      // 锁定状态拦截：若建议框正处于操作期间，禁止强行关闭
      const suggestionBox = document.getElementById("suggestionBox");
      if (suggestionBox && suggestionBox.dataset.interacting === "true") {
        return;
      }
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains("mx-input")) {
        if (suggestionBox) {
          suggestionBox.classList.remove("open");
          state.currentSuggestions = [];
        }
      }
    }, 150);
  });
};