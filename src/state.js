// Shared application state
export const state = {
  appMap: new Map(),
  globalConfText: "",
  injectorStates: new Map(),
  injectorRulesMap: new Map(),
  currentSettings: { autoTheme: true, syncPlugin: false },
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
  currentSuggestions: [], // Pretext-driven autocomplete height measurement cache
  suggestionBoxHeight: 0, // Cached autocomplete box height to avoid layout thrashing
  cachedModalHeight: null, // Cached open modal height for keyboard offset calculations
  lastActiveModal: null,  // Track which modal is currently measured
  isViewportResizing: false,
  isUserTouching: false,  // 追踪用户真实物理触控
  resumePolling: null,    // 由 main.js 在初始化时设置，用于 closeModalCleanup 恢复轮询
};

/**
 * 关闭所有模态框/子页面并恢复轮询。
 * 避免 main.js ↔ backup.js 循环依赖，移到此共享模块。
 */
export const closeModalCleanup = () => {
  if (history.state && history.state.modalOpen) {
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
    document.documentElement.style.setProperty('--keyboard-h', '0px');
    document.querySelectorAll(".mx-modal-overlay.open").forEach((el) => el.classList.remove("open"));
    state.resumePolling?.();
    window._currentInput = null;
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
};