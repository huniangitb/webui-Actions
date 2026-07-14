import { exec } from "kernelsu";
import type { Settings } from "./types/index";
import {showToast} from "./utils.js";
const SETTINGS_FILE = "/data/Namespace-Proxy/webui_settings.json";

export async function getSettings(): Promise<Settings> {
  try {
    const res = await exec(`cat ${SETTINGS_FILE} 2>/dev/null`);
    if (res.stdout) return JSON.parse(res.stdout) as Settings;
  } catch (e) {
    showToast.error("读取设置失败: " + (e instanceof Error ? e.message : String(e)));
  }
  return { autoTheme: true, colorProfile: "teal", useLogCtl: true };
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await exec(`echo '${JSON.stringify(settings)}' > ${SETTINGS_FILE}`);
  } catch (e) {
    showToast.error("保存设置失败: " + (e instanceof Error ? e.message : String(e)));
  }
}
