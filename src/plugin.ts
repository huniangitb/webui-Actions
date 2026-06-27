import { exec, toast } from "kernelsu";
import type { Settings, AppEntry } from "./types/index";
import {showToast, splitLineRespectingQuotes} from "./utils.js";
const SETTINGS_FILE = "/data/Namespace-Proxy/webui_settings.json";

export async function getSettings(): Promise<Settings> {
  try {
    const res = await exec(`cat ${SETTINGS_FILE} 2>/dev/null`);
    if (res.stdout) return JSON.parse(res.stdout) as Settings;
  } catch (e) {
    showToast.error("读取设置失败: " + (e instanceof Error ? e.message : String(e)));
  }
  return { syncPlugin: false, autoTheme: true, colorProfile: "teal" };
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await exec(`echo '${JSON.stringify(settings)}' > ${SETTINGS_FILE}`);
  } catch (e) {
    showToast.error("保存设置失败: " + (e instanceof Error ? e.message : String(e)));
  }
}

export async function checkPluginInstalled(): Promise<boolean> {
  try {
    const res = await exec("pm path me.gm.cleaner.plugin 2>/dev/null");
    return !!(res.stdout && res.stdout.trim());
  } catch {
    return false;
  }
}

interface RedirectRule {
  source: string;
  target: string;
}

interface ParsedRules {
  redirects: RedirectRule[];
  hides: string[];
  ros: string[];
  allows: string[];
  sandboxState: string | undefined;
}

function deduplicate<T>(arr: T[]): T[] | undefined {
  return arr.length > 0 ? [...new Set(arr)] : undefined;
}

function convertToStoragePath(p: string): string {
  if (!p) return p;
  let result = p.trim();
  if (result.startsWith("/data/media/0")) {
    result = "/storage/emulated/0" + result.substring(13);
  } else if (!result.startsWith("/storage/emulated/0")) {
    result = "/storage/emulated/0" + (result.startsWith("/") ? result : "/" + result);
  }
  if (!result.endsWith("/")) {
    result += "/";
  }
  return result.replace(/\/+/g, "/");
}

function parseRules(text: string | undefined): ParsedRules {
  const redirects: RedirectRule[] = [];
  const hides: string[] = [];
  const ros: string[] = [];
  const allows: string[] = [];
  let sandboxState: string | undefined;

  if (!text) return { redirects, hides, ros, allows, sandboxState };

  for (const line of text.split("\n")) {
    const parts = splitLineRespectingQuotes(line.trim());
    const directive = parts[0];
    const hasPath = parts.length >= 2;
    if (!directive) continue;

    switch (directive) {
      case "REDIRECT":
        if (parts.length >= 3) {
          redirects.push({
            source: convertToStoragePath(parts[1]),
            target: convertToStoragePath(parts.slice(2).join(" ")),
          });
        }
        break;
      case "HIDE":
        if (hasPath) hides.push(convertToStoragePath(parts[1]));
        break;
      case "RO":
        if (hasPath) ros.push(convertToStoragePath(parts[1]));
        break;
      case "ALLOW":
        if (hasPath) allows.push(convertToStoragePath(parts[1]));
        break;
      case "SANDBOX":
        if (parts[1] === "ON" || parts[1] === "OFF") sandboxState = parts[1];
        break;
    }
  }
  return { redirects, hides, ros, allows, sandboxState };
}

function hasSpecialRules(rules: ParsedRules): boolean {
  return (
    rules.sandboxState === "ON" ||
    rules.redirects.length > 0 ||
    rules.hides.length > 0 ||
    rules.ros.length > 0 ||
    rules.allows.length > 0
  );
}

interface PluginTemplate {
  template_name: string;
  hook_operation: string[];
  apply_to_app: string[];
  enable_sandbox: boolean;
  exempt_path?: string[];
  filter_path?: string[];
  read_only_path?: string[];
  redirect_rules?: RedirectRule[];
}

