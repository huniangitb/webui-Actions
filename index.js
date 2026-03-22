import './style.css';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { 
    mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile, 
    mdiRefresh, mdiMagnify, mdiPlus, mdiClose, mdiChevronRight,
    mdiFilterVariant, mdiViewGrid, mdiViewList, mdiStop, mdiPlay,
    mdiEyeOff, mdiDeleteSweep, mdiClockOutline, mdiShieldAccount, mdiAccountCircle
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

let activeUsers = [0];
let activeMounts = new Set();
let statusPolling = null;
let currentAppFilter = 'filterUser';
let currentPid = null;
let currentBindingPkg = null;
let currentBindingUser = 0;

const PAGE_LIMIT = 50;
let ioState = { offset: 0, loading: false, hasMore: true, term: '' };
let sysState = { offset: 0, loading: false, hasMore: true, term: '' };

const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    DELETE: getSvg(mdiDelete, 18, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e'),
    SEARCH: getSvg(mdiMagnify, 18, '#868e96'),
    PLUS: getSvg(mdiPlus, 16, '#fff'),
    CLOSE: getSvg(mdiClose, 28, '#5f6368'),
    FILTER: getSvg(mdiFilterVariant, 24, '#fff'),
    STOP: getSvg(mdiStop, 20, '#dc3545'),
    PLAY: getSvg(mdiPlay, 20, '#36a420'),
    EYE_OFF: getSvg(mdiEyeOff, 20, 'currentColor'),
    CLEAR: getSvg(mdiDeleteSweep, 20, '#fff'),
    CLOCK: getSvg(mdiClockOutline, 14, 'currentColor'),
    SHIELD: getSvg(mdiShieldAccount, 16, 'currentColor'),
    USER: getSvg(mdiAccountCircle, 14, 'currentColor')
};

const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        if (res.errno && res.errno !== 0) {
            console.warn(`Cmd failed: ${cmd}`, res.stderr);
            return ""; 
        }
        return res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        console.error("Exec exception:", e);
        return "";
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

const checkStatus = async () => {
    try {
        const badge = document.getElementById('statusBadge');
        const info = document.getElementById('statusInfo');
        const toggleBtn = document.getElementById('btnToggleStatus');
        
        let pid = await run("pidof injector");
        if (!pid) pid = await run("pgrep -x injector");
        currentPid = pid ? pid.split(' ')[0] : null;

        if (currentPid) {
            badge.className = "badge badge-success";
            badge.textContent = "RUNNING";
            info.textContent = `PID: ${currentPid}`;
            if (toggleBtn.getAttribute('data-status') !== 'running') {
                toggleBtn.innerHTML = ICONS.STOP;
                toggleBtn.style.background = "rgba(220, 53, 69, 0.1)";
                toggleBtn.setAttribute('data-status', 'running');
            }
        } else {
            badge.className = "badge badge-gray";
            badge.textContent = "STOPPED";
            info.textContent = "OFFLINE";
            if (toggleBtn.getAttribute('data-status') !== 'stopped') {
                toggleBtn.innerHTML = ICONS.PLAY;
                toggleBtn.style.background = "rgba(54, 164, 32, 0.1)";
                toggleBtn.setAttribute('data-status', 'stopped');
            }
        }
        await updateMountStatus();
    } catch (e) { console.error(e); }
};

document.addEventListener('DOMContentLoaded', () => {
    const setIcon = (id, icon) => { const el = document.getElementById(id); if(el) el.innerHTML = icon; };
    setIcon('iconSearch', ICONS.SEARCH);
    setIcon('iconIoSearch', ICONS.SEARCH);
    setIcon('iconFilter', ICONS.FILTER);
    setIcon('btnMonitorIgnore', ICONS.EYE_OFF);
    setIcon('iconClearIo', ICONS.CLEAR);
    setIcon('iconClearLog', ICONS.CLEAR);
    document.querySelectorAll('.btn-close').forEach(el => el.innerHTML = ICONS.CLOSE);
    
    const setHtml = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
    setHtml('btnAppAddRule', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加规则</span>`);
    setHtml('btnGlobalAddRule', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加规则</span>`);
    setHtml('btnAddIgnoreRow', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加路径</span>`);

    loadData();
    checkStatus();
    if (statusPolling) clearInterval(statusPolling);
    statusPolling = setInterval(checkStatus, 2000);

    document.getElementById('appSearch').oninput = renderAppList;
    
    const fabBtn = document.getElementById('btnFilterFab');
    const filterOpts = document.getElementById('filterOptions');
    if (fabBtn) {
        fabBtn.onclick = (e) => { e.stopPropagation(); filterOpts.classList.toggle('show'); };
        document.addEventListener('click', (e) => { if (!filterOpts.contains(e.target) && !fabBtn.contains(e.target)) filterOpts.classList.remove('show'); });
    }
    
    document.querySelectorAll('.filter-opt').forEach(btn => {
        btn.onclick = () => {
            currentAppFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterOpts.classList.remove('show');
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
});

const debounce = (func, wait) => {
    let timeout;
    return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
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
                    document.getElementById('ioLogList').innerHTML = '<div class="empty-state">暂无监控数据</div>';
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
        
        const ts = parseInt(parts[0]);
        const content = parts.slice(1).join('|');
        
        let pkg = "未知", op = "INFO", details = content;
        const match = content.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
        if (match) { pkg = match[1]; op = match[2]; details = match[3]; }

        const date = new Date(ts * 1000);
        const timeStr = isNaN(date.getTime()) ? "--:--:--" : date.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

        const app = appMap.get(pkg);
        const appName = app ? app.appLabel : pkg;

        return `
            <div class="io-card">
                <div class="io-card-header">
                    <div class="io-time">${ICONS.CLOCK} <span>${timeStr}</span></div>
                    <div class="io-app text-truncate" title="${pkg}">${appName}</div>
                    <div class="io-op op-${op}">${op}</div>
                </div>
                <div class="io-card-body break-all font-monospace text-muted">
                    ${details}
                </div>
            </div>
        `;
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

document.querySelectorAll('.main-tabs .nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.main-tabs .nav-item').forEach(b => b.classList.remove('active'));
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

const loadData = async () => {
    try {
        activeMounts = await fetchActiveMounts();
        
        const userRes = await run("pm list users");
        activeUsers = [];
        if (userRes) {
            const matches = userRes.matchAll(/UserInfo\{(\d+):/g);
            for (const m of matches) activeUsers.push(parseInt(m[1]));
        }
        if (activeUsers.length === 0) activeUsers.push(0);

        const injectorConf = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        globalConfText = "";
        injectorStates.clear();
        
        let currentSection = "";
        let globalLines = [];

        if (injectorConf) {
            injectorConf.split('\n').forEach(line => {
                const tLine = line.trim();
                if (!tLine) return; // Ignore empty lines during parsing
                const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
                if (secMatch) {
                    if (currentSection === '[GLOBAL]') globalConfText = globalLines.join('\n');
                    currentSection = `[${secMatch[1]}]`;
                    if (secMatch[1] !== 'GLOBAL') injectorStates.set(secMatch[1], secMatch[2] || "ON");
                    globalLines = [];
                } else if (currentSection === '[GLOBAL]') {
                    globalLines.push(tLine);
                }
            });
            if (currentSection === '[GLOBAL]') globalConfText = globalLines.join('\n');
        }

        let ruleFilesMap = new Map();
        for (const uid of activeUsers) {
            const dir = uid === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${uid}`;
            const lsRes = await run(`ls -1 ${dir} 2>/dev/null`);
            if (lsRes) {
                // 兼容读取已禁用状态的规则文件 (.conf.disabled)
                const files = lsRes.split('\n').filter(f => f.endsWith('.conf') || f.endsWith('.conf.disabled'));
                for (const file of files) {
                    const pkg = file.replace(/\.conf(\.disabled)?$/, '');
                    const content = await run(`cat ${dir}/${file} 2>/dev/null`);
                    ruleFilesMap.set(`${pkg}:${uid}`, content);
                }
            }
        }

        let infos = [];
        try {
            const userPkgs = await listPackages('user') || [];
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
            infos = [];
            if (fallbackList) {
                fallbackList.split('\n').forEach(line => {
                    const trimLine = line.trim();
                    if (trimLine && !trimLine.startsWith('#') && trimLine.includes('=')) {
                        const firstEq = trimLine.indexOf('=');
                        const pkg = trimLine.substring(0, firstEq).trim();
                        const name = trimLine.substring(firstEq + 1).trim();
                        if (pkg) {
                            infos.push({
                                packageName: pkg,
                                appLabel: name || pkg,
                                isSystem: false,
                                versionName: "",
                                versionCode: 0,
                                uid: 0
                            });
                        }
                    }
                });
            }
        }

        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
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

                    if (hasRulesFile || state === 'OFF') isConfiguredAny = true;

                    appUsers[uid] = {
                        isEnabled: state !== 'OFF',
                        text: ruleText,
                        hasMonitor: ruleText.includes('MONITOR ON'),
                        hasSandbox: ruleText.includes('SANDBOX ON'),
                        hasRules: ruleText.includes('REDIRECT') || ruleText.includes('HIDE')
                    };
                });

                appMap.set(info.packageName, { ...info, isConfigured: isConfiguredAny, users: appUsers });
            });
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
    const items = [];
    appMap.forEach(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return;
        if (currentAppFilter === 'filterBound' && !app.isConfigured) return;
        const label = app.appLabel || app.packageName;
        if (searchVal && !label.toLowerCase().includes(searchVal) && !app.packageName.toLowerCase().includes(searchVal)) return;
        items.push(app);
    });
    
    items.sort((a, b) => (!!b.isConfigured - !!a.isConfigured) || (a.appLabel || "").localeCompare(b.appLabel || ""));
    
    listEl.innerHTML = items.length ? items.map(app => {
        let mountedBadge = activeMounts.has(app.packageName) ? `<span class="badge badge-success badge-mount">MOUNTED</span>` : "";
        
        let badges = [];
        let configuredUsers = activeUsers.filter(u => app.users[u].text.trim() || app.users[u].hasRules || app.isConfigured);
        
        configuredUsers.forEach(u => {
            const uConf = app.users[u];
            if (!uConf.isEnabled) {
                badges.push(`<span class="badge badge-gray badge-pill">U${u}: OFF</span>`);
            } else {
                let txt = `U${u}`;
                let color = 'badge-primary';
                if(uConf.hasSandbox) color = 'badge-success';
                else if(uConf.hasMonitor) color = 'badge-warning';
                badges.push(`<span class="badge ${color} badge-pill">${txt}</span>`);
            }
        });
        
        const isOverallDisabled = configuredUsers.length > 0 && configuredUsers.every(u => !app.users[u].isEnabled);

        return `
        <div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')">
            <div class="app-main">
                <div class="app-icon-wrapper">${ICONS.ANDROID}</div>
                <div class="app-content">
                    <div class="app-header"><span class="app-name ${isOverallDisabled ? 'text-muted' : ''}">${app.appLabel}</span>${mountedBadge}</div>
                    <small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small>
                </div>
            </div>
            <div class="app-end">${badges.join(' ')}</div>
        </div>`;
    }).join('') : '<div class="empty-state">无匹配应用</div>';
};

