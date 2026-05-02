--- START OF FILE index.js ---
import './style.css';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { getSettings, saveSettings, checkPluginInstalled, syncToPlugin } from './plugin.js';
import { 
    mdiAndroid, mdiDelete, mdiFolder, mdiFile, 
    mdiMagnify, mdiPlus, mdiClose, mdiFilterVariant, 
    mdiStop, mdiPlay, mdiEyeOff, mdiDeleteSweep, 
    mdiClockOutline, mdiAccountCircle, mdiCog,
    mdiMathLog, mdiMonitor, mdiShieldAccount, mdiApps
} from '@mdi/js';

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

let activeUsers =[0];
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

let iconObserver = null;
let renderQueueId = null;

const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    DELETE: getSvg(mdiDelete, 18, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e'),
    SEARCH: getSvg(mdiMagnify, 18, 'currentColor'),
    PLUS: getSvg(mdiPlus, 16, '#fff'),
    CLOSE: getSvg(mdiClose, 24, 'currentColor'),
    FILTER: getSvg(mdiFilterVariant, 24, '#fff'),
    STOP: getSvg(mdiStop, 20, 'currentColor'),
    PLAY: getSvg(mdiPlay, 20, 'currentColor'),
    EYE_OFF: getSvg(mdiEyeOff, 20, 'currentColor'),
    CLEAR: getSvg(mdiDeleteSweep, 20, '#fff'),
    CLOCK: getSvg(mdiClockOutline, 14, 'currentColor'),
    USER: getSvg(mdiAccountCircle, 14, 'currentColor'),
    COG: getSvg(mdiCog, 20, 'currentColor'),
    
    // Bottom Nav Icons
    APPS: getSvg(mdiApps, 24, 'currentColor'),
    GLOBAL: getSvg(mdiShieldAccount, 24, 'currentColor'),
    IO: getSvg(mdiMonitor, 24, 'currentColor'),
    LOG: getSvg(mdiMathLog, 24, 'currentColor'),
};

window.onIconError = (ele) => {
    ele.outerHTML = ICONS.ANDROID;
};

const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return (res.errno === 0 && res.stdout) ? res.stdout.trim() : "";
    } catch (e) { return ""; }
};

const debounce = (func, wait) => {
    let timeout;
    return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
};

const processInChunks = async (array, processFn, chunkSize = 100) => {
    for (let i = 0; i < array.length; i += chunkSize) {
        const chunk = array.slice(i, i + chunkSize);
        chunk.forEach(processFn);
        await new Promise(resolve => setTimeout(resolve, 0)); 
    }
};

const fetchActiveMounts = async () => {
    try {
        const fuseArgs = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
        const mounts = new Set();
        if (fuseArgs) {
            fuseArgs.split('\n').forEach(line => {
                const match = line.match(/--pkg=([a-zA-Z0-9._]+)/);
                if (match) mounts.add(match[1]);
            });
        }
        return mounts;
    } catch (e) { return new Set(); }
};

const updateMountStatus = async () => {
    try {
        activeMounts = await fetchActiveMounts();
        document.querySelectorAll('#appList .list-item').forEach(item => {
            const pkg = item.dataset.pkg;
            if (!pkg) return;
            const header = item.querySelector('.app-header');
            if (!header) return;
            const badge = header.querySelector('.badge-mount');
            const isMounted = activeMounts.has(pkg);
            if (isMounted && !badge) header.insertAdjacentHTML('beforeend', `<span class="badge badge-success badge-mount">MOUNTED</span>`);
            else if (!isMounted && badge) badge.remove();
        });
    } catch (e) { console.error(e); }
};

const fetchInjectedApps = async () => {
    try {
        const res = await run(`${LOG_CTL} list-injected api`);
        injectedApps.clear();
        if (res) {
            res.split('\n').forEach(line => {
                if (line.startsWith('APP|')) {
                    const parts = line.split('|');
                    if (parts.length >= 7) {
                        injectedApps.set(parts[1], {
                            pid: parts[2],
                            uid: parts[3],
                            redirect: parts[4],
                            hide: parts[5],
                            ro: parts[6]
                        });
                    }
                }
            });
        }
    } catch (e) { /* ignore */ }
};

const checkStatus = async () => {
    try {
        const badge = document.getElementById('statusBadge');
        const info = document.getElementById('statusInfo');
        const toggleBtn = document.getElementById('btnToggleStatus');
        let pid = await run("pidof injector") || await run("pgrep -x injector");
        currentPid = pid ? pid.split(' ')[0] : null;

        if (currentPid) {
            badge.className = "badge badge-success"; badge.textContent = "RUNNING"; info.textContent = `PID: ${currentPid}`;
            if (toggleBtn.getAttribute('data-status') !== 'running') {
                toggleBtn.innerHTML = ICONS.STOP; toggleBtn.style.color = "var(--mx-red)";
                toggleBtn.setAttribute('data-status', 'running');
            }
        } else {
            badge.className = "badge badge-gray"; badge.textContent = "STOPPED"; info.textContent = "OFFLINE";
            if (toggleBtn.getAttribute('data-status') !== 'stopped') {
                toggleBtn.innerHTML = ICONS.PLAY; toggleBtn.style.color = "var(--mx-green)";
                toggleBtn.setAttribute('data-status', 'stopped');
            }
        }
        await updateMountStatus();
        await fetchInjectedApps();
        document.querySelectorAll('#appList .list-item').forEach(item => {
            const pkg = item.dataset.pkg;
            if (!pkg) return;
            const small = item.querySelector('.app-content > small');
            if (!small) return;
            const inj = injectedApps.get(pkg);
            if (inj) {
                const flags =[];
                if (inj.redirect === '1') flags.push('<span class="inj-flag inj-flag-r">R</span>');
                if (inj.hide === '1') flags.push('<span class="inj-flag inj-flag-h">H</span>');
                if (inj.ro === '1') flags.push('<span class="inj-flag inj-flag-ro">RO</span>');
                small.className = 'inj-status';
                small.innerHTML = `<span class="inj-pid">PID ${inj.pid}</span> ${flags.join(' ')}`;
            } else {
                small.className = 'text-muted text-truncate d-block';
                small.style.fontFamily = "monospace";
                small.textContent = pkg;
            }
        });
    } catch (e) {}
};

