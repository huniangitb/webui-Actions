import { state } from "./state.js";
import { ICONS, updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;

  // 显式设置过渡，强制浏览器对 data-theme 切换进行动态动画
  const doc = document.documentElement;
  doc.style.transition = 'background-color 0.5s ease';
  document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';

  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  // 过渡结束后清理行内样式，恢复 CSS 类管理
  setTimeout(() => {
    doc.style.transition = '';
    document.body.style.transition = '';
  }, 550);

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