const renderGlobalRules = () => {
    document.getElementById('globalRuleContent').value = globalConfText;
    parseConfigTextToVisual(globalConfText, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect');
    
    const visualRadio = document.querySelector('input[name="globalEditorMode"][value="visual"]');
    if (visualRadio && !visualRadio.checked) { 
        visualRadio.checked = true; 
        handleModeChange(true, 'content-global', 'globalVisual', 'globalRaw', 'globalAlert', 'fabGlobal', 'globalRuleContent', 
            (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect'),
            () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect'));
    }
};

const parseConfigTextToVisual = (text, containerId, monitorSelectId, sandboxSelectId) => {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    const selMonitor = monitorSelectId ? document.getElementById(monitorSelectId) : null;
    if (selMonitor) selMonitor.value = "";
    
    const selSandbox = sandboxSelectId ? document.getElementById(sandboxSelectId) : null;
    if (selSandbox) selSandbox.value = "";

    if (text) {
        text.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'REDIRECT' && parts.length >= 3) {
                addRuleRow('REDIRECT', normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(' ')), containerId);
            } else if (parts[0] === 'HIDE' && parts.length >= 2) {
                addRuleRow('HIDE', normalizeToDisplay(parts[1]), '', containerId);
            } else if (parts[0] === 'MONITOR' && parts.length >= 2 && selMonitor) {
                if (parts[1] === 'ON') selMonitor.value = 'ON';
                else if (parts[1] === 'OFF') selMonitor.value = 'OFF';
            } else if (parts[0] === 'SANDBOX' && parts.length >= 2 && selSandbox) {
                if (parts[1] === 'ON') selSandbox.value = 'ON';
                else if (parts[1] === 'OFF') selSandbox.value = 'OFF';
            }
        });
    }
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '', containerId);
};

