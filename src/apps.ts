import { state, CONST } from "./state.js";
import { run, showToast, ICONS } from "./utils.js";
import { listPackages, getPackagesInfo } from "kernelsu";
import { parseConfigTextToVisual, setupModeToggle } from "./ui.js";
import type { AppEntry, PackageInfo } from "./types/index";

const TRANSPARENT_SPACER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// ── Icon lazy-loading ──

const _iconCache = new Set<string>();
const iconQueue = new Set<HTMLImageElement>();
let isIconQueueRunning = false;

const processIconQueue = async (): Promise<void> => {
  if (isIconQueueRunning) return;
  isIconQueueRunning = true;
  while (iconQueue.size > 0) {
    const img = iconQueue.values().next().value;
    iconQueue.delete(img);
    if (img && img.dataset.src) {
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

// ── Batch loading state ──

let loadedIconsInBatch = 0;
let targetIconCount = 0;
let isTransitioningOut = false;

// These are called from inline event handlers in rendered HTML
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

const checkBatchLoading = (): void => {
  if (isTransitioningOut || !state.isInitialLoad) return;
  loadedIconsInBatch++;
  if (loadedIconsInBatch >= targetIconCount) {
    isTransitioningOut = true;
    hideSpinnerOverlay();
  }
};

const hideSpinnerOverlay = (): void => {
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
  initListObserver();
  const listEl = document.getElementById("appList");
  if (listEl) {
    listEl.querySelectorAll<HTMLElement>(".app-item").forEach((el) => listObserver?.observe(el));
  }
};

// ── Data fetching ──

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
    state.injectedApps.clear();
    const res = await run(`${CONST.LOG_CTL} list-injected api`);
    if (res) {
      res.split("\n").forEach((l) => {
        if (l.startsWith("APP|")) {
          const p = l.split("|");
          if (p.length >= 7) {
            state.injectedApps.set(p[1], {
              pid: p[2],
              uid: p[3],
              redirect: p[4],
              hide: p[5],
              ro: p[6],
            });
          }
        }
      });
    }
  } catch {
    /* ignore */
  }
};

// ── Main data loading ──

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
    state.activeMounts = await fetchActiveMounts();
    await fetchInjectedApps();
    const userRes = await run("pm list users");
    state.activeUsers = [];
    if (userRes) {
      for (const m of userRes.matchAll(/UserInfo\{(\d+):/g)) {
        state.activeUsers.push(parseInt(m[1]));
      }
    }
    if (state.activeUsers.length === 0) state.activeUsers.push(0);

    const injectorConf = await run(`cat ${CONST.INJECTOR_CONF} 2>/dev/null`);
    state.globalConfText = "";
    state.injectorStates.clear();
    state.injectorRulesMap.clear();

    if (injectorConf) {
      let currentSection = "";
      injectorConf.split("\n").forEach((line) => {
        const tLine = line.trim();
        if (!tLine) return;
        const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
        if (secMatch) {
          currentSection = secMatch[1];
          if (currentSection !== "GLOBAL") {
            state.injectorStates.set(currentSection, secMatch[2] || "ON");
          }
          if (!state.injectorRulesMap.has(currentSection)) {
            state.injectorRulesMap.set(currentSection, []);
          }
        } else if (currentSection) {
          state.injectorRulesMap.get(currentSection)!.push(tLine);
        }
      });
      state.globalConfText = (state.injectorRulesMap.get("GLOBAL") || []).join("\n") || "";
    }

    // Read app-specific rule files per user
    const ruleFilesMap = new Map<string, string | boolean>();
    for (const uid of state.activeUsers) {
      const dir = uid === 0 ? `${CONST.BASE_DIR}/App-rules` : `${CONST.BASE_DIR}/App-rules-${uid}`;
      const lsRes = await run(`ls -1 ${dir} 2>/dev/null`);
      if (lsRes) {
        const files = lsRes.split("\n").filter((f) => f.endsWith(".conf") || f.endsWith(".conf.disabled"));
        for (const file of files) {
          const isDisabled = file.endsWith(".conf.disabled");
          const pkg = file.replace(/\.conf(\.disabled)?$/, "");
          ruleFilesMap.set(`${pkg}:${uid}`, await run(`cat ${dir}/${file} 2>/dev/null`));
          if (isDisabled) ruleFilesMap.set(`${pkg}:${uid}_disabled`, true);
          else ruleFilesMap.set(`${pkg}:${uid}_enabled`, true);
        }
      }
    }

    const buildAppMap = (src: PackageInfo[]): void => {
      state.appMap.clear();
      if (!Array.isArray(src)) return;
      src.forEach((info) => {
        if (!info || !info.packageName) return;
        const appUsers: Record<number, { isEnabled: boolean; text: string; hasRules: boolean }> = {};
        let isConfiguredAny = false;
        state.activeUsers.forEach((uid) => {
          const exactKey = `${info.packageName}:${uid}`;
          const stateVal =
            state.injectorStates.get(exactKey) || state.injectorStates.get(info.packageName) || "ON";
          const ruleText = (ruleFilesMap.get(exactKey) as string) || "";
          const hasRulesFile = ruleFilesMap.has(exactKey);
          const isEnabled = ruleFilesMap.get(`${exactKey}_enabled`)
            ? true
            : ruleFilesMap.get(`${exactKey}_disabled`)
              ? false
              : stateVal === "ON" && hasRulesFile;
          if (hasRulesFile || stateVal === "OFF") isConfiguredAny = true;
          appUsers[uid] = {
            isEnabled,
            text: ruleText,
            hasRules:
              /REDIRECT|HIDE|RO|ALLOW/.test(ruleText) ||
              /REDIRECT|HIDE|RO|ALLOW/.test(
                (state.injectorRulesMap.get(exactKey) || []).join(""),
              ),
          };
        });
        const entry: AppEntry = {
          ...info,
          isConfigured: isConfiguredAny,
          users: appUsers,
        };
        state.appMap.set(info.packageName, entry);
      });
    };

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
    buildAppMap(infos);
    if (primaryEmpty || state.appMap.size === 0) {
      const fallbackList = await run(`cat ${CONST.LIST_CONFIG} 2>/dev/null`);
      if (fallbackList) {
        infos = [];
        fallbackList.split("\n").forEach((line) => {
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
        });
        buildAppMap(infos);
        if (state.appMap.size > 0) usedFallback = true;
      }
    }
    state.usingFallback = usedFallback;
    if (usedFallback) showToast.warning("应用列表为空，已回退至兼容模式");

    requestAnimationFrame(() => {
      renderAppList();
      import("./global.js").then(({ renderGlobalRules }) => renderGlobalRules());
    });

    // Preload system app icons
    const sysAppsToPreload = Array.from(state.appMap.values()).filter((a) => a.isSystem).slice(0, 30);
    sysAppsToPreload.forEach((app) => {
      if (!_iconCache.has(app.packageName)) {
        const dummyImg = document.createElement("img");
        dummyImg.dataset.src = `ksu://icon/${app.packageName}`;
        dummyImg.dataset.pkg = app.packageName;
        dummyImg.onload = () => _iconCache.add(app.packageName);
        enqueueIcon(dummyImg);
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast.error("加载异常: " + msg);
  }
};

// ── List observer for virtualization ──

let listObserver: IntersectionObserver | null = null;

const initListObserver = (): void => {
  const rootEl = document.getElementById("appList");
  if (!rootEl) return;
  if (listObserver) listObserver.disconnect();
  listObserver = new IntersectionObserver(
    (entries) => {
      const intersecting = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      entries.forEach((entry) => {
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
      });
    },
    { root: rootEl, threshold: 0.01, rootMargin: "30px" },
  );
};

// ── Render app list ──

export const renderAppList = (): void => {
  const listEl = document.getElementById("appList");
  if (!listEl) return;
  const searchVal = (document.getElementById("appSearch") as HTMLInputElement)?.value?.toLowerCase() ?? "";
  const items = Array.from(state.appMap.values())
    .filter((app) => {
      if (state.usingFallback && app.isSystem) return false;
      if (state.currentAppFilter === "filterUser" && app.isSystem) return false;
      if (state.currentAppFilter === "filterSystem" && !app.isSystem) return false;
      if (state.currentAppFilter === "filterBound" && !app.isConfigured) return false;
      const label = (app.appLabel || app.packageName).toLowerCase();
      return (
        !searchVal ||
        label.includes(searchVal) ||
        app.packageName.toLowerCase().includes(searchVal)
      );
    })
    .sort((a, b) => {
      const confDiff = (b.isConfigured ? 1 : 0) - (a.isConfigured ? 1 : 0);
      return confDiff !== 0 ? confDiff : (a.appLabel || "").localeCompare(b.appLabel || "");
    });

  if (items.length === 0) {
    listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mx-t2);">无匹配应用</div>';
    return;
  }

  isTransitioningOut = false;
  loadedIconsInBatch = 0;
  targetIconCount = Math.min(items.length, 6);
  if (targetIconCount === 0) {
    hideSpinnerOverlay();
  }

  const finalHTML = items
    .map((app) => {
      let badgesHTML = state.activeUsers
        .filter((u) => app.users[u]?.text.trim() || app.users[u]?.hasRules || app.isConfigured)
        .map((u) => {
          const c = app.users[u];
          return `<span class="mx-badge ${c.isEnabled ? "mx-badge-primary" : "mx-badge-gray"}">U${u}${c.isEnabled ? "" : " OFF"}</span>`;
        })
        .join("");

      if (state.activeMounts.has(app.packageName)) {
        badgesHTML += `<span class="mx-badge mx-badge-success">MOUNTED</span>`;
      }

      let injStr = "";
      const inj = state.injectedApps.get(app.packageName);
      if (inj) {
        const flags: string[] = [];
        if (inj.redirect === "1") flags.push('<span style="color:var(--mx-primary);font-weight:800">R</span>');
        if (inj.hide === "1") flags.push('<span style="color:var(--mx-amber);font-weight:800">H</span>');
        if (inj.ro === "1") flags.push('<span style="color:var(--mx-red);font-weight:800">RO</span>');
        injStr = `<span style="font-size:10px;margin-left:6px;padding:2px 6px;background:var(--mx-s3);border-radius:4px;font-family:var(--mx-font-mono);flex-shrink:0;">PID ${inj.pid} ${flags.join(" ")}</span>`;
      }

      const isCached = _iconCache.has(app.packageName);
      const iconSrc = isCached ? `ksu://icon/${app.packageName}` : TRANSPARENT_SPACER;
      const dataSrc = isCached ? "" : `ksu://icon/${app.packageName}`;
      // escape package name for use in onclick
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
    })
    .join("");

  listEl.innerHTML = finalHTML;
  initListObserver();
  listEl.querySelectorAll<HTMLElement>(".app-item").forEach((el) => listObserver?.observe(el));
};

export const updateAppListStatus = (): void => {
  document.querySelectorAll<HTMLElement>("#appList .app-item").forEach((item) => {
    const pkg = item.dataset.pkg;
    if (!pkg) return;
    const app = state.appMap.get(pkg);
    if (!app) return;

    let badgesHTML = state.activeUsers
      .filter((u) => app.users[u]?.text.trim() || app.users[u]?.hasRules || app.isConfigured)
      .map((u) => {
        const c = app.users[u];
        return `<span class="mx-badge ${c.isEnabled ? "mx-badge-primary" : "mx-badge-gray"}">U${u}${c.isEnabled ? "" : " OFF"}</span>`;
      })
      .join("");
    if (state.activeMounts.has(pkg)) {
      badgesHTML += `<span class="mx-badge mx-badge-success">MOUNTED</span>`;
    }

    const badgeEl = item.querySelector(".app-badges");
    if (badgeEl && badgeEl.innerHTML !== badgesHTML) badgeEl.innerHTML = badgesHTML;

    let injStr = "";
    const inj = state.injectedApps.get(pkg);
    if (inj) {
      const flags: string[] = [];
      if (inj.redirect === "1") flags.push('<span style="color:var(--mx-primary);font-weight:800">R</span>');
      if (inj.hide === "1") flags.push('<span style="color:var(--mx-amber);font-weight:800">H</span>');
      if (inj.ro === "1") flags.push('<span style="color:var(--mx-red);font-weight:800">RO</span>');
      injStr = `<span style="font-size:10px;margin-left:6px;padding:2px 6px;background:var(--mx-s3);border-radius:4px;font-family:var(--mx-font-mono);flex-shrink:0;">PID ${inj.pid} ${flags.join(" ")}</span>`;
    }
    const injEl = item.querySelector(".inj-str");
    if (injEl && injEl.innerHTML !== injStr) injEl.innerHTML = injStr;
  });
};

// ── App config subpage ──

export const openAppConfig = (pkg: string): void => {
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
};

export const switchAppUser = (uid: number): void => {
  state.currentBindingUser = uid;
  document.querySelectorAll("#appUserTabs button").forEach((btn) => {
    btn.classList.toggle("active", parseInt((btn as HTMLElement).dataset.uid ?? "") === uid);
  });
  const app = state.appMap.get(state.currentBindingPkg!);
  const uConf = app?.users[uid] || { isEnabled: false, text: "" };
  (document.getElementById("appEnableToggle") as HTMLInputElement).checked = uConf.isEnabled;
  (document.getElementById("appRuleContent") as HTMLTextAreaElement).value = uConf.text;
  parseConfigTextToVisual(uConf.text, "appRuleBuilderContainer", "appMonitorSelect", "appSandboxSelect", null);
  const visualBtn = document.querySelector<HTMLElement>('button[name="appModeToggle"][data-mode="visual"]');
  if (visualBtn) visualBtn.click();
};

export const flushInjectorConf = async (): Promise<void> => {
  let r = `[GLOBAL]\n${state.globalConfText.trim() ? state.globalConfText.trim() + "\n" : ""}`;
  state.injectorStates.forEach((s, k) => {
    if (k === "GLOBAL") return;
    r += `[${k}] ${s}\n`;
    const il = state.injectorRulesMap.get(k) || [];
    if (il.length > 0) r += il.join("\n") + "\n";
  });
  const escaped = r.trim().replace(/'/g, "'\\''");
  await run(`echo '${escaped}' > ${CONST.INJECTOR_CONF}`);
};

// Expose to global scope for inline event handlers
window.openAppConfig = openAppConfig;
window.switchAppUser = switchAppUser;
