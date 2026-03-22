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
        return (res.errno === 0 && res.stdout) ? res.stdout.trim() : "";
    } catch (e) {
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
    activeMounts = await fetchActiveMounts();
    document.querySelectorAll('#appList .list-item').forEach(item => {
        const pkg = item.dataset.pkg;
        const header = item.querySelector('.app-header');
        if (!pkg || !header) return;
        const badge = header.querySelector('.badge-mount');
        const isMounted = activeMounts.has(pkg);
        if (isMounted && !badge) header.insertAdjacentHTML('beforeend', `<span class="badge badge-success badge-mount">MOUNTED</span>`);
        else if (!isMounted && badge) badge.remove();
    });
};

const checkStatus = async () => {
    const badge = document.getElementById('statusBadge');
    const info = document.getElementById('statusInfo');
    const toggleBtn = document.getElementById('btnToggleStatus');
    
    let pid = await run("pidof injector || pgrep -x injector");
    currentPid = pid ? pid.split(' ')[0] : null;

    if (currentPid) {
        badge.className = "badge badge-success";
        badge.textContent = "RUNNING";
        info.textContent = `PID: ${currentPid}`;
        toggleBtn.innerHTML = ICONS.STOP;
        toggleBtn.style.background = "rgba(220, 53, 69, 0.1)";
        toggleBtn.setAttribute('data-status', 'running');
    } else {
        badge.className = "badge badge-gray";
        badge.textContent = "STOPPED";
        info.textContent = "OFFLINE";
        toggleBtn.innerHTML = ICONS.PLAY;
        toggleBtn.style.background = "rgba(54, 164, 32, 0.1)";
        toggleBtn.setAttribute('data-status', 'stopped');
    }
    await updateMountStatus();
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
    
    document.getElementById('btnAppAddRule').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加规则</span>`;
    document.getElementById('btnGlobalAddRule').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加规则</span>`;
    document.getElementById('btnAddIgnoreRow').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${ICONS.PLUS} 添加路径</span>`;

    loadData();
    checkStatus();
    if (statusPolling) clearInterval(statusPolling);
    statusPolling = setInterval(checkStatus, 3000);

    document.getElementById('appSearch').oninput = renderAppList;
    
    const fabBtn = document.getElementById('btnFilterFab');
    const filterOpts = document.getElementById('filterOptions');
    fabBtn.onclick = (e) => { e.stopPropagation(); filterOpts.classList.toggle('show'); };
    document.addEventListener('click', (e) => { if (!filterOpts.contains(e.target) && !fabBtn.contains(e.target)) filterOpts.classList.remove('show'); });
    
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
    document.getElementById('ioSearch').addEventListener('input', debounce(() => {
        ioState.offset = 0; ioState.hasMore = true;
        ioState.term = document.getElementById('ioSearch').value.trim();
        document.getElementById('ioLogList').innerHTML = '';
        fetchIoLogs();
    }, 500));
    ioContainer.addEventListener('scroll', () => { if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) fetchIoLogs(); });

    document.getElementById('btnClearIo').onclick = async () => {
        await run(`${LOG_CTL} clear-io`);
        toast("IO 日志已清理");
        ioState.offset = 0; ioState.hasMore = true;
        document.getElementById('ioLogList').innerHTML = '';
        fetchIoLogs();
    };

    document.getElementById('logSourceSelect').addEventListener('change', () => {
        sysState.offset = 0; sysState.hasMore = true;
        document.getElementById('logViewer').innerHTML = ''; fetchSysLogs();
    });
    document.getElementById('logViewer').addEventListener('scroll', () => {
        if (document.getElementById('logSourceSelect').value === 'internal' && logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50) fetchSysLogs();
    });

    document.getElementById('btnClearLog').onclick = async () => {
        const source = document.getElementById('logSourceSelect').value;
        if (source === 'zygisk') await run("logcat -c");
        else await run(`${LOG_CTL} clear-sys`);
        toast("日志已清空");
        if (source === 'internal') { sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; }
        fetchSysLogs();
    };

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
    indicator.classList.remove('hidden');
    try {
        const res = await run(`${LOG_CTL} search-io "${ioState.term}" ${PAGE_LIMIT} ${ioState.offset} api`);
        if (!res) { ioState.hasMore = false; } else {
            const lines = res.split('\n');
            let dataLines = lines;
            const lastLine = lines[lines.length - 1];
            if (lastLine.startsWith('DONE|')) {
                const parts = lastLine.split('|');
                ioState.hasMore = parts.length >= 3 && parseInt(parts[2]) > 0;
                dataLines = lines.slice(0, -1);
            } else if (lastLine === 'OK') { ioState.hasMore = false; dataLines = lines.slice(0, -1); }
            if (dataLines.length > 0) { ioState.offset += dataLines.length; renderIoRows(dataLines); }
            else if (ioState.offset === 0) document.getElementById('ioLogList').innerHTML = '<div class="empty-state">暂无监控数据</div>';
        }
    } catch (e) { ioState.hasMore = false; } finally { ioState.loading = false; indicator.classList.add('hidden'); }
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
        return `
            <div class="io-card">
                <div class="io-card-header">
                    <div class="io-time">${ICONS.CLOCK} <span>${timeStr}</span></div>
                    <div class="io-app text-truncate">${app ? app.appLabel : pkg}</div>
                    <div class="io-op op-${op}">${op}</div>
                </div>
                <div class="io-card-body break-all font-monospace text-muted">${details}</div>
            </div>`;
    }).join('');
    listEl.insertAdjacentHTML('beforeend', html);
};

const fetchSysLogs = async () => {
    const source = document.getElementById('logSourceSelect').value;
    const viewer = document.getElementById('logViewer');
    const indicator = document.getElementById('sysLoadingIndicator');
    if (source === 'zygisk') {
        const content = await run("logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector");
        viewer.textContent = content || "无 Zygisk 日志";
        viewer.scrollTop = viewer.scrollHeight;
        return;
    }
    if (sysState.loading || !sysState.hasMore) return;
    sysState.loading = true;
    indicator.classList.remove('hidden');
    try {
        const res = await run(`${LOG_CTL} search-sys "" ${PAGE_LIMIT} ${sysState.offset} api`);
        if (!res) { sysState.hasMore = false; } else {
            const lines = res.split('\n');
            let dataLines = lines;
            const lastLine = lines[lines.length - 1];
            if (lastLine.startsWith('DONE|')) {
                const parts = lastLine.split('|');
                sysState.hasMore = parts.length >= 3 && parseInt(parts[2]) > 0;
                dataLines = lines.slice(0, -1);
            } else if (lastLine === 'OK') { sysState.hasMore = false; dataLines = lines.slice(0, -1); }
            if (dataLines.length > 0) { sysState.offset += dataLines.length; viewer.insertAdjacentText('beforeend', dataLines.join('\n') + '\n'); }
            else if (sysState.offset === 0) viewer.textContent = "无内部日志";
        }
    } catch (e) { sysState.hasMore = false; } finally { sysState.loading = false; indicator.classList.add('hidden'); }
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
             sysState = { offset: 0, loading: false, hasMore: true, term: '' };
             document.getElementById('logViewer').innerHTML = '';
             fetchSysLogs();
        }
    };
});

const loadData = async () => {
    try {
        activeMounts = await fetchActiveMounts();
        const userRes = await run("pm list users");
        activeUsers = userRes ? [...userRes.matchAll(/UserInfo\{(\d+):/g)].map(m => parseInt(m[1])) : [0];

        const injectorConf = await run(`cat ${INJECTOR_CONF}`);
        globalConfText = ""; injectorStates.clear();
        let currentSection = "", globalLines = [];
        if (injectorConf) {
            injectorConf.split('\n').forEach(line => {
                const tLine = line.trim();
                const secMatch = tLine.match(/^\[(.*?)\](?:\s+(ON|OFF))?/);
                if (secMatch) {
                    if (currentSection === '[GLOBAL]') globalConfText = globalLines.join('\n');
                    currentSection = `[${secMatch[1]}]`;
                    if (secMatch[1] !== 'GLOBAL') injectorStates.set(secMatch[1], secMatch[2] || "ON");
                    globalLines = [];
                } else if (currentSection === '[GLOBAL]') globalLines.push(line);
            });
            if (currentSection === '[GLOBAL]') globalConfText = globalLines.join('\n');
        }

        let ruleFilesMap = new Map();
        for (const uid of activeUsers) {
            const dir = uid === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${uid}`;
            const lsRes = await run(`ls -1 ${dir} 2>/dev/null`);
            if (lsRes) {
                lsRes.split('\n').forEach(file => {
                    if (file.endsWith('.conf') || file.endsWith('.conf.off')) {
                        const pkg = file.replace('.conf.off', '').replace('.conf', '');
                        ruleFilesMap.set(`${pkg}:${uid}`, {
                            name: file,
                            isActive: file.endsWith('.conf')
                        });
                    }
                });
            }
        }

        let infos = [];
        try {
            const userPkgs = await listPackages('user') || [];
            const systemPkgs = await listPackages('system') || [];
            const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
            if (allPkgs.length > 0) infos = await getPackagesInfo(allPkgs);
        } catch (e) {}

        if (!infos || infos.length === 0) {
            const fallback = await run(`cat ${LIST_CONFIG}`);
            infos = fallback ? fallback.split('\n').filter(l => l.includes('=')).map(l => {
                const [p, n] = l.split('='); return { packageName: p.trim(), appLabel: n.trim(), isSystem: false };
            }) : [];
        }

        appMap.clear();
        infos.forEach(info => {
            let appUsers = {}; let isConfiguredAny = false;
            activeUsers.forEach(uid => {
                const key = `${info.packageName}:${uid}`;
                const fileInfo = ruleFilesMap.get(key);
                const state = injectorStates.get(key) || injectorStates.get(info.packageName) || "ON";
                
                if (fileInfo) isConfiguredAny = true;

                appUsers[uid] = {
                    isEnabled: fileInfo ? fileInfo.isActive : (state !== 'OFF'),
                    text: "", 
                    fileFound: !!fileInfo
                };
            });
            appMap.set(info.packageName, { ...info, isConfigured: isConfiguredAny, users: appUsers });
        });

        renderAppList();
        renderGlobalRules();
    } catch (e) { toast("加载异常: " + e.message); }
};