const generateConfigTextFromVisual = (containerId, monitorSelectId, sandboxSelectId) => {
    let res = "";
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
            else if (type === 'HIDE') res += `HIDE ${normalizeToConfig(target, true)}\n`;
        }
    });
    return res.trim();
};

const addRuleRow = (type, target, source, containerId) => {
    const div = document.createElement('div');
    div.className = 'rule-row';
    div.innerHTML = `<select class="form-select rule-type"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select><div class="rule-inputs"><input type="text" class="form-control rule-target" placeholder="原始路径" value="${target}"><input type="text" class="form-control rule-source ${type==='HIDE'?'hidden':''}" placeholder="重定向至" value="${source}"></div><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    const select = div.querySelector('.rule-type');
    select.value = type;
    select.onchange = (e) => div.querySelector('.rule-source').classList.toggle('hidden', e.target.value === 'HIDE');
    div.querySelector('.btn-del').onclick = () => div.remove();
    setupAutocomplete(div.querySelector('.rule-target'));
    setupAutocomplete(div.querySelector('.rule-source'));
    document.getElementById(containerId).appendChild(div);
};

const flushInjectorConf = async () => {
    let res = `[GLOBAL]\n`;
    const gt = globalConfText.trim();
    if (gt) {
        res += `${gt}\n`;
    }
    injectorStates.forEach((state, key) => {
        res += `[${key}] ${state}\n`;
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
        `<button class="nav-item ${uid === activeUsers[0] ? 'active' : ''}" data-uid="${uid}" onclick="window.switchAppUser(${uid})">${ICONS.USER} 用户 ${uid}</button>`
    ).join('');
    
    window.switchAppUser(activeUsers[0]);
    openModal('appConfigModal');
};

window.switchAppUser = (uid) => {
    currentBindingUser = uid;
    document.querySelectorAll('#appUserTabs .nav-item').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.uid) === uid);
    });

    const app = appMap.get(currentBindingPkg);
    const uConf = app.users[uid] || { isEnabled: true, text: '' };

    document.getElementById('appEnableToggle').checked = uConf.isEnabled;
    document.getElementById('appRuleContent').value = uConf.text;
    parseConfigTextToVisual(uConf.text, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect');
    
    const visualRadio = document.querySelector('input[name="appEditorMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
};

document.getElementById('btnSaveAppConfig').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="appEditorMode"][value="visual"]').checked;
        const text = isVisual ? generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect') : document.getElementById('appRuleContent').value;
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
        
        // 无论规则内容是否为空都生成文件，实现“将应用添加到列表中”的逻辑
        if (isEnabled) {
            await exec(`echo '${cleanText.replace(/'/g, "'\\''")}' > ${file}`);
            await run(`rm -f ${disabledFile}`);
        } else {
            // 通过后缀名禁用
            await exec(`echo '${cleanText.replace(/'/g, "'\\''")}' > ${disabledFile}`);
            await run(`rm -f ${file}`);
        }
        
        await flushInjectorConf();
        toast("当前用户应用配置已保存");
        closeModal('appConfigModal');
        loadData();
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

