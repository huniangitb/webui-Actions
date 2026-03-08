import './style.css';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { 
    mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile, 
    mdiRefresh, mdiMagnify, mdiPlus, mdiClose, mdiChevronRight,
    mdiFilterVariant, mdiViewGrid, mdiViewList, mdiStop, mdiPlay,
    mdiEyeOff, mdiDeleteSweep
} from '@mdi/js';

const BASE_DIR = "/data/Namespace-Proxy";
const INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const MONITOR_IGNORE_CONF = `${BASE_DIR}/monitor_ignore.conf`;
const LOG_CTL = "/data/adb/modules/Namespace-Proxy/bin/log_ctl";
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
const PATH_PREFIX_STORAGE = '/storage/emulated/0';
const PATH_PREFIX_REAL = '/data/media/0';

let appMap = new Map();
let confSections = new Map(); // key: "[GLOBAL]" or "[pkg]", value: text content
let activeMounts = new Set();
let statusPolling = null;
let currentAppFilter = 'filterUser';
let currentPid = null;
let currentBindingPkg = null;

const PAGE_LIMIT = 50;
let ioState = { offset: 0, loading: false, hasMore: true, term: '' };
let sysState = { offset: 0, loading: false, hasMore: true, term: '' };

const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    ENV: getSvg(mdiLayers, 24, '#1266f1'),
    DELETE: getSvg(mdiDelete, 18, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e'),
    REFRESH: getSvg(mdiRefresh, 20, '#000'),
    SEARCH: getSvg(mdiMagnify, 18, '#868e96'),
    PLUS: getSvg(mdiPlus, 16, '#fff'),
    CLOSE: getSvg(mdiClose, 28, '#5f6368'),
    CHEVRON: getSvg(mdiChevronRight, 20, '#adb5bd'),
    FILTER: getSvg(mdiFilterVariant, 24, '#fff'),
    GRID: getSvg(mdiViewGrid, 24, '#fff'),
    LIST: getSvg(mdiViewList, 24, '#fff'),
    STOP: getSvg(mdiStop, 20, '#dc3545'),
    PLAY: getSvg(mdiPlay, 20, '#36a420'),
    EYE_OFF: getSvg(mdiEyeOff, 20, 'currentColor'),
    CLEAR: getSvg(mdiDeleteSweep, 20, '#fff')
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
        toast(`执行错误: ${e.message || e}`); 
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
    } catch (e) {
        console.error("Fetch mounts error", e);
        return new Set();
    }
};