export async function syncToPlugin(
  appMap: Map<string, AppEntry>,
  globalConfText: string,
  injectorRulesMap: Map<string, string[]>,
  injectorStates: Map<string, string>,
): Promise<void> {
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch (e) {
    showToast.error("读取设置失败: " + (e instanceof Error ? e.message : String(e)));
    return;
  }
  if (!settings.syncPlugin) return;

  try {
    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;
  } catch (e) {
    showToast.error("检查插件状态失败: " + (e instanceof Error ? e.message : String(e)));
    return;
  }

  const isGlobalInjectOn = (globalConfText || "").includes("GLOBAL_INJECT ON");
  const allEnabledApps = new Set<string>();
  const pkgRules = new Map<string, ParsedRules>();

  // 1. collect app enable status & config
  appMap.forEach((app, pkg) => {
    let combinedText = "";
    let isPkgEnabled = false;

    for (const uid in app.users) {
      if (app.users[uid].isEnabled) {
        isPkgEnabled = true;
        if (app.users[uid].text) combinedText += app.users[uid].text + "\n";
      }
    }

    if (isGlobalInjectOn) {
      const state0 = injectorStates.get(`${pkg}:0`);
      if (state0 !== "OFF") {
        isPkgEnabled = true;
      }
    }

    if (isPkgEnabled) {
      allEnabledApps.add(pkg);
      if (combinedText.trim()) {
        pkgRules.set(pkg, parseRules(combinedText));
      }
    }
  });

  // 2. collect inline config from injectorRulesMap
  injectorRulesMap.forEach((lines, section) => {
    if (section === "GLOBAL") return;
    const pkg = section.split(":")[0];
    const stateVal = injectorStates.get(section);
    const isPkgEnabled = isGlobalInjectOn ? stateVal !== "OFF" : stateVal === "ON";

    if (isPkgEnabled) {
      allEnabledApps.add(pkg);
      const parsed = parseRules(lines.join("\n"));
      const existing = pkgRules.get(pkg) || {
        hides: [],
        redirects: [],
        ros: [],
        allows: [],
        sandboxState: undefined,
      };
      existing.hides.push(...parsed.hides);
      existing.ros.push(...parsed.ros);
      existing.allows.push(...parsed.allows);
      existing.redirects.push(...parsed.redirects);
      if (parsed.sandboxState) existing.sandboxState = parsed.sandboxState;
      pkgRules.set(pkg, existing);
    }
  });

  const templates: PluginTemplate[] = [];

  // 3. global template
  const globalRules = parseRules(globalConfText);

  if (hasSpecialRules(globalRules) && allEnabledApps.size > 0) {
    templates.push({
      template_name: "NS-Proxy-Global",
      hook_operation: ["query", "insert"],
      apply_to_app: Array.from(allEnabledApps),
      enable_sandbox: globalRules.sandboxState === "ON",
      exempt_path: deduplicate(globalRules.allows),
      filter_path: deduplicate(globalRules.hides),
      read_only_path: deduplicate(globalRules.ros),
      redirect_rules: globalRules.redirects.length > 0 ? globalRules.redirects : undefined,
    });
  }

  // 4. app-specific templates with name conflict detection
  const labelCounts = new Map<string, number>();
  pkgRules.forEach((_, pkg) => {
    const appInfo = appMap.get(pkg);
    const label = appInfo?.appLabel || pkg;
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });

  pkgRules.forEach((data, pkg) => {
    if (!hasSpecialRules(data)) return;

    const appInfo = appMap.get(pkg);
    const label = appInfo?.appLabel || pkg;
    const finalName =
      (labelCounts.get(label) ?? 0) > 1 && label !== pkg ? `${label} (${pkg})` : label;

    templates.push({
      template_name: finalName,
      hook_operation: ["query", "insert"],
      apply_to_app: [pkg],
      enable_sandbox: data.sandboxState === "ON",
      exempt_path: deduplicate(data.allows),
      filter_path: deduplicate(data.hides),
      read_only_path: deduplicate(data.ros),
      redirect_rules: data.redirects.length > 0
        ? [...new Map(data.redirects.map((r) => [r.source, r])).values()]
        : undefined,
    });
  });

  // 5. write rule file
  try {
    const jsonStr = JSON.stringify(templates);
    const findCmd = "pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1";
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";

    const targetDir = `/data/user_de/0/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;

    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);

    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) {
      await exec(`chown ${ug} ${targetPath}`);
    }
    await exec(`chmod 644 ${targetPath}`);

    // 6. reload feedback
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
      showToast.success(`同步成功：已转换 ${templates.length} 个规则模板，插件已重载`);
    } else {
      showToast.error("Reload rules failed: " + reloadRes.stderr);
    }
  } catch (e) {
    showToast.error("同步失败: " + (e instanceof Error ? e.message : String(e)));
  }
}
