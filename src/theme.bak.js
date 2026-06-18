import { state } from "./state.js";
import { updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;

  const doc = document.documentElement;

  // 添加过渡类，触发全局 1s 丝滑过渡
  doc.classList.add("theme-transition");

  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#161616" : "#F0F2F5");
  }
  updateThemeIcons();

  // 过渡完成后移除类，恢复正常交互动画时序
  clearTimeout(doc._themeTransitionTimer);
  doc._themeTransitionTimer = setTimeout(() => {
    doc.classList.remove("theme-transition");
  }, 1100);
};

export const systemThemeListener = (e) => {
  if (state.currentSettings.autoTheme) applyTheme(e.matches);
};

export const handleManualThemeToggle = () => {
  if (state.currentSettings.autoTheme) {
    state.currentSettings.autoTheme = false;
    document.getElementById("autoThemeToggle").checked = false;
    saveSettings(state.currentSettings);
    import("./utils.js").then(({ showToast }) => showToast.info("已关闭系统深色模式跟随"));
  }
  applyTheme(!state.isDarkMode);
};