const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const searchVal = document.getElementById('appSearch').value.toLowerCase();
    const items = [...appMap.values()].filter(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return false;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return false;
        if (currentAppFilter === 'filterBound' && !app.isConfigured) return false;
        const label = (app.appLabel || "").toLowerCase();
        const pkg = (app.packageName || "").toLowerCase();
        return !searchVal || label.includes(searchVal) || pkg.includes(searchVal);
    }).sort((a, b) => (!!b.isConfigured - !!a.isConfigured) || (a.appLabel || "").localeCompare(b.appLabel || ""));
    
    listEl.innerHTML = items.length ? items.map(app => {
        let badges = [];
        activeUsers.forEach(u => {
            const uConf = app.users[u];
            if (uConf.fileFound) {
                badges.push(`<span class="badge ${uConf.isEnabled ? 'badge-primary' : 'badge-gray'} badge-pill">U${u}: ${uConf.isEnabled ? 'ON' : 'OFF'}</span>`);
            }
        });
        return `
        <div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')">
            <div class="app-main">
                <div class="app-icon-wrapper">${ICONS.ANDROID}</div>
                <div class="app-content">
                    <div class="app-header"><span class="app-name">${app.appLabel}</span>${activeMounts.has(app.packageName) ? '<span class="badge badge-success badge-mount">MOUNTED</span>' : ''}</div>
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
};

const parseConfigTextToVisual = (text, containerId, monitorSelectId, sandboxSelectId) => {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const selM = document.getElementById(monitorSelectId); if(selM) selM.value = "";
    const selS = document.getElementById(sandboxSelectId); if(selS) selS.value = "";
    if (text) {
        text.split('\n').forEach(line => {
            const p = line.trim().split(/\s+/);
            if (p[0] === 'REDIRECT' && p.length >= 3) addRuleRow('REDIRECT', normalizeToDisplay(p[1]), normalizeToDisplay(p.slice(2).join(' ')), containerId);
            else if (p[0] === 'HIDE' && p.length >= 2) addRuleRow('HIDE', normalizeToDisplay(p[1]), '', containerId);
            else if (p[0] === 'MONITOR' && selM) selM.value = p[1];
            else if (p[0] === 'SANDBOX' && selS) selS.value = p[1];
        });
    }
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '', containerId);
};

const generateConfigTextFromVisual = (containerId, monitorSelectId, sandboxSelectId) => {
    let res = "";
    const m = document.getElementById(monitorSelectId)?.value; if(m) res += `MONITOR ${m}\n`;
    const s = document.getElementById(sandboxSelectId)?.value; if(s) res += `SANDBOX ${s}\n`;
    document.querySelectorAll(`#${containerId} .rule-row`).forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const target = row.querySelector('.rule-target').value.trim();
        const source = row.querySelector('.rule-source').value.trim();
        if (target) {
            if (type === 'REDIRECT' && source) res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
            else if (type === 'HIDE') res += `HIDE ${normalizeToConfig(target, true)}\n`;
        }
    });
    return res;
};