document.addEventListener('DOMContentLoaded', () => {
    const setIcon = (id, icon) => { const el = document.getElementById(id); if(el) el.innerHTML = icon; };
    setIcon('iconSearch', ICONS.SEARCH); setIcon('iconIoSearch', ICONS.SEARCH); setIcon('iconFilter', ICONS.FILTER);
    setIcon('btnMonitorIgnore', ICONS.EYE_OFF); setIcon('iconClearIo', ICONS.CLEAR); setIcon('iconClearLog', ICONS.CLEAR);
    setIcon('btnSettings', ICONS.COG);
    setIcon('iconCloseAppModal', ICONS.CLOSE);
    setIcon('iconCloseIgnoreModal', ICONS.CLOSE);
    setIcon('iconCloseSettingsModal', ICONS.CLOSE);
    
    // Bottom Nav Icons
    setIcon('navIconApps', ICONS.APPS);
    setIcon('navIconGlobal', ICONS.GLOBAL);
    setIcon('navIconIo', ICONS.IO);
    setIcon('navIconLog', ICONS.LOG);
    
    document.getElementById('btnGlobalAddRule').innerHTML = `${ICONS.PLUS} 添加规则`;
    document.getElementById('btnAppAddRule').innerHTML = `${ICONS.PLUS} 添加规则`;
    document.getElementById('btnAddIgnoreRow').innerHTML = `${ICONS.PLUS} 添加路径`;

    loadData();
    checkStatus();
    if (statusPolling) clearInterval(statusPolling);
    statusPolling = setInterval(checkStatus, 2000);

    const debouncedAppSearch = debounce(() => { renderAppList(); }, 250);
    document.getElementById('appSearch').addEventListener('input', debouncedAppSearch);

    document.getElementById('btnFilterFab').onclick = (e) => { e.stopPropagation(); document.getElementById('filterOptions').classList.toggle('show'); };
    
    document.querySelectorAll('.filter-opt').forEach(btn => {
        btn.onclick = () => {
            currentAppFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('filterOptions').classList.remove('show');
            renderAppList();
        };
    });

    const ioContainer = document.getElementById('ioLogContainer');
    const debouncedIoSearch = debounce(() => {
        ioState.offset = 0; ioState.hasMore = true;
        ioState.term = document.getElementById('ioSearch').value.trim();
        document.getElementById('ioLogList').innerHTML = '';
        fetchIoLogs();
    }, 500);
    document.getElementById('ioSearch').addEventListener('input', debouncedIoSearch);
    if (ioContainer) {
        ioContainer.addEventListener('scroll', () => {
            if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) fetchIoLogs();
        });
    }

    const btnClearIo = document.getElementById('btnClearIo');
    if (btnClearIo) {
        btnClearIo.onclick = async () => {
            await run(`${LOG_CTL} clear-io`);
            toast("IO 日志已清理");
            ioState.offset = 0; ioState.hasMore = true;
            document.getElementById('ioLogList').innerHTML = '';
            fetchIoLogs();
        };
    }

    const logSelect = document.getElementById('logSourceSelect');
    const logViewer = document.getElementById('logViewer');
    if (logSelect) {
        logSelect.addEventListener('change', () => {
            sysState.offset = 0; sysState.hasMore = true;
            logViewer.innerHTML = ''; fetchSysLogs();
        });
    }
    if (logViewer) {
        logViewer.addEventListener('scroll', () => {
            if (logSelect.value === 'internal' && logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50) fetchSysLogs();
        });
    }

    const btnClearLog = document.getElementById('btnClearLog');
    if (btnClearLog) {
        btnClearLog.onclick = async () => {
            const source = logSelect.value;
            if (source === 'zygisk') await run("logcat -c");
            else await run(`${LOG_CTL} clear-sys`);
            toast("日志已清空");
            if (source === 'internal') { sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; }
            fetchSysLogs();
        };
    }

    document.getElementById('btnMonitorIgnore').onclick = openMonitorIgnoreEditor;
    
    document.getElementById('btnSettings').onclick = async () => {
        const settings = await getSettings();
        document.getElementById('pluginSyncToggle').checked = settings.syncPlugin;
        const isInstalled = await checkPluginInstalled();
        const lbl = document.getElementById('pluginStatusLabel');
        lbl.textContent = isInstalled ? "状态: 发现清理插件 (已就绪)" : "状态: 未发现清理插件";
        lbl.style.color = isInstalled ? "var(--mx-green)" : "var(--mx-red)";
        openModal('settingsModal');
    };
    
    document.getElementById('btnSaveSettings').onclick = async () => {
        await saveSettings({ syncPlugin: document.getElementById('pluginSyncToggle').checked });
        toast("设置已保存"); closeModal('settingsModal');
        await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
    };

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const box = document.getElementById('suggestionBox');
            if (box) box.style.display = 'none';
            if (document.activeElement && document.activeElement.classList.contains('mx-input')) {
                setTimeout(() => { document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
            }
        });
    }

    document.addEventListener('scroll', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('editor-pane')) {
            const box = document.getElementById('suggestionBox');
            if (box && box.style.display !== 'none') box.style.display = 'none';
        }
    }, true);
    
    // Bottom Navigation Logic
    document.querySelectorAll('.main-tabs .bottom-nav-item').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.main-tabs .bottom-nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.target;
            document.getElementById(targetId).classList.add('active');
            
            if (targetId === 'content-io') {
                 ioState = { offset: 0, loading: false, hasMore: true, term: document.getElementById('ioSearch').value.trim() };
                 document.getElementById('ioLogList').innerHTML = '';
                 fetchIoLogs();
            } else if (targetId === 'content-log') {
                 if (document.getElementById('logSourceSelect').value === 'internal') {
                     sysState = { offset: 0, loading: false, hasMore: true, term: '' };
                     document.getElementById('logViewer').innerHTML = '';
                 }
                 fetchSysLogs();
            }
        };
    });
});

