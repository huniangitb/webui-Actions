import { state, CONST } from "./state.js";
import { run, showToast } from "./utils.js";
import { listPackages, getPackagesInfo } from "kernelsu";
import { parseConfigTextToVisual } from "./ui.js";
import type { AppEntry, PackageInfo } from "./types/index";
import * as logctl from "./logctl.js";

const TRANSPARENT_SPACER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const _iconCache = new Set<string>();
const iconQueue = new Set<HTMLImageElement>();
let isIconQueueRunning = false;

// DOM node cache: pkg -> element (avoids destroying/recreating on filter switch)
const _itemNodeCache = new Map<string, HTMLElement>();

const processIconQueue = async (): Promise<void> => {
  if (isIconQueueRunning) return;
  isIconQueueRunning = true;
  while (iconQueue.size > 0) {
    const img = iconQueue.values().next().value;
    if (!img) continue;
    iconQueue.delete(img);
    if (img.dataset.src) {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  isIconQueueRunning = false;
};

const enqueueIcon = (img: HTMLImageElement): void => {
  if (!img || !img.dataset.src) return;
  iconQueue.add(img);
  processIconQueue();
};

let loadedIconsInBatch = 0;
let targetIconCount = 0;
let isTransitioningOut = false;

declare global {
  interface Window {
    onIconLoaded: (img: HTMLImageElement) => void;
    onIconError: (img: HTMLImageElement) => void;
    openAppConfig: (pkg: string) => void;
    switchAppUser: (uid: number) => void;
  }
}

window.onIconLoaded = (img: HTMLImageElement): void => {
  if (img.src.startsWith("data:image/gif;base64,")) return;
  img.classList.add("icon-loaded");
  _iconCache.add(img.dataset.pkg ?? "");
  checkBatchLoading();
};

window.onIconError = (img: HTMLImageElement): void => {
  if (img.src.startsWith("data:image/gif;base64,")) return;
  img.classList.add("icon-error");
  img.src = img.dataset.fallback ?? "";
  checkBatchLoading();
};

function checkBatchLoading(): void {
  if (isTransitioningOut || !state.isInitialLoad) return;
  loadedIconsInBatch++;
  if (loadedIconsInBatch >= targetIconCount) {
    isTransitioningOut = true;
    hideSpinnerOverlay();
  }
}

function hideSpinnerOverlay(): void {
  const overlay = document.getElementById("appLoadingOverlay");
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    setTimeout(() => {
      overlay.style.display = "none";
    }, 400);
  }
  state.isAppListReady = true;
  state.isInitialLoad = false;
  // Mark app list container as ready so scrollbar can appear
  document.getElementById("appListContainer")?.classList.add("app-list-loaded");
  initListObserver();
  const listEl = document.getElementById("appList");
  if (listEl) {
    listEl.querySelectorAll<HTMLElement>(".app-item").forEach((el) => listObserver?.observe(el));
  }
}

export const fetchActiveMounts = async (): Promise<Set<string>> => {
  const m = new Set<string>();
  try {
    const args = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
    if (args) {
      args.split("\n").forEach((l) => {
        const mt = l.match(/--pkg=([a-zA-Z0-9._]+)/);
        if (mt) m.add(mt[1]);
      });
    }
  } catch {
    /* ignore */
  }
  return m;
};

export const fetchInjectedApps = async (): Promise<void> => {
  try {
    const result = await logctl.listInjected();
    state.injectedApps.clear();
    // result.apps contains InjectedAppInfo with pkg/pid/uid/redirect/hide/ro
    for (const [pkg, info] of result.apps) {
      state.injectedApps.set(pkg, info);
    }
  } catch {
    /* ignore */
  }
};

function buildAppMap(
  src: PackageInfo[],
  ruleFilesMap: Map<string, string | boolean>,
): void {
  state.appMap.clear();
  if (!Array.isArray(src)) return;
  for (const info of src) {
    if (!info || !info.packageName) continue;
    const appUsers: Record<number, { isEnabled: boolean; text: string; hasRules: boolean }> = {};
    let isConfiguredAny = false;
    for (const uid of state.activeUsers) {
      const exactKey = `${info.packageName}:${uid}`;
      const stateVal =
        state.injectorStates.get(exactKey) || state.injectorStates.get(info.packageName) || "ON";
      const ruleText = (ruleFilesMap.get(exactKey) as string) || "";
      const hasRulesFile = ruleFilesMap.has(exactKey);
      const hasInlineRules = (state.injectorRulesMap.get(exactKey)?.length ?? 0) > 0;
      const isEnabled = ruleFilesMap.get(`${exactKey}_enabled`)
        ? true
        : ruleFilesMap.get(`${exactKey}_disabled`)
          ? false
          : stateVal === "ON" && (hasRulesFile || hasInlineRules);
      if (hasRulesFile || stateVal === "OFF" || hasInlineRules) isConfiguredAny = true;
      appUsers[uid] = {
        isEnabled,
        text: ruleText,
        hasRules:
          /REDIRECT|HIDE|RO|ALLOW/.test(ruleText) ||
          /REDIRECT|HIDE|RO|ALLOW/.test(
            (state.injectorRulesMap.get(exactKey) || []).join(""),
          ),
      };
    }
    state.appMap.set(info.packageName, {
      ...info,
      isConfigured: isConfiguredAny,
      users: appUsers,
    });
  }
}

export const loadData = async (): Promise<void> => {
  if (state.isInitialLoad === undefined) {
    state.isInitialLoad = true;
    state.isAppListReady = false;
  }
  const overlay = document.getElementById("appLoadingOverlay");
  if (overlay && state.isInitialLoad) {
    overlay.style.display = "flex";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "auto";
  }
  try {
    const results = await Promise.all([
      fetchActiveMounts().then((m) => { state.activeMounts = m; }),
      fetchInjectedApps(),
      run("pm list users"),
    ]);
    const userRes = results[2] as string;
    state.activeUsers = [];
    if (userRes) {
      for (const m of userRes.matchAll(/UserInfo\{(\d+):/g)) {
        state.activeUsers.push(parseInt(m[1]));
      }
    }
    if (state.activeUsers.length === 0) state.activeUsers.push(0);

    state.globalConfText = "";
    state.injectorStates.clear();
    state.injectorRulesMap.clear();
    /** When useLogCtl, also holds app_rule files from get-config --static response */
    let staticAppRules: logctl.StaticConfigAppRuleFile[] | null = null;

    if (state.currentSettings.useLogCtl) {
      // ── log_ctl API mode ──

      // 1) Parse get-config --static for app entries + app rule files
      const parsed = await logctl.getConfigStaticParsed();
      if (parsed && parsed.apps) {
        staticAppRules = parsed.app_rules || null;
        // Populate app inject states
        for (const app of parsed.apps) {
          const key = `${app.pkg}:${app.user_id}`;
          state.injectorStates.set(key, app.inject_enable);
        }
      }

      // 2) Fetch global rules via dedicated get-global-rules API
      const globalRules = await logctl.getGlobalRules();
      if (globalRules) {
        const globalLines: string[] = [];
        const sw = globalRules.switches;
        const isOn = (v: unknown) => v && v !== "false" && v !== false;
        if (isOn(sw?.global_inject)) globalLines.push(`GLOBAL_INJECT ON`);
        if (isOn(sw?.monitor)) globalLines.push(`MONITOR ON`);
        if (isOn(sw?.sandbox)) globalLines.push(`SANDBOX ON`);
        if (isOn(sw?.fuse_direct)) globalLines.push(`FUSE_DIRECT ON`);
        for (const r of globalRules.ro_rules || []) globalLines.push(`RO ${r}`);
        for (const r of globalRules.hide_rules || []) globalLines.push(`HIDE ${r}`);
        for (const r of globalRules.redirect_rules || []) globalLines.push(`REDIRECT ${r}`);
        for (const r of globalRules.allow_rules || []) globalLines.push(`ALLOW ${r}`);

        state.globalConfText = globalLines.join("\n");
        state.injectorRulesMap.set("GLOBAL", globalLines);
      } else if (parsed?.global) {
        // Fallback: reconstruct from get-config --static data
        const globalLines: string[] = [];
        const sw = parsed.global.switches;
        if (sw?.global_inject) globalLines.push(`GLOBAL_INJECT ${sw.global_inject}`);
        if (sw?.monitor) globalLines.push(`MONITOR ${sw.monitor}`);
        if (sw?.sandbox) globalLines.push(`SANDBOX ${sw.sandbox}`);
        if (sw?.fuse_direct) globalLines.push(`FUSE_DIRECT ${sw.fuse_direct}`);
        for (const r of parsed.global.ro_rules || []) globalLines.push(`RO ${r}`);
        for (const r of parsed.global.hide_rules || []) globalLines.push(`HIDE ${r}`);
        for (const r of parsed.global.redirect_rules || []) globalLines.push(`REDIRECT ${r}`);
        for (const r of parsed.global.allow_rules || []) globalLines.push(`ALLOW ${r}`);

        state.globalConfText = globalLines.join("\n");
        state.injectorRulesMap.set("GLOBAL", globalLines);
      }
    } else {
      // ── Direct file mode: parse injector.conf as INI text ──
      const injectorConf = await run(`cat ${CONST.INJECTOR_CONF} 2>/dev/null`);
      if (injectorConf) {
        let currentSection = "";
        for (const line of injectorConf.split("\n")) {
          const tLine = line.trim();
          if (!tLine) continue;
          const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
          if (secMatch) {
            currentSection = secMatch[1];
            // 确保 app section key 始终带 :uid，默认不加则追加 :0
            if (currentSection !== "GLOBAL" && !currentSection.includes(":")) {
              currentSection = `${currentSection}:0`;
            }
            if (currentSection !== "GLOBAL") {
              state.injectorStates.set(currentSection, secMatch[2] || "ON");
            }
            if (!state.injectorRulesMap.has(currentSection)) {
              state.injectorRulesMap.set(currentSection, []);
            }
          } else if (currentSection) {
            state.injectorRulesMap.get(currentSection)!.push(tLine);
          }
        }
        state.globalConfText = (state.injectorRulesMap.get("GLOBAL") || []).join("\n") || "";
      }
    }

    const ruleFilesMap = new Map<string, string | boolean>();

    if (staticAppRules) {
      // ── log_ctl API mode: use app_rules from get-config --static ──
      for (const ar of staticAppRules) {
        const isDisabled = ar.file.endsWith(".conf.disabled");
        const fileName = ar.file.replace(/\.conf(\.disabled)?$/, "");
        const uidStr = ar.user_dir === "App-rules" ? "0" : ar.user_dir.replace("App-rules-", "");
        const uid = parseInt(uidStr, 10) || 0;
        ruleFilesMap.set(`${fileName}:${uid}`, ar.content);
        if (isDisabled) ruleFilesMap.set(`${fileName}:${uid}_disabled`, true);
        else ruleFilesMap.set(`${fileName}:${uid}_enabled`, true);
      }
    } else {
      // ── Direct file mode: read App-rules directories ──
      const batchCmds: string[] = [];
      const batchKeys: string[] = [];
      for (const uid of state.activeUsers) {
        const dir = uid === 0 ? `${CONST.BASE_DIR}/App-rules` : `${CONST.BASE_DIR}/App-rules-${uid}`;
        batchCmds.push(`for f in ${dir}/*.conf ${dir}/*.conf.disabled; do [ -f "$f" ] && echo "===FILE:$f===" && cat "$f"; done 2>/dev/null`);
        batchKeys.push(dir);
      }
      const batchResults = await Promise.all(batchCmds.map((cmd) => run(cmd)));
      for (let bi = 0; bi < batchResults.length; bi++) {
        const res = batchResults[bi];
        if (!res) continue;
        const dir = batchKeys[bi];
        const blocks = res.split("===FILE:");
        for (const block of blocks) {
          if (!block) continue;
          const endIdx = block.indexOf("===");
          if (endIdx === -1) continue;
          const filePath = block.substring(0, endIdx);
          const content = block.substring(endIdx + 3);
          const fileName = filePath.split("/").pop() ?? "";
          const isDisabled = fileName.endsWith(".conf.disabled");
          const pkg = fileName.replace(/\.conf(\.disabled)?$/, "");
          // batchCmds 按 state.activeUsers 顺序构建，bi 即对应 activeUsers 的索引
          const uid = bi < state.activeUsers.length ? state.activeUsers[bi] : 0;
          ruleFilesMap.set(`${pkg}:${uid}`, content);
          if (isDisabled) ruleFilesMap.set(`${pkg}:${uid}_disabled`, true);
          else ruleFilesMap.set(`${pkg}:${uid}_enabled`, true);
        }
      }
    }

    let infos: PackageInfo[] = [];
    let usedFallback = false;
    let primaryEmpty = false;
    try {
      const userPkgs = (await listPackages("user")) || [];
      const sysPkgs = (await listPackages("system")) || [];
      const allPkgs = [...new Set([...userPkgs, ...sysPkgs])];
      if (allPkgs.length > 0) {
        infos = (await getPackagesInfo(allPkgs)) || [];
        if (infos.length === 0) primaryEmpty = true;
      } else {
        primaryEmpty = true;
      }
    } catch {
      primaryEmpty = true;
    }
    buildAppMap(infos, ruleFilesMap);

    if (primaryEmpty || state.appMap.size === 0) {
      const fallbackList = await run(`cat ${CONST.LIST_CONFIG} 2>/dev/null`);
      if (fallbackList) {
        infos = [];
        for (const line of fallbackList.split("\n")) {
          const tl = line.trim();
          if (tl && !tl.startsWith("#") && tl.includes("=")) {
            const pkg = tl.substring(0, tl.indexOf("=")).trim();
            if (pkg)
              infos.push({
                packageName: pkg,
                appLabel: tl.substring(tl.indexOf("=") + 1).trim() || pkg,
                isSystem: false,
              });
          }
        }
        buildAppMap(infos, ruleFilesMap);
        if (state.appMap.size > 0) usedFallback = true;
      }
    }

    state.usingFallback = usedFallback;
    if (usedFallback) showToast.warning("应用列表为空，已回退至兼容模式");

    requestAnimationFrame(() => {
      renderAppList();
      import("./global.js").then(({ renderGlobalRules }) => renderGlobalRules());
    });

    const sysAppsToPreload = Array.from(state.appMap.values()).filter((a) => a.isSystem).slice(0, 30);
    for (const app of sysAppsToPreload) {
      if (!_iconCache.has(app.packageName)) {
        const dummyImg = document.createElement("img");
        dummyImg.dataset.src = `ksu://icon/${app.packageName}`;
        dummyImg.dataset.pkg = app.packageName;
        dummyImg.onload = () => _iconCache.add(app.packageName);
        enqueueIcon(dummyImg);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast.error("加载异常: " + msg);
  }
};

let listObserver: IntersectionObserver | null = null;

function initListObserver(): void {
  const rootEl = document.getElementById("appList");
  if (!rootEl) return;
  if (listObserver) listObserver.disconnect();
  listObserver = new IntersectionObserver(
    (entries) => {
      const intersecting = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          const idx = intersecting.indexOf(entry);
          if (state.isAppListReady) {
            el.style.transitionDelay = `${idx * 30}ms`;
            const icon = el.querySelector<HTMLElement>(".app-icon");
            if (icon) icon.style.transitionDelay = `${idx * 30 + 30}ms`;
            requestAnimationFrame(() => el.classList.add("show"));
          }
          const icon = el.querySelector<HTMLImageElement>(".app-icon");
          if (icon && icon.dataset.src) {
            enqueueIcon(icon);
          }
        } else {
          el.style.transitionDelay = "0ms";
          const icon = el.querySelector<HTMLElement>(".app-icon");
          if (icon) icon.style.transitionDelay = "0ms";
          el.classList.remove("show");
        }
      }
    },
    { root: rootEl, threshold: 0.01, rootMargin: "30px" },
  );
}

function renderBadges(app: AppEntry, pkg: string): string {
  let badges = state.activeUsers
    .filter((u) => app.users[u]?.text.trim() || app.users[u]?.hasRules || app.isConfigured)
    .map((u) => {
      const c = app.users[u];
      return `<span class="mx-badge ${c.isEnabled ? "mx-badge-primary" : "mx-badge-gray"}">U${u}${c.isEnabled ? "" : " OFF"}</span>`;
    })
    .join("");
  if (state.activeMounts.has(pkg)) {
    badges += `<span class="mx-badge mx-badge-success">MOUNTED</span>`;
  }
  return badges;
}

function renderInjectedStr(pkg: string): string {
  const inj = state.injectedApps.get(pkg);
  if (!inj) return "";
  const flags: string[] = [];
  if (inj.redirect === "1") flags.push('<span style="color:var(--mx-primary);font-weight:800">R</span>');
  if (inj.hide === "1") flags.push('<span style="color:var(--mx-amber);font-weight:800">H</span>');
  if (inj.ro === "1") flags.push('<span style="color:var(--mx-red);font-weight:800">RO</span>');
  return `<span style="font-size:10px;margin-left:6px;padding:2px 6px;background:var(--mx-s3);border-radius:4px;font-family:var(--mx-font-mono);flex-shrink:0;">PID ${inj.pid} ${flags.join(" ")}</span>`;
}

function buildAppItemHtml(app: AppEntry): string {
  const badgesHTML = renderBadges(app, app.packageName);
  const injStr = renderInjectedStr(app.packageName);
  const isCached = _iconCache.has(app.packageName);
  const iconSrc = isCached ? `ksu://icon/${app.packageName}` : TRANSPARENT_SPACER;
  const dataSrc = isCached ? "" : `ksu://icon/${app.packageName}`;
  const escapedPkg = app.packageName.replace(/'/g, "\\'");

  return `<div class="app-item" data-pkg="${app.packageName}" onclick="window.openAppConfig('${escapedPkg}')">
    <img class="app-icon${isCached ? " icon-loaded" : ""}" src="${iconSrc}" data-src="${dataSrc}" onerror="window.onIconError(this)" data-fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2365676b'><path d='M17.6,9.48l1.84-3.18c0.16-0.31,0.04-0.69-0.26-0.85c-0.31-0.16-0.69-0.04-0.85,0.26L16.4,9c-1.35-0.6-2.85-0.95-4.4-0.95S8.95,8.4,7.6,9L5.67,5.71C5.51,5.41,5.13,5.29,4.83,5.45C4.52,5.61,4.4,6,4.56,6.3L6.4,9.48C3.3,11.25,1.28,14.44,1,18.15h22C22.72,14.44,20.7,11.25,17.6,9.48z M7,15.25c-0.69,0-1.25-0.56-1.25-1.25S6.31,12.75,7,12.75s1.25,0.56,1.25,1.25S7.69,15.25,7,15.25z M17,15.25c-0.69,0-1.25-0.56-1.25-1.25s0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25S17.69,15.25,17,15.25z'/></svg>" onload="window.onIconLoaded(this)" data-pkg="${app.packageName}" />
    <div class="app-info">
      <div class="app-name" style="display:flex;align-items:center;">
        <span style="overflow:hidden;text-overflow:ellipsis;">${app.appLabel}</span><span class="inj-str">${injStr}</span>
      </div>
      <div class="app-pkg">${app.packageName}</div>
    </div>
    <div class="app-badges">${badgesHTML}</div>
  </div>`;
}

export function renderAppList(): void {
  const listEl = document.getElementById("appList");
  if (!listEl) return;
  const searchInput = document.getElementById("appSearch") as HTMLInputElement;
  const searchVal = searchInput?.value?.toLowerCase() ?? "";
  const items = Array.from(state.appMap.values())
    .filter((app) => {
      if (state.usingFallback && app.isSystem) return false;
      if (state.currentAppFilter === "filterUser" && app.isSystem) return false;
      if (state.currentAppFilter === "filterSystem" && !app.isSystem) return false;
      if (state.currentAppFilter === "filterBound" && !app.isConfigured) return false;
      const label = (app.appLabel || app.packageName).toLowerCase();
      return !searchVal || label.includes(searchVal) || app.packageName.toLowerCase().includes(searchVal);
    })
    .sort((a, b) => {
      const confDiff = (b.isConfigured ? 1 : 0) - (a.isConfigured ? 1 : 0);
      const labelA = a.appLabel || "";
      const labelB = b.appLabel || "";
      return confDiff !== 0 ? confDiff : labelA.localeCompare(labelB);
    });

  if (items.length === 0) {
    listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mx-t2);">无匹配应用</div>';
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    return;
  }

  for (const app of items) {
    if (!_itemNodeCache.has(app.packageName)) {
      const temp = document.createElement("div");
      temp.innerHTML = buildAppItemHtml(app);
      const node = temp.firstElementChild as HTMLElement;
      if (node) _itemNodeCache.set(app.packageName, node);
    }
  }

  const fragment = document.createDocumentFragment();
  for (const app of items) {
    const node = _itemNodeCache.get(app.packageName);
    if (node) fragment.appendChild(node);
  }
  listEl.innerHTML = "";
  listEl.appendChild(fragment);

  if (!listObserver) initListObserver();
  for (const el of listEl.querySelectorAll<HTMLElement>(".app-item")) {
    listObserver?.observe(el);
  }
}

export function updateAppListStatus(): void {
  for (const item of document.querySelectorAll<HTMLElement>("#appList .app-item")) {
    const pkg = item.dataset.pkg;
    if (!pkg) continue;
    const app = state.appMap.get(pkg);
    if (!app) continue;

    const badgesHTML = renderBadges(app, pkg);
    const badgeEl = item.querySelector(".app-badges");
    if (badgeEl && badgeEl.innerHTML !== badgesHTML) badgeEl.innerHTML = badgesHTML;

    const injStr = renderInjectedStr(pkg);
    const injEl = item.querySelector(".inj-str");
    if (injEl && injEl.innerHTML !== injStr) injEl.innerHTML = injStr;
  }
}

export function openAppConfig(pkg: string): void {
  state.currentBindingPkg = pkg;
  const app = state.appMap.get(pkg);
  if (!app) return;

  document.getElementById("bindAppName")!.textContent = app.appLabel;
  document.getElementById("bindAppPkg")!.textContent = pkg;

  const tabs = document.getElementById("appUserTabs")!;
  if (state.activeUsers.length <= 1) {
    tabs.style.display = "none";
  } else {
    tabs.style.display = "flex";
    tabs.innerHTML = state.activeUsers
      .map(
        (uid) =>
          `<button class="${uid === state.activeUsers[0] ? "active" : ""}" data-uid="${uid}" onclick="window.switchAppUser(${uid})">User ${uid}</button>`,
      )
      .join("");
  }
  window.switchAppUser(state.activeUsers[0]);
  document.getElementById("appConfigSubpage")!.classList.add("open");
}

export function switchAppUser(uid: number): void {
  state.currentBindingUser = uid;
  for (const btn of document.querySelectorAll("#appUserTabs button")) {
    btn.classList.toggle("active", parseInt((btn as HTMLElement).dataset.uid ?? "") === uid);
  }

  const pkg = state.currentBindingPkg;
  if (!pkg) return;

  const app = state.appMap.get(pkg);
  const uConf = app?.users[uid] || { isEnabled: false, text: "" };
  (document.getElementById("appEnableToggle") as HTMLInputElement).checked = uConf.isEnabled;
  (document.getElementById("appRuleContent") as HTMLTextAreaElement).value = uConf.text;
  parseConfigTextToVisual(uConf.text, "appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null);
  const visualBtn = document.querySelector<HTMLElement>('button[name="appModeToggle"][data-mode="visual"]');
  if (visualBtn) visualBtn.click();
}

export async function flushInjectorConf(): Promise<void> {
  // 读现有文件，只替换 [GLOBAL] 段内容，保留所有非 GLOBAL 段不变
  const existing = await run(`cat ${CONST.INJECTOR_CONF} 2>/dev/null`);
  const lines = existing ? existing.split("\n") : [];

  // 找到 [GLOBAL] 段的起止行索引
  let globalStart = -1;
  let globalEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\[.*?\]/.test(t)) {
      if (/^\[GLOBAL\]/.test(t)) {
        globalStart = i;
      } else if (globalStart >= 0) {
        globalEnd = i;
        break;
      }
    }
  }

  // 构造新的 [GLOBAL] 段
  const newGlobal: string[] = ["[GLOBAL]"];
  if (state.globalConfText.trim()) {
    for (const gl of state.globalConfText.trim().split("\n")) {
      const trimmed = gl.trim();
      if (trimmed) newGlobal.push(trimmed);
    }
  }

  // 组装结果：替换 GLOBAL 段，保留其他所有行
  const result: string[] = [];
  if (globalStart >= 0) {
    result.push(...lines.slice(0, globalStart));
    result.push(...newGlobal);
    result.push(...lines.slice(globalEnd));
  } else {
    // 文件里没有 [GLOBAL]，在最前面插入
    result.push(...newGlobal, ...lines);
  }

  // 更新 app 的 ON/OFF 状态行（injectorStates 中的变更）
  state.injectorStates.forEach((onoff, key) => {
    if (key === "GLOBAL") return;
    const pattern = `[${key}]`;
    for (let i = 0; i < result.length; i++) {
      if (new RegExp(`^\\s*\\${pattern}`).test(result[i])) {
        result[i] = `[${key}] ${onoff}`;
        break;
      }
    }
  });

  const escaped = result.join("\n").trim().replace(/'/g, "'\\''");
  await run(`echo '${escaped}' > ${CONST.INJECTOR_CONF}`);
  if (state.currentSettings.useLogCtl) {
    await logctl.reloadConfig();
  }
}

window.openAppConfig = openAppConfig;
window.switchAppUser = switchAppUser;
