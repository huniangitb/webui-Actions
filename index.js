import './style.css';
import { exec, fullScreen, enableEdgeToEdge, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { getSettings, saveSettings, checkPluginInstalled, syncToPlugin } from './plugin.js';
import { 
    mdiMathLog, mdiViewGridOutline, mdiMonitorDashboard, mdiWrench,
    mdiMagnify, mdiCog, mdiClose, mdiPlus, mdiDeleteOutline, 
    mdiWeatherNight, mdiWhiteBalanceSunny, mdiStopCircleOutline, mdiPlayCircleOutline,
    mdiFolderOutline, mdiFileOutline, mdiEyeOffOutline, mdiDeleteSweepOutline
} from '@mdi/js';

// Setup KernelSU immersive mode
try { fullScreen(true); enableEdgeToEdge(true); } catch(e) {}

const BASE_DIR = "/data/Namespace-Proxy";
const INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const MONITOR_IGNORE_CONF = `${BASE_DIR}/monitor_ignore.conf`;
const LIST_CONFIG = `${BASE_DIR}/list.config`;
const LOG_CTL = "/data/adb/modules/Namespace-Proxy/bin/log_ctl";
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
const PATH_PREFIX_STORAGE = '/storage/emulated/0';
const PATH_PREFIX_REAL = '/data/media/0';

let appMap = new Map();
let globalConfText = "";
let injectorStates = new Map();
let injectorRulesMap = new Map();
let currentSettings = { autoTheme: true, syncPlugin: false };

let activeUsers = [0];
let activeMounts = new Set();
let injectedApps = new Map();
let statusPolling = null;
let currentAppFilter = 'filterUser';
let currentPid = null;
let currentBindingPkg = null;
let currentBindingUser = 0;

const PAGE_LIMIT = 50;
let ioState = { offset: 0, loading: false, hasMore: true, term: '' };
let sysState = { offset: 0, loading: false, hasMore: true, term: '' };

let isDarkMode = true;
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Icon helper
const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}"><path d="${path}" fill="${color}" stroke="none"/></svg>`;

const ICONS = {
    APPS: getSvg(mdiViewGridOutline),
    GLOBAL: getSvg(mdiWrench), // Replaced to Wrench
    IO: getSvg(mdiMonitorDashboard),
    LOG: getSvg(mdiMathLog),
    SEARCH: getSvg(mdiMagnify, 18, 'var(--mx-t2)'),
    COG: getSvg(mdiCog),
    CLOSE: getSvg(mdiClose),
    PLUS: getSvg(mdiPlus, 18),
    DELETE: getSvg(mdiDeleteOutline, 18),
    MOON: getSvg(mdiWeatherNight),
    SUN: getSvg(mdiWhiteBalanceSunny),
    STOP: getSvg(mdiStopCircleOutline, 24, 'var(--mx-red)'),
    PLAY: getSvg(mdiPlayCircleOutline, 24, 'var(--mx-green)'),
    FOLDER: getSvg(mdiFolderOutline, 16),
    FILE: getSvg(mdiFileOutline, 16),
    IGNORE: getSvg(mdiEyeOffOutline),
    SWEEP: getSvg(mdiDeleteSweepOutline)
};

const showToast = (msg) => {
    try { toast(msg); } catch(e) {}
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'mx-toast'; t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
};

const run = async (cmd) => { try { const res = await exec(cmd); return (res.errno === 0 && res.stdout) ? res.stdout.trim() : ""; } catch (e) { return ""; } };
const debounce = (func, wait) => { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; };

// Render Icons
const initIcons = () => {
    document.getElementById('logoIconMobile').innerHTML = ICONS.APPS;
    document.getElementById('logoIconDesktop').innerHTML = ICONS.APPS;
    
    document.getElementById('navIconApps').innerHTML = ICONS.APPS;
    document.getElementById('navIconGlobal').innerHTML = ICONS.GLOBAL;
    document.getElementById('navIconIo').innerHTML = ICONS.IO;
    document.getElementById('navIconLog').innerHTML = ICONS.LOG;
    
    document.getElementById('btmIconApps').innerHTML = ICONS.APPS;
    document.getElementById('btmIconGlobal').innerHTML = ICONS.GLOBAL;
    document.getElementById('btmIconIo').innerHTML = ICONS.IO;
    document.getElementById('btmIconLog').innerHTML = ICONS.LOG;

    document.getElementById('iconSearch').innerHTML = ICONS.SEARCH;
    document.getElementById('iconIoSearch').innerHTML = ICONS.SEARCH;
    
    document.getElementById('btnSettingsMobile').innerHTML = ICONS.COG;
    document.getElementById('btnSettingsDesktop').innerHTML = ICONS.COG;
    
    document.getElementById('btnCloseAppModal').innerHTML = ICONS.CLOSE;
    
    document.getElementById('btnGlobalAddRule').innerHTML = `${ICONS.PLUS} 添加规则`;
    document.getElementById('btnAppAddRule').innerHTML = `${ICONS.PLUS} 添加规则`;
    document.getElementById('btnAddIgnoreRow').innerHTML = `添加路径`;
    
    document.getElementById('btnMonitorIgnore').innerHTML = ICONS.IGNORE;
    document.getElementById('btnClearIo').innerHTML = ICONS.SWEEP;
};

