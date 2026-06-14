import { state, CONST } from "./state.js";
import { run, showToast, ICONS, initIcons, debounce } from "./utils.js";
import { applyTheme, systemThemeListener, handleManualThemeToggle } from "./theme.js";
import { setupModeToggle, addRuleRow, parseConfigTextToVisual, generateConfigTextFromVisual } from "./ui.js";
import { loadData, renderAppList, updateAppListStatus, flushInjectorConf, fetchInjectedApps, fetchActiveMounts } from "./apps.js";
import { setupGlobalHandlers } from "./global.js";
import { initIoLogs, initSysLogs, fetchIoLogs, fetchSysLogs, resetIoLogs, clearIoLogs, resetSysLogs, clearSysLogs } from "./logs.js";
import { getSettings, saveSettings, checkPluginInstalled, syncToPlugin } from "./plugin.js";
import { enableEdgeToEdge } from "kernelsu";
import "../style.css";

const lockInitialHeight = () => {
  const initialH = window.innerHeight;
  document.documentElement.style.setProperty('--initial-vh', `${initialH}px`);
};
lockInitialHeight();
window.addEventListener("orientationchange", () => setTimeout(lockInitialHeight, 200));

let statusPolling = null;
let appStatusPolling = null;

export const startPolling = () => {
  if (!statusPolling) {
    checkStatus();
    statusPolling = setInterval(checkStatus, 1500);
  }
  if (!appStatusPolling) {
    refreshAppStatus();
    appStatusPolling = setInterval(refreshAppStatus, 2000);
  }
};

export const stopPolling = () => {
  if (statusPolling) {
    clearInterval(statusPolling);
    statusPolling = null;
  }
  if (appStatusPolling) {
    clearInterval(appStatusPolling);
    appStatusPolling = null;
  }
};

const checkStatus = async () => {
  if (document.querySelector(".mx-app")?.classList.contains("frozen")) return;
  try {
    let pid = (await run("pidof injector")) || (await run("pgrep -x injector"));
    state.currentPid = pid ? pid.split(" ")[0] : null;
    ["Mobile", "Desktop"].forEach((s) => {
      const b = document.getElementById("statusBadge" + s);
      const btn = document.getElementById("btnToggleStatus" + s);
      if (b && btn) {
        if (state.currentPid) {
          b.className = "mx-badge mx-badge-success";
          b.textContent = "RUNNING";
          btn.innerHTML = ICONS.STOP;
        } else {
          b.className = "mx-badge mx-badge-gray";
          b.textContent = "STOPPED";
          btn.innerHTML = ICONS.PLAY;
        }
      }
    });
    const info = document.getElementById("statusInfo");
    if (info) info.textContent = state.currentPid ? `PID ${state.currentPid}` : "OFFLINE";
  } catch {}
};

const toggleStatus = async () => {
  if (state.currentPid) {
    await run(`kill -15 ${state.currentPid}`);
    showToast("发送停止信号...");
  } else {
    await run(`sh ${CONST.SERVICE_SH}`);
    showToast("启动服务...");
    setTimeout(loadData, 1000);
  }
  setTimeout(checkStatus, 500);
};

const refreshAppStatus = async () => {
  if (document.querySelector(".mx-app")?.classList.contains("frozen")) return;
  try {
    const [mounts] = await Promise.all([fetchActiveMounts(), fetchInjectedApps()]);
    state.activeMounts = mounts;
    if (document.getElementById("sec-apps")?.classList.contains("active")) {
      updateAppListStatus();
    }
  } catch {}
};

const parseIgnoreToVisual = (t) => {
  const c = document.getElementById("ignoreBuilderContainer");
  if (!c) return;
  c.innerHTML = "";
  if (t)
    t.split("\n").forEach((l) => {
      const v = l.trim();
      if (v && !v.startsWith("#")) addIgnoreRow(v);
    });
  if (c.children.length === 0) addIgnoreRow("");
};

const generateIgnoreFromVisual = () => {
  let r = "";
  document.querySelectorAll("#ignoreBuilderContainer input").forEach((i) => {
    const v = i.value.trim();
    if (v) r += `${v}\n`;
  });
  return r.trim();
};