const loadData = async () => {
    try {
        activeMounts = await fetchActiveMounts();
        await fetchInjectedApps();

        const userRes = await run("pm list users");
        activeUsers =[];
        if (userRes) {
            const matches = userRes.matchAll(/UserInfo\{(\d+):/g);
            for (const m of matches) activeUsers.push(parseInt(m[1]));
        }
        if (activeUsers.length === 0) activeUsers.push(0);

        const injectorConf = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        globalConfText = "";
        injectorStates.clear();
        injectorRulesMap.clear();
        
        if (injectorConf) {
            let currentSection = "";
            injectorConf.split('\n').forEach(line => {
                const tLine = line.trim();
                if (!tLine) return;
                const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
                if (secMatch) {
                    currentSection = secMatch[1];
                    if (currentSection !== 'GLOBAL') injectorStates.set(currentSection, secMatch[2] || "ON");
                    if (!injectorRulesMap.has(currentSection)) {
                        injectorRulesMap.set(currentSection,[]);
                    }
                } else if (currentSection) {
                    injectorRulesMap.get(currentSection).push(tLine);
                }
            });
            globalConfText = (injectorRulesMap.get('GLOBAL') ||[]).join('\n');
        }

        let ruleFilesMap = new Map();
        for (const uid of activeUsers) {
            const dir = uid === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${uid}`;
            const lsRes = await run(`ls -1 ${dir} 2>/dev/null`);
            if (lsRes) {
                const files = lsRes.split('\n').filter(f => f.endsWith('.conf') || f.endsWith('.conf.disabled'));
                await processInChunks(files, async (file) => {
                    const isDisabled = file.endsWith('.conf.disabled');
                    const pkg = file.replace(/\.conf(\.disabled)?$/, '');
                    const content = await run(`cat ${dir}/${file} 2>/dev/null`);
                    ruleFilesMap.set(`${pkg}:${uid}`, content);
                    if (isDisabled) ruleFilesMap.set(`${pkg}:${uid}_disabled`, true);
                    else ruleFilesMap.set(`${pkg}:${uid}_enabled`, true);
                }, 20);
            }
        }

        let infos =[];
        try {
            const userPkgs = await listPackages('user') ||[];
            const systemPkgs = await listPackages('system') || [];
            const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
            if (allPkgs.length > 0) {
                infos = await getPackagesInfo(allPkgs);
            }
        } catch (e) {
            console.warn("API获取应用列表失败, 尝试使用 fallback", e);
        }

        if (!Array.isArray(infos) || infos.length === 0) {
            const fallbackList = await run(`cat ${LIST_CONFIG} 2>/dev/null`);
            infos =[];
            if (fallbackList) {
                fallbackList.split('\n').forEach(line => {
                    const trimLine = line.trim();
                    if (trimLine && !trimLine.startsWith('#') && trimLine.includes('=')) {
                        const firstEq = trimLine.indexOf('=');
                        const pkg = trimLine.substring(0, firstEq).trim();
                        const name = trimLine.substring(firstEq + 1).trim();
                        if (pkg) infos.push({ packageName: pkg, appLabel: name || pkg, isSystem: false, versionName: "", versionCode: 0, uid: 0 });
                    }
                });
            }
        }

        appMap.clear();
        if (Array.isArray(infos)) {
            await processInChunks(infos, info => {
                if (!info || !info.packageName) return;
                
                let appUsers = {};
                let isConfiguredAny = false;

                activeUsers.forEach(uid => {
                    const exactKey = `${info.packageName}:${uid}`;
                    const globalPkgKey = info.packageName;
                    
                    let state = "ON";
                    if (injectorStates.has(exactKey)) state = injectorStates.get(exactKey);
                    else if (injectorStates.has(globalPkgKey)) state = injectorStates.get(globalPkgKey);

                    const ruleText = ruleFilesMap.get(exactKey) || "";
                    const hasRulesFile = ruleFilesMap.has(exactKey);
                    const isExplicitlyEnabled = ruleFilesMap.get(`${exactKey}_enabled`);
                    const isExplicitlyDisabled = ruleFilesMap.get(`${exactKey}_disabled`);

                    let isEnabled = false;
                    if (isExplicitlyEnabled) isEnabled = true;
                    else if (isExplicitlyDisabled) isEnabled = false;
                    else if (state === 'ON' && hasRulesFile) isEnabled = true;

                    if (hasRulesFile || state === 'OFF') isConfiguredAny = true;

                    appUsers[uid] = {
                        isEnabled: isEnabled,
                        text: ruleText,
                        hasRules: /REDIRECT|HIDE|RO|ALLOW/.test(ruleText) || /REDIRECT|HIDE|RO|ALLOW/.test((injectorRulesMap.get(exactKey)||[]).join(''))
                    };
                });

                appMap.set(info.packageName, { ...info, isConfigured: isConfiguredAny, users: appUsers });
            }, 100);
        }

        renderAppList();
        renderGlobalRules();
    } catch (e) {
        toast("数据加载异常: " + e.message);
    }
};

const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const searchVal = document.getElementById('appSearch').value.toLowerCase();
    
    if (renderQueueId) {
        cancelAnimationFrame(renderQueueId);
        renderQueueId = null;
    }

    if (!iconObserver) {
        iconObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        }, { root: listEl, rootMargin: '100px 0px' });
    } else {
        iconObserver.disconnect();
    }

    const items = Array.from(appMap.values()).filter(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return false;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return false;
        if (currentAppFilter === 'filterBound' && !app.isConfigured) return false;
        const label = (app.appLabel || app.packageName).toLowerCase();
        return !searchVal || label.includes(searchVal) || app.packageName.toLowerCase().includes(searchVal);
    }).sort((a, b) => (!!b.isConfigured - !!a.isConfigured) || (a.appLabel || "").localeCompare(b.appLabel || ""));
    
    listEl.innerHTML = '';
    
    if (items.length === 0) {
        listEl.innerHTML = '<div style="padding:40px; text-align:center; color:var(--mx-text-muted);">无匹配应用</div>';
        return;
    }

    let currentIndex = 0;
    const CHUNK_SIZE = 40;

    const renderChunk = () => {
        const chunk = items.slice(currentIndex, currentIndex + CHUNK_SIZE);
        if (chunk.length === 0) {
            renderQueueId = null;
            return;
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = chunk.map(app => {
            let mountedBadge = activeMounts.has(app.packageName) ? `<span class="badge badge-success badge-mount">MOUNTED</span>` : "";
            let badges = activeUsers.filter(u => app.users[u].text.trim() || app.users[u].hasRules || app.isConfigured).map(u => {
                const c = app.users[u];
                return `<span class="badge ${c.isEnabled?'badge-primary':'badge-gray'}">U${u}${c.isEnabled?'':' OFF'}</span>`;
            });
            const isOverallDisabled = badges.every(b => b.includes('OFF'));

            return `
            <div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')">
                <div class="app-main">
                    <div class="app-icon-wrapper">
                        <img data-src="ksu://icon/${app.packageName}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width: 40px; height: 40px; border-radius: 8px; object-fit: contain; background: var(--mx-s1);" class="lazy-icon" onerror="window.onIconError(this)" />
                    </div>
                    <div class="app-content">
                        <div class="app-header"><span class="app-name ${isOverallDisabled ? 'text-muted' : ''}">${app.appLabel}</span>${mountedBadge}</div>
                        ${(() => {
                            const inj = injectedApps.get(app.packageName);
                            if (inj) {
                                const flags =[];
                                if (inj.redirect === '1') flags.push('<span class="inj-flag inj-flag-r">R</span>');
                                if (inj.hide === '1') flags.push('<span class="inj-flag inj-flag-h">H</span>');
                                if (inj.ro === '1') flags.push('<span class="inj-flag inj-flag-ro">RO</span>');
                                return `<small class="inj-status"><span class="inj-pid">PID ${inj.pid}</span> ${flags.join(' ')}</small>`;
                            }
                            return `<small class="text-muted text-truncate d-block" style="font-family:monospace;">${app.packageName}</small>`;
                        })()}
                    </div>
                </div>
                <div class="app-end">${badges.join(' ')}</div>
            </div>`;
        }).join('');

        const newImgs = tempDiv.querySelectorAll('.lazy-icon');
        
        while (tempDiv.firstChild) {
            listEl.appendChild(tempDiv.firstChild);
        }

        newImgs.forEach(img => iconObserver.observe(img));

        currentIndex += CHUNK_SIZE;
        renderQueueId = requestAnimationFrame(renderChunk);
    };

    renderQueueId = requestAnimationFrame(renderChunk);
};

const renderGlobalRules = () => {
    document.getElementById('globalRuleContent').value = globalConfText;
    parseConfigTextToVisual(globalConfText, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect');
    
    const visualRadio = document.querySelector('input[name="globalEditorMode"][value="visual"]');
    if (visualRadio && !visualRadio.checked) { 
        visualRadio.checked = true; 
        handleModeChange(true, 'globalVisual', 'globalRaw', 'globalAlert', 'globalRuleContent', 
            (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect'),
            () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect'));
    }
};

const parseConfigTextToVisual = (text, containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    const selMonitor = monitorSelectId ? document.getElementById(monitorSelectId) : null;
    if (selMonitor) selMonitor.value = "";
    
    const selSandbox = sandboxSelectId ? document.getElementById(sandboxSelectId) : null;
    if (selSandbox) selSandbox.value = "";

    const selInject = injectSelectId ? document.getElementById(injectSelectId) : null;
    if (selInject) selInject.value = "";

    if (text) {
        text.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'REDIRECT' && parts.length >= 3) {
                addRuleRow('REDIRECT', normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(' ')), containerId);
            } else if (['HIDE', 'RO', 'ALLOW'].includes(parts[0]) && parts.length >= 2) {
                addRuleRow(parts[0], normalizeToDisplay(parts[1]), '', containerId);
            } else if (parts[0] === 'MONITOR' && parts.length >= 2 && selMonitor) {
                if (parts[1] === 'ON') selMonitor.value = 'ON';
                else if (parts[1] === 'OFF') selMonitor.value = 'OFF';
            } else if (parts[0] === 'SANDBOX' && parts.length >= 2 && selSandbox) {
                if (parts[1] === 'ON') selSandbox.value = 'ON';
                else if (parts[1] === 'OFF') selSandbox.value = 'OFF';
            } else if (parts[0] === 'GLOBAL_INJECT' && parts.length >= 2 && selInject) {
                if (parts[1] === 'ON') selInject.value = 'ON';
                else if (parts[1] === 'OFF') selInject.value = 'OFF';
            }
        });
    }
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '', containerId);
};

const generateConfigTextFromVisual = (containerId, monitorSelectId, sandboxSelectId, injectSelectId) => {
    let res = "";

    const selInject = injectSelectId ? document.getElementById(injectSelectId) : null;
    if (selInject && selInject.value) res += `GLOBAL_INJECT ${selInject.value}\n`;

    const selMonitor = monitorSelectId ? document.getElementById(monitorSelectId) : null;
    if (selMonitor && selMonitor.value) res += `MONITOR ${selMonitor.value}\n`;
    
    const selSandbox = sandboxSelectId ? document.getElementById(sandboxSelectId) : null;
    if (selSandbox && selSandbox.value) res += `SANDBOX ${selSandbox.value}\n`;

    document.querySelectorAll(`#${containerId} .rule-row`).forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const target = row.querySelector('.rule-target').value.trim();
        const source = row.querySelector('.rule-source').value.trim();
        if (target) {
            if (type === 'REDIRECT' && source) res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
            else if (['HIDE', 'RO', 'ALLOW'].includes(type)) res += `${type} ${normalizeToConfig(target, true)}\n`;
        }
    });
    return res.trim();
};

const addRuleRow = (type, target, source, containerId) => {
    const div = document.createElement('div');
    div.className = 'rule-row';
    div.innerHTML = `<select class="mx-select rule-type" style="width:100px; height:36px;"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option><option value="RO">只读</option><option value="ALLOW">沙盒豁免</option></select><div class="rule-inputs" style="flex:1; display:flex; gap:8px;"><input type="text" class="mx-input rule-target" placeholder="原始路径" value="${target}" style="height:36px;"><input type="text" class="mx-input rule-source ${type!=='REDIRECT'?'hidden':''}" placeholder="重定向至" value="${source}" style="height:36px;"></div><button class="mx-btn btn-del" style="background:transparent; padding:0 8px; color:var(--mx-text-muted); border:none; display:flex;">${ICONS.DELETE}</button>`;
    const select = div.querySelector('.rule-type');
    select.value = type;
    select.onchange = (e) => div.querySelector('.rule-source').classList.toggle('hidden', e.target.value !== 'REDIRECT');
    div.querySelector('.btn-del').onclick = () => div.remove();
    
    const targetInput = div.querySelector('.rule-target');
    const sourceInput = div.querySelector('.rule-source');
    
    setupAutocomplete(targetInput);
    setupAutocomplete(sourceInput);
    
    const scrollToCenter = (e) => {
        setTimeout(() => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
    };
    targetInput.addEventListener('focus', scrollToCenter);
    sourceInput.addEventListener('focus', scrollToCenter);
    
    document.getElementById(containerId).appendChild(div);
};

const flushInjectorConf = async () => {
    let res = `[GLOBAL]\n`;
    const gt = globalConfText.trim();
    if (gt) {
        res += `${gt}\n`;
    }
    
    injectorStates.forEach((state, key) => {
        if (key === 'GLOBAL') return;
        res += `[${key}] ${state}\n`;
        const inlineRules = injectorRulesMap.get(key) ||[];
        if (inlineRules.length > 0) {
            res += inlineRules.join('\n') + '\n';
        }
    });
    const safeResult = res.trim().replace(/'/g, "'\\''");
    await exec(`echo '${safeResult}' > ${INJECTOR_CONF}`);
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    if (!app) return;
    
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    
    const tabsContainer = document.getElementById('appUserTabs');
    tabsContainer.innerHTML = activeUsers.map(uid => 
        `<button class="mx-tab ${uid === activeUsers[0] ? 'active' : ''}" data-uid="${uid}" onclick="window.switchAppUser(${uid})">${ICONS.USER} 用户 ${uid}</button>`
    ).join('');
    
    setTimeout(() => {
        window.switchAppUser(activeUsers[0]);
    }, 50);
    openModal('appConfigModal');
};

window.switchAppUser = (uid) => {
    currentBindingUser = uid;
    document.querySelectorAll('#appUserTabs .mx-tab').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.uid) === uid);
    });

    const app = appMap.get(currentBindingPkg);
    const uConf = app.users[uid] || { isEnabled: false, text: '' };

    document.getElementById('appEnableToggle').checked = uConf.isEnabled;
    document.getElementById('appRuleContent').value = uConf.text;
    parseConfigTextToVisual(uConf.text, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null);
    
    const visualRadio = document.querySelector('input[name="appEditorMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
};