// Theme Management
const updateThemeIcons = () => {
    const icon = isDarkMode ? ICONS.SUN : ICONS.MOON;
    document.getElementById('btnThemeToggleMobile').innerHTML = icon;
    document.getElementById('btnThemeToggleDesktop').innerHTML = icon;
};

const applyTheme = (isDark) => {
    isDarkMode = isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    updateThemeIcons();
};

const systemThemeListener = (e) => {
    if (currentSettings.autoTheme) applyTheme(e.matches);
};

const handleManualThemeToggle = () => {
    if (currentSettings.autoTheme) {
        currentSettings.autoTheme = false;
        document.getElementById('autoThemeToggle').checked = false;
        saveSettings(currentSettings);
        showToast("已关闭系统深色模式跟随");
    }
    applyTheme(!isDarkMode);
};

// Navigation
const switchSection = (sectionId) => {
    document.querySelectorAll('.demo-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`sec-${sectionId}`).classList.add('active');
    
    document.querySelectorAll('.mx-nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === sectionId));
    document.querySelectorAll('.mx-btm-item').forEach(el => el.classList.toggle('active', el.dataset.section === sectionId));
    
    const titles = { apps: '应用配置', global: '全局规则', io: '系统监控', log: '运行日志' };
    document.getElementById('breadcrumbTitle').textContent = titles[sectionId];
    
    if (sectionId === 'io') { ioState.offset=0; ioState.hasMore=true; document.getElementById('ioLogList').innerHTML=''; fetchIoLogs(); }
    if (sectionId === 'log') { if(document.getElementById('logSourceSelect').value==='internal'){sysState.offset=0; sysState.hasMore=true; document.getElementById('logViewer').innerHTML='';} fetchSysLogs(); }
};

document.addEventListener('DOMContentLoaded', async () => {
    initIcons();
    
    // Load Settings
    currentSettings = await getSettings();
    document.getElementById('autoThemeToggle').checked = currentSettings.autoTheme;
    document.getElementById('pluginSyncToggle').checked = currentSettings.syncPlugin;
    
    if (currentSettings.autoTheme) applyTheme(mediaQuery.matches);
    mediaQuery.addEventListener('change', systemThemeListener);

    document.getElementById('btnThemeToggleMobile').onclick = handleManualThemeToggle;
    document.getElementById('btnThemeToggleDesktop').onclick = handleManualThemeToggle;
    
    document.querySelectorAll('.mx-nav-item, .mx-btm-item').forEach(btn => {
        btn.onclick = () => switchSection(btn.dataset.section);
    });

    document.querySelectorAll('#appFilterGroup button').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#appFilterGroup button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentAppFilter = btn.dataset.filter;
            renderAppList();
        };
    });

    document.getElementById('appSearch').addEventListener('input', debounce(renderAppList, 250));

    // IO
    const ioContainer = document.getElementById('ioLogContainer');
    document.getElementById('ioSearch').addEventListener('input', debounce(() => {
        ioState.offset = 0; ioState.hasMore = true;
        ioState.term = document.getElementById('ioSearch').value.trim();
        document.getElementById('ioLogList').innerHTML = '';
        fetchIoLogs();
    }, 500));
    ioContainer.addEventListener('scroll', () => {
        if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) fetchIoLogs();
    });
    document.getElementById('btnClearIo').onclick = async () => {
        await run(`${LOG_CTL} clear-io`); showToast("监控记录已清理");
        ioState.offset = 0; ioState.hasMore = true; document.getElementById('ioLogList').innerHTML = ''; fetchIoLogs();
    };

    // Log
    const logSelect = document.getElementById('logSourceSelect');
    const logViewer = document.getElementById('logViewer');
    logSelect.addEventListener('change', () => {
        sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; fetchSysLogs();
    });
    logViewer.addEventListener('scroll', () => {
        if (logSelect.value === 'internal' && logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50) fetchSysLogs();
    });
    document.getElementById('btnClearLog').onclick = async () => {
        if (logSelect.value === 'zygisk') await run("logcat -c");
        else await run(`${LOG_CTL} clear-sys`);
        showToast("日志已清空");
        if (logSelect.value === 'internal') { sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; }
        fetchSysLogs();
    };

    document.getElementById('btnToggleStatusMobile').onclick = toggleStatus;
    document.getElementById('btnToggleStatusDesktop').onclick = toggleStatus;

    // Settings
    const openSettings = async () => {
        const isInstalled = await checkPluginInstalled();
        const lbl = document.getElementById('pluginStatusLabel');
        lbl.textContent = isInstalled ? "状态: 发现清理插件 (已就绪)" : "状态: 未发现清理插件";
        lbl.style.color = isInstalled ? "var(--mx-green)" : "var(--mx-red)";
        document.getElementById('settingsModal').classList.add('open');
    };
    document.getElementById('btnSettingsMobile').onclick = openSettings;
    document.getElementById('btnSettingsDesktop').onclick = openSettings;
    document.getElementById('btnSaveSettings').onclick = async () => {
        currentSettings.autoTheme = document.getElementById('autoThemeToggle').checked;
        currentSettings.syncPlugin = document.getElementById('pluginSyncToggle').checked;
        await saveSettings(currentSettings);
        if (currentSettings.autoTheme) applyTheme(mediaQuery.matches);
        showToast("设置已保存"); document.getElementById('settingsModal').classList.remove('open');
        await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
    };

    // Ignore Settings
    document.getElementById('btnMonitorIgnore').onclick = async () => {
        const content = await run(`cat ${MONITOR_IGNORE_CONF} 2>/dev/null`);
        document.getElementById('monitorIgnoreContent').value = content;
        parseIgnoreToVisual(content); document.getElementById('monitorIgnoreModal').classList.add('open');
    };
    document.getElementById('btnAddIgnoreRow').onclick = () => addIgnoreRow('');
    document.getElementById('btnSaveIgnore').onclick = async () => {
        try {
            const isVisual = document.querySelector('button[name="ignoreModeToggle"][data-mode="visual"]').classList.contains('active');
            const content = isVisual ? generateIgnoreFromVisual() : document.getElementById('monitorIgnoreContent').value;
            await exec(`echo '${content.trim()}' > ${MONITOR_IGNORE_CONF}`);
            showToast("过滤配置已保存"); document.getElementById('monitorIgnoreModal').classList.remove('open');
        } catch (e) { showToast("保存失败"); }
    };

    setupModeToggle('globalModeToggle', 'globalVisual', 'globalRaw', 'globalRuleContent', 
        (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect'),
        () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect')
    );
    setupModeToggle('appModeToggle', 'appVisual', 'appRaw', 'appRuleContent', 
        (val) => parseConfigTextToVisual(val, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null),
        () => generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null)
    );
    setupModeToggle('ignoreModeToggle', 'ignoreVisual', 'ignoreRaw', 'monitorIgnoreContent', parseIgnoreToVisual, generateIgnoreFromVisual);

    document.getElementById('btnSaveGlobal').onclick = async () => {
        try {
            const isVisual = document.querySelector('button[name="globalModeToggle"][data-mode="visual"]').classList.contains('active');
            globalConfText = isVisual ? generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect') : document.getElementById('globalRuleContent').value;
            await flushInjectorConf(); showToast("全局规则已保存"); await loadData(); await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
        } catch (e) { showToast("保存失败"); }
    };
    
    document.getElementById('btnGlobalAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'globalRuleBuilderContainer');
    document.getElementById('btnAppAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'appRuleBuilderContainer');

    document.getElementById('btnCloseAppModal').onclick = () => document.getElementById('appConfigModal').classList.remove('open');
    document.getElementById('btnSaveAppConfig').onclick = async () => {
        try {
            const isVisual = document.querySelector('button[name="appModeToggle"][data-mode="visual"]').classList.contains('active');
            const text = isVisual ? generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null) : document.getElementById('appRuleContent').value;
            const isEnabled = document.getElementById('appEnableToggle').checked;
            const exactKey = `${currentBindingPkg}:${currentBindingUser}`;
            
            if (!isEnabled) injectorStates.set(exactKey, 'OFF'); else injectorStates.set(exactKey, 'ON');
            const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
            await run(`mkdir -p ${dir}`);
            if (isEnabled) { await exec(`echo '${text.trim().replace(/'/g, "'\\''")}' > ${dir}/${currentBindingPkg}.conf`); await run(`rm -f ${dir}/${currentBindingPkg}.conf.disabled`); } 
            else { await exec(`echo '${text.trim().replace(/'/g, "'\\''")}' > ${dir}/${currentBindingPkg}.conf.disabled`); await run(`rm -f ${dir}/${currentBindingPkg}.conf`); }
            
            await flushInjectorConf(); showToast("配置已保存"); document.getElementById('appConfigModal').classList.remove('open');
            await loadData(); await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
        } catch (e) { showToast("保存失败"); }
    };

    document.getElementById('btnDeleteAppConfig').onclick = async () => {
        if (!confirm(`确定清除配置吗?`)) return;
        const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
        await run(`rm -f ${dir}/${currentBindingPkg}.conf ${dir}/${currentBindingPkg}.conf.disabled`);
        injectorStates.delete(`${currentBindingPkg}:${currentBindingUser}`);
        await flushInjectorConf(); await loadData(); await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
        showToast("配置已清除"); document.getElementById('appConfigModal').classList.remove('open');
    };

    loadData(); checkStatus(); statusPolling = setInterval(checkStatus, 2000);
    const closeBtns = document.querySelectorAll('.mx-btn-close');
    closeBtns.forEach(btn => btn.innerHTML = ICONS.CLOSE);
});

