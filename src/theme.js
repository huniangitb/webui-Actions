import { state } from "./state.js";
import { ICONS, updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";
export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  // 动态更新系统状态栏和网页 meta theme-color，使其完美覆盖状态栏
  const themeColor = isDark ? "#161616" : "#F0F2F5";
  document.getElementById("themeMeta")?.setAttribute("content", themeColor);
  updateThemeIcons();
};
export const systemThemeListener = (e) => {
  if (state.currentSettings.autoTheme) applyTheme(e.matches);
};
export const handleManualThemeToggle = () => {
  if (state.currentSettings.autoTheme) {
    state.currentSettings.autoTheme = false;
    document.getElementById("autoThemeToggle").checked = false;
    saveSettings(state.currentSettings);
    import("./utils.js").then(({ showToast }) => showToast("已关闭系统深色模式跟随"));
  }
  applyTheme(!state.isDarkMode);
};