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
import "./scss/main.scss";

// 是否从自动补全框内部发起的触控滚动行为标记
let touchStartInSuggestions = false;

// Cached DOM references for frequently queried elements
const domCache = {
  sections: null as NodeListOf<HTMLElement> | null,
  navItems: null as NodeListOf<HTMLElement> | null,
  getSections(): NodeListOf<HTMLElement> {
    if (!this.sections) this.sections = document.querySelectorAll(".demo-section");
    return this.sections;
  },
  getNavItems(): NodeListOf<HTMLElement> {
    if (!this.navItems) this.navItems = document.querySelectorAll<HTMLElement>(".mx-nav-item, .mx-btm-item");
    return this.navItems;
  },
  invalidate(): void {
    this.sections = null;
    this.navItems = null;
  },
};

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
  // 核心防御点 ── 若本次屏幕触摸起源于补全框内部，则其滑动期间丢出的滚动，无条件免疫关闭！
  if (touchStartInSuggestions) return;

  const box = document.getElementById("suggestionBox");
  if (box && box.dataset.interacting === "true") return;
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

function lockInitialHeight(): void {
  const update = (): void => {
    const initialH = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;
    if (initialH > 100) {
      const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--initial-vh")) || 0;
      if (initialH > current) {
        document.documentElement.style.setProperty("--initial-vh", `${initialH}px`);
      }
    }
  };
  update();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", update);
  }
  window.addEventListener("orientationchange", () => setTimeout(update, 200));
}
lockInitialHeight();

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

let isPageVisible = true;

function handleVisibilityChange(): void {
  if (document.hidden) {
    isPageVisible = false;
    stopPolling();
    stopLogPolling();
  } else {
    isPageVisible = true;
    if (state.currentSection === "io" || state.currentSection === "log") {
      startLogPolling(state.currentSection);
    }
    startPolling();
  }
}

document.addEventListener("visibilitychange", handleVisibilityChange);

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

const SECTION_TITLES: Record<string, string> = {
  apps: "应用配置",
  global: "全局规则",
  io: "系统监控",
  log: "运行日志",
};