// Setup Mode Toggles
const setupModeToggle = (groupName, visualId, rawId, contentId, parseFunc, genFunc) => {
    document.querySelectorAll(`button[name="${groupName}"]`).forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(`button[name="${groupName}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (btn.dataset.mode === 'visual') {
                parseFunc(document.getElementById(contentId).value);
                document.getElementById(rawId).classList.remove('active'); document.getElementById(visualId).classList.add('active');
            } else {
                document.getElementById(contentId).value = genFunc();
                document.getElementById(visualId).classList.remove('active'); document.getElementById(rawId).classList.add('active');
            }
        };
    });
};

const loadData = async () => {
    try {
        activeMounts = await fetchActiveMounts(); await fetchInjectedApps();
        const userRes = await run("pm list users"); activeUsers = [];
        if (userRes) { for (const m of userRes.matchAll(/UserInfo\{(\d+):/g)) activeUsers.push(parseInt(m[1])); }
        if (activeUsers.length === 0) activeUsers.push(0);

        const injectorConf = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        globalConfText = ""; injectorStates.clear(); injectorRulesMap.clear();
        if (injectorConf) {
            let currentSection = "";
            injectorConf.split('\n').forEach(line => {
                const tLine = line.trim(); if (!tLine) return;
                const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
                if (secMatch) { currentSection = secMatch[1]; if (currentSection !== 'GLOBAL') injectorStates.set(currentSection, secMatch[2] || "ON"); if (!injectorRulesMap.has(currentSection)) injectorRulesMap.set(currentSection, []); } 
                else if (currentSection) injectorRulesMap.get(currentSection).push(tLine);
            });
            globalConfText = (injectorRulesMap.get('GLOBAL') || []).join('\n');
        }

        let ruleFilesMap = new Map();
        for (const uid of activeUsers) {
            const dir = uid === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${uid}`;
            const lsRes = await run(`ls -1 ${dir} 2>/dev/null`);
            if (lsRes) {
                const files = lsRes.split('\n').filter(f => f.endsWith('.conf') || f.endsWith('.conf.disabled'));
                for (const file of files) {
                    const isDisabled = file.endsWith('.conf.disabled');
                    const pkg = file.replace(/\.conf(\.disabled)?$/, '');
                    ruleFilesMap.set(`${pkg}:${uid}`, await run(`cat ${dir}/${file} 2>/dev/null`));
                    if (isDisabled) ruleFilesMap.set(`${pkg}:${uid}_disabled`, true); else ruleFilesMap.set(`${pkg}:${uid}_enabled`, true);
                }
            }
        }

        let infos = [];
        try {
            const allPkgs = [...new Set([...(await listPackages('user')||[]), ...(await listPackages('system')||[])])];
            if (allPkgs.length > 0) infos = await getPackagesInfo(allPkgs);
        } catch (e) {}

        if (!Array.isArray(infos) || infos.length === 0) {
            const fallbackList = await run(`cat ${LIST_CONFIG} 2>/dev/null`);
            if (fallbackList) fallbackList.split('\n').forEach(line => {
                const tl = line.trim(); if (tl && !tl.startsWith('#') && tl.includes('=')) {
                    const pkg = tl.substring(0, tl.indexOf('=')).trim();
                    if (pkg) infos.push({ packageName: pkg, appLabel: tl.substring(tl.indexOf('=') + 1).trim() || pkg, isSystem: false });
                }
            });
        }

        appMap.clear();
        infos.forEach(info => {
            if (!info || !info.packageName) return;
            let appUsers = {}, isConfiguredAny = false;
            activeUsers.forEach(uid => {
                const exactKey = `${info.packageName}:${uid}`;
                let state = injectorStates.get(exactKey) || injectorStates.get(info.packageName) || "ON";
                const ruleText = ruleFilesMap.get(exactKey) || "", hasRulesFile = ruleFilesMap.has(exactKey);
                const isEnabled = ruleFilesMap.get(`${exactKey}_enabled`) ? true : (ruleFilesMap.get(`${exactKey}_disabled`) ? false : (state === 'ON' && hasRulesFile));
                if (hasRulesFile || state === 'OFF') isConfiguredAny = true;
                appUsers[uid] = { isEnabled, text: ruleText, hasRules: /REDIRECT|HIDE|RO|ALLOW/.test(ruleText) || /REDIRECT|HIDE|RO|ALLOW/.test((injectorRulesMap.get(exactKey)||[]).join('')) };
            });
            appMap.set(info.packageName, { ...info, isConfigured: isConfiguredAny, users: appUsers });
        });

        renderAppList(); renderGlobalRules();
    } catch (e) { showToast("加载异常: " + e.message); }
};

