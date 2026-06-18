import { state } from "./state.js";
import { updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark: boolean): void => {
  state.isDarkMode = isDark;
  const doc = document.documentElement;

  doc.classList.add("theme-transition");
  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#161616" : "#F0F2F5");
  }
  updateThemeIcons();

  clearTimeout(doc._themeTransitionTimer);
  doc._themeTransitionTimer = setTimeout(() => {
    doc.classList.remove("theme-transition");
  }, 500);
};

export const systemThemeListener = (e: MediaQueryListEvent): void => {
  if (state.currentSettings.autoTheme) applyTheme(e.matches);
};

export const handleManualThemeToggle = (): void => {
  if (state.currentSettings.autoTheme) {
    state.currentSettings.autoTheme = false;
    (document.getElementById("autoThemeToggle") as HTMLInputElement).checked = false;
    saveSettings(state.currentSettings);
    import("./utils.js").then(({ showToast }) => showToast.info("已关闭系统深色模式跟随"));
  }
  applyTheme(!state.isDarkMode);
};