const updateMountStatus = async () => {
    try {
        const newMounts = await fetchActiveMounts();
        activeMounts = newMounts;
        document.querySelectorAll('#appList .list-item').forEach(item => {
            const pkg = item.dataset.pkg;
            if (!pkg) return;
            const header = item.querySelector('.app-header');
            if (!header) return;
            const badge = header.querySelector('.badge-success');
            const isMounted = activeMounts.has(pkg);
            if (isMounted && !badge) header.insertAdjacentHTML('beforeend', `<span class="badge badge-success">MOUNTED</span>`);
            else if (!isMounted && badge && badge.textContent === 'MOUNTED') badge.remove();
        });
    } catch (e) {
        console.error("Update mount status error", e);
    }
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
    } catch (e) {
        console.error("Check status error", e);
    }
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
    setHtml('btnAppAddRule', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加规则</span>`);
    setHtml('btnGlobalAddRule', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加全局规则</span>`);
    setHtml('btnAddIgnoreRow', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加路径</span>`);

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

    const ioContainer = document.getElementById('ioTableContainer');
    const debouncedIoSearch = debounce(() => {
        ioState.offset = 0;
        ioState.hasMore = true;
        ioState.term = document.getElementById('ioSearch').value.trim();
        document.getElementById('ioTableBody').innerHTML = '';
        fetchIoLogs();
    }, 500);
    
    document.getElementById('ioSearch').addEventListener('input', debouncedIoSearch);
    if (ioContainer) {
        ioContainer.addEventListener('scroll', () => {
            if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) {
                fetchIoLogs();
            }
        });
    }

    const btnClearIo = document.getElementById('btnClearIo');
    if (btnClearIo) {
        btnClearIo.onclick = async () => {
            await run(`${LOG_CTL} clear-io`);
            toast("IO 日志已清理");
            ioState.offset = 0;
            ioState.hasMore = true;
            document.getElementById('ioTableBody').innerHTML = '';
            fetchIoLogs();
        };
    }

    const logSelect = document.getElementById('logSourceSelect');
    const logViewer = document.getElementById('logViewer');
    
    if (logSelect) {
        logSelect.addEventListener('change', () => {
            sysState.offset = 0;
            sysState.hasMore = true;
            logViewer.innerHTML = '';
            fetchSysLogs();
        });
    }

    if (logViewer) {
        logViewer.addEventListener('scroll', () => {
            if (logSelect.value === 'internal' && logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50) {
                fetchSysLogs();
            }
        });
    }

    const btnClearLog = document.getElementById('btnClearLog');
    if (btnClearLog) {
        btnClearLog.onclick = async () => {
            const source = logSelect.value;
            if (source === 'zygisk') {
                await run("logcat -c");
            } else {
                await run(`${LOG_CTL} clear-sys`);
            }
            toast("日志已清空");
            if (source === 'internal') {
                sysState.offset = 0;
                sysState.hasMore = true;
                logViewer.innerHTML = '';
            }
            fetchSysLogs();
        };
    }

    document.getElementById('btnMonitorIgnore').onclick = openMonitorIgnoreEditor;
});

const debounce = (func, wait) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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
                } else {
                    ioState.hasMore = false;
                }
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
                    document.getElementById('ioTableBody').innerHTML = '<tr><td colspan="4" class="text-center text-muted">暂无数据</td></tr>';
                }
            }
        }
    } catch (e) {
        console.error("Fetch IO logs error", e);
        toast("获取 IO 日志失败");
        ioState.hasMore = false;
    } finally {
        ioState.loading = false;
        if (indicator) indicator.classList.add('hidden');
    }
};

const renderIoRows = (lines) => {
    const tbody = document.getElementById('ioTableBody');
    if (tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = '';

    const html = lines.map(line => {
        if (!line.trim()) return '';
        const parts = line.split('|');
        if (parts.length < 2) return '';
        
        const ts = parseInt(parts[0]);
        const content = parts.slice(1).join('|');
        
        let pkg = "未知", op = "INFO", details = content;
        
        const match = content.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
        if (match) {
            pkg = match[1];
            op = match[2];
            details = match[3];
        }

        const date = new Date(ts * 1000);
        const timeStr = isNaN(date.getTime()) ? "无效时间" : date.toLocaleString('zh-CN', { 
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
        });

        const app = appMap.get(pkg);
        const appName = app ? app.appLabel : pkg;

        return `
            <tr>
                <td class="text-muted small font-monospace">${timeStr}</td>
                <td><div class="text-truncate" style="max-width:100px" title="${pkg}">${appName}</div></td>
                <td><span class="op-tag op-${op}">${op}</span></td>
                <td class="break-all font-monospace small">${details}</td>
            </tr>
        `;
    }).join('');
    
    tbody.insertAdjacentHTML('beforeend', html);
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
        } catch (e) {
            toast("获取 Logcat 失败");
        }
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
    } catch (e) {
        console.error("Fetch Sys logs error", e);
        sysState.hasMore = false;
    } finally {
        sysState.loading = false;
        if (indicator) indicator.classList.add('hidden');
    }
};

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.dataset.target;
        document.getElementById(targetId).classList.add('active');
        
        if (targetId === 'content-io') {
             ioState = { offset: 0, loading: false, hasMore: true, term: document.getElementById('ioSearch').value.trim() };
             document.getElementById('ioTableBody').innerHTML = '';
             fetchIoLogs();
        } else if (targetId === 'content-log') {
             const isInternal = document.getElementById('logSourceSelect').value === 'internal';
             if (isInternal) {
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
        
        const content = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        confSections.clear();
        let currentSection = "[GLOBAL]";
        let currentLines = [];
        
        if (content) {
            content.split('\n').forEach(line => {
                let trimLine = line.trim();
                if (trimLine.startsWith('[') && trimLine.endsWith(']')) {
                    if (currentLines.length > 0 || currentSection === '[GLOBAL]') {
                        confSections.set(currentSection, currentLines.join('\n'));
                    }
                    currentSection = trimLine;
                    currentLines = [];
                } else {
                    currentLines.push(line);
                }
            });
            confSections.set(currentSection, currentLines.join('\n'));
        } else {
            confSections.set("[GLOBAL]", "");
        }

        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
        const infos = await getPackagesInfo(allPkgs);

        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info && info.packageName) {
                    const sectionKey = `[${info.packageName}]`;
                    const isConfigured = confSections.has(sectionKey);
                    let hasMonitor = false;
                    let hasRules = false;
                    if (isConfigured) {
                        const text = confSections.get(sectionKey);
                        if (text.includes('MONITOR ON')) hasMonitor = true;
                        if (text.includes('REDIRECT') || text.includes('HIDE')) hasRules = true;
                    }
                    appMap.set(info.packageName, { ...info, isConfigured, hasMonitor, hasRules });
                }
            });
        }

        renderAppList();
        renderGlobalRules();
    } catch (e) {
        console.error("Load data error", e);
        toast("数据加载异常: " + e.message);
    }
};

const renderAppList = () => {
    try {
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
            let mountedBadge = activeMounts.has(app.packageName) ? `<span class="badge badge-success">MOUNTED</span>` : "";
            
            let badges = [];
            if (app.hasMonitor) {
                badges.push(`<span class="badge badge-warning badge-pill">MONITOR</span>`);
            }
            if (app.hasRules) {
                badges.push(`<span class="badge badge-primary badge-pill">RULES</span>`);
            }
            
            return `
            <div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')">
                <div class="app-main">
                    <div class="app-icon-wrapper">${ICONS.ANDROID}</div>
                    <div class="app-content">
                        <div class="app-header"><span class="app-name">${app.appLabel}</span>${mountedBadge}</div>
                        <small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small>
                    </div>
                </div>
                <div class="app-end">${badges.join(' ')}</div>
            </div>`;
        }).join('') : '<div class="empty-state">无匹配应用</div>';
    } catch (e) {
        console.error("Render app list error", e);
    }
};

const renderGlobalRules = () => {
    const text = confSections.has('[GLOBAL]') ? confSections.get('[GLOBAL]') : "";
    document.getElementById('globalRuleContent').value = text;
    parseConfigTextToVisual(text, 'globalRuleBuilderContainer', null);
    
    const visualRadio = document.querySelector('input[name="globalEditorMode"][value="visual"]');
    if (visualRadio && !visualRadio.checked) { 
        visualRadio.checked = true; 
        handleModeChange(true, 'content-global', 'globalVisual', 'globalRaw', 'globalAlert', 'fabGlobal', 'globalRuleContent', 
            (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', null),
            () => generateConfigTextFromVisual('globalRuleBuilderContainer', null));
    }
};

const parseConfigTextToVisual = (text, containerId, monitorSelectId) => {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const selMonitor = monitorSelectId ? document.getElementById(monitorSelectId) : null;
    if (selMonitor) selMonitor.value = "";

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
            }
        });
    }
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '', containerId);
};

const generateConfigTextFromVisual = (containerId, monitorSelectId) => {
    let res = "";
    const selMonitor = monitorSelectId ? document.getElementById(monitorSelectId) : null;
    if (selMonitor && selMonitor.value) {
        res += `MONITOR ${selMonitor.value}\n`;
    }

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

const flushConfig = async () => {
    let result = "";
    if (confSections.has('[GLOBAL]')) {
        result += `[GLOBAL]\n${confSections.get('[GLOBAL]').trim()}\n\n`;
    } else {
        result += `[GLOBAL]\n\n`;
    }
    
    confSections.forEach((text, section) => {
        if (section !== '[GLOBAL]' && text.trim()) {
            result += `${section}\n${text.trim()}\n\n`;
        }
    });
    
    const safeResult = result.replace(/'/g, "'\\''");
    await exec(`echo '${safeResult}' > ${INJECTOR_CONF}`);
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    if (!app) return;
    
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    
    const sectionKey = `[${pkg}]`;
    const text = confSections.has(sectionKey) ? confSections.get(sectionKey) : "";
    document.getElementById('appRuleContent').value = text;
    parseConfigTextToVisual(text, 'appRuleBuilderContainer', 'appMonitorSelect');
    
    const visualRadio = document.querySelector('input[name="appEditorMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
    
    openModal('appConfigModal');
};

document.getElementById('btnSaveAppConfig').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="appEditorMode"][value="visual"]').checked;
        const text = isVisual ? generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect') : document.getElementById('appRuleContent').value;
        
        const sectionKey = `[${currentBindingPkg}]`;
        if (text.trim()) {
            confSections.set(sectionKey, text);
        } else {
            confSections.delete(sectionKey);
        }
        
        await flushConfig();
        toast("应用配置已保存");
        closeModal('appConfigModal');
        loadData();
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

document.getElementById('btnDeleteAppConfig').onclick = async () => {
    try {
        if (!confirm(`确定清除该应用的配置吗?`)) return;
        confSections.delete(`[${currentBindingPkg}]`);
        await flushConfig();
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
        const text = isVisual ? generateConfigTextFromVisual('globalRuleBuilderContainer', null) : document.getElementById('globalRuleContent').value;
        
        confSections.set('[GLOBAL]', text);
        await flushConfig();
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
        box.style.top = 'auto';
        box.style.bottom = (window.innerHeight - rect.top) + 'px';
        box.style.maxHeight = (rect.top - 10) + 'px';
        box.style.borderRadius = '8px 8px 0 0';
        box.style.borderBottom = 'none';
        box.style.borderTop = '1px solid var(--border)';
    } else {
        box.style.top = rect.bottom + 'px';
        box.style.bottom = 'auto';
        box.style.maxHeight = (window.innerHeight - rect.bottom - 10) + 'px';
        box.style.borderRadius = '0 0 8px 8px';
        box.style.borderTop = 'none';
        box.style.borderBottom = '1px solid var(--border)';
    }
};

const startAutoUpdate = (input) => {
    const box = document.getElementById('suggestionBox');
    const loop = () => {
        if (box.style.display !== 'none' && window._currentInput === input) {
            updateBoxPosition(input);
            requestAnimationFrame(loop);
        }
    };
    requestAnimationFrame(loop);
};

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    const performSearch = debounce(async (val) => {
        let parentDir = PATH_PREFIX_REAL;
        let searchPrefix = "";
        let displayBase = "/";
        const cleanVal = val ? val.replace(/^\/+/, '') : "";
        if (!cleanVal) parentDir = PATH_PREFIX_REAL + '/';
        else if (cleanVal.endsWith('/')) { parentDir = PATH_PREFIX_REAL + '/' + cleanVal; displayBase = "/" + cleanVal; }
        else {
            const lastSlashIndex = cleanVal.lastIndexOf('/');
            if (lastSlashIndex === -1) searchPrefix = cleanVal;
            else {
                const dirPart = cleanVal.substring(0, lastSlashIndex + 1);
                parentDir = PATH_PREFIX_REAL + '/' + dirPart;
                searchPrefix = cleanVal.substring(lastSlashIndex + 1);
                displayBase = "/" + dirPart;
            }
        }
        parentDir = parentDir.replace(/\/+/g, '/');
        try {
            const res = await exec(`ls -F -1 "${parentDir}" 2>/dev/null | head -n 30`);
            if (!res || !res.stdout) { box.style.display = 'none'; return; }
            const suggestions = res.stdout.split('\n').filter(l => l.startsWith(searchPrefix)).map(line => {
                const isDir = line.endsWith('/');
                return { text: displayBase + (isDir ? line : line) + (isDir ? '' : ''), icon: isDir ? ICONS.FOLDER : ICONS.FILE };
            });
            if (suggestions.length === 0) { box.style.display = 'none'; return; }
            box.innerHTML = suggestions.map(s => `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window.applySuggestion('${s.text}')"><div class="s-icon">${s.icon}</div><div class="s-text">${s.text}</div></div>`).join('');
            box.style.display = 'block';
            updateBoxPosition(input);
            startAutoUpdate(input);
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
    
    const themeTarget = containerEl.classList.contains('modal') ? containerEl.querySelector('.modal-content') : containerEl.querySelector('.card') || containerEl;

    if (isVisual) {
        if (themeTarget) themeTarget.classList.remove('dark-theme');
        rawEl.classList.remove('active');
        setTimeout(() => {
            rawEl.classList.add('hidden');
            visualEl.classList.remove('hidden');
            if (alertBox) alertBox.classList.remove('collapsed');
            if (fab) fab.classList.remove('hidden');
            parseFunc(document.getElementById(contentId).value);
            requestAnimationFrame(() => { visualEl.classList.add('active'); });
        }, 250);
    } else {
        if (themeTarget) themeTarget.classList.add('dark-theme');
        visualEl.classList.remove('active');
        if (alertBox) alertBox.classList.add('collapsed');
        if (fab) fab.classList.add('hidden');
        setTimeout(() => {
            visualEl.classList.add('hidden');
            rawEl.classList.remove('hidden');
            document.getElementById(contentId).value = genFunc();
            requestAnimationFrame(() => { rawEl.classList.add('active'); });
        }, 250);
    }
};

