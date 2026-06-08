import { state, CONST } from "./state.js";
import { run, showToast, ICONS, initIcons, debounce } from "./utils.js";
import { applyTheme, systemThemeListener, handleManualThemeToggle } from "./theme.js";
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
} from "./apps.js";
import { setupGlobalHandlers } from "./global.js";
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
import { getSettings, saveSettings, checkPluginInstalled } from "./plugin.js";
import { syncToPlugin } from "./plugin.js";
// =============================================
// CSS
// =============================================
import "../style.css";
// =============================================
// Status polling
// =============================================
let statusPolling = null;
let appStatusPolling = null;
const checkStatus = async () => {
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
  try {
    const [mounts] = await Promise.all([fetchActiveMounts(), fetchInjectedApps()]);
    state.activeMounts = mounts;
    if (document.getElementById("sec-apps")?.classList.contains("active")) {
      updateAppListStatus();
    }
  } catch {}
};
// =============================================
// Ignore config helpers
// =============================================
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
  div.innerHTML = `<input type="text" class="mx-input" style="background:var(--mx-s1); border-radius:6px; font-size:12px; padding:6px;" placeholder="要忽略的路径前缀" value="${p}"><button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
  div.querySelector(".btn-del").onclick = () => div.remove();
  document.getElementById("ignoreBuilderContainer")?.appendChild(div);
};
// =============================================
// Navigation
// =============================================
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
// =============================================
// DOMContentLoaded
// =============================================
document.addEventListener("DOMContentLoaded", async () => {
  // Init
  initIcons();
  
  // Real-time Visual Viewport & Keyboard Resizer
  // 在键盘弹起期间：主界面和子模态框高度锁定不作改变。
  // 待键盘完成弹出（稳定 150ms 之后）直接计算视口遮挡，通过硬件加速平移 modal 整体视图（允许溢出屏幕上方），并同步校准提示框位置
  let resizeTimeout = null;
  const updateViewportHeight = () => {
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    } else {
      state.isViewportResizing = true;
    }
    
    resizeTimeout = setTimeout(() => {
      state.isViewportResizing = false;
      resizeTimeout = null;
      
      // 1. 过渡结束后，单帧内代数计算重叠并整体平移模态框视图位置
      import("./ui.js").then(({ updateModalShift }) => {
        updateModalShift();
      });
      
      // 2. 将输入框滚动至正中并同步重构提示框定位
      window.requestAnimationFrame(() => {
        if (window._currentInput && document.activeElement === window._currentInput) {
          window._currentInput.scrollIntoView({ block: "center", behavior: "smooth" });
          window._currentInput.dispatchEvent(new Event("input"));
          import("./ui.js").then(({ updateSuggestionBoxPosition }) => {
            updateSuggestionBoxPosition(window._currentInput);
          });
        }
      });
    }, 150);
  };
  
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      window.requestAnimationFrame(updateViewportHeight);
    });
    window.visualViewport.addEventListener("scroll", () => {
      window.requestAnimationFrame(updateViewportHeight);
    });
  }
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(updateViewportHeight);
  });
  window.requestAnimationFrame(updateViewportHeight);
  // 全局滚动捕获监听：当页面任意滚动发生时，若是输入框焦点态，实时对补全框重定位，若已失焦则即刻收回
  window.addEventListener("scroll", (e) => {
    if (window._currentInput && document.activeElement === window._currentInput) {
      window.requestAnimationFrame(() => {
        import("./ui.js").then(({ updateSuggestionBoxPosition }) => {
          updateSuggestionBoxPosition(window._currentInput);
        });
      });
    } else {
      const box = document.getElementById("suggestionBox");
      if (box && box.style.display !== "none") {
        box.style.display = "none";
        state.currentSuggestions = [];
      }
    }
  }, true); // capture 设为 true 从而穿透任意滚动层
  // 全局点击判定：若点击落在补全框及对应输入框以外的区域，立刻收回补全菜单，并在完全失焦时重置模态框视图位置
  document.addEventListener("click", (e) => {
    const box = document.getElementById("suggestionBox");
    if (box && box.style.display !== "none") {
      const isInput = e.target.classList.contains("rule-target") || e.target.classList.contains("rule-source");
      const isInsideBox = box.contains(e.target);
      if (!isInput && !isInsideBox) {
        box.style.display = "none";
        state.currentSuggestions = [];
      }
    }
    // 延迟检查焦点。若不再聚焦任何输入框，一键重置模态框归位
    setTimeout(() => {
      if (!document.activeElement || !document.activeElement.classList.contains("mx-input")) {
        const modal = document.querySelector(".mx-modal-overlay.open .mx-modal");
        if (modal) {
          modal.style.transform = "scale(1) translate3d(0, 0, 0)";
        }
      }
    }, 150);
  });
  // Settings
  state.currentSettings = await getSettings();
  document.getElementById("autoThemeToggle").checked = state.currentSettings.autoTheme;
  document.getElementById("pluginSyncToggle").checked = state.currentSettings.syncPlugin;
  if (state.currentSettings.autoTheme) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mediaQuery.matches);
    mediaQuery.addEventListener("change", systemThemeListener);
  }
  // Theme toggles
  document.getElementById("btnThemeToggleMobile").onclick = handleManualThemeToggle;
  document.getElementById("btnThemeToggleDesktop").onclick = handleManualThemeToggle;
  // Navigation
  document.querySelectorAll(".mx-nav-item, .mx-btm-item").forEach((btn) => {
    btn.onclick = () => switchSection(btn.dataset.section);
  });
  // App filter
  document.querySelectorAll("#appFilterGroup button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#appFilterGroup button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentAppFilter = btn.dataset.filter;
      renderAppList();
    };
  });
  // App search
  document.getElementById("appSearch")?.addEventListener("input", debounce(renderAppList, 250));
  // IO
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
  // Log
  const logSelect = document.getElementById("logSourceSelect");
  const logLevelSelect = document.getElementById("logLevelSelect");
  const logViewer = document.getElementById("logViewer");
  if (logSelect) {
    logSelect.addEventListener("change", () => {
      if (logSelect.value === "internal") resetSysLogs();
      fetchSysLogs();
    });
  }
  if (logLevelSelect) {
    logLevelSelect.addEventListener("change", () => {
      state.sysState.level = parseInt(logLevelSelect.value);
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
  // Status toggle
  document.getElementById("btnToggleStatusMobile").onclick = toggleStatus;
  document.getElementById("btnToggleStatusDesktop").onclick = toggleStatus;
  // Settings modal
  const openSettings = async () => {
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
    document.getElementById("settingsModal")?.classList.remove("open");
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
  };
  // Ignore modal
  document.getElementById("btnMonitorIgnore").onclick = async () => {
    const content = await run(`cat ${CONST.MONITOR_IGNORE_CONF} 2>/dev/null`);
    document.getElementById("monitorIgnoreContent").value = content;
    parseIgnoreToVisual(content);
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
      document.getElementById("monitorIgnoreModal")?.classList.open && document.getElementById("monitorIgnoreModal").classList.remove("open");
    } catch {
      showToast("保存失败");
    }
  };
  // Mode toggles
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
  // Global rules
  setupGlobalHandlers();
  document.getElementById("btnAppAddRule").onclick = () =>
    addRuleRow("REDIRECT", "", "", "appRuleBuilderContainer");
  // App config modal
  document.getElementById("btnCloseAppModal").onclick = () =>
    document.getElementById("appConfigModal")?.classList.remove("open");
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
      document.getElementById("appConfigModal")?.classList.remove("open");
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
    await loadData();
    await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    showToast("配置已清除");
    document.getElementById("appConfigModal")?.classList.remove("open");
  };
  // Init virtual log lists
  initIoLogs();
  initSysLogs();
  // Initial data load
  loadData();
  checkStatus();
  // Polling
  statusPolling = setInterval(checkStatus, 500);
  appStatusPolling = setInterval(refreshAppStatus, 1000);
  // Close buttons
  document.querySelectorAll(".mx-btn-close").forEach((btn) => (btn.innerHTML = ICONS.CLOSE));
  // 挂载淡入样式，触发渐隐式优雅切入
  requestAnimationFrame(() => {
    document.body.classList.add("loaded");
  });
});