import { state } from "./state.js";
import { updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark: boolean, colorProfile?: string): void => {
  state.isDarkMode = isDark;
  const doc = document.documentElement;

  doc.classList.add("theme-transition");
  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  if (colorProfile) {
    doc.setAttribute("data-color-profile", colorProfile);
    state.currentSettings.colorProfile = colorProfile;
  }

  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#0C0E12" : "#F0F2F5");
  }
  updateThemeIcons();

  clearTimeout(doc._themeTransitionTimer);
  doc._themeTransitionTimer = setTimeout(() => {
    doc.classList.remove("theme-transition");
  }, 500);
};

export const systemThemeListener = (e: MediaQueryListEvent): void => {
  if (state.currentSettings.autoTheme) {
    applyTheme(e.matches, state.currentSettings.colorProfile);
  }
};

export const handleManualThemeToggle = (): void => {
  if (state.currentSettings.autoTheme) {
    state.currentSettings.autoTheme = false;
    (document.getElementById("autoThemeToggle") as HTMLInputElement).checked = false;
    saveSettings(state.currentSettings);
    import("./utils.js").then(({ showToast }) => showToast.info("已关闭系统深色模式跟随"));
  }
  applyTheme(!state.isDarkMode, state.currentSettings.colorProfile);
};

/** Apply the color profile without triggering a full theme transition */
export const applyColorProfile = (profile: string): void => {
  state.currentSettings.colorProfile = profile;
  document.documentElement.setAttribute("data-color-profile", profile);
};