document.getElementById('btnSaveAppConfig').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="appEditorMode"][value="visual"]').checked;
        const text = isVisual ? generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null) : document.getElementById('appRuleContent').value;
        const cleanText = text.trim();
        const isEnabled = document.getElementById('appEnableToggle').checked;

        const exactKey = `${currentBindingPkg}:${currentBindingUser}`;
        
        if (!isEnabled) {
            injectorStates.set(exactKey, 'OFF');
        } else {
            injectorStates.set(exactKey, 'ON');
        }

        const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
        const file = `${dir}/${currentBindingPkg}.conf`;
        const disabledFile = `${dir}/${currentBindingPkg}.conf.disabled`;
        
        await run(`mkdir -p ${dir}`);
        
        if (isEnabled) {
            await exec(`echo '${cleanText.replace(/'/g, "'\\''")}' > ${file}`);
            await run(`rm -f ${disabledFile}`);
        } else {
            await exec(`echo '${cleanText.replace(/'/g, "'\\''")}' > ${disabledFile}`);
            await run(`rm -f ${file}`);
        }
        
        await flushInjectorConf();
        toast("当前用户应用配置已保存");
        closeModal('appConfigModal');
        await loadData();
        await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

document.getElementById('btnDeleteAppConfig').onclick = async () => {
    try {
        if (!confirm(`确定清除当前用户 (${currentBindingUser}) 的应用配置吗?`)) return;
        
        const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
        await run(`rm -f ${dir}/${currentBindingPkg}.conf ${dir}/${currentBindingPkg}.conf.disabled`);
        injectorStates.delete(`${currentBindingPkg}:${currentBindingUser}`);
        
        await flushInjectorConf();
        await loadData();
        await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
        
        toast("配置已清除并同步");
        closeModal('appConfigModal');
    } catch (e) {
        toast("清除失败: " + e.message);
    }
};

