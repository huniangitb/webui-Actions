import { state, CONST, closeModalCleanup } from "./state.js";
import { run, showToast, ICONS, initIcons, debounce } from "./utils.js";
import { applyTheme, systemThemeListener, handleManualThemeToggle, applyColorProfile } from "./theme.js";
import {
  setupModeToggle,
  addRuleRow,
  parseConfigTextToVisual,
  generateConfigTextFromVisual,
} from "./ui.js";
import {
  loadData,
  renderAppList,
  updateAppListStatus,
  flushInjectorConf,
  fetchInjectedApps,
  fetchActiveMounts,
  openAppConfig,
} from "./apps.js";
import { setupGlobalHandlers, renderGlobalRules } from "./global.js";
import {
  initIoLogs,
  initSysLogs,
  fetchIoLogs,
  fetchSysLogs,
  resetIoLogs,
  clearIoLogs,
  resetSysLogs,
  clearSysLogs,
} from "./logs.js";
import { getSettings, saveSettings, checkPluginInstalled, syncToPlugin } from "./plugin.js";
import { openBackupModal, showPicker, exportAllLogs, createNewFolder } from "./backup.js";
import { enableEdgeToEdge } from "kernelsu";
import { initRipple } from "./ripple.js";
import { initAllCustomSelects } from "./select.js";
import "../style.css";

// ── Helpers ──
function isVisualMode(toggleName: string): boolean {
  return !!document
    .querySelector(`button[name="${toggleName}"][data-mode="visual"]`)
    ?.classList.contains("active");
}

function getStatusSuffixes(): readonly string[] {
  return ["Mobile", "Desktop"];
}

function closeSuggestionsOnScroll(): void {
  if (!state.isUserTouching) return;
  const box = document.getElementById("suggestionBox");
  if (box && box.classList.contains("open")) {
    box.classList.remove("open");
    state.currentSuggestions = [];
  }
}

function scrollToInputIfKeyboardOpen(input: HTMLElement): void {
  if (document.body.classList.contains("keyboard-open")) {
    import("./ui.js").then(({ centerActiveInput }) => centerActiveInput(input));
  }
}

function buildPluginStatusLabel(container: HTMLElement, installed: boolean): void {
  if (installed) {
    container.textContent = "状态: 发现清理插件 (已就绪)";
    container.style.color = "var(--mx-green)";
    container.style.display = "";
    container.style.justifyContent = "";
    container.style.alignItems = "";
  } else {
    container.innerHTML = "";
    container.style.display = "flex";
    container.style.justifyContent = "space-between";
    container.style.alignItems = "center";
    container.style.color = "";
    const span = document.createElement("span");
    span.textContent = "状态: 未发现清理插件";
    span.style.color = "var(--mx-red)";
    const link = document.createElement("a");
    link.textContent = "去下载";
    link.style.cssText =
      "margin-left:auto;color:var(--mx-primary);text-decoration:none;font-size:11px;cursor:pointer;";
    link.onclick = () => {
      run('am start -a android.intent.action.VIEW -d "https://wwbti.lanzoue.com/i3K1v3ofox5a"');
    };
    container.appendChild(span);
    container.appendChild(link);
  }
}

// ── Height lock for WebView keyboard handling ──
function lockInitialHeight(): void {
  const update = (): void => {
    const initialH = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;
    if (initialH > 100) {
      document.documentElement.style.setProperty("--initial-vh", `${initialH}px`);
    }
  };
  const delayedUpdate = () => setTimeout(update, 200);
  update();
  window.addEventListener("load", update);
  window.addEventListener("orientationchange", delayedUpdate);
  setTimeout(update, 100);
  setTimeout(update, 300);
  setTimeout(update, 600);
}
lockInitialHeight();

// ── Polling ──
let statusPolling: ReturnType<typeof setInterval> | null = null;
let appStatusPolling: ReturnType<typeof setInterval> | null = null;

