import type { AppState } from "./types/index";

export const state: AppState = {
  appMap: new Map(),
  globalConfText: "",
  injectorStates: new Map(),
  injectorRulesMap: new Map(),
  currentSettings: { autoTheme: true, colorProfile: "teal", useLogCtl: true },
  activeUsers: [0],
  activeMounts: new Set(),
  injectedApps: new Map(),
  currentAppFilter: "filterUser",
  usingFallback: false,
  currentPid: null,
  currentBindingPkg: null,
  currentBindingUser: 0,
  ioState: { offset: 0, loading: false, hasMore: true, term: "" },
  sysState: { offset: 0, loading: false, hasMore: true, term: "", level: -1 },
  isDarkMode: true,
  currentSuggestions: [],
  suggestionBoxHeight: 0,
  cachedModalHeight: null,
  lastActiveModal: null,
  isViewportResizing: false,
  isUserTouching: false,
  currentSection: "",
  resumePolling: null,
  suspendPolling: null,
};

export const closeModalCleanup = (): void => {
  // 无论历史状态如何，先关闭 UI
  const appConfig = document.getElementById("appConfigSubpage");
  if (appConfig?.classList.contains("open")) {
    appConfig.classList.remove("open");
    appConfig.classList.add("closing");
    setTimeout(() => appConfig.classList.remove("closing"), 300);
  }
  document.querySelector(".mx-app")?.classList.remove("frozen");
  document.body.classList.remove("modal-open", "keyboard-open");
  document.documentElement.style.setProperty("--keyboard-h", "0px");
  document.querySelectorAll(".mx-modal-overlay.open").forEach((el) => el.classList.remove("open"));
  document.querySelector<HTMLElement>(".mx-bottom-nav")?.style.removeProperty("transform");
  state.resumePolling?.();
  window._currentInput = null;

  // 再清理历史状态（如果有 pushState 的标记）
  const historyState = history.state as Record<string, unknown> | null;
  if (historyState?.modalOpen) {
    history.back();
  }
};

export const CONST = {
  BASE_DIR: "/data/Namespace-Proxy",
  INJECTOR_CONF: "/data/Namespace-Proxy/injector.conf",
  MONITOR_IGNORE_CONF: "/data/Namespace-Proxy/monitor_ignore.conf",
  LIST_CONFIG: "/data/Namespace-Proxy/list.config",
  LOG_CTL: "/data/adb/modules/Namespace-Proxy/bin/log_ctl",
  SERVICE_SH: "/data/adb/modules/Namespace-Proxy/service.sh",
  PATH_PREFIX_STORAGE: "/storage/emulated/0",
  PATH_PREFIX_REAL: "/data/media/0",
  PAGE_LIMIT: 50,
} as const;