const addIgnoreRow = (p) => {
  const div = document.createElement("div");
  div.className = "rule-row flex-shrink-0";
  div.innerHTML = `<div class="mx-input-wrapper" style="position: relative; width: 100%;">
    <input type="text" class="mx-input" style="background:var(--mx-s1); border-radius:6px; font-size:12px; padding:6px;" placeholder="要忽略的路径前缀" value="${p}">
  </div>
  <button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
  div.querySelector(".btn-del").onclick = () => div.remove();
  document.getElementById("ignoreBuilderContainer")?.appendChild(div);
};

const switchSection = (sectionId) => {
  document.querySelectorAll(".demo-section").forEach((el) => el.classList.remove("active"));
  document.getElementById(`sec-${sectionId}`)?.classList.add("active");
  document.querySelectorAll(".mx-nav-item").forEach((el) => el.classList.toggle("active", el.dataset.section === sectionId));
  document.querySelectorAll(".mx-btm-item").forEach((el) => el.classList.toggle("active", el.dataset.section === sectionId));
  const titles = { apps: "应用配置", global: "全局规则", io: "系统监控", log: "运行日志" };
  const breadcrumb = document.getElementById("breadcrumbTitle");
  if (breadcrumb) breadcrumb.textContent = titles[sectionId];
  if (sectionId === "io") {
    resetIoLogs();
    fetchIoLogs();
  }
  if (sectionId === "log") {
    if (document.getElementById("logSourceSelect")?.value === "internal") {
      resetSysLogs();
    }
    fetchSysLogs();
  }
};

const closeModalCleanup = () => {
  if (history.state && history.state.modalOpen) {
    history.back(); // 优先驱动 popstate，实现物理返回键与虚拟返回键动效一致
  } else {
    // 兜底同步动画逻辑
    const appConfig = document.getElementById("appConfigSubpage");
    if (appConfig && appConfig.classList.contains("open")) {
      appConfig.classList.remove("open");
      appConfig.classList.add("closing");
      setTimeout(() => {
        appConfig.classList.remove("closing");
      }, 220);
    }
    document.querySelector(".mx-app").classList.remove("frozen");
    document.body.classList.remove("modal-open");
    document.body.classList.remove("keyboard-open");
    document.documentElement.style.setProperty('--keyboard-h', '0px');
    startPolling();
    window._currentInput = null;
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    enableEdgeToEdge(true);
  } catch (err) {
    console.warn("enableEdgeToEdge not available:", err);
  }
  initIcons();

  window.addEventListener("popstate", () => {
    // 关闭应用配置时的平滑推出动画生命周期
    const appConfig = document.getElementById("appConfigSubpage");
    if (appConfig && appConfig.classList.contains("open")) {
      appConfig.classList.remove("open");
      appConfig.classList.add("closing");
      setTimeout(() => {
        appConfig.classList.remove("closing");
      }, 220); // 动效周期完成后清理类名

      document.querySelector(".mx-app").classList.remove("frozen");
      document.body.classList.remove("modal-open", "keyboard-open");
      document.documentElement.style.setProperty('--keyboard-h', '0px');
      startPolling();
      window._currentInput = null; // 确保清空当前引用
    }
    document.querySelectorAll(".mx-modal-overlay.open").forEach((el) => {
      el.classList.remove("open");
    });
  });

  const ro = new ResizeObserver(() => {
    if (document.body.classList.contains("keyboard-open") && window._currentInput && document.activeElement === window._currentInput) {
       import("./ui.js").then(({ centerActiveInput }) => {
          centerActiveInput(window._currentInput);
       });
    }
  });
  document.querySelectorAll('.mx-subpage-body, .overflow-y-auto').forEach(el => ro.observe(el));

  if (navigator.virtualKeyboard) {
    navigator.virtualKeyboard.overlaysContent = true;
    navigator.virtualKeyboard.addEventListener("geometrychange", (e) => {
      const { height } = e.target.boundingRect;
      const isKeyboardOpen = height > 0;
      document.body.classList.toggle("keyboard-open", isKeyboardOpen);
      document.documentElement.style.setProperty('--keyboard-h', `${height}px`);
      if (isKeyboardOpen && window._currentInput) {
         import("./ui.js").then(({ centerActiveInput }) => {
            centerActiveInput(window._currentInput);
         });
      }
    });
  } else {
    let isFrameBlocked = false;
    const updateViewportHeight = () => {
      if (isFrameBlocked) return;
      isFrameBlocked = true;
      window.requestAnimationFrame(() => {
        isFrameBlocked = false;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const totalH = window.innerHeight;
        const keyboardHeight = totalH - vh;
        const isKeyboardOpen = keyboardHeight > 80;
        document.body.classList.toggle("keyboard-open", isKeyboardOpen);
        document.documentElement.style.setProperty('--keyboard-h', `${isKeyboardOpen ? keyboardHeight : 0}px`);
        if (isKeyboardOpen && window._currentInput) {
           import("./ui.js").then(({ centerActiveInput }) => {
              centerActiveInput(window._currentInput);
           });
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

  document.addEventListener("touchstart", () => {
    state.isUserTouching = true;
  }, { passive: true });
  document.addEventListener("touchend", () => {
    state.isUserTouching = false;
  }, { passive: true });
  document.addEventListener("touchcancel", () => {
    state.isUserTouching = false;
  }, { passive: true });

  window.addEventListener("scroll", (e) => {
    if (state.isUserTouching) {
      const box = document.getElementById("suggestionBox");
      if (box && box.classList.contains("open")) {
        box.classList.remove("open");
        state.currentSuggestions = [];
      }
    }
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }, true);

  document.addEventListener("click", (e) => {
    const box = document.getElementById("suggestionBox");
    if (box && box.classList.contains("open")) {
      const isInput = e.target.classList.contains("rule-target") || e.target.classList.contains("rule-source");
      const isInsideBox = box.contains(e.target);
      if (!isInput && !isInsideBox) {
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
  document.getElementById("autoThemeToggle").checked = state.currentSettings.autoTheme;
  document.getElementById("pluginSyncToggle").checked = state.currentSettings.syncPlugin;
  if (state.currentSettings.autoTheme) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mediaQuery.matches);
    mediaQuery.addEventListener("change", systemThemeListener);
  } else {
    applyTheme(state.isDarkMode);
  }

  document.getElementById("btnThemeToggleMobile").onclick = handleManualThemeToggle;
  document.getElementById("btnThemeToggleDesktop").onclick = handleManualThemeToggle;

  document.querySelectorAll(".mx-nav-item, .mx-btm-item").forEach((btn) => {
    btn.onclick = () => switchSection(btn.dataset.section);
  });

  document.querySelectorAll("#appFilterGroup button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#appFilterGroup button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentAppFilter = btn.dataset.filter;
      renderAppList();
    };
  });

  document.getElementById("appSearch")?.addEventListener("input", debounce(renderAppList, 250));

  const ioContainer = document.getElementById("ioLogContainer");
  const ioSearch = document.getElementById("ioSearch");
  if (ioSearch) {
    ioSearch.addEventListener(
      "input",
      debounce(() => {
        state.ioState.term = ioSearch.value.trim();
        resetIoLogs();
        fetchIoLogs();
      }, 500)
    );
  }
  if (ioContainer) {
    ioContainer.addEventListener("scroll", () => {
      if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50)
        fetchIoLogs();
    });
  }
  document.getElementById("btnClearIo").onclick = clearIoLogs;

  const logSelect = document.getElementById("logSourceSelect");
  const logLevelSelect = document.getElementById("logLevelSelect");
  const logViewer = document.getElementById("logViewer");
  
  const savedLogLevel = localStorage.getItem("sysLogLevel");
  if (savedLogLevel) {
    state.sysState.level = parseInt(savedLogLevel);
    if (logLevelSelect) logLevelSelect.value = savedLogLevel;
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
      )
        fetchSysLogs();
    });
  }
  document.getElementById("btnClearLog").onclick = clearSysLogs;
  document.getElementById("btnToggleStatusMobile").onclick = toggleStatus;
  document.getElementById("btnToggleStatusDesktop").onclick = toggleStatus;

  const openSettings = async () => {
    history.pushState({ modalOpen: true }, "");
    const isInstalled = await checkPluginInstalled();
    const lbl = document.getElementById("pluginStatusLabel");
    if (lbl) {
      lbl.textContent = isInstalled ? "状态: 发现清理插件 (已就绪)" : "状态: 未发现清理插件";
      lbl.style.color = isInstalled ? "var(--mx-green)" : "var(--mx-red)";
    }
    document.getElementById("settingsModal")?.classList.add("open");
  };
  document.getElementById("btnSettingsMobile").onclick = openSettings;
  document.getElementById("btnSettingsDesktop").onclick = openSettings;

  document.getElementById("btnSaveSettings").onclick = async () => {
    state.currentSettings.autoTheme = document.getElementById("autoThemeToggle").checked;
    state.currentSettings.syncPlugin = document.getElementById("pluginSyncToggle").checked;
    await saveSettings(state.currentSettings);
    if (state.currentSettings.autoTheme) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);
    }
    showToast("设置已保存");
    closeModalCleanup();
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
  };

  document.getElementById("btnMonitorIgnore").onclick = async () => {
    const content = await run(`cat ${CONST.MONITOR_IGNORE_CONF} 2>/dev/null`);
    document.getElementById("monitorIgnoreContent").value = content;
    parseIgnoreToVisual(content);
    history.pushState({ modalOpen: true }, "");
    document.getElementById("monitorIgnoreModal")?.classList.add("open");
  };
  document.getElementById("btnAddIgnoreRow").onclick = () => addIgnoreRow("");
  document.getElementById("btnSaveIgnore").onclick = async () => {
    try {
      const isVisual = document
        .querySelector('button[name="ignoreModeToggle"][data-mode="visual"]')
        ?.classList.contains("active");
      const content = isVisual
        ? generateIgnoreFromVisual()
        : document.getElementById("monitorIgnoreContent").value;
      await run(`echo '${content.trim()}' > ${CONST.MONITOR_IGNORE_CONF}`);
      showToast("过滤配置已保存");
      closeModalCleanup();
    } catch {
      showToast("保存失败");
    }
  };

  setupModeToggle(
    "globalModeToggle",
    "globalVisual",
    "globalRaw",
    "globalRuleContent",
    (val) =>
      parseConfigTextToVisual(val, "globalRuleBuilderContainer", "globalMonitorSelect", "globalSandboxSelect", "globalInjectSelect"),
    () =>
      generateConfigTextFromVisual("globalRuleBuilderContainer", "globalMonitorSelect", "globalSandboxSelect", "globalInjectSelect")
  );
  setupModeToggle(
    "appModeToggle",
    "appVisual",
    "appRaw",
    "appRuleContent",
    (val) =>
      parseConfigTextToVisual(val, "appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null),
    () =>
      generateConfigTextFromVisual("appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null)
  );
  setupModeToggle(
    "ignoreModeToggle",
    "ignoreVisual",
    "ignoreRaw",
    "monitorIgnoreContent",
    parseIgnoreToVisual,
    generateIgnoreFromVisual
  );

  setupGlobalHandlers();
  document.getElementById("btnAppAddRule").onclick = () =>
    addRuleRow("REDIRECT", "", "", "appRuleBuilderContainer");
    
  document.getElementById("btnCloseAppModal").onclick = closeModalCleanup;
  document.querySelectorAll(".mx-btn-close").forEach(btn => {
    btn.onclick = () => closeModalCleanup();
  });

  document.getElementById("btnSaveAppConfig").onclick = async () => {
    try {
      const isVisual = document
        .querySelector('button[name="appModeToggle"][data-mode="visual"]')
        ?.classList.contains("active");
      const text = isVisual
        ? generateConfigTextFromVisual("appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null)
        : document.getElementById("appRuleContent").value;
      const isEnabled = document.getElementById("appEnableToggle").checked;
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
      showToast("配置已保存");
      closeModalCleanup();
      await loadData();
      await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    } catch {
      showToast("保存失败");
    }
  };

  document.getElementById("btnDeleteAppConfig").onclick = async () => {
    if (!confirm("确定清除配置吗?")) return;
    const dir =
      state.currentBindingUser === 0
        ? `${CONST.BASE_DIR}/App-rules`
        : `${CONST.BASE_DIR}/App-rules-${state.currentBindingUser}`;
    await run(`rm -f ${dir}/${state.currentBindingPkg}.conf ${dir}/${state.currentBindingPkg}.conf.disabled`);
    state.injectorStates.delete(`${state.currentBindingPkg}:${state.currentBindingUser}`);
    await flushInjectorConf();
    closeModalCleanup();
    await loadData();
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    showToast("配置已清除");
  };

  const originalOpenAppConfig = window.openAppConfig;
  window.openAppConfig = (pkg) => {
    stopPolling();
    history.pushState({ modalOpen: true }, "");
    document.querySelector(".mx-app").classList.add("frozen");
    document.body.classList.add("modal-open");
    document.getElementById("appConfigSubpage")?.classList.add("open");
    originalOpenAppConfig(pkg);
  };

  initIoLogs();
  initSysLogs();
  loadData();
  startPolling();
  requestAnimationFrame(() => {
    document.body.classList.add("loaded");
  });
});