const addRuleRow = (type, target, source, containerId) => {
    const div = document.createElement('div'); div.className = 'rule-row';
    div.innerHTML = `<select class="form-select rule-type"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select><div class="rule-inputs"><input type="text" class="form-control rule-target" placeholder="原始路径" value="${target}"><input type="text" class="form-control rule-source ${type==='HIDE'?'hidden':''}" placeholder="重定向至" value="${source}"></div><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    const sel = div.querySelector('.rule-type'); sel.value = type;
    sel.onchange = (e) => div.querySelector('.rule-source').classList.toggle('hidden', e.target.value === 'HIDE');
    div.querySelector('.btn-del').onclick = () => div.remove();
    setupAutocomplete(div.querySelector('.rule-target')); setupAutocomplete(div.querySelector('.rule-source'));
    document.getElementById(containerId).appendChild(div);
};

const flushInjectorConf = async () => {
    let res = `[GLOBAL]\n${globalConfText.trim()}\n\n`;
    injectorStates.forEach((state, key) => { res += `[${key}] ${state}\n\n`; });
    await exec(`echo '${res.replace(/'/g, "'\\''")}' > ${INJECTOR_CONF}`);
};

window.openAppConfig = async (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('appUserTabs').innerHTML = activeUsers.map(uid => `<button class="nav-item ${uid === activeUsers[0] ? 'active' : ''}" data-uid="${uid}" onclick="window.switchAppUser(${uid})">${ICONS.USER} 用户 ${uid}</button>`).join('');
    window.switchAppUser(activeUsers[0]);
    openModal('appConfigModal');
};