document.querySelectorAll('input[name="globalEditorMode"]').forEach(el => {
    el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'content-global', 'globalVisual', 'globalRaw', 'globalAlert', 'fabGlobal', 'globalRuleContent', 
        (val) => parseConfigTextToVisual(val, 'globalRuleBuilderContainer', null),
        () => generateConfigTextFromVisual('globalRuleBuilderContainer', null));
});

document.querySelectorAll('input[name="appEditorMode"]').forEach(el => {
    el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'appConfigModal', 'appVisual', 'appRaw', null, 'fabApp', 'appRuleContent', 
        (val) => parseConfigTextToVisual(val, 'appRuleBuilderContainer', 'appMonitorSelect'),
        () => generateConfigTextFromVisual('appRuleBuilderContainer', 'appMonitorSelect'));
});

document.getElementById('btnGlobalAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'globalRuleBuilderContainer');
document.getElementById('btnAppAddRule').onclick = () => addRuleRow('REDIRECT', '', '', 'appRuleBuilderContainer');

const parseIgnoreToVisual = (text) => {
    const container = document.getElementById('ignoreBuilderContainer');
    container.innerHTML = '';
    if (text) {
        text.split('\n').forEach(line => {
            const val = line.trim();
            if (val && !val.startsWith('#')) addIgnoreRow(val);
        });
    }
    if (container.children.length === 0) addIgnoreRow('');
};

const generateIgnoreFromVisual = () => {
    let res = "";
    document.querySelectorAll('#ignoreBuilderContainer .ignore-row input').forEach(input => {
        const val = input.value.trim();
        if (val) res += `${val}\n`;
    });
    return res;
};

const addIgnoreRow = (path) => {
    const div = document.createElement('div');
    div.className = 'rule-row ignore-row';
    div.innerHTML = `<input type="text" class="form-control" placeholder="输入要忽略的路径前缀" value="${path}"><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    div.querySelector('.btn-del').onclick = () => div.remove();
    setupAutocomplete(div.querySelector('input'));
    document.getElementById('ignoreBuilderContainer').appendChild(div);
};

const openMonitorIgnoreEditor = async () => {
    const content = await run(`cat ${MONITOR_IGNORE_CONF} 2>/dev/null`);
    document.getElementById('monitorIgnoreContent').value = content;
    parseIgnoreToVisual(content);
    document.getElementById('alertIgnore').classList.remove('collapsed');
    const modalContent = document.querySelector('#monitorIgnoreModal .modal-content');
    modalContent.classList.remove('dark-theme');
    const visualRadio = document.querySelector('input[name="ignoreMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
    openModal('monitorIgnoreModal');
};

document.querySelectorAll('input[name="ignoreMode"]').forEach(el => {
    el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'monitorIgnoreModal', 'ignoreVisual', 'ignoreRaw', 'alertIgnore', 'fabIgnore', 'monitorIgnoreContent', parseIgnoreToVisual, generateIgnoreFromVisual);
});

document.getElementById('btnAddIgnoreRow').onclick = () => addIgnoreRow('');

document.getElementById('btnSaveIgnore').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="ignoreMode"][value="visual"]').checked;
        const content = isVisual ? generateIgnoreFromVisual() : document.getElementById('monitorIgnoreContent').value;
        await exec(`echo '${content}' > ${MONITOR_IGNORE_CONF}`);
        toast("忽略配置已保存");
        closeModal('monitorIgnoreModal');
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};