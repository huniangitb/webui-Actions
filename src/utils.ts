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
  mdiBackupRestore,
} from "@mdi/js";
import { exec, toast as ksuToast } from "kernelsu";
import { state, CONST } from "./state.js";

// ── Shell execution ──

export const run = async (cmd: string): Promise<string> => {
  try {
    const res = await exec(cmd);
    return res.errno === 0 && res.stdout ? res.stdout.trim() : "";
  } catch {
    return "";
  }
};

// ── Debounce ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  wait: number,
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout>;
  return function (...args: Parameters<T>): void {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// ── Toast ──

type ToastType = "success" | "warning" | "error" | "info";

const TOAST_ICONS: Record<ToastType, string> = {
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

const toast = (msg: string, type?: ToastType): void => {
  const c = document.getElementById("toastContainer");
  if (!c) {
    try {
      ksuToast(msg);
    } catch {
      /* fallback silent */
    }
    return;
  }
  // deduplication: skip if the same message toast already exists
  for (let i = 0; i < c.children.length; i++) {
    if (c.children[i].textContent === msg) return;
  }
  const t = document.createElement("div");
  t.className = "mx-toast" + (type ? ` mx-toast-${type}` : "");
  if (type && TOAST_ICONS[type]) {
    t.innerHTML = `<span class="mx-toast-icon">${TOAST_ICONS[type]}</span><span style="flex:1">${msg}</span>`;
  } else {
    t.textContent = msg;
  }
  t.style.willChange = "transform, opacity";
  c.appendChild(t);
  t.animate(
    [
      { transform: "translateY(16px) scale(0.95)", opacity: 0 },
      { transform: "translateY(0) scale(1)", opacity: 1 },
    ],
    {
      duration: 250,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      fill: "forwards",
    },
  );
  setTimeout(() => {
    const animOut = t.animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: "translateY(-12px) scale(0.95)", opacity: 0 },
      ],
      {
        duration: 200,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );
    animOut.onfinish = () => t.remove();
  }, 2500);
};

// Toast with sub-methods
type ToastFn = {
  (msg: string): void;
  success: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
};

export const showToast = ((msg: string): void => toast(msg)) as ToastFn;
showToast.success = (msg: string): void => toast(msg, "success");
showToast.warning = (msg: string): void => toast(msg, "warning");
showToast.error = (msg: string): void => toast(msg, "error");
showToast.info = (msg: string): void => toast(msg, "info");

// ── Icons ──

const getSvg = (path: string, size = 24, color = "currentColor"): string =>
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
  BACKUP: getSvg(mdiBackupRestore),
} as const;

export const updateThemeIcons = (): void => {
  const icon = state.isDarkMode ? ICONS.SUN : ICONS.MOON;
  const mobile = document.getElementById("btnThemeToggleMobile");
  const desktop = document.getElementById("btnThemeToggleDesktop");
  if (mobile) mobile.innerHTML = icon;
  if (desktop) desktop.innerHTML = icon;
};

export const initIcons = (): void => {
  const byId = (id: string): HTMLElement | null => document.getElementById(id);

  byId("logoIconMobile")!.innerHTML = ICONS.APPS;
  byId("logoIconDesktop")!.innerHTML = ICONS.APPS;
  byId("navIconApps")!.innerHTML = ICONS.APPS;
  byId("navIconGlobal")!.innerHTML = ICONS.GLOBAL;
  byId("navIconIo")!.innerHTML = ICONS.IO;
  byId("navIconLog")!.innerHTML = ICONS.LOG;
  byId("btmIconApps")!.innerHTML = ICONS.APPS;
  byId("btmIconGlobal")!.innerHTML = ICONS.GLOBAL;
  byId("btmIconIo")!.innerHTML = ICONS.IO;
  byId("btmIconLog")!.innerHTML = ICONS.LOG;
  byId("iconSearch")!.innerHTML = ICONS.SEARCH;
  byId("iconIoSearch")!.innerHTML = ICONS.SEARCH;
  byId("btnSettingsMobile")!.innerHTML = ICONS.COG;
  byId("btnSettingsDesktop")!.innerHTML = ICONS.COG;

  const btnBackupMobile = byId("btnBackupMobile");
  if (btnBackupMobile) btnBackupMobile.innerHTML = ICONS.BACKUP;
  const navIconBackup = byId("navIconBackup");
  if (navIconBackup) navIconBackup.innerHTML = ICONS.BACKUP;

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
  document.querySelectorAll(".mx-btn-close").forEach((btn) => {
    btn.innerHTML = ICONS.CLOSE;
  });
};

export const normalizeToDisplay = (path: string | null | undefined): string => {
  if (!path) return "";
  if (path.startsWith(CONST.PATH_PREFIX_REAL))
    return path.substring(CONST.PATH_PREFIX_REAL.length) || "/";
  if (path.startsWith(CONST.PATH_PREFIX_STORAGE))
    return path.substring(CONST.PATH_PREFIX_STORAGE.length) || "/";
  return path;
};

export const normalizeToConfig = (path: string | null | undefined, isTarget: boolean): string => {
  if (!path) return "";
  path = path.trim();
  const prefix = isTarget ? CONST.PATH_PREFIX_STORAGE : CONST.PATH_PREFIX_REAL;
  if (path.startsWith("/")) return path;
  return (prefix + "/" + path).replace(/\/+/g, "/");
};