window.switchAppUser = async (uid) => {
    currentBindingUser = uid;
    document.querySelectorAll('#appUserTabs .nav-item').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.uid) === uid));
    const dir = uid === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${uid}`;
    
    // 尝试读取 .conf 或 .conf.off
    let content = await run(`cat ${dir}/${currentBindingPkg}.conf 2>/dev/null`);
    let isEnabled = true;
    if (!content) {
        content = await run(`cat ${dir}/${currentBindingPkg}.conf.off 2>/dev/null`);
        if (content) isEnabled = false;
    }

    document.getElementById('appEnableToggle').checked = isEnabled;
    document.getElementById('appRuleContent').value = content || "";
    parseConfigTextToVisual(content || "", 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect');
};

document.getElementById('btnSaveAppConfig').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="appEditorMode"][value="visual"]').checked;
        let text = isVisual ? generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect') : document.getElementById('appRuleContent').value;
        const isEnabled = document.getElementById('appEnableToggle').checked;
        const exactKey = `${currentBindingPkg}:${currentBindingUser}`;
        const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
        
        // 如果 text 为空，写入一个空格或注释，确保文件存在从而让应用出现在“已配置”列表中
        if (!text.trim()) text = "# Managed by Namespace-Proxy";

        await run(`mkdir -p ${dir}`);
        // 删除旧命名的文件(清理残留)
        await run(`rm -f ${dir}/${currentBindingPkg}.conf ${dir}/${currentBindingPkg}.conf.off`);
        
        // 根据状态决定文件名
        const finalPath = `${dir}/${currentBindingPkg}.conf${isEnabled ? '' : '.off'}`;
        await exec(`echo '${text.replace(/'/g, "'\\''")}' > ${finalPath}`);
        
        injectorStates.set(exactKey, isEnabled ? 'ON' : 'OFF');
        await flushInjectorConf();
        toast("配置已保存"); closeModal('appConfigModal'); loadData();
    } catch (e) { toast("保存失败: " + e.message); }
};