function switchSection(sectionId: string): void {
  if (state.currentSection === sectionId) return;
  state.currentSection = sectionId;
  domCache.getSections().forEach((el) => el.classList.remove("active"));
  document.getElementById(`sec-${sectionId}`)?.classList.add("active");
  const selector = ".mx-nav-item, .mx-btm-item";
  domCache.getNavItems().forEach((el) =>
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

let logPollTimer: ReturnType<typeof setInterval> | null = null;

function startLogPolling(section: string): void {
  stopLogPolling();
  logPollTimer = setInterval(() => {
    if (section === "io" && state.currentSection === "io") {
      if (state.ioState.offset > 0) {
        state.ioState.offset = 0;
        state.ioState.hasMore = true;
        fetchIoLogs();
      } else {
        fetchIoLogs();
      }
    } else if (section === "log" && state.currentSection === "log") {
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

document.addEventListener("DOMContentLoaded", async () => {
  try {
    enableEdgeToEdge(true);
  } catch {
    /* not supported */
  }
  initIcons();
  initRipple();
  initAllCustomSelects();

  window.addEventListener("popstate", () => {
    closeModalCleanup();
    startPolling();
  });

  const ro = new ResizeObserver(() => {
    if (window._currentInput && document.activeElement === window._currentInput) {
      scrollToInputIfKeyboardOpen(window._currentInput);
    }
  });
  document.querySelectorAll(".mx-subpage-body, .overflow-y-auto").forEach((el) => ro.observe(el));

  setupKeyboardHandling();

  // ── 重构全局多指/单指触碰源头追踪器 ──
  document.addEventListener("touchstart", (e: TouchEvent) => {
    state.isUserTouching = true;
    const target = e.target as HTMLElement;
    const box = document.getElementById("suggestionBox");
    // 溯源：记录并锁定当前触控周期是否在建议框内发起
    touchStartInSuggestions = !!(box && (target === box || box.contains(target)));
  }, { passive: true });

  document.addEventListener("touchend", () => {
    state.isUserTouching = false;
    touchStartInSuggestions = false;
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    state.isUserTouching = false;
    touchStartInSuggestions = false;
  }, { passive: true });

  window.addEventListener(
    "scroll",
    (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && (target.id === "suggestionBox" || document.getElementById("suggestionBox")?.contains(target))) {
        return;
      }
      closeSuggestionsOnScroll();
    },
    true,
  );

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

  state.currentSettings = await getSettings();
  (document.getElementById("autoThemeToggle") as HTMLInputElement).checked =
    state.currentSettings.autoTheme;
  (document.getElementById("pluginSyncToggle") as HTMLInputElement).checked =
    state.currentSettings.syncPlugin;

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

  document.getElementById("btnThemeToggleMobile")!.onclick = handleManualThemeToggle;
  document.getElementById("btnThemeToggleDesktop")!.onclick = handleManualThemeToggle;

  domCache.getNavItems().forEach((btn) => {
    if (btn.id !== "btnBackupDesktop") {
      btn.onclick = () => switchSection(btn.dataset.section ?? "");
    }
  });

  function positionPillSlider(): void {
    const group = document.getElementById("appFilterGroup");
    const slider = document.getElementById("pillSlider");
    const active = group?.querySelector("button.active") as HTMLElement | null;
    if (!group || !slider || !active) return;
    const groupRect = group.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    slider.style.left = `${btnRect.left - groupRect.left}px`;
    slider.style.width = `${btnRect.width}px`;
  }

  document.querySelectorAll("#appFilterGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#appFilterGroup button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentAppFilter = (btn as HTMLElement).dataset.filter ?? "filterUser";
      positionPillSlider();
      renderAppList();
    });
  });

  positionPillSlider();

  setupSearchBar();
  setupIoSection();
  setupLogSection();

  // Event delegation for app list clicks
  const appListEl = document.getElementById("appList");
  if (appListEl) {
    appListEl.addEventListener("click", (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".app-item");
      if (item?.dataset.pkg) {
        window.openAppConfig(item.dataset.pkg);
      }
    });
  }

  document.getElementById("btnToggleStatusMobile")!.onclick = toggleStatus;
  document.getElementById("btnToggleStatusDesktop")!.onclick = toggleStatus;

  const openSettings = async (): Promise<void> => {
    history.pushState({ modalOpen: true }, "");
    const isInstalled = await checkPluginInstalled();
    const lbl = document.getElementById("pluginStatusLabel");
    if (lbl) buildPluginStatusLabel(lbl, isInstalled);
    document.getElementById("settingsModal")?.classList.add("open");
  };
  document.getElementById("btnSettingsMobile")!.onclick = openSettings;
  document.getElementById("btnSettingsDesktop")!.onclick = openSettings;

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

  const btnBackupMobile = document.getElementById("btnBackupMobile");
  if (btnBackupMobile) btnBackupMobile.onclick = openBackupModal;
  const btnBackupDesktop = document.getElementById("btnBackupDesktop");
  if (btnBackupDesktop) btnBackupDesktop.onclick = openBackupModal;
  document.getElementById("btnMenuLogs")!.addEventListener("click", exportAllLogs);
  document.getElementById("btnMenuExport")!.addEventListener("click", () => showPicker("export"));
  document.getElementById("btnMenuImport")!.addEventListener("click", () => showPicker("import"));
  document.getElementById("btnBackupNewFolder")!.addEventListener("click", createNewFolder);

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

function setupKeyboardHandling(): void {
  document.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.classList.contains('mx-input'))) {
      window._currentInput = target;
      if (navigator.virtualKeyboard) {
        (navigator.virtualKeyboard as unknown as { show(): void }).show();
      }
    }
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.classList.contains('mx-input'));
      if (!isInput && navigator.virtualKeyboard) {
        (navigator.virtualKeyboard as unknown as { hide(): void }).hide();
      }
    }, 100);
  });

  if (navigator.virtualKeyboard) {
    navigator.virtualKeyboard.overlaysContent = true;
    navigator.virtualKeyboard.addEventListener("geometrychange", (e: Event) => {
      const { height } = (e.target as unknown as VirtualKeyboard).boundingRect;
      const isOpen = height > 0;
      requestAnimationFrame(() => {
        document.body.classList.toggle("keyboard-open", isOpen);
        document.documentElement.style.setProperty("--keyboard-h", `${height}px`);
        if (isOpen && window._currentInput) {
          scrollToInputIfKeyboardOpen(window._currentInput);
        }
      });
    });
    return;
  }

  // Fallback: no VirtualKeyboard API
  let initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    }, 300);
  });

  let isFrameBlocked = false;
  const updateViewportHeight = (): void => {
    if (isFrameBlocked) return;
    isFrameBlocked = true;
    window.requestAnimationFrame(() => {
      isFrameBlocked = false;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const keyboardHeight = initialHeight - vh;
      const isOpen = keyboardHeight > 80;
      document.body.classList.toggle("keyboard-open", isOpen);
      document.documentElement.style.setProperty(
        "--keyboard-h",
        isOpen ? `${keyboardHeight}px` : "0px",
      );
      if (isOpen && window._currentInput) {
        setTimeout(() => {
          scrollToInputIfKeyboardOpen(window._currentInput!);
        }, 80);
      }
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