document.getElementById('btnDeleteAppConfig').onclick = async () => {
    try {
        if (!confirm(`确定清除当前用户 (${currentBindingUser}) 的应用配置吗?`)) return;
        
        const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
        // 清理所有可能的配置文件
        await run(`rm -f ${dir}/${currentBindingPkg}.conf ${dir}/${currentBindingPkg}.conf.disabled`);
        injectorStates.delete(`${currentBindingPkg}:${currentBindingUser}`);
        
        await flushInjectorConf();
        toast("配置已清除");
        closeModal('appConfigModal');
        loadData();
    } catch (e) {
        toast("清除失败: " + e.message);
    }
};

document.getElementById('btnSaveGlobal').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="globalEditorMode"][value="visual"]').checked;
        globalConfText = isVisual ? generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect') : document.getElementById('globalRuleContent').value;
        
        await flushInjectorConf();
        toast("全局规则已保存");
        loadData();
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

window.openModal = (id) => { const el = document.getElementById(id); if (el) { el.classList.remove('hiding'); el.classList.add('show'); } };
window.closeModal = (id) => { const el = document.getElementById(id); if (el && el.classList.contains('show')) { el.classList.add('hiding'); setTimeout(() => { el.classList.remove('show'); el.classList.remove('hiding'); }, 250); document.getElementById('suggestionBox').style.display = 'none'; } };

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
    const threshold = window.innerHeight * 0.5;
    box.style.width = rect.width + 'px';
    box.style.left = rect.left + 'px';
    if (rect.bottom > threshold) {
        box.style.top = 'auto'; box.style.bottom = (window.innerHeight - rect.top) + 'px';
        box.style.maxHeight = (rect.top - 10) + 'px'; box.style.borderRadius = '8px 8px 0 0';
        box.style.borderBottom = 'none'; box.style.borderTop = '1px solid var(--border)';
    } else {
        box.style.top = rect.bottom + 'px'; box.style.bottom = 'auto';
        box.style.maxHeight = (window.innerHeight - rect.bottom - 10) + 'px'; box.style.borderRadius = '0 0 8px 8px';
        box.style.borderTop = 'none'; box.style.borderBottom = '1px solid var(--border)';
    }
};