document.getElementById('btnSaveGlobal').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="globalEditorMode"][value="visual"]').checked;
        globalConfText = isVisual ? generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect') : document.getElementById('globalRuleContent').value;
        
        await flushInjectorConf();
        toast("全局规则已保存");
        await loadData();
        await syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates);
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

window.openModal = (id) => { const el = document.getElementById(id); if (el) { el.classList.remove('hiding'); el.classList.add('show'); } };
window.closeModal = (id) => { const el = document.getElementById(id); if (el && el.classList.contains('show')) { el.classList.add('hiding'); setTimeout(() => { el.classList.remove('show'); el.classList.remove('hiding'); }, 200); document.getElementById('suggestionBox').style.display = 'none'; } };

const normalizeToDisplay = (path) => { if (!path) return ""; if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/"; if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/"; return path; };
const normalizeToConfig = (path, isTarget) => { if (!path) return ""; path = path.trim(); if (isTarget) { if (path.startsWith('/')) return path; return (PATH_PREFIX_STORAGE + '/' + path).replace(/\/+/g, '/'); } else { if (path.startsWith('/')) return path; return (PATH_PREFIX_REAL + '/' + path).replace(/\/+/g, '/'); } };

document.getElementById('btnToggleStatus').onclick = async () => {
    try {
        const btn = document.getElementById('btnToggleStatus');
        const isRunning = btn.getAttribute('data-status') === 'running';
        if (isRunning) { 
            if (currentPid) { await run(`kill -15 ${currentPid}`); toast("发送停止信号..."); }
            else toast("服务未运行");
        } else { 
            await run(`sh ${SERVICE_SH}`); toast("启动服务..."); 
            setTimeout(loadData, 1000); 
        }
        setTimeout(checkStatus, 500); 
        setTimeout(checkStatus, 1500);
    } catch (e) {
        toast("操作失败: " + e.message);
    }
};

