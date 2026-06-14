import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce } from "./utils.js";
import { exec } from "kernelsu";
import { prepare, layout } from "@chenglou/pretext";

export const addRuleRow = (type, target, source, containerId) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement("div");
  div.className = "rule-row";
  div.innerHTML = `<select class="mx-select rule-type flex-shrink-0" style="width:90px; padding:8px 24px 8px 8px; font-size:12px;">
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
  const select = div.querySelector(".rule-type");
  select.value = type;
  select.onchange = (e) => {
    const srcWrapper = div.querySelectorAll(".mx-input-wrapper")[1];
    if (srcWrapper) {
      srcWrapper.classList.toggle("hidden", e.target.value !== "REDIRECT");
    }
  };
  div.querySelector(".btn-del").onclick = () => div.remove();
  setupAutocomplete(div.querySelectorAll(".mx-input")[0]);
  setupAutocomplete(div.querySelectorAll(".mx-input")[1]);
  container.appendChild(div);
};

export const parseConfigTextToVisual = (text, containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = "";
  const selMonitor = document.getElementById(monitorSelectId);
  if (selMonitor) selMonitor.value = "";
  const selSandbox = document.getElementById(sandboxSelectId);
  if (selSandbox) selSandbox.value = "";
  const selInject = document.getElementById(injectSelectId);
  if (selInject) selInject.value = "";
  if (text) {
    text.split("\n").forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === "REDIRECT" && parts.length >= 3)
        addRuleRow("REDIRECT", normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(" ")), containerId);
      else if (["HIDE", "RO", "ALLOW"].includes(parts[0]) && parts.length >= 2)
        addRuleRow(parts[0], normalizeToDisplay(parts[1]), "", containerId);
      else if (parts[0] === "MONITOR" && selMonitor) selMonitor.value = parts[1];
      else if (parts[0] === "SANDBOX" && selSandbox) selSandbox.value = parts[1];
      else if (parts[0] === "GLOBAL_INJECT" && selInject) selInject.value = parts[1];
    });
  }
};

export const generateConfigTextFromVisual = (containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
  let res = "";
  const selInject = document.getElementById(injectSelectId);
  if (selInject && selInject.value) res += `GLOBAL_INJECT ${selInject.value}\n`;
  const selMonitor = document.getElementById(monitorSelectId);
  if (selMonitor && selMonitor.value) res += `MONITOR ${selMonitor.value}\n`;
  const selSandbox = document.getElementById(sandboxSelectId);
  if (selSandbox && selSandbox.value) res += `SANDBOX ${selSandbox.value}\n`;
  document.querySelectorAll(`#${containerId} .rule-row`).forEach((row) => {
    const type = row.querySelector(".rule-type").value;
    const target = row.querySelector(".rule-target").value.trim();
    const source = row.querySelector(".rule-source").value.trim();
    if (target) {
      if (type === "REDIRECT" && source)
        res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
      else if (["HIDE", "RO", "ALLOW"].includes(type))
        res += `${type} ${normalizeToConfig(target, true)}\n`;
    }
  });
  return res.trim();
};

