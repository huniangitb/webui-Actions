import { state } from "./state.js";
import { updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;
  
  const doc = document.documentElement;
  // 直接切换 data-theme 属性，触发 CSS 中定义的全链路 GPU 过渡
  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  // 动态修改状态栏颜色 Meta 标签，实现全屏沉浸
  const metaThemeColor = document.getElementById("themeColorMeta");
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", isDark ? "#161616" : "#F0F2F5");
  }
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
    import("./utils.js").then(({ showToast }) => showToast.info("已关闭系统深色模式跟随"));
  }
  applyTheme(!state.isDarkMode);
};