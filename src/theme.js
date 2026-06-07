import { state } from "./state.js";
import { ICONS, updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
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
