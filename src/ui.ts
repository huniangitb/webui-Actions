import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce } from "./utils.js";
import { exec } from "kernelsu";
import { prepare, layout } from "@chenglou/pretext";
import type { Suggestion } from "./types/index";
import { initCustomSelect } from "./select.js";

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

  /* Init custom select after adding to DOM so layout is ready */
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
    const parts = line.trim().split(/\s+/);
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
        res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
      }
    } else if (type === "HIDE" || type === "RO" || type === "ALLOW") {
      res += `${type} ${normalizeToConfig(target, true)}\n`;
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
    input.closest(".mx-subpage-body");
  if (!row || !container) return;
  if (container._scrollAnimId) {
    cancelAnimationFrame(container._scrollAnimId);
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

declare global {
  interface Window {
    _currentInput: HTMLInputElement | null;
  }
}

// ---- Autocomplete helpers ----
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

async function checkInputPathExists(val: string): Promise<boolean> {
  if (!val.trim()) return false;
  const fullPath = val.startsWith("/")
    ? CONST.PATH_PREFIX_REAL + val
    : CONST.PATH_PREFIX_REAL + "/" + val;
  try {
    const checkRes = await exec(
      `test -d "${fullPath.replace(/\/+/g, "/")}" 2>/dev/null && echo yes`,
    );
    return checkRes.stdout?.trim() === "yes";
  } catch {
    return false;
  }
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
        `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.t}';window._currentInput.dispatchEvent(new Event('input'))"><span style="display:flex">${s.i}</span><span style="word-break:break-all;flex:1;line-height:18px;">${s.t}</span></div>`,
    )
    .join("");
}

// ---- Autocomplete setup ----
const setupAutocomplete = (input: HTMLInputElement | null): void => {
  if (!input) return;
  let box = document.getElementById("suggestionBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "suggestionBox";
    box.className = "suggestion-box";
    document.body.appendChild(box);
  }
  input.addEventListener(
    "input",
    debounce(async (e: Event) => {
      const val = (e.target as HTMLInputElement).value;
      const { prefixDir, searchPrefix, displayBase } = parseAutocompletePath(val);
      try {
        const res = await exec(
          `ls -F -1 "${prefixDir.replace(/\/+/g, "/")}" 2>/dev/null | head -n 30`,
        );
        if (!res || !res.stdout) {
          closeSuggestionBox(box!);
          return;
        }
        const sugs: Suggestion[] = res.stdout
          .split("\n")
          .filter((l: string) => l.endsWith("/") && l.startsWith(searchPrefix))
          .map((l: string) => ({ t: displayBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          closeSuggestionBox(box!);
          return;
        }
        const inputPathExists = await checkInputPathExists(val);
        input.classList.toggle("path-exists", inputPathExists);
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
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains("mx-input")) {
        const suggestionBox = document.getElementById("suggestionBox");
        if (suggestionBox) {
          suggestionBox.classList.remove("open");
          state.currentSuggestions = [];
        }
      }
    }, 150);
  });
};