const startAutoUpdate = (input) => {
    const box = document.getElementById('suggestionBox');
    const loop = () => { if (box.style.display !== 'none' && window._currentInput === input) { updateBoxPosition(input); requestAnimationFrame(loop); } };
    requestAnimationFrame(loop);
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
            box.innerHTML = suggestions.map(s => `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window.applySuggestion('${s.text}')"><div class="s-icon">${s.icon}</div><div class="s-text">${s.text}</div></div>`).join('');
            box.style.display = 'block'; updateBoxPosition(input); startAutoUpdate(input);
        } catch (e) { box.style.display = 'none'; }
    }, 150);
    input.addEventListener('input', (e) => performSearch(e.target.value));
    input.addEventListener('focus', () => { window._currentInput = input; if (input.value) input.dispatchEvent(new Event('input')); });
};

window.applySuggestion = (text) => { if (window._currentInput) { window._currentInput.value = text; window._currentInput.dispatchEvent(new Event('input')); } };

const handleModeChange = (isVisual, containerId, visualId, rawId, alertId, fabId, contentId, parseFunc, genFunc) => {
    const alertBox = document.getElementById(alertId);
    const visualEl = document.getElementById(visualId);
    const rawEl = document.getElementById(rawId);
    const containerEl = document.getElementById(containerId);
    const fab = document.getElementById(fabId) || (containerEl ? containerEl.querySelector('.fab-container') : null);

    if (isVisual) {
        rawEl.classList.remove('active');
        setTimeout(() => {
            rawEl.classList.add('hidden'); visualEl.classList.remove('hidden');
            if (alertBox) alertBox.classList.remove('collapsed');
            if (fab) fab.classList.remove('hidden');
            parseFunc(document.getElementById(contentId).value);
            requestAnimationFrame(() => { visualEl.classList.add('active'); });
        }, 250);
    } else {
        visualEl.classList.remove('active');
        if (alertBox) alertBox.classList.add('collapsed');
        if (fab) fab.classList.add('hidden');
        setTimeout(() => {
            visualEl.classList.add('hidden'); rawEl.classList.remove('hidden');
            document.getElementById(contentId).value = genFunc();
            requestAnimationFrame(() => { rawEl.classList.add('active'); });
        }, 250);
    }
};