const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const searchVal = document.getElementById('appSearch').value.toLowerCase();
    
    const items = Array.from(appMap.values()).filter(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return false;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return false;
        if (currentAppFilter === 'filterBound' && !app.isConfigured) return false;
        const label = (app.appLabel || app.packageName).toLowerCase();
        return !searchVal || label.includes(searchVal) || app.packageName.toLowerCase().includes(searchVal);
    }).sort((a, b) => (!!b.isConfigured - !!a.isConfigured) || (a.appLabel || "").localeCompare(b.appLabel || ""));
    
    if (items.length === 0) { listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mx-t2);">无匹配应用</div>'; return; }

    listEl.innerHTML = items.map(app => {
        let badgesHTML = activeUsers.filter(u => app.users[u].text.trim() || app.users[u].hasRules || app.isConfigured).map(u => {
            const c = app.users[u]; return `<span class="mx-badge ${c.isEnabled?'mx-badge-primary':'mx-badge-gray'}">U${u}${c.isEnabled?'':' OFF'}</span>`;
        }).join('');
        if (activeMounts.has(app.packageName)) badgesHTML += `<span class="mx-badge mx-badge-success">MOUNTED</span>`;
        
        let injStr = ""; const inj = injectedApps.get(app.packageName);
        if (inj) {
            let flags = [];
            if (inj.redirect === '1') flags.push('<span style="color:var(--mx-primary);font-weight:800">R</span>');
            if (inj.hide === '1') flags.push('<span style="color:var(--mx-amber);font-weight:800">H</span>');
            if (inj.ro === '1') flags.push('<span style="color:var(--mx-red);font-weight:800">RO</span>');
            injStr = `<span style="font-size:10px;margin-left:6px;padding:2px 6px;background:var(--mx-s3);border-radius:4px;font-family:var(--mx-font-mono);flex-shrink:0;">PID ${inj.pid} ${flags.join(' ')}</span>`;
        }
        return `<div class="app-item" onclick="openAppConfig('${app.packageName}')">
            <img class="app-icon" src="ksu://icon/${app.packageName}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'%2365676b\\'><path d=\\'M17.6,9.48l1.84-3.18c0.16-0.31,0.04-0.69-0.26-0.85c-0.31-0.16-0.69-0.04-0.85,0.26L16.4,9c-1.35-0.6-2.85-0.95-4.4-0.95S8.95,8.4,7.6,9L5.67,5.71C5.51,5.41,5.13,5.29,4.83,5.45C4.52,5.61,4.4,6,4.56,6.3L6.4,9.48C3.3,11.25,1.28,14.44,1,18.15h22C22.72,14.44,20.7,11.25,17.6,9.48z M7,15.25c-0.69,0-1.25-0.56-1.25-1.25S6.31,12.75,7,12.75s1.25,0.56,1.25,1.25S7.69,15.25,7,15.25z M17,15.25c-0.69,0-1.25-0.56-1.25-1.25s0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25S17.69,15.25,17,15.25z\\'/></svg>'" />
            <div class="app-info"><div class="app-name" style="display:flex;align-items:center;"><span style="overflow:hidden;text-overflow:ellipsis;">${app.appLabel}</span>${injStr}</div><div class="app-pkg">${app.packageName}</div></div>
            <div class="app-badges">${badgesHTML}</div></div>`;
    }).join('');
};