function updateStatusBadge(suffix: string): void {
  const badge = document.getElementById("statusBadge" + suffix);
  const btn = document.getElementById("btnToggleStatus" + suffix);
  if (!badge || !btn) return;
  if (state.currentPid) {
    badge.className = "mx-badge mx-badge-success";
    badge.textContent = "RUNNING";
    btn.innerHTML = ICONS.STOP;
  } else {
    badge.className = "mx-badge mx-badge-gray";
    badge.textContent = "STOPPED";
    btn.innerHTML = ICONS.PLAY;
  }
}

async function checkStatus(): Promise<void> {
  if (document.querySelector(".mx-app")?.classList.contains("frozen")) return;
  try {
    const pid = (await run("pidof injector")) || (await run("pgrep -x injector"));
    state.currentPid = pid ? pid.split(" ")[0] : null;
    getStatusSuffixes().forEach(updateStatusBadge);
    const info = document.getElementById("statusInfo");
    if (info) {
      info.textContent = state.currentPid ? `PID ${state.currentPid}` : "OFFLINE";
    }
  } catch {
    /* ignore */
  }
}

export function startPolling(): void {
  if (!statusPolling) {
    checkStatus();
    statusPolling = setInterval(checkStatus, 1500);
  }
  if (!appStatusPolling) {
    refreshAppStatus();
    appStatusPolling = setInterval(refreshAppStatus, 2000);
  }
}
state.resumePolling = startPolling;

export function stopPolling(): void {
  if (statusPolling) {
    clearInterval(statusPolling);
    statusPolling = null;
  }
  if (appStatusPolling) {
    clearInterval(appStatusPolling);
    appStatusPolling = null;
  }
}
state.suspendPolling = stopPolling;

async function toggleStatus(): Promise<void> {
  if (state.currentPid) {
    await run(`kill -15 ${state.currentPid}`);
    showToast.info("发送停止信号...");
  } else {
    await run(`sh ${CONST.SERVICE_SH}`);
    showToast.info("启动服务...");
    setTimeout(loadData, 1000);
  }
  setTimeout(checkStatus, 500);
}

async function refreshAppStatus(): Promise<void> {
  if (document.querySelector(".mx-app")?.classList.contains("frozen")) return;
  try {
    const [mounts] = await Promise.all([fetchActiveMounts(), fetchInjectedApps()]);
    state.activeMounts = mounts;
    if (document.getElementById("sec-apps")?.classList.contains("active")) {
      updateAppListStatus();
    }
  } catch {
    /* ignore */
  }
}

// ── Monitor ignore helpers ──
function parseIgnoreToVisual(t: string): void {
  const c = document.getElementById("ignoreBuilderContainer");
  if (!c) return;
  c.innerHTML = "";
  if (t) {
    t.split("\n").forEach((l) => {
      const v = l.trim();
      if (v && !v.startsWith("#")) addIgnoreRow(v);
    });
  }
  if (c.children.length === 0) addIgnoreRow("");
}

function generateIgnoreFromVisual(): string {
  let r = "";
  document.querySelectorAll<HTMLInputElement>("#ignoreBuilderContainer input").forEach((i) => {
    const v = i.value.trim();
    if (v) r += `${v}\n`;
  });
  return r.trim();
}