document.querySelectorAll('input[name="globalEditorMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'content-global', 'globalVisual', 'globalRaw', 'globalAlert', 'fabGlobal', 'globalRuleContent', (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect'), () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect')); });
document.querySelectorAll('input[name="appEditorMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'appConfigModal', 'appVisual', 'appRaw', null, 'fabApp', 'appRuleContent', (val) => parseConfigTextToVisual(val, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect'), () => generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect')); });

document.getElementById('btnGlobalAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'globalRuleBuilderContainer');
document.getElementById('btnAppAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'appRuleBuilderContainer');

const parseIgnoreToVisual = (text) => {
    const container = document.getElementById('ignoreBuilderContainer'); container.innerHTML = '';
    if (text) { text.split('\n').forEach(line => { const val = line.trim(); if (val && !val.startsWith('#')) addIgnoreRow(val); }); }
    if (container.children.length === 0) addIgnoreRow('');
};
const generateIgnoreFromVisual = () => {
    let res = ""; document.querySelectorAll('#ignoreBuilderContainer .ignore-row input').forEach(input => { const val = input.value.trim(); if (val) res += `${val}\n`; }); return res.trim();
};
const addIgnoreRow = (path) => {
    const div = document.createElement('div'); div.className = 'rule-row ignore-row';
    div.innerHTML = `<input type="text" class="form-control" placeholder="输入要忽略的路径前缀" value="${path}"><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    div.querySelector('.btn-del').onclick = () => div.remove(); setupAutocomplete(div.querySelector('input'));
    document.getElementById('ignoreBuilderContainer').appendChild(div);
};

const openMonitorIgnoreEditor = async () => {
    const content = await run(`cat ${MONITOR_IGNORE_CONF} 2>/dev/null`);
    document.getElementById('monitorIgnoreContent').value = content;
    parseIgnoreToVisual(content); document.getElementById('alertIgnore').classList.remove('collapsed');
    const visualRadio = document.querySelector('input[name="ignoreMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
    openModal('monitorIgnoreModal');
};
document.querySelectorAll('input[name="ignoreMode"]').forEach(el => { el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'monitorIgnoreModal', 'ignoreVisual', 'ignoreRaw', 'alertIgnore', 'fabIgnore', 'monitorIgnoreContent', parseIgnoreToVisual, generateIgnoreFromVisual); });
document.getElementById('btnAddIgnoreRow').onclick = () => addIgnoreRow('');
document.getElementById('btnSaveIgnore').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="ignoreMode"][value="visual"]').checked;
        const content = isVisual ? generateIgnoreFromVisual() : document.getElementById('monitorIgnoreContent').value;
        await exec(`echo '${content.trim()}' > ${MONITOR_IGNORE_CONF}`);
        toast("忽略配置已保存"); closeModal('monitorIgnoreModal');
    } catch (e) { toast("保存失败: " + e.message); }
};