const renderGlobalRules = () => { document.getElementById('globalRuleContent').value = globalConfText; parseConfigTextToVisual(globalConfText, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect'); };

const parseConfigTextToVisual = (text, containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
    const container = document.getElementById(containerId); container.innerHTML = '';
    const selMonitor = document.getElementById(monitorSelectId); if(selMonitor) selMonitor.value="";
    const selSandbox = document.getElementById(sandboxSelectId); if(selSandbox) selSandbox.value="";
    const selInject = document.getElementById(injectSelectId); if(selInject) selInject.value="";

    if (text) {
        text.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'REDIRECT' && parts.length >= 3) addRuleRow('REDIRECT', normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(' ')), containerId);
            else if (['HIDE', 'RO', 'ALLOW'].includes(parts[0]) && parts.length >= 2) addRuleRow(parts[0], normalizeToDisplay(parts[1]), '', containerId);
            else if (parts[0] === 'MONITOR' && selMonitor) selMonitor.value = parts[1];
            else if (parts[0] === 'SANDBOX' && selSandbox) selSandbox.value = parts[1];
            else if (parts[0] === 'GLOBAL_INJECT' && selInject) selInject.value = parts[1];
        });
    }
};

const generateConfigTextFromVisual = (containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
    let res = "";
    const selInject = document.getElementById(injectSelectId); if (selInject && selInject.value) res += `GLOBAL_INJECT ${selInject.value}\n`;
    const selMonitor = document.getElementById(monitorSelectId); if (selMonitor && selMonitor.value) res += `MONITOR ${selMonitor.value}\n`;
    const selSandbox = document.getElementById(sandboxSelectId); if (selSandbox && selSandbox.value) res += `SANDBOX ${selSandbox.value}\n`;

    document.querySelectorAll(`#${containerId} .rule-row`).forEach(row => {
        const type = row.querySelector('.rule-type').value, target = row.querySelector('.rule-target').value.trim(), source = row.querySelector('.rule-source').value.trim();
        if (target) {
            if (type === 'REDIRECT' && source) res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
            else if (['HIDE', 'RO', 'ALLOW'].includes(type)) res += `${type} ${normalizeToConfig(target, true)}\n`;
        }
    });
    return res.trim();
};