const updateBoxPosition = (input) => {
    const box = document.getElementById('suggestionBox');
    if (box.style.display === 'none' || !input) return;
    
    const rect = input.getBoundingClientRect();
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const threshold = vh * 0.5;
    
    requestAnimationFrame(() => {
        box.style.width = rect.width + 'px';
        box.style.left = rect.left + 'px';
        if (rect.bottom > threshold) {
            box.style.top = 'auto'; 
            box.style.bottom = (vh - rect.top) + 'px';
            box.style.maxHeight = (rect.top - 10) + 'px'; 
            box.style.borderRadius = '8px 8px 0 0';
            box.style.borderBottom = 'none'; 
            box.style.borderTop = '1px solid var(--mx-s4)';
        } else {
            box.style.top = rect.bottom + 'px'; 
            box.style.bottom = 'auto';
            box.style.maxHeight = (vh - rect.bottom - 10) + 'px'; 
            box.style.borderRadius = '0 0 8px 8px';
            box.style.borderTop = 'none'; 
            box.style.borderBottom = '1px solid var(--mx-s4)';
        }
    });
};

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    const performSearch = debounce(async (val) => {
        let parentDir = PATH_PREFIX_REAL; let searchPrefix = ""; let displayBase = "/";
        const cleanVal = val ? val.replace(/^\/+/, '') : "";
        if (!cleanVal) parentDir = PATH_PREFIX_REAL + '/';
        else if (cleanVal.endsWith('/')) { parentDir = PATH_PREFIX_REAL + '/' + cleanVal; displayBase = "/" + cleanVal; }
        else {
            const lastSlashIndex = cleanVal.lastIndexOf('/');
            if (lastSlashIndex === -1) searchPrefix = cleanVal;
            else { const dirPart = cleanVal.substring(0, lastSlashIndex + 1); parentDir = PATH_PREFIX_REAL + '/' + dirPart; searchPrefix = cleanVal.substring(lastSlashIndex + 1); displayBase = "/" + dirPart; }
        }
        parentDir = parentDir.replace(/\/+/g, '/');
        try {
            const res = await exec(`ls -F -1 "${parentDir}" 2>/dev/null | head -n 30`);
            if (!res || !res.stdout) { box.style.display = 'none'; return; }
            const suggestions = res.stdout.split('\n').filter(l => l.startsWith(searchPrefix)).map(line => { const isDir = line.endsWith('/'); return { text: displayBase + (isDir ? line : line) + (isDir ? '' : ''), icon: isDir ? ICONS.FOLDER : ICONS.FILE }; });
            if (suggestions.length === 0) { box.style.display = 'none'; return; }
            
            box.innerHTML = suggestions.map(s => `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window.applySuggestion('${s.text}')"><div class="s-icon" style="margin-right:10px;display:flex;">${s.icon}</div><div class="s-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.text}</div></div>`).join('');
            box.style.display = 'block'; 
            
            updateBoxPosition(input);
        } catch (e) { box.style.display = 'none'; }
    }, 250);

    input.addEventListener('input', (e) => performSearch(e.target.value));
    
    input.addEventListener('focus', () => { 
        window._currentInput = input; 
        setTimeout(() => {
            if (input.value && window._currentInput === input) {
                input.dispatchEvent(new Event('input')); 
            }
        }, 300);
    });
};

