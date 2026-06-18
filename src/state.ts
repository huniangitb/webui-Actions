import type { AppState, Settings } from "./types/index";

export const state: AppState = {
  appMap: new Map(),
  globalConfText: "",
  injectorStates: new Map(),
  injectorRulesMap: new Map(),
  currentSettings: { autoTheme: true, syncPlugin: false } as Settings,
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
  resumePolling: null,
  suspendPolling: null,
};

/**
 * Close all modals/subpages and resume polling.
 * Moved here to avoid circular imports between main.js ↔ backup.js.
 */
export const closeModalCleanup = (): void => {
  if (history.state && (history.state as Record<string, unknown>).modalOpen) {
    history.back();
  } else {
    const appConfig = document.getElementById("appConfigSubpage");
    if (appConfig && appConfig.classList.contains("open")) {
      appConfig.classList.remove("open");
      appConfig.classList.add("closing");
      setTimeout(() => {
        appConfig.classList.remove("closing");
      }, 220);
    }
    document.querySelector(".mx-app")?.classList.remove("frozen");
    document.body.classList.remove("modal-open", "keyboard-open");
    document.documentElement.style.setProperty("--keyboard-h", "0px");
    document.querySelectorAll(".mx-modal-overlay.open").forEach((el) => el.classList.remove("open"));
    state.resumePolling?.();
    (window as Record<string, unknown>)._currentInput = null;
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