const addRuleRow = (type, target, source, containerId) => {
    const div = document.createElement('div'); div.className = 'rule-row';
    div.innerHTML = `<select class="mx-select rule-type flex-shrink-0" style="width:90px; padding:8px 24px 8px 8px; font-size:12px;"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option><option value="RO">只读</option><option value="ALLOW">豁免</option></select>
        <div class="rule-inputs"><input type="text" class="mx-input rule-target" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="原始路径" value="${target}"><input type="text" class="mx-input rule-source ${type!=='REDIRECT'?'hidden':''}" style="padding:6px; background:var(--mx-s1); border-radius:6px; font-size:12px;" placeholder="重定向至" value="${source}"></div>
        <button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
    const select = div.querySelector('.rule-type'); select.value = type;
    select.onchange = (e) => div.querySelector('.rule-source').classList.toggle('hidden', e.target.value !== 'REDIRECT');
    div.querySelector('.btn-del').onclick = () => div.remove();
    setupAutocomplete(div.querySelector('.rule-target')); setupAutocomplete(div.querySelector('.rule-source'));
    document.getElementById(containerId).appendChild(div);
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg; const app = appMap.get(pkg); if (!app) return;
    document.getElementById('bindAppName').textContent = app.appLabel; document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('appUserTabs').innerHTML = activeUsers.map(uid => `<button class="${uid === activeUsers[0] ? 'active' : ''}" data-uid="${uid}" onclick="window.switchAppUser(${uid})">User ${uid}</button>`).join('');
    window.switchAppUser(activeUsers[0]); document.getElementById('appConfigModal').classList.add('open');
};

window.switchAppUser = (uid) => {
    currentBindingUser = uid; document.querySelectorAll('#appUserTabs button').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.uid) === uid));
    const app = appMap.get(currentBindingPkg), uConf = app.users[uid] || { isEnabled: false, text: '' };
    document.getElementById('appEnableToggle').checked = uConf.isEnabled; document.getElementById('appRuleContent').value = uConf.text;
    parseConfigTextToVisual(uConf.text, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null);
    const visualBtn = document.querySelector('button[name="appModeToggle"][data-mode="visual"]'); if (visualBtn) visualBtn.click();
};

const fetchIoLogs = async () => {
    if (ioState.loading || !ioState.hasMore) return; ioState.loading = true; document.getElementById('ioLoadingIndicator').classList.remove('hidden');
    try {
        const res = await run(`${LOG_CTL} search-io "${ioState.term}" ${PAGE_LIMIT} ${ioState.offset} api`);
        if (!res) ioState.hasMore = false;
        else {
            const lines = res.split('\n'); let dataLines = lines; const lastLine = lines[lines.length - 1];
            if (lastLine.startsWith('DONE|')) { ioState.hasMore = parseInt(lastLine.split('|')[2]) > 0; dataLines = lines.slice(0, -1); } 
            else if (lastLine === 'OK') { ioState.hasMore = false; dataLines = lines.slice(0, -1); }
            if (dataLines.length > 0) { ioState.offset += dataLines.length; renderIoRows(dataLines); } else if (ioState.offset === 0) document.getElementById('ioLogList').innerHTML = '<div style="padding:40px;text-align:center;color:var(--mx-t2);">暂无记录</div>';
        }
    } catch (e) { ioState.hasMore = false; } finally { ioState.loading = false; document.getElementById('ioLoadingIndicator').classList.add('hidden'); }
};

const renderIoRows = (lines) => {
    const listEl = document.getElementById('ioLogList');
    if (listEl.innerHTML.includes('暂无记录')) listEl.innerHTML = '';
    
    const html = lines.map(line => {
        if (!line.trim()) return '';
        const parts = line.split('|');
        if (parts.length < 2) return '';

        let timeStr = "--:--:--";
        const rawTs = parts[0];

        // 1. 如果是 Unix 时间戳
        if (/^\d+$/.test(rawTs)) {
            const d = new Date(parseInt(rawTs) * 1000);
            if (!isNaN(d)) timeStr = d.toLocaleTimeString('zh-CN', { hour12: false });
        } 
        // 2. 如果是 "YYYY-MM-DD HH:MM:SS" 格式
        else if (rawTs.includes(' ')) {
            // 通过空格分割，直接获取后面的 HH:MM:SS 部分
            const dt = rawTs.split(' ');
            timeStr = dt[1] || dt[0];
        }
        // 3. 其他情况原样使用
        else {
            timeStr = rawTs;
        }

        let pkg = "未知", op = "INFO", details = parts.slice(1).join('|');
        const m = details.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
        if (m) { pkg = m[1]; op = m[2]; details = m[3]; }
        const appName = appMap.has(pkg) ? appMap.get(pkg).appLabel : pkg;

        return `
        <div class="io-item">
            <div class="io-header">
                <span class="io-time">${timeStr}</span>
                <span class="io-app">${appName}</span>
                <span class="io-op op-${op}">${op}</span>
            </div>
            <div class="io-detail">${details}</div>
        </div>`;
    }).join('');
    listEl.insertAdjacentHTML('beforeend', html);
};

const fetchSysLogs = async () => {
    const source = document.getElementById('logSourceSelect').value, viewer = document.getElementById('logViewer');
    if (source === 'zygisk') { viewer.textContent = await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector") || "无 Zygisk 日志"; viewer.scrollTop = viewer.scrollHeight; return; }
    if (sysState.loading || !sysState.hasMore) return; sysState.loading = true;
    try {
        const res = await run(`${LOG_CTL} search-sys "" ${PAGE_LIMIT} ${sysState.offset} api`);
        if (!res) sysState.hasMore = false;
        else {
            const lines = res.split('\n'); let dataLines = lines; const lastLine = lines[lines.length - 1];
            if (lastLine.startsWith('DONE|')) { sysState.hasMore = parseInt(lastLine.split('|')[2]) > 0; dataLines = lines.slice(0, -1); } else if (lastLine === 'OK') { sysState.hasMore = false; dataLines = lines.slice(0, -1); }
            // 在 fetchSysLogs 函数内部
if (dataLines.length > 0) {
    sysState.offset += dataLines.length;
    viewer.insertAdjacentHTML('beforeend', dataLines.map(line => {
        // 尝试匹配带 Tag 的格式: YYYY-MM-DD HH:MM:SS|[Tag]Message
        const matchTag = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|\[(.*?)\](.*)$/);
        // 尝试匹配仅包含时间的格式: YYYY-MM-DD HH:MM:SS Message
        const matchSimple = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(.*)$/);

        if (matchTag) {
            return `<div class="sys-log-item">
                <div class="sys-log-header">
                    <span class="sys-log-time">${matchTag[1]}</span>
                    <span class="sys-log-tag">[${matchTag[2]}]</span>
                </div>
                <div class="sys-log-msg">${matchTag[3]}</div>
            </div>`;
        } else if (matchSimple) {
            return `<div class="sys-log-item">
                <div class="sys-log-header">
                    <span class="sys-log-time">${matchSimple[1]}</span>
                </div>
                <div class="sys-log-msg">${matchSimple[2]}</div>
            </div>`;
        }
        // 如果完全不匹配格式，原样输出
        return `<div class="sys-log-raw">${line}</div>`;
    }).join(''));
}
        }
    } catch (e) { sysState.hasMore = false; } finally { sysState.loading = false; }
};

const checkStatus = async () => {
    try {
        let pid = await run("pidof injector") || await run("pgrep -x injector"); currentPid = pid ? pid.split(' ')[0] : null;
        ['Mobile', 'Desktop'].forEach(s => {
            const b = document.getElementById('statusBadge'+s), btn = document.getElementById('btnToggleStatus'+s);
            if(b && btn) { if (currentPid) { b.className="mx-badge mx-badge-success"; b.textContent="RUNNING"; btn.innerHTML=ICONS.STOP; } else { b.className="mx-badge mx-badge-gray"; b.textContent="STOPPED"; btn.innerHTML=ICONS.PLAY; } }
        });
        const info = document.getElementById('statusInfo'); if(info) info.textContent = currentPid ? `PID ${currentPid}` : "OFFLINE";
    } catch (e) {}
};

const toggleStatus = async () => { if (currentPid) { await run(`kill -15 ${currentPid}`); showToast("发送停止信号..."); } else { await run(`sh ${SERVICE_SH}`); showToast("启动服务..."); setTimeout(loadData, 1000); } setTimeout(checkStatus, 500); };

const normalizeToDisplay = (path) => { if (!path) return ""; if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/"; if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/"; return path; };
const normalizeToConfig = (path, isT) => { if (!path) return ""; path = path.trim(); if (isT) { if (path.startsWith('/')) return path; return (PATH_PREFIX_STORAGE + '/' + path).replace(/\/+/g, '/'); } else { if (path.startsWith('/')) return path; return (PATH_PREFIX_REAL + '/' + path).replace(/\/+/g, '/'); } };
const fetchActiveMounts = async () => { const m = new Set(); try { const args = await run("ps -A -o args | grep fuse_daemon | grep -v grep"); if (args) args.split('\n').forEach(l => { const mt = l.match(/--pkg=([a-zA-Z0-9._]+)/); if (mt) m.add(mt[1]); }); } catch(e){} return m; };
const fetchInjectedApps = async () => { try { injectedApps.clear(); const res = await run(`${LOG_CTL} list-injected api`); if (res) res.split('\n').forEach(l => { if (l.startsWith('APP|')) { const p = l.split('|'); if (p.length >= 7) injectedApps.set(p[1], {pid:p[2], uid:p[3], redirect:p[4], hide:p[5], ro:p[6]}); }}); } catch(e){} };
const flushInjectorConf = async () => { let r = `[GLOBAL]\n${globalConfText.trim() ? globalConfText.trim()+'\n' : ''}`; injectorStates.forEach((s, k) => { if(k==='GLOBAL') return; r+=`[${k}] ${s}\n`; const il=injectorRulesMap.get(k)||[]; if(il.length>0) r+=il.join('\n')+'\n'; }); await exec(`echo '${r.trim().replace(/'/g, "'\\''")}' > ${INJECTOR_CONF}`); };