window.applySuggestion = (text) => { if (window._currentInput) { window._currentInput.value = text; window._currentInput.dispatchEvent(new Event('input')); } };

const handleModeChange = (isVisual, visualId, rawId, alertId, contentId, parseFunc, genFunc) => {
    const alertBox = document.getElementById(alertId);
    const visualEl = document.getElementById(visualId);
    const rawEl = document.getElementById(rawId);

    setTimeout(() => {
        if (isVisual) {
            parseFunc(document.getElementById(contentId).value);
            rawEl.classList.remove('active');
            visualEl.classList.add('active');
            if (alertBox) alertBox.style.display = 'block';
        } else {
            document.getElementById(contentId).value = genFunc();
            visualEl.classList.remove('active');
            rawEl.classList.add('active');
            if (alertBox) alertBox.style.display = 'none';
        }
    }, 10);
};

document.querySelectorAll('input[name="globalEditorMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'globalVisual', 'globalRaw', 'globalAlert', 'globalRuleContent', (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect'), () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect', 'globalInjectSelect')); });
document.querySelectorAll('input[name="appEditorMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'appVisual', 'appRaw', null, 'appRuleContent', (val) => parseConfigTextToVisual(val, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null), () => generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect', null)); });
document.querySelectorAll('input[name="ignoreMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'ignoreVisual', 'ignoreRaw', 'alertIgnore', 'monitorIgnoreContent', parseIgnoreToVisual, generateIgnoreFromVisual); });

document.getElementById('btnGlobalAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'globalRuleBuilderContainer');
document.getElementById('btnAppAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'appRuleBuilderContainer');

const parseIgnoreToVisual = (text) => {
    const container = document.getElementById('ignoreBuilderContainer'); container.innerHTML = '';
    if (text) { text.split('\n').forEach(line => { const val = line.trim(); if (val && !val.startsWith('#')) addIgnoreRow(val); }); }
    if (container.children.length === 0) addIgnoreRow('');
};
const generateIgnoreFromVisual = () => {
    let res = ""; document.querySelectorAll('#ignoreBuilderContainer .rule-row input').forEach(input => { const val = input.value.trim(); if (val) res += `${val}\n`; }); return res.trim();
};
const addIgnoreRow = (path) => {
    const div = document.createElement('div'); div.className = 'rule-row ignore-row';
    div.innerHTML = `<input type="text" class="mx-input" placeholder="输入要忽略的路径前缀" value="${path}" style="flex:1; height:36px;"><button class="mx-btn btn-del" style="background:transparent; padding:0 8px; color:var(--mx-text-muted); border:none; display:flex;">${ICONS.DELETE}</button>`;
    div.querySelector('.btn-del').onclick = () => div.remove(); setupAutocomplete(div.querySelector('input'));
    document.getElementById('ignoreBuilderContainer').appendChild(div);
};

const openMonitorIgnoreEditor = async () => {
    const content = await run(`cat ${MONITOR_IGNORE_CONF} 2>/dev/null`);
    document.getElementById('monitorIgnoreContent').value = content;
    parseIgnoreToVisual(content); document.getElementById('alertIgnore').style.display = 'block';
    const visualRadio = document.querySelector('input[name="ignoreMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
    openModal('monitorIgnoreModal');
};
document.getElementById('btnAddIgnoreRow').onclick = () => addIgnoreRow('');
document.getElementById('btnSaveIgnore').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="ignoreMode"][value="visual"]').checked;
        const content = isVisual ? generateIgnoreFromVisual() : document.getElementById('monitorIgnoreContent').value;
        await exec(`echo '${content.trim()}' > ${MONITOR_IGNORE_CONF}`);
        toast("忽略配置已保存"); closeModal('monitorIgnoreModal');
    } catch (e) { toast("保存失败: " + e.message); }
};

const fetchIoLogs = async () => {
    if (ioState.loading || !ioState.hasMore) return;
    ioState.loading = true;
    const indicator = document.getElementById('ioLoadingIndicator');
    if (indicator) indicator.classList.remove('hidden');

    try {
        const res = await run(`${LOG_CTL} search-io "${ioState.term}" ${PAGE_LIMIT} ${ioState.offset} api`);
        if (!res) {
            ioState.hasMore = false;
        } else {
            const lines = res.split('\n');
            let dataLines = lines;
            const lastLine = lines[lines.length - 1];

            if (lastLine.startsWith('DONE|')) {
                const parts = lastLine.split('|');
                if (parts.length >= 3) {
                    const remain = parseInt(parts[2]);
                    ioState.hasMore = !isNaN(remain) && remain > 0;
                } else ioState.hasMore = false;
                dataLines = lines.slice(0, -1);
            } else if (lastLine === 'OK') {
                ioState.hasMore = false;
                dataLines = lines.slice(0, -1);
            }

            if (dataLines.length > 0) {
                ioState.offset += dataLines.length;
                renderIoRows(dataLines);
            } else {
                if (!ioState.hasMore && ioState.offset === 0) {
                    document.getElementById('ioLogList').innerHTML = '<div style="padding:40px; text-align:center; color:var(--mx-text-muted);">暂无监控数据</div>';
                }
            }
        }
    } catch (e) {
        toast("获取 IO 日志失败"); ioState.hasMore = false;
    } finally {
        ioState.loading = false;
        if (indicator) indicator.classList.add('hidden');
    }
};

const renderIoRows = (lines) => {
    const listEl = document.getElementById('ioLogList');
    if (listEl.innerHTML.includes('暂无监控数据')) listEl.innerHTML = '';

    const html = lines.map(line => {
        if (!line.trim()) return '';
        const parts = line.split('|');
        if (parts.length < 2) return '';

        const rawTs = parts[0];
        const content = parts.slice(1).join('|');

        let timeStr;
        if (/^\d+$/.test(rawTs)) {
            const ts = parseInt(rawTs);
            const date = new Date(ts * 1000);
            timeStr = isNaN(date.getTime()) ? "--:--:--" : date.toLocaleString('zh-CN', { hour: '2-digit', minute:'2-digit', second:'2-digit', hour12: false });
        } else {
            const match = rawTs.match(/\d{2}:\d{2}:\d{2}/);
            timeStr = match ? match[0] : rawTs.slice(0, 8);
        }

        let pkg = "未知", op = "INFO", details = content;
        const matchContent = content.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
        if (matchContent) {
            pkg = matchContent[1];
            op = matchContent[2];
            details = matchContent[3];
        }

        const app = appMap.get(pkg);
        const appName = app ? app.appLabel : pkg;

        return `<div class="io-card">
                    <div class="io-card-header">
                        <div class="io-time"><span style="display:flex;">${ICONS.CLOCK}</span> <span>${timeStr}</span></div>
                        <div class="io-app text-truncate" title="${pkg}">${appName}</div>
                        <div class="io-op op-${op}">${op}</div>
                    </div>
                    <div class="io-card-body">${details}</div>
                </div>`;
    }).join('');
    listEl.insertAdjacentHTML('beforeend', html);
};

const fetchSysLogs = async () => {
    const source = document.getElementById('logSourceSelect').value;
    const viewer = document.getElementById('logViewer');
    const indicator = document.getElementById('sysLoadingIndicator');

    if (source === 'zygisk') {
        try {
            const content = await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector");
            viewer.textContent = content || "无 Zygisk 日志";
            viewer.scrollTop = viewer.scrollHeight;
        } catch (e) { toast("获取 Logcat 失败"); }
        return;
    }

    if (sysState.loading || !sysState.hasMore) return;
    sysState.loading = true;
    if (indicator) indicator.classList.remove('hidden');

    try {
        const res = await run(`${LOG_CTL} search-sys "" ${PAGE_LIMIT} ${sysState.offset} api`);
        if (!res) {
            sysState.hasMore = false;
        } else {
            const lines = res.split('\n');
            let dataLines = lines;
            const lastLine = lines[lines.length - 1];

            if (lastLine.startsWith('DONE|')) {
                const parts = lastLine.split('|');
                if (parts.length >= 3) {
                    const remain = parseInt(parts[2]);
                    sysState.hasMore = !isNaN(remain) && remain > 0;
                }
                dataLines = lines.slice(0, -1);
            } else if (lastLine === 'OK') {
                sysState.hasMore = false;
                dataLines = lines.slice(0, -1);
            }

            if (dataLines.length > 0) {
                sysState.offset += dataLines.length;
                const text = dataLines.join('\n') + '\n';
                viewer.insertAdjacentText('beforeend', text);
            } else {
                if (sysState.offset === 0) viewer.textContent = "无内部日志";
            }
        }
    } catch (e) { sysState.hasMore = false; } finally {
        sysState.loading = false;
        if (indicator) indicator.classList.add('hidden');
    }
};