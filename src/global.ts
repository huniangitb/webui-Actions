import { state } from "./state.js";
import { showToast } from "./utils.js";
import { addRuleRow, parseConfigTextToVisual, generateConfigTextFromVisual } from "./ui.js";
import { loadData, flushInjectorConf } from "./apps.js";
import { syncToPlugin } from "./plugin.js";

export const renderGlobalRules = (): void => {
  const contentEl = document.getElementById("globalRuleContent") as HTMLTextAreaElement | null;
  if (contentEl) contentEl.value = state.globalConfText;
  parseConfigTextToVisual(
    state.globalConfText,
    "globalRuleBuilderContainer",
    "globalMonitorSelect",
    "globalSandboxSelect",
    "globalInjectSelect",
  );
};

export const setupGlobalHandlers = (): void => {
  document.getElementById("btnSaveGlobal")!.onclick = async () => {
    try {
      const visualBtn = document.querySelector<HTMLElement>(
        'button[name="globalModeToggle"][data-mode="visual"]',
      );
      if (visualBtn?.classList.contains("active")) {
        state.globalConfText = generateConfigTextFromVisual(
          "globalRuleBuilderContainer",
          "globalMonitorSelect",
          "globalSandboxSelect",
          "globalInjectSelect",
        );
      } else {
        state.globalConfText = (document.getElementById("globalRuleContent") as HTMLTextAreaElement).value;
      }
      await flushInjectorConf();
      const mode = state.currentSettings.useLogCtl ? "log_ctl" : "文件";
      showToast.success(`全局规则已保存 (${mode}模式)`);
      await loadData();
      await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    } catch {
      showToast.error("保存失败");
    }
  };

  document.getElementById("btnGlobalAddRule")!.onclick = () =>
    addRuleRow("REDIRECT", "", "", "globalRuleBuilderContainer");
};
