import { state, CONST } from "./state.js";
import { showToast } from "./utils.js";
import {
  addRuleRow,
  parseConfigTextToVisual,
  generateConfigTextFromVisual,
} from "./ui.js";
import { loadData, flushInjectorConf } from "./apps.js";
import { syncToPlugin } from "./plugin.js";

export const renderGlobalRules = () => {
  const contentEl = document.getElementById("globalRuleContent");
  if (contentEl) contentEl.value = state.globalConfText;
  parseConfigTextToVisual(
    state.globalConfText,
    "globalRuleBuilderContainer",
    "globalMonitorSelect",
    "globalSandboxSelect",
    "globalInjectSelect"
  );
};

export const setupGlobalHandlers = () => {
  document.getElementById("btnSaveGlobal").onclick = async () => {
    try {
      const isVisual = document.querySelector(
        'button[name="globalModeToggle"][data-mode="visual"]'
      )?.classList.contains("active");
      state.globalConfText = isVisual
        ? generateConfigTextFromVisual(
            "globalRuleBuilderContainer",
            "globalMonitorSelect",
            "globalSandboxSelect",
            "globalInjectSelect"
          )
        : document.getElementById("globalRuleContent").value;
      await flushInjectorConf();
      showToast.success("全局规则已保存");
      await loadData();
      await syncToPlugin(state.appMap, state.globalConfText, state.injectorRulesMap, state.injectorStates);
    } catch (e) {
      showToast.error("保存失败");
    }
  };

  document.getElementById("btnGlobalAddRule").onclick = () =>
    addRuleRow("REDIRECT", "", "", "globalRuleBuilderContainer");
};