document.getElementById('btnDeleteAppConfig').onclick = async () => {
    if (!confirm(`确定彻底删除该应用的所有规则文件吗?`)) return;
    const dir = currentBindingUser === 0 ? `${BASE_DIR}/App-rules` : `${BASE_DIR}/App-rules-${currentBindingUser}`;
    await run(`rm -f ${dir}/${currentBindingPkg}.conf ${dir}/${currentBindingPkg}.conf.off`);
    injectorStates.delete(`${currentBindingPkg}:${currentBindingUser}`);
    await flushInjectorConf();
    toast("规则已彻底移除"); closeModal('appConfigModal'); loadData();
};

document.getElementById('btnSaveGlobal').onclick = async () => {
    const isVisual = document.querySelector('input[name="globalEditorMode"][value="visual"]').checked;
    globalConfText = isVisual ? generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect') : document.getElementById('globalRuleContent').value;
    await flushInjectorConf(); toast("全局规则已保存"); loadData();
};

window.openModal = (id) => { const el = document.getElementById(id); el.classList.remove('hiding'); el.classList.add('show'); };
window.closeModal = (id) => { const el = document.getElementById(id); el.classList.add('hiding'); setTimeout(() => { el.classList.remove('show'); el.classList.remove('hiding'); }, 250); };

const normalizeToDisplay = (path) => { if (!path) return ""; if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/"; if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/"; return path; };
const normalizeToConfig = (path, isT) => { if (!path) return ""; path = path.trim(); if (isT) return (path.startsWith('/') ? path : (PATH_PREFIX_STORAGE + '/' + path)).replace(/\/+/g, '/'); return (path.startsWith('/') ? path : (PATH_PREFIX_REAL + '/' + path)).replace(/\/+/g, '/'); };

