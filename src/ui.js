import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce } from "./utils.js";
import { exec } from "kernelsu";
import { prepare, layout } from "@chenglou/pretext";
// =============================================
// Rule row builder
// =============================================
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
    <input type="text" class="mx-input rule-target" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="原始路径" value="${target.replace(/"/g, "&quot;")}">
    <input type="text" class="mx-input rule-source ${type !== "REDIRECT" ? "hidden" : ""}" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="重定向至" value="${source.replace(/"/g, "&quot;")}">
  </div>
  <button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
  const select = div.querySelector(".rule-type");
  select.value = type;
  select.onchange = (e) =>
    div.querySelector(".rule-source").classList.toggle("hidden", e.target.value !== "REDIRECT");
  div.querySelector(".btn-del").onclick = () => div.remove();
  setupAutocomplete(div.querySelector(".rule-target"));
  setupAutocomplete(div.querySelector(".rule-source"));
  container.appendChild(div);
};
// =============================================
// Config text ↔ visual builders
// =============================================
export const parseConfigTextToVisual = (
  text,
  containerId,
  monitorSelectId,
  sandboxSelectId,
  injectSelectId
) => {
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
// =============================================
// Mode toggle helper
// =============================================
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
// =============================================
// Modal Shifter (Allows overflowing above screen)
// =============================================
export const updateModalShift = () => {
  const modal = document.querySelector(".mx-modal-overlay.open .mx-modal");
  if (!modal) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const totalH = window.innerHeight;
  // 键盘未弹出或已收回，归位
  if (vh >= totalH - 60) {
    modal.style.transform = "scale(1) translate3d(0, 0, 0)";
    return;
  }
  // 暂存当前平移，复位并重构一个不受当前 transform 干扰的基础位置，用于精准测算
  const prevTransform = modal.style.transform;
  modal.style.transform = "scale(1) translate3d(0, 0, 0)";
  const rect = modal.getBoundingClientRect();
  // 测算完毕，先迅速恢复平移，防止重排画面闪烁
  modal.style.transform = prevTransform;
  // 测算在自然状态下，模态框底部有多少像素被键盘盖住
  const overlap = rect.bottom - vh + 16; // 16px 安全外边距
  if (overlap > 0) {
    // 整体上移 modal 视图位置（允许向上超出屏幕）
    modal.style.transform = `scale(1) translate3d(0, -${overlap}px, 0)`;
  } else {
    modal.style.transform = "scale(1) translate3d(0, 0, 0)";
  }
};
// =============================================
// Autocomplete Positioner (With Pretext optimization)
// =============================================
export const updateSuggestionBoxPosition = (input) => {
  const box = document.getElementById("suggestionBox");
  if (!box || !input || box.style.display === "none") return;
  const rect = input.getBoundingClientRect();
  // 移动端核心校准：减去视觉视口本身的滚动平移量 offsetTop / offsetLeft
  // 确保当输入法将网页顶起、视觉视口发生位移时，定位框仍能毫厘不差地紧贴输入框，不发生任何偏移
  const vv = window.visualViewport;
  const vh = vv ? vv.height : window.innerHeight;
  const scrollY = vv ? vv.offsetTop : 0;
  const scrollX = vv ? vv.offsetLeft : 0;
  const inputLeft = rect.left - scrollX;
  const inputTop = rect.top - scrollY;
  const inputBottom = rect.bottom - scrollY;
  box.style.width = rect.width + "px";
  box.style.left = "0px";
  box.style.top = "0px";
  box.style.bottom = "auto";
  // 使用 Pretext 代数运算计算补全框的精确内容高度，完全规避触发浏览器 Reflow
  let totalBoxHeight = 2; // 上下边框像素
  const fontStyle = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const horizontalPadding = 24; // 左右各 12px
  const iconAndGap = 16 + 8; // 图标宽度及间距
  const availTextWidth = rect.width - horizontalPadding - iconAndGap;
  (state.currentSuggestions || []).forEach((s) => {
    try {
      const prepared = prepare(s.t, fontStyle);
      const { height } = layout(prepared, Math.max(availTextWidth, 50), 18);
      // 项高度 = 测算文本换行后高度 + 垂直 padding (20px) + 下边框 (1px)
      totalBoxHeight += height + 20 + 1;
    } catch {
      totalBoxHeight += 39;
    }
  });
  let computedTop = 0;
  if (inputBottom > vh / 2) {
    const maxHeight = Math.min(inputTop - 10, 240);
    const boxHeight = Math.min(totalBoxHeight, maxHeight);
    computedTop = inputTop - boxHeight - 4;
    box.style.maxHeight = maxHeight + "px";
  } else {
    const maxHeight = Math.min(vh - inputBottom - 10, 240);
    computedTop = inputBottom + 4;
    box.style.maxHeight = maxHeight + "px";
  }
  // 使用 3D 转换紧贴定位
  box.style.transform = `translate3d(${inputLeft}px, ${computedTop}px, 0)`;
};
// =============================================
// Autocomplete (file path)
// =============================================
const setupAutocomplete = (input) => {
  if (!input) return;
  const box = document.getElementById("suggestionBox");
  if (!box) return;
  input.addEventListener(
    "input",
    debounce(async (e) => {
      const val = e.target.value;
      let pDir = CONST.PATH_PREFIX_REAL + "/",
        sPre = "",
        dBase = "/";
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
          box.style.display = "none";
          state.currentSuggestions = [];
          return;
        }
        const sugs = res.stdout
          .split("\n")
          .filter((l) => l.endsWith("/") && l.startsWith(sPre))
          .map((l) => ({ t: dBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          box.style.display = "none";
          state.currentSuggestions = [];
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
        state.currentSuggestions = sugs; // 缓存供 Pretext 测量高度
        box.innerHTML = sugs
          .map(
            (s) =>
              `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.t}';window._currentInput.dispatchEvent(new Event('input'))"><span style="display:flex">${s.i}</span><span style="word-break:break-all;flex:1;line-height:18px;">${s.t}</span></div>`
          )
          .join("");
        box.style.display = "block";
        window.requestAnimationFrame(() => {
          updateSuggestionBoxPosition(input);
        });
      } catch {
        box.style.display = "none";
        state.currentSuggestions = [];
      }
    }, 250)
  );
  input.addEventListener("focus", () => {
    window._currentInput = input;
    // 聚焦定位：使输入行在局部滚动区内居中。若其下方还有后续行，将自动执行额外偏移量滚动
    window.requestAnimationFrame(() => {
      const container = input.closest(".overflow-y-auto");
      const row = input.closest(".rule-row") || input;
      if (container && row) {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        // 检测下方是否还有更多的规则输入行
        let nextRowsCount = 0;
        let nextNode = row.nextElementSibling;
        while (nextNode) {
          if (nextNode.classList.contains("rule-row")) {
            nextRowsCount++;
          }
          nextNode = nextNode.nextElementSibling;
        }
        // 如果下方存在多行，自动向下额外平滑滚动偏移，把聚焦项进一步向上推起，从而完整露出下方未填项
        if (nextRowsCount > 0) {
          const extraScroll = Math.min(nextRowsCount * 45, 120); // 每多一行追加 45px，封顶 120px
          setTimeout(() => {
            if (document.activeElement === input) {
              container.scrollBy({ top: extraScroll, behavior: "smooth" });
            }
          }, 180); // 180ms 延时，确保原生 scrollIntoView 轨迹大致结束
        }
      } else {
        input.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    // 大幅缩减键盘弹窗反馈动画延迟：从 320ms 降至 80ms，使体验极其敏捷 snappy
    setTimeout(() => {
      if (document.activeElement === input) {
        input.dispatchEvent(new Event("input"));
      }
    }, 80);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== input) {
        box.style.display = "none";
        state.currentSuggestions = [];
      }
    }, 120);
  });
};