export const setupModeToggle = (groupName, visualId, rawId, contentId, parseFunc, genFunc) => {
  document.querySelectorAll(`button[name="${groupName}"]`).forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(`button[name="${groupName}"]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.mode === "visual") {
        parseFunc(document.getElementById(contentId).value);
        document.getElementById(rawId).classList.remove("active");
        document.getElementById(visualId).classList.add("active");
      } else {
        document.getElementById(contentId).value = genFunc();
        document.getElementById(visualId).classList.remove("active");
        document.getElementById(rawId).classList.add("active");
      }
    };
  });
};

export const updateSuggestionBoxPosition = (input) => {
  const box = document.getElementById("suggestionBox");
  if (!box || !input || !box.classList.contains("open")) return;
  const wrapper = input.closest(".mx-input-wrapper");
  if (!wrapper) return;
  if (box.parentNode !== wrapper) {
    wrapper.appendChild(box);
  }
  const container = input.closest(".overflow-y-auto") || input.closest(".mx-subpage-body") || input.closest(".editor-scroll");
  if (container) {
    const containerRect = container.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const effectiveBottom = Math.min(containerRect.bottom, vvHeight);
    const spaceBelow = effectiveBottom - inputRect.bottom;
    const spaceAbove = inputRect.top - containerRect.top;
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
      box.style.top = "auto";
      box.style.bottom = "100%";
      box.style.marginTop = "0px";
      box.style.marginBottom = "4px";
    } else {
      box.style.top = "100%";
      box.style.bottom = "auto";
      box.style.marginTop = "4px";
      box.style.marginBottom = "0px";
    }
  }
};

export const centerActiveInput = (input) => {
  if (!input) return;
  const row = input.closest(".rule-row") || input.closest(".mx-form-group") || input;
  // 过滤掉不带实际滚动特性的外层容器，精确定位负责内部视口滚动的目标
  const container = input.closest(".overflow-y-auto") || input.closest(".mx-subpage-body");
  if (!row || !container) return;

  // 如果已经有正在运行的滚动动画，先将其中止以防逻辑冲突
  if (container._scrollAnimId) {
    cancelAnimationFrame(container._scrollAnimId);
  }

  const duration = 280; // 与物理键盘开启的时间曲线保持一致
  const startTime = performance.now();
  const startScrollTop = container.scrollTop;

  const step = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // 标准缓动减速曲线 (Cubic Ease Out) 带来流畅感
    const ease = 1 - Math.pow(1 - progress, 3);

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();

    // 在每一帧动态计算在当前拉伸高度下，目标输入框在滚动画布中的绝对 Y 轴深度
    const relativeTop = rowRect.top - containerRect.top + container.scrollTop;

    // 自动将行元素对齐到当前视口的中心位置
    const idealScrollTop = relativeTop - (containerRect.height / 2) + (rowRect.height / 2);
    const maxScrollTop = container.scrollHeight - containerRect.height;
    const targetScrollTop = Math.max(0, Math.min(idealScrollTop, maxScrollTop));

    // 缓动线性差值过渡
    container.scrollTop = startScrollTop + (targetScrollTop - startScrollTop) * ease;

    if (progress < 1) {
      container._scrollAnimId = requestAnimationFrame(step);
    } else {
      container._scrollAnimId = null;
    }
  };

  container._scrollAnimId = requestAnimationFrame(step);
};

export const debouncedCenterActive = debounce((input) => {
  centerActiveInput(input);
}, 80);

const setupAutocomplete = (input) => {
  if (!input) return;
  const box = document.getElementById("suggestionBox");
  if (!box) return;
  input.addEventListener(
    "input",
    debounce(async (e) => {
      const val = e.target.value;
      let pDir = CONST.PATH_PREFIX_REAL + "/", sPre = "", dBase = "/";
      const cVal = val ? val.replace(/^\/+/, "") : "";
      if (cVal) {
        const ls = cVal.lastIndexOf("/");
        if (ls === -1) sPre = cVal;
        else {
          pDir = CONST.PATH_PREFIX_REAL + "/" + cVal.substring(0, ls + 1);
          sPre = cVal.substring(ls + 1);
          dBase = "/" + cVal.substring(0, ls + 1);
        }
      }
      try {
        const res = await exec(`ls -F -1 "${pDir.replace(/\/+/g, "/")}" 2>/dev/null | head -n 30`);
        if (!res || !res.stdout) {
          box.classList.remove("open");
          state.currentSuggestions = [];
          state.suggestionBoxHeight = 0;
          return;
        }
        const sugs = res.stdout
          .split("\n")
          .filter((l) => l.endsWith("/") && l.startsWith(sPre))
          .map((l) => ({ t: dBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          box.classList.remove("open");
          state.currentSuggestions = [];
          state.suggestionBoxHeight = 0;
          return;
        }
        let inputPathExists = false;
        if (val.trim()) {
          const fullPath = val.startsWith("/")
            ? CONST.PATH_PREFIX_REAL + val
            : CONST.PATH_PREFIX_REAL + "/" + val;
          try {
            const checkRes = await exec(`test -d "${fullPath.replace(/\/+/g, '/')}" 2>/dev/null && echo yes`);
            inputPathExists = checkRes.stdout?.trim() === "yes";
          } catch {}
        }
        input.classList.toggle("path-exists", inputPathExists);
        state.currentSuggestions = sugs;
        let totalBoxHeight = 2; 
        const fontStyle = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        const horizontalPadding = 24; 
        const iconAndGap = 16 + 8;
        const rect = input.getBoundingClientRect();
        const availTextWidth = rect.width - horizontalPadding - iconAndGap;
        sugs.forEach((s) => {
          try {
            const prepared = prepare(s.t, fontStyle);
            const { height } = layout(prepared, Math.max(availTextWidth, 50), 18);
            totalBoxHeight += height + 20 + 1;
          } catch {
            totalBoxHeight += 39;
          }
        });
        state.suggestionBoxHeight = totalBoxHeight;
        box.innerHTML = sugs
          .map(
            (s) =>
              `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.t}';window._currentInput.dispatchEvent(new Event('input'))"><span style="display:flex">${s.i}</span><span style="word-break:break-all;flex:1;line-height:18px;">${s.t}</span></div>`
          )
          .join("");
        box.classList.add("open");
        window.requestAnimationFrame(() => {
          updateSuggestionBoxPosition(input);
        });
      } catch {
        box.classList.remove("open");
        state.currentSuggestions = [];
        state.suggestionBoxHeight = 0;
      }
    }, 250)
  );
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const inputs = Array.from(document.querySelectorAll(".mx-subpage-container.open .mx-input:not([readonly])"));
      const idx = inputs.indexOf(input);
      if (idx !== -1) {
        if (e.key === "ArrowUp" && idx > 0) {
          e.preventDefault();
          inputs[idx - 1].focus();
        } else if (e.key === "ArrowDown" && idx < inputs.length - 1) {
          e.preventDefault();
          inputs[idx + 1].focus();
        }
      }
    }
  });
  input.addEventListener("focus", () => {
    window._currentInput = input;
    
    // 聚焦时瞬间开启高精度 RAF 滚动检测，配合键盘缓缓升起的时差，无缝滑动
    centerActiveInput(input);

    const isFirstFocus = !input.hasAttribute("data-has-focused");
    if (isFirstFocus) {
      input.setAttribute("data-has-focused", "true");
    }
    
    const dispatchDelay = isFirstFocus ? 400 : 0;
    setTimeout(() => {
      if (document.activeElement === input) {
        input.dispatchEvent(new Event("input"));
      }
    }, dispatchDelay);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains("mx-input")) {
        box.classList.remove("open");
        state.currentSuggestions = [];
      }
    }, 150);
  });
};