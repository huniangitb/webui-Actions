import {
  mdiMathLog,
  mdiViewGridOutline,
  mdiMonitorDashboard,
  mdiWrench,
  mdiMagnify,
  mdiCog,
  mdiClose,
  mdiPlus,
  mdiDeleteOutline,
  mdiWeatherNight,
  mdiWhiteBalanceSunny,
  mdiStopCircleOutline,
  mdiPlayCircleOutline,
  mdiFolderOutline,
  mdiFileOutline,
  mdiEyeOffOutline,
  mdiDeleteSweepOutline,
  mdiClockOutline,
} from "@mdi/js";
import { exec, toast as ksuToast } from "kernelsu";
import { state, CONST } from "./state.js";

// ---- Shell helper ----
export const run = async (cmd) => {
  try {
    const res = await exec(cmd);
    return res.errno === 0 && res.stdout ? res.stdout.trim() : "";
  } catch {
    return "";
  }
};

// ---- Debounce ----
export const debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// ---- Toast (采用现代 Web Animations API 高性能合成层动画) ----
export const showToast = (msg) => {
  try {
    ksuToast(msg);
  } catch {}
  
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "mx-toast";
  t.textContent = msg;
  
  // 提前通知浏览器内核准备渲染流水线硬件加速
  t.style.willChange = "transform, opacity";
  c.appendChild(t);

  // 利用浏览器原生的 Web Animations API (WAAPI) 驱动 spring 阻尼淡入，完全不拖累主线程
  t.animate([
    { transform: 'translateY(16px) scale(0.95)', opacity: 0 },
    { transform: 'translateY(0) scale(1)', opacity: 1 }
  ], {
    duration: 250,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    fill: 'forwards'
  });

  setTimeout(() => {
    const animOut = t.animate([
      { transform: 'translateY(0) scale(1)', opacity: 1 },
      { transform: 'translateY(-12px) scale(0.95)', opacity: 0 }
    ], {
      duration: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards'
    });
    animOut.onfinish = () => t.remove();
  }, 2500);
};

// ---- SVG icon helper ----
const getSvg = (path, size = 24, color = "currentColor") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}"><path d="${path}" fill="${color}" stroke="none"/></svg>`;
export const ICONS = {
  APPS: getSvg(mdiViewGridOutline),
  GLOBAL: getSvg(mdiWrench),
  IO: getSvg(mdiMonitorDashboard),
  LOG: getSvg(mdiMathLog),
  SEARCH: getSvg(mdiMagnify, 18, "var(--mx-t2)"),
  COG: getSvg(mdiCog),
  CLOSE: getSvg(mdiClose),
  PLUS: getSvg(mdiPlus, 18),
  DELETE: getSvg(mdiDeleteOutline, 18),
  MOON: getSvg(mdiWeatherNight),
  SUN: getSvg(mdiWhiteBalanceSunny),
  STOP: getSvg(mdiStopCircleOutline, 24, "var(--mx-red)"),
  PLAY: getSvg(mdiPlayCircleOutline, 24, "var(--mx-green)"),
  FOLDER: getSvg(mdiFolderOutline, 16),
  FILE: getSvg(mdiFileOutline, 16),
  IGNORE: getSvg(mdiEyeOffOutline),
  SWEEP: getSvg(mdiDeleteSweepOutline),
  CLOCK: getSvg(mdiClockOutline, 14, "var(--mx-t2)"),
};

// ---- Theme icons ----
export const updateThemeIcons = () => {
  const icon = state.isDarkMode ? ICONS.SUN : ICONS.MOON;
  const mobile = document.getElementById("btnThemeToggleMobile");
  const desktop = document.getElementById("btnThemeToggleDesktop");
  if (mobile) mobile.innerHTML = icon;
  if (desktop) desktop.innerHTML = icon;
};

// ---- Icon init ----
export const initIcons = () => {
  const byId = (id) => document.getElementById(id);
  byId("logoIconMobile").innerHTML = ICONS.APPS;
  byId("logoIconDesktop").innerHTML = ICONS.APPS;
  byId("navIconApps").innerHTML = ICONS.APPS;
  byId("navIconGlobal").innerHTML = ICONS.GLOBAL;
  byId("navIconIo").innerHTML = ICONS.IO;
  byId("navIconLog").innerHTML = ICONS.LOG;
  byId("btmIconApps").innerHTML = ICONS.APPS;
  byId("btmIconGlobal").innerHTML = ICONS.GLOBAL;
  byId("btmIconIo").innerHTML = ICONS.IO;
  byId("btmIconLog").innerHTML = ICONS.LOG;
  byId("iconSearch").innerHTML = ICONS.SEARCH;
  byId("iconIoSearch").innerHTML = ICONS.SEARCH;
  byId("btnSettingsMobile").innerHTML = ICONS.COG;
  byId("btnSettingsDesktop").innerHTML = ICONS.COG;
  byId("btnCloseAppModal").innerHTML = ICONS.CLOSE;
  const btnGlobalAdd = document.getElementById("btnGlobalAddRule");
  if (btnGlobalAdd) btnGlobalAdd.innerHTML = `${ICONS.PLUS} 添加规则`;
  const btnAppAdd = document.getElementById("btnAppAddRule");
  if (btnAppAdd) btnAppAdd.innerHTML = `${ICONS.PLUS} 添加规则`;
  const btnAddIgnore = document.getElementById("btnAddIgnoreRow");
  if (btnAddIgnore) btnAddIgnore.textContent = "添加路径";
  const btnMonitor = document.getElementById("btnMonitorIgnore");
  if (btnMonitor) btnMonitor.innerHTML = ICONS.IGNORE;
  const btnClear = document.getElementById("btnClearIo");
  if (btnClear) btnClear.innerHTML = ICONS.SWEEP;
};

// ---- Path normalizers ----
export const normalizeToDisplay = (path) => {
  if (!path) return "";
  if (path.startsWith(CONST.PATH_PREFIX_REAL))
    return path.substring(CONST.PATH_PREFIX_REAL.length) || "/";
  if (path.startsWith(CONST.PATH_PREFIX_STORAGE))
    return path.substring(CONST.PATH_PREFIX_STORAGE.length) || "/";
  return path;
};

export const normalizeToConfig = (path, isTarget) => {
  if (!path) return "";
  path = path.trim();
  const prefix = isTarget ? CONST.PATH_PREFIX_STORAGE : CONST.PATH_PREFIX_REAL;
  if (path.startsWith("/")) return path;
  return (prefix + "/" + path).replace(/\/+/g, "/");
};