function addIgnoreRow(p: string): void {
  const div = document.createElement("div");
  div.className = "rule-row flex-shrink-0";
  div.innerHTML = `<div class="mx-input-wrapper" style="position: relative; width: 100%;">
    <input type="text" class="mx-input" style="background:var(--mx-s1); border-radius:6px; font-size:12px; padding:6px;" placeholder="要忽略的路径前缀" value="${p.replace(/"/g, "&quot;")}">
  </div>
  <button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
  div.querySelector(".btn-del")!.addEventListener("click", () => div.remove());
  document.getElementById("ignoreBuilderContainer")?.appendChild(div);
}

// ── Section switching ──
const SECTION_TITLES: Record<string, string> = {
  apps: "应用配置",
  global: "全局规则",
  io: "系统监控",
  log: "运行日志",
};

function switchSection(sectionId: string): void {
  /* Don't re-fetch logs if already on this section — prevents list flicker */
  if (state.currentSection === sectionId) return;
  state.currentSection = sectionId;
  document.querySelectorAll(".demo-section").forEach((el) => el.classList.remove("active"));
  document.getElementById(`sec-${sectionId}`)?.classList.add("active");
  const selector = ".mx-nav-item, .mx-btm-item";
  document.querySelectorAll<HTMLElement>(selector).forEach((el) =>
    el.classList.toggle("active", el.dataset.section === sectionId),
  );
  const breadcrumb = document.getElementById("breadcrumbTitle");
  if (breadcrumb) breadcrumb.textContent = SECTION_TITLES[sectionId] ?? sectionId;
  if (sectionId === "io") {
    resetIoLogs();
    fetchIoLogs();
    startLogPolling("io");
    return;
  }
  if (sectionId === "log") {
    const source = (document.getElementById("logSourceSelect") as HTMLSelectElement)?.value;
    if (source === "internal") {
      state.sysState.offset = 0;
      state.sysState.hasMore = true;
      fetchSysLogs();
    }
    startLogPolling("log");
    return;
  }
  stopLogPolling();
}

/* ── Log live polling (1s interval) ── */
let logPollTimer: ReturnType<typeof setInterval> | null = null;
function startLogPolling(section: string): void {
  stopLogPolling();
  logPollTimer = setInterval(() => {
    if (section === "io" && state.currentSection === "io") {
      if (state.ioState.offset > 0) {
        /* Only refresh from start if less than 200 items shown to avoid perf spikes */
        state.ioState.offset = 0;
        state.ioState.hasMore = true;
        fetchIoLogs();
      } else {
        fetchIoLogs();
      }
    } else if (section === "log" && state.currentSection === "log") {
      state.sysState.offset = 0;
      state.sysState.hasMore = true;
      fetchSysLogs();
    }
  }, 1000);
}

function stopLogPolling(): void {
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
}

// ── DOMContentLoaded ──
document.addEventListener("DOMContentLoaded", async () => {
  try {
    enableEdgeToEdge(true);
  } catch {
    /* not supported */
  }
  initIcons();
  initRipple();
  initAllCustomSelects();

  // Handle browser back for modals
  window.addEventListener("popstate", () => {
    const appConfig = document.getElementById("appConfigSubpage");
    if (appConfig && appConfig.classList.contains("open")) {
      appConfig.classList.remove("open");
      appConfig.classList.add("closing");
      setTimeout(() => appConfig.classList.remove("closing"), 300);
    }
    document.querySelector(".mx-app")!.classList.remove("frozen");
    document.body.classList.remove("modal-open", "keyboard-open");
    document.documentElement.style.setProperty("--keyboard-h", "0px");
    document.querySelectorAll(".mx-modal-overlay.open").forEach((el) => el.classList.remove("open"));
    startPolling();
    window._currentInput = null;
  });

  // ResizeObserver for re-centering input in open keyboard
  const ro = new ResizeObserver(() => {
    if (window._currentInput && document.activeElement === window._currentInput) {
      scrollToInputIfKeyboardOpen(window._currentInput);
    }
  });
  document.querySelectorAll(".mx-subpage-body, .overflow-y-auto").forEach((el) => ro.observe(el));

  // Keyboard handling
  setupKeyboardHandling();

  // Touch tracking
  document.addEventListener("touchstart", () => { state.isUserTouching = true; }, { passive: true });
  document.addEventListener("touchend", () => { state.isUserTouching = false; }, { passive: true });
  document.addEventListener("touchcancel", () => { state.isUserTouching = false; }, { passive: true });

  // Scroll handling
  window.addEventListener(
    "scroll",
    () => {
      closeSuggestionsOnScroll();
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    },
    true,
  );

  // Click outside suggestions
  document.addEventListener("click", (e: MouseEvent) => {
    const box = document.getElementById("suggestionBox");
    if (box && box.classList.contains("open")) {
      const target = e.target as HTMLElement;
      const isInput =
        target.classList.contains("rule-target") || target.classList.contains("rule-source");
      if (!isInput && !box.contains(target)) {
        box.classList.remove("open");
        state.currentSuggestions = [];
      }
    }
    setTimeout(() => {
      if (!document.activeElement || !document.activeElement.classList.contains("mx-input")) {
        const subpage = document.getElementById("appConfigSubpage");
        if (subpage && !subpage.classList.contains("open")) {
          subpage.style.transform = "translate3d(0, 0, 0)";
        }
        document.body.classList.remove("keyboard-open");
      }
    }, 150);
  });

  // Load settings
  state.currentSettings = await getSettings();
  (document.getElementById("autoThemeToggle") as HTMLInputElement).checked =
    state.currentSettings.autoTheme;
  (document.getElementById("pluginSyncToggle") as HTMLInputElement).checked =
    state.currentSettings.syncPlugin;

  // Initialize color profile
  const colorProfileSelect = document.getElementById("colorProfileSelect") as HTMLSelectElement | null;
  if (colorProfileSelect) {
    colorProfileSelect.value = state.currentSettings.colorProfile || "teal";
    colorProfileSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (state.currentSettings.colorProfile) {
    document.documentElement.setAttribute("data-color-profile", state.currentSettings.colorProfile);
  }
  if (state.currentSettings.autoTheme) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mediaQuery.matches);
    mediaQuery.addEventListener("change", systemThemeListener);
  } else {
    applyTheme(state.isDarkMode);
  }

  // Theme toggles
  document.getElementById("btnThemeToggleMobile")!.onclick = handleManualThemeToggle;
  document.getElementById("btnThemeToggleDesktop")!.onclick = handleManualThemeToggle;

  // Navigation
  document.querySelectorAll<HTMLElement>(".mx-nav-item, .mx-btm-item").forEach((btn) => {
    if (btn.id !== "btnBackupDesktop") {
      btn.onclick = () => switchSection(btn.dataset.section ?? "");
    }
  });

  // App filter
  document.querySelectorAll("#appFilterGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#appFilterGroup button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentAppFilter = (btn as HTMLElement).dataset.filter ?? "filterUser";
      renderAppList();
    });
  });

  // Search bar
  setupSearchBar();

  // IO search
  setupIoSection();

  // Logs
  setupLogSection();

  // Status toggle
  document.getElementById("btnToggleStatusMobile")!.onclick = toggleStatus;
  document.getElementById("btnToggleStatusDesktop")!.onclick = toggleStatus;

  // Settings modal
  const openSettings = async (): Promise<void> => {
    history.pushState({ modalOpen: true }, "");
    const isInstalled = await checkPluginInstalled();
    const lbl = document.getElementById("pluginStatusLabel");
    if (lbl) buildPluginStatusLabel(lbl, isInstalled);
    document.getElementById("settingsModal")?.classList.add("open");
  };
  document.getElementById("btnSettingsMobile")!.onclick = openSettings;
  document.getElementById("btnSettingsDesktop")!.onclick = openSettings;

  // About modal
  const openAboutModal = (): void => {
    history.pushState({ modalOpen: true }, "");
    document.getElementById("aboutModal")?.classList.add("open");
  };
  document.getElementById("logoIconMobile")?.addEventListener("click", openAboutModal);
  document.getElementById("logoIconDesktop")?.addEventListener("click", openAboutModal);
  document.getElementById("btnJoinQQGroup")?.addEventListener("click", async () => {
    await run(
      'am start -a android.intent.action.VIEW -d "mqqapi://card/show_pslcard?src_type=internal&version=1&card_type=group&uin=1093864387"',
    );
  });

  // Backup
  const btnBackupMobile = document.getElementById("btnBackupMobile");
  if (btnBackupMobile) btnBackupMobile.onclick = openBackupModal;
  const btnBackupDesktop = document.getElementById("btnBackupDesktop");
  if (btnBackupDesktop) btnBackupDesktop.onclick = openBackupModal;
  document.getElementById("btnMenuLogs")!.addEventListener("click", exportAllLogs);
  document.getElementById("btnMenuExport")!.addEventListener("click", () => showPicker("export"));
  document.getElementById("btnMenuImport")!.addEventListener("click", () => showPicker("import"));
  document.getElementById("btnBackupNewFolder")!.addEventListener("click", createNewFolder);

  // Save settings
  document.getElementById("btnSaveSettings")!.onclick = async () => {
    state.currentSettings.autoTheme = (document.getElementById("autoThemeToggle") as HTMLInputElement).checked;
    state.currentSettings.syncPlugin = (document.getElementById("pluginSyncToggle") as HTMLInputElement).checked;
    const profileSelect = document.getElementById("colorProfileSelect") as HTMLSelectElement | null;
    if (profileSelect) {
      state.currentSettings.colorProfile = profileSelect.value;
    }
    await saveSettings(state.currentSettings);
    applyColorProfile(state.currentSettings.colorProfile);
    if (state.currentSettings.autoTheme) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);
    }
    showToast.success("设置已保存");
    closeModalCleanup();
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
  };

  // Monitor ignore
  document.getElementById("btnMonitorIgnore")!.onclick = async () => {
    const content = await run(`cat ${CONST.MONITOR_IGNORE_CONF} 2>/dev/null`);
    (document.getElementById("monitorIgnoreContent") as HTMLTextAreaElement).value = content;
    parseIgnoreToVisual(content);
    history.pushState({ modalOpen: true }, "");
    document.getElementById("monitorIgnoreModal")?.classList.add("open");
  };
  document.getElementById("btnAddIgnoreRow")!.onclick = () => addIgnoreRow("");
  document.getElementById("btnSaveIgnore")!.onclick = async () => {
    try {
      const isVisual = isVisualMode("ignoreModeToggle");
      const content = isVisual
        ? generateIgnoreFromVisual()
        : (document.getElementById("monitorIgnoreContent") as HTMLTextAreaElement).value;
      await run(`echo '${content.trim()}' > ${CONST.MONITOR_IGNORE_CONF}`);
      showToast.success("过滤配置已保存");
      closeModalCleanup();
    } catch {
      showToast.error("保存失败");
    }
  };

  // Mode toggles
  setupModeToggle(
    "globalModeToggle",
    "globalVisual",
    "globalRaw",
    "globalRuleContent",
    (val: string) =>
      parseConfigTextToVisual(val, "globalRuleBuilderContainer", "globalMonitorSelect", "globalSandboxSelect", "globalInjectSelect"),
    () =>
      generateConfigTextFromVisual("globalRuleBuilderContainer", "globalMonitorSelect", "globalSandboxSelect", "globalInjectSelect"),
  );
  setupModeToggle(
    "appModeToggle",
    "appVisual",
    "appRaw",
    "appRuleContent",
    (val: string) =>
      parseConfigTextToVisual(val, "appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null),
    () => generateConfigTextFromVisual("appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null),
  );
  setupModeToggle("ignoreModeToggle", "ignoreVisual", "ignoreRaw", "monitorIgnoreContent", parseIgnoreToVisual, generateIgnoreFromVisual);

  setupGlobalHandlers();
  document.getElementById("btnAppAddRule")!.onclick = () =>
    addRuleRow("REDIRECT", "", "", "appRuleBuilderContainer");
  document.getElementById("btnCloseAppModal")!.onclick = closeModalCleanup;
  document.querySelectorAll(".mx-btn-close").forEach((btn) => {
    btn.addEventListener("click", closeModalCleanup);
  });

  // Save app config
  document.getElementById("btnSaveAppConfig")!.onclick = async () => {
    try {
      const isVisual = isVisualMode("appModeToggle");
      const text = isVisual
        ? generateConfigTextFromVisual("appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null)
        : (document.getElementById("appRuleContent") as HTMLTextAreaElement).value;
      const isEnabled = (document.getElementById("appEnableToggle") as HTMLInputElement).checked;
      const exactKey = `${state.currentBindingPkg}:${state.currentBindingUser}`;
      if (!isEnabled) state.injectorStates.set(exactKey, "OFF");
      else state.injectorStates.set(exactKey, "ON");
      const dir =
        state.currentBindingUser === 0
          ? `${CONST.BASE_DIR}/App-rules`
          : `${CONST.BASE_DIR}/App-rules-${state.currentBindingUser}`;
      await run(`mkdir -p ${dir}`);
      const escaped = text.trim().replace(/'/g, "'\\''");
      if (isEnabled) {
        await run(`echo '${escaped}' > ${dir}/${state.currentBindingPkg}.conf`);
        await run(`rm -f ${dir}/${state.currentBindingPkg}.conf.disabled`);
      } else {
        await run(`echo '${escaped}' > ${dir}/${state.currentBindingPkg}.conf.disabled`);
        await run(`rm -f ${dir}/${state.currentBindingPkg}.conf`);
      }
      await flushInjectorConf();
      showToast.success("配置已保存");
      closeModalCleanup();
      await loadData();
      await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    } catch {
      showToast.error("保存失败");
    }
  };

  // Delete app config
  document.getElementById("btnDeleteAppConfig")!.onclick = async () => {
    if (!confirm("确定清除配置吗?")) return;
    const dir =
      state.currentBindingUser === 0
        ? `${CONST.BASE_DIR}/App-rules`
        : `${CONST.BASE_DIR}/App-rules-${state.currentBindingUser}`;
    await run(
      `rm -f ${dir}/${state.currentBindingPkg}.conf ${dir}/${state.currentBindingPkg}.conf.disabled`,
    );
    state.injectorStates.delete(`${state.currentBindingPkg}:${state.currentBindingUser}`);
    await flushInjectorConf();
    closeModalCleanup();
    await loadData();
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    showToast.success("配置已清除");
  };

  // Wrap openAppConfig to stop polling
  const originalOpenAppConfig = window.openAppConfig;
  window.openAppConfig = (pkg: string) => {
    stopPolling();
    history.pushState({ modalOpen: true }, "");
    document.querySelector(".mx-app")!.classList.add("frozen");
    document.body.classList.add("modal-open");
    document.getElementById("appConfigSubpage")?.classList.add("open");
    originalOpenAppConfig(pkg);
  };

  initIoLogs();
  initSysLogs();
  loadData();
  startPolling();
  requestAnimationFrame(() => document.body.classList.add("loaded"));
});

// ── Setup sub-functions (extracted from DOMContentLoaded to reduce nesting) ──
function setupKeyboardHandling(): void {
  if (navigator.virtualKeyboard) {
    navigator.virtualKeyboard.overlaysContent = true;
    navigator.virtualKeyboard.addEventListener("geometrychange", (e: Event) => {
      const { height } = (e.target as unknown as VirtualKeyboard).boundingRect;
      const isOpen = height > 0;
      document.body.classList.toggle("keyboard-open", isOpen);
      document.documentElement.style.setProperty("--keyboard-h", `${height}px`);
      if (isOpen && window._currentInput) scrollToInputIfKeyboardOpen(window._currentInput);
    });
    return;
  }
  // Fallback: use visualViewport + resize to detect keyboard
  let isFrameBlocked = false;
  const updateViewportHeight = (): void => {
    if (isFrameBlocked) return;
    isFrameBlocked = true;
    window.requestAnimationFrame(() => {
      isFrameBlocked = false;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const keyboardHeight = window.innerHeight - vh;
      const isOpen = keyboardHeight > 80;
      document.body.classList.toggle("keyboard-open", isOpen);
      document.documentElement.style.setProperty(
        "--keyboard-h",
        isOpen ? `${keyboardHeight}px` : "0px",
      );
      if (isOpen && window._currentInput) scrollToInputIfKeyboardOpen(window._currentInput);
    });
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeight);
    window.visualViewport.addEventListener("scroll", updateViewportHeight);
  }
  window.addEventListener("resize", updateViewportHeight);
  updateViewportHeight();
}

function setupSearchBar(): void {
  const searchBarWrap = document.getElementById("searchBarWrap");
  const appSearch = document.getElementById("appSearch") as HTMLInputElement | null;
  const appFilterWrapper = document.getElementById("appFilterWrapper");
  if (!searchBarWrap || !appSearch || !appFilterWrapper) return;
  searchBarWrap.addEventListener("click", () => {
    if (!searchBarWrap.classList.contains("expanded")) {
      searchBarWrap.classList.add("expanded");
      appFilterWrapper.classList.add("collapsed");
      appSearch.focus();
    }
  });
  appSearch.addEventListener("blur", () => {
    searchBarWrap.classList.remove("expanded");
    appFilterWrapper.classList.remove("collapsed");
    searchBarWrap.classList.toggle("has-text", !!appSearch.value.trim());
  });
  appSearch.addEventListener("input", debounce(() => renderAppList(), 250));
  const appListContainer = document.getElementById("appListContainer");
  if (appListContainer) {
    appListContainer.addEventListener(
      "scroll",
      () => {
        if (searchBarWrap.classList.contains("expanded")) {
          searchBarWrap.classList.remove("expanded");
          appFilterWrapper.classList.remove("collapsed");
          searchBarWrap.classList.toggle("has-text", !!appSearch.value.trim());
          appSearch.blur();
        }
      },
      { passive: true },
    );
  }
}

function setupIoSection(): void {
  const ioSearch = document.getElementById("ioSearch") as HTMLInputElement | null;
  if (ioSearch) {
    ioSearch.addEventListener(
      "input",
      debounce(() => {
        state.ioState.term = ioSearch.value.trim();
        resetIoLogs();
        fetchIoLogs();
      }, 500),
    );
  }
  const ioContainer = document.getElementById("ioLogContainer");
  if (ioContainer) {
    ioContainer.addEventListener("scroll", () => {
      if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) {
        fetchIoLogs();
      }
    });
  }
  document.getElementById("btnClearIo")!.onclick = clearIoLogs;
}

function setupLogSection(): void {
  const logSelect = document.getElementById("logSourceSelect") as HTMLSelectElement | null;
  const logLevelSelect = document.getElementById("logLevelSelect") as HTMLSelectElement | null;
  const logViewer = document.getElementById("logViewer");
  const savedLogLevel = localStorage.getItem("sysLogLevel");
  if (savedLogLevel) {
    state.sysState.level = parseInt(savedLogLevel);
    if (logLevelSelect) {
      logLevelSelect.value = savedLogLevel;
      logLevelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  if (logSelect) {
    logSelect.addEventListener("change", () => {
      if (logSelect.value === "internal") resetSysLogs();
      fetchSysLogs();
    });
  }
  if (logLevelSelect) {
    logLevelSelect.addEventListener("change", () => {
      state.sysState.level = parseInt(logLevelSelect.value);
      localStorage.setItem("sysLogLevel", logLevelSelect.value);
      resetSysLogs();
      fetchSysLogs();
    });
  }
  if (logViewer) {
    logViewer.addEventListener("scroll", () => {
      if (
        logSelect?.value === "internal" &&
        logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50
      ) {
        fetchSysLogs();
      }
    });
  }
  document.getElementById("btnClearLog")!.onclick = clearSysLogs;
}