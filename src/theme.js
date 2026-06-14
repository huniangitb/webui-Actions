import { state } from "./state.js";
import { ICONS, updateThemeIcons } from "./utils.js";
import { saveSettings } from "./plugin.js";

const TRANSITION = 'background-color 0.5s ease, color 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease';

export const applyTheme = (isDark) => {
  state.isDarkMode = isDark;

  // 对 html / body 及所有主题色容器显式注入 transition，确保虚拟列表/模态框/卡片等均有渐变
  const doc = document.documentElement;
  doc.style.transition = TRANSITION;
  document.body.style.transition = TRANSITION;

  // 批量设置关键容器的行内过渡
  const selectors = [
    '.mx-app', '.mx-desktop-main', '.mx-topbar', '.mx-bottom-nav', '.mx-sidebar',
    '.mx-card', '.mx-card-head', '.mx-card-body', '.mx-card-foot',
    '.mx-modal-overlay', '.mx-modal', '.mx-modal-head', '.mx-modal-body', '.mx-modal-foot',
    '.mx-subpage-container', '.mx-subpage-header', '.mx-subpage-body', '.mx-subpage-footer',
    '.mx-desktop-shell', '.mx-desktop-topbar',
    '.io-item', '.io-detail', '.sys-log-item', '.sys-log-msg', '.sys-log-raw',
    '.virtual-log-item',
  ];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.transition = TRANSITION;
    });
  });

  doc.setAttribute("data-theme", isDark ? "dark" : "light");

  // 过渡结束后清理行内样式，恢复 CSS 类管理
  setTimeout(() => {
    doc.style.transition = '';
    document.body.style.transition = '';
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.transition = '';
      });
    });
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