import { state, CONST } from "./state.js";
import { run, showToast, ICONS, normalizeToDisplay, normalizeToConfig, debounce } from "./utils.js";
import { exec } from "kernelsu";

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
          return;
        }
        // Only show directories (those ending with /), exclude files
        const sugs = res.stdout
          .split("\n")
          .filter((l) => l.endsWith("/") && l.startsWith(sPre))
          .map((l) => ({ t: dBase + l, i: ICONS.FOLDER }));
        if (sugs.length === 0) {
          box.style.display = "none";
          return;
        }
        // Check if the user-entered path (full real path) exists as a directory
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

        box.innerHTML = sugs
          .map(
            (s) =>
              `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.t}';window._currentInput.dispatchEvent(new Event('input'))"><span style="display:flex">${s.i}</span><span style="overflow:hidden;text-overflow:ellipsis;flex:1;">${s.t}</span></div>`
          )
          .join("");
        const rect = input.getBoundingClientRect();
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        box.style.width = rect.width + "px";
        box.style.left = rect.left + "px";
        // Show with animation — the CSS animation plays on display:block
        box.style.display = "block";
        if (rect.bottom > vh / 2) {
          box.style.top = "auto";
          box.style.bottom = window.innerHeight - rect.top + 4 + "px";
          box.style.maxHeight = Math.min(rect.top - 10, 320) + "px";
        } else {
          box.style.bottom = "auto";
          box.style.top = rect.bottom + 4 + "px";
          box.style.maxHeight = Math.min(vh - rect.bottom - 10, 320) + "px";
        }
      } catch {
        box.style.display = "none";
      }
    }, 250)
  );
  input.addEventListener("focus", () => {
    window._currentInput = input;
    setTimeout(() => input.dispatchEvent(new Event("input")), 300);
  });
  input.addEventListener("blur", () => setTimeout(() => (box.style.display = "none"), 200));
};