const parseIgnoreToVisual = (t) => { const c = document.getElementById('ignoreBuilderContainer'); c.innerHTML=''; if(t) t.split('\n').forEach(l=>{const v=l.trim(); if(v&&!v.startsWith('#')) addIgnoreRow(v);}); if(c.children.length===0) addIgnoreRow(''); };
const generateIgnoreFromVisual = () => { let r=""; document.querySelectorAll('#ignoreBuilderContainer input').forEach(i=>{const v=i.value.trim(); if(v) r+=`${v}\n`;}); return r.trim(); };
const addIgnoreRow = (p) => {
    const div = document.createElement('div'); div.className='rule-row flex-shrink-0';
    div.innerHTML = `<input type="text" class="mx-input" style="background:var(--mx-s1); border-radius:6px; font-size:12px; padding:6px;" placeholder="要忽略的路径前缀" value="${p}"><button class="mx-btn-icon btn-del flex-shrink-0">${ICONS.DELETE}</button>`;
    div.querySelector('.btn-del').onclick = () => div.remove(); setupAutocomplete(div.querySelector('input'));
    document.getElementById('ignoreBuilderContainer').appendChild(div);
};

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    input.addEventListener('input', debounce(async (e) => {
        const val = e.target.value; let pDir=PATH_PREFIX_REAL+'/', sPre="", dBase="/"; const cVal = val?val.replace(/^\/+/, ''):"";
        if(cVal) { const ls = cVal.lastIndexOf('/'); if(ls===-1) sPre=cVal; else { pDir=PATH_PREFIX_REAL+'/'+cVal.substring(0,ls+1); sPre=cVal.substring(ls+1); dBase="/"+cVal.substring(0,ls+1); } }
        try {
            const res = await exec(`ls -F -1 "${pDir.replace(/\/+/g,'/')}" 2>/dev/null | head -n 30`);
            if(!res||!res.stdout) {box.style.display='none';return;}
            const sugs = res.stdout.split('\n').filter(l=>l.startsWith(sPre)).map(l=>{const isD=l.endsWith('/'); return {t:dBase+l, i:isD?ICONS.FOLDER:ICONS.FILE};});
            if(sugs.length===0) {box.style.display='none';return;}
            box.innerHTML = sugs.map(s=>`<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.t}';window._currentInput.dispatchEvent(new Event('input'))"><span style="display:flex">${s.i}</span><span style="overflow:hidden;text-overflow:ellipsis;flex:1;">${s.t}</span></div>`).join('');
            
            const rect = input.getBoundingClientRect();
            const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            box.style.width = rect.width + 'px'; box.style.left = rect.left + 'px'; box.style.display = 'block';
            
            // Auto layout orientation logic
            if (rect.bottom > vh / 2) {
                box.style.top = 'auto'; box.style.bottom = (window.innerHeight - rect.top + 4) + 'px'; box.style.maxHeight = (rect.top - 10) + 'px';
            } else {
                box.style.bottom = 'auto'; box.style.top = (rect.bottom + 4) + 'px'; box.style.maxHeight = (vh - rect.bottom - 10) + 'px';
            }
        } catch(e) { box.style.display='none'; }
    }, 250));
    input.addEventListener('focus', () => { window._currentInput = input; setTimeout(()=>input.dispatchEvent(new Event('input')), 300); });
    input.addEventListener('blur', () => setTimeout(()=>box.style.display='none', 200));
};