document.getElementById('btnToggleStatus').onclick = async () => {
    const isRunning = document.getElementById('btnToggleStatus').getAttribute('data-status') === 'running';
    if (isRunning) { if (currentPid) { await run(`kill -15 ${currentPid}`); toast("停止中..."); } }
    else { await run(`sh ${SERVICE_SH}`); toast("启动中..."); setTimeout(loadData, 1000); }
    setTimeout(checkStatus, 1000);
};

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    input.addEventListener('input', debounce(async (e) => {
        let val = e.target.value.replace(/^\/+/, '');
        let parentDir = PATH_PREFIX_REAL + '/', searchP = "", displayB = "/";
        if (val) {
            const lastS = val.lastIndexOf('/');
            if (lastS !== -1) { parentDir = PATH_PREFIX_REAL + '/' + val.substring(0, lastS + 1); searchP = val.substring(lastS + 1); displayB = "/" + val.substring(0, lastS + 1); }
            else searchP = val;
        }
        const res = await exec(`ls -F -1 "${parentDir.replace(/\/+/g, '/')}" 2>/dev/null | head -n 20`);
        if (!res.stdout) { box.style.display = 'none'; return; }
        const items = res.stdout.split('\n').filter(l => l.startsWith(searchP)).map(l => ({ text: displayB + l, icon: l.endsWith('/') ? ICONS.FOLDER : ICONS.FILE }));
        if (items.length === 0) { box.style.display = 'none'; return; }
        box.innerHTML = items.map(s => `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window.applySuggestion('${s.text}')"><div class="s-icon">${s.icon}</div><div class="s-text">${s.text}</div></div>`).join('');
        box.style.display = 'block';
        const r = input.getBoundingClientRect(); box.style.width = r.width + 'px'; box.style.left = r.left + 'px'; box.style.top = r.bottom + 'px';
    }, 200));
    input.addEventListener('focus', () => window._currentInput = input);
    input.addEventListener('blur', () => setTimeout(() => box.style.display = 'none', 200));
};
window.applySuggestion = (t) => { if (window._currentInput) { window._currentInput.value = t; window._currentInput.dispatchEvent(new Event('input')); } };

const handleModeChange = (isVisual, visualId, rawId, contentId, parseF, genF) => {
    const v = document.getElementById(visualId), r = document.getElementById(rawId);
    if (isVisual) { r.classList.add('hidden'); v.classList.remove('hidden'); parseF(document.getElementById(contentId).value); }
    else { v.classList.add('hidden'); r.classList.remove('hidden'); document.getElementById(contentId).value = genF(); }
};

document.querySelectorAll('input[name="globalEditorMode"]').forEach(el => el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'globalVisual', 'globalRaw', 'globalRuleContent', (v) => parseConfigTextToVisual(v, 'globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect'), () => generateConfigTextFromVisual('globalRuleBuilderContainer', 'globalMonitorSelect', 'globalSandboxSelect')));
document.querySelectorAll('input[name="appEditorMode"]').forEach(el => el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'appVisual', 'appRaw', 'appRuleContent', (v) => parseConfigTextToVisual(v, 'appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect'), () => generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect', 'appSandboxSelect')));

const openMonitorIgnoreEditor = async () => {
    const content = await run(`cat ${MONITOR_IGNORE_CONF}`);
    document.getElementById('monitorIgnoreContent').value = content;
    const container = document.getElementById('ignoreBuilderContainer'); container.innerHTML = '';
    if (content) content.split('\n').forEach(l => { if(l.trim()) addIgnoreRow(l.trim()); });
    if (container.children.length === 0) addIgnoreRow('');
    openModal('monitorIgnoreModal');
};
const addIgnoreRow = (p) => {
    const div = document.createElement('div'); div.className = 'rule-row';
    div.innerHTML = `<input type="text" class="form-control" placeholder="路径前缀" value="${p}"><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    div.querySelector('.btn-del').onclick = () => div.remove(); setupAutocomplete(div.querySelector('input'));
    document.getElementById('ignoreBuilderContainer').appendChild(div);
};
document.getElementById('btnSaveIgnore').onclick = async () => {
    let res = ""; document.querySelectorAll('#ignoreBuilderContainer input').forEach(i => { if(i.value.trim()) res += i.value.trim() + '\n'; });
    await exec(`echo '${res}' > ${MONITOR_IGNORE_CONF}`); toast("忽略配置已保存"); closeModal('monitorIgnoreModal');
};