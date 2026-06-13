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
// Modal Shifter (With Layout cache optimization)
// =============================================
export const updateModalShift = () => {
  const modal = document.querySelector(".mx-modal-overlay.open .mx-modal");
  if (!modal) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const totalH = window.innerHeight;
  if (vh >= totalH - 60) {
    modal.style.transform = "scale(1) translate3d(0, 0, 0)";
    return;
  }
  if (!state.cachedModalHeight || state.lastActiveModal !== modal) {
    state.cachedModalHeight = modal.offsetHeight;
    state.lastActiveModal = modal;
  }
  const naturalTop = (totalH - state.cachedModalHeight) / 2;
  const naturalBottom = naturalTop + state.cachedModalHeight;
  const overlap = naturalBottom - vh + 16;
  if (overlap > 0) {
    // 采用性能极佳的 3D GPU 加速偏移上推遮罩，绝不触碰和修改 DOM 的物理高度，防止发生重排断档
    modal.style.transform = `scale(1) translate3d(0, -${overlap}px, 0)`;
  } else {
    modal.style.transform = "scale(1) translate3d(0, 0, 0)";
  }
};
// =============================================
// Autocomplete Positioner
// =============================================
export const updateSuggestionBoxPosition = (input) => {
  const box = document.getElementById("suggestionBox");
  if (!box || !input || box.style.display === "none") return;
  const wrapper = input.closest(".mx-input-wrapper");
  if (!wrapper) return;
  if (box.parentNode !== wrapper) {
    wrapper.appendChild(box);
  }
  const container = input.closest(".overflow-y-auto");
  if (container) {
    const containerRect = container.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    
    // 获取当前的 visualViewport 物理底边界（智能规避并计算各种键盘布局产生的遮挡区域）
    const vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    
    // 可用高度阈值为当前滚动配置容器底界和虚拟键盘顶缘的较小值
    const effectiveBottom = Math.min(containerRect.bottom, vvHeight);
    
    const spaceBelow = effectiveBottom - inputRect.bottom;
    const spaceAbove = inputRect.top - containerRect.top;
    
    // 如果因键盘挤压导致下方空隙小于 180px 且上方剩余空间比下方更宽裕，则提示框往上溢出弹出
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
// =============================================
// 【高阶流畅对齐引擎】
// 运用浏览器原生 Compositor 线程平滑滚动，使目标输入框平稳过渡定位在屏幕键盘上方的最佳视线区内
// =============================================
export const centerActiveInput = (input) => {
  const container = input.closest(".overflow-y-auto");
  const row = input.closest(".rule-row") || input;
  if (!container || !row) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  
  // 动态读取当前真实的可视高度（随九键、全键盘、表情等键盘布局切换自适应判定）
  const vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  
  // 测算当前滚动容器在键盘上缘以上的真实露空区高度
  const visibleContainerHeight = Math.max(120, vvHeight - containerRect.top);
  
  // 黄金中线偏上对齐算法：完美将当前聚焦行对齐到露出区 35% 偏上位置，彻底避开任何高度的键盘遮挡
  const targetY = containerRect.top + (visibleContainerHeight * 0.35);
  const diff = rowRect.top - targetY;
  
  // 采用浏览器原生高性能 smooth compositor 机制进行无损平稳定位
  container.style.scrollBehavior = "smooth";
  container.scrollTop += diff;
  
  setTimeout(() => {
    if (container) container.style.scrollBehavior = "";
  }, 300);
};

// 键盘高度频繁改变时的定位重测防抖函数，避免键盘升起动画过程中发生渲染冲突导致画面剧烈抖动
export const debouncedCenterActive = debounce((input) => {
  centerActiveInput(input);
}, 150);

// =============================================
// Autocomplete
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
          state.suggestionBoxHeight = 0;
          return;
        }
        const sugs = res.stdout
          .split("\n")
          .filter((l) => l.endsWith("/") && l.startsWith(sPre))
          .map((l) => ({ t: dBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          box.style.display = "none";
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
        box.style.display = "block";
        window.requestAnimationFrame(() => {
          updateSuggestionBoxPosition(input);
        });
      } catch {
        box.style.display = "none";
        state.currentSuggestions = [];
        state.suggestionBoxHeight = 0;
      }
    }, 250)
  );
  
  // 在 mx-input 输入框上注入键盘方向键 (ArrowUp/ArrowDown) 物理对焦导航引擎，解除 DOM 裁剪限制
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const inputs = Array.from(document.querySelectorAll(".mx-modal-overlay.open .mx-input:not([readonly])"));
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
    const container = input.closest(".overflow-y-auto");
    if (container) {
      // 开启大缓冲跑道，确保滚动流畅无截断
      container.style.paddingBottom = "550px";
      
      // 双阶滚动控制 - 阶段一：在 focus 瞬间(0ms)直接将输入行瞬移至容器最顶部（完全处于任何高度键盘的上方），消除起跳打断风险
      const row = input.closest(".rule-row") || input;
      container.style.scrollBehavior = "auto";
      container.scrollTop = row.offsetTop - 16;
    }
    // 双阶滚动控制 - 阶段二：在 80ms 后及 280ms 键盘彻底升起稳定后，以 compositor-smooth 机制微调缓动滑行到最佳中视线
    setTimeout(() => {
      if (document.activeElement === input) {
        centerActiveInput(input);
      }
    }, 80);
    setTimeout(() => {
      if (document.activeElement === input) {
        centerActiveInput(input);
      }
    }, 280);
    setTimeout(() => {
      if (document.activeElement === input) {
        input.dispatchEvent(new Event("input"));
      }
    }, 150);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains("mx-input")) {
        box.style.display = "none";
        state.currentSuggestions = [];
        const container = input.closest(".overflow-y-auto");
        if (container) {
          container.style.paddingBottom = "";
          container.style.scrollBehavior = "";
        }
      }
    }, 150);
  });
};