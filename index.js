import './style.scss';
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
let envList = [];
let envStats = new Map(); 
let envViewMode = 'grid';
let registry = new Map();
let currentEditingEnv = null;
let currentBindingPkg = null;
let activeMounts = new Set();
let statusPolling = null;
let currentAppFilter = 'filterUser';
let currentPid = null;

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

// 核心执行函数：增加错误捕获，防止白屏
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        // 部分命令可能只有 stderr 没有 stdout，视情况处理
        if (res.errno && res.errno !== 0) {
            console.warn(`Cmd failed: ${cmd}`, res.stderr);
            return ""; 
        }
        return res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        console.error("Exec exception:", e);
        toast(`执行错误: ${e.message || e}`); // 关键：提示错误
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
        // 不弹窗，避免定时器频繁骚扰
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 初始化图标
    const setIcon = (id, icon) => { const el = document.getElementById(id); if(el) el.innerHTML = icon; };
    setIcon('iconSearch', ICONS.SEARCH);
    setIcon('iconIoSearch', ICONS.SEARCH);
    setIcon('iconFilter', ICONS.FILTER);
    setIcon('iconEnvView', ICONS.LIST);
    setIcon('btnMonitorIgnore', ICONS.EYE_OFF);
    setIcon('iconClearIo', ICONS.CLEAR);
    setIcon('iconClearLog', ICONS.CLEAR);
    document.querySelectorAll('.btn-close').forEach(el => el.innerHTML = ICONS.CLOSE);
    
    const setHtml = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
    setHtml('btnNewEnv', `<span style="display:flex;align-items:center;gap:4px">${getSvg(mdiPlus,14,'#fff')} 新建</span>`);
    setHtml('btnAddRuleRow', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加规则</span>`);
    setHtml('btnAddIgnoreRow', `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加路径</span>`);

    loadData();
    checkStatus();
    
    if (statusPolling) clearInterval(statusPolling);
    statusPolling = setInterval(checkStatus, 2000); // 放宽检查间隔

    document.getElementById('appSearch').oninput = renderAppList;
    
    document.getElementById('btnEnvViewToggle').onclick = () => {
        envViewMode = envViewMode === 'grid' ? 'list' : 'grid';
        document.getElementById('iconEnvView').innerHTML = envViewMode === 'grid' ? ICONS.LIST : ICONS.GRID;
        renderEnvList();
    };

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

    // 滚动监听与 IO 逻辑
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

    // 日志逻辑
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

// ---------------------------------------------------------
// IO 日志获取 (增强错误处理)
// ---------------------------------------------------------
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

            // 解析结束标记 DONE|total|remain
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
    // 如果之前显示暂无数据，先清空
    if (tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = '';

    const html = lines.map(line => {
        if (!line.trim()) return '';
        // 格式: 1768742124|[com.termux] [OPEN] /ii.html
        const parts = line.split('|');
        if (parts.length < 2) return '';
        
        const ts = parseInt(parts[0]);
        // 剩余部分重新组合，防止内容里有 |
        const content = parts.slice(1).join('|');
        
        let pkg = "未知", op = "INFO", details = content;
        
        // 解析 [PKG] [OP] Details
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

// ---------------------------------------------------------
// 系统日志获取
// ---------------------------------------------------------
const fetchSysLogs = async () => {
    const source = document.getElementById('logSourceSelect').value;
    const viewer = document.getElementById('logViewer');
    const indicator = document.getElementById('sysLoadingIndicator');

    if (source === 'zygisk') {
        try {
            const content = await run("logcat -d -s Zygisk_Blocker NamespaceProxy_Injector");
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

// ---------------------------------------------------------
// Tab 切换逻辑
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// 数据加载与初始化
// ---------------------------------------------------------
const loadData = async () => {
    try {
        activeMounts = await fetchActiveMounts();
        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files ? files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector' && n !== 'monitor_ignore') : [];
        
        envStats.clear();
        if (envList.length > 0) {
            const countsR = await run(`grep -c "REDIRECT" ${BASE_DIR}/*.conf 2>/dev/null`);
            const countsH = await run(`grep -c "HIDE" ${BASE_DIR}/*.conf 2>/dev/null`);
            envList.forEach(env => {
                const regR = new RegExp(`${env}\\.conf:(\\d+)`);
                const matchR = countsR.match(regR);
                const matchH = countsH.match(new RegExp(`${env}\\.conf:(\\d+)`));
                envStats.set(env, { r: matchR ? parseInt(matchR[1]) : 0, h: matchH ? parseInt(matchH[1]) : 0 });
            });
        }

        const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        registry.clear();
        if (regContent) {
            regContent.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && !line.trim().startsWith('#')) {
                    const paramStr = parts.slice(2).join(' ') || "";
                    registry.set(parts[0], { env: parts[1], param: paramStr });
                }
            });
        }

        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
        const infos = await getPackagesInfo(allPkgs);

        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info && info.packageName) {
                    const reg = registry.get(info.packageName);
                    appMap.set(info.packageName, { ...info, boundEnv: reg?.env, boundParam: reg?.param });
                }
            });
        }

        renderAppList();
        renderEnvList();
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
            if (currentAppFilter === 'filterBound' && !app.boundEnv) return;
            const label = app.appLabel || app.packageName;
            if (searchVal && !label.toLowerCase().includes(searchVal) && !app.packageName.toLowerCase().includes(searchVal)) return;
            items.push(app);
        });
        items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || (a.appLabel || "").localeCompare(b.appLabel || ""));
        listEl.innerHTML = items.length ? items.map(app => {
            let mountedBadge = activeMounts.has(app.packageName) ? `<span class="badge badge-success">MOUNTED</span>` : "";
            
            let badgeClass = 'badge-primary';
            let badgeStyle = '';
            let badgeText = app.boundEnv;
            const param = app.boundParam || "";

            if (param.includes('MONITOR')) badgeClass = 'badge-warning';
            else if (param.includes('PASSTHROUGH')) badgeClass = 'badge-success';
            
            if (param.includes('MERGE')) {
                badgeText += ' (M)';
                if (!param.includes('MONITOR') && !param.includes('PASSTHROUGH')) {
                    badgeStyle = 'style="background:#6f42c1"';
                }
            }

            let envBadge = app.boundEnv ? `<span class="badge ${badgeClass} badge-pill" ${badgeStyle}>${badgeText}</span>` : "";
            
            return `
            <div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')">
                <div class="app-main">
                    <div class="app-icon-wrapper">${ICONS.ANDROID}</div>
                    <div class="app-content">
                        <div class="app-header"><span class="app-name">${app.appLabel}</span>${mountedBadge}</div>
                        <small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small>
                    </div>
                </div>
                <div class="app-end">${envBadge}</div>
            </div>`;
        }).join('') : '<div class="empty-state">无匹配应用</div>';
    } catch (e) {
        console.error("Render app list error", e);
    }
};

const renderEnvList = () => {
    try {
        const listEl = document.getElementById('envList');
        if (envList.length === 0) {
            listEl.innerHTML = '<div class="empty-state full-col">暂无环境</div>';
            return;
        }
        listEl.className = `grid-list scroll-y ${envViewMode === 'list' ? 'list-mode' : ''}`;
        listEl.innerHTML = envList.map(env => {
            const stats = envStats.get(env) || { r: 0, h: 0 };
            if (envViewMode === 'list') {
                return `
                <div class="env-item" onclick="openEnvEditor('${env}')">
                    <div class="env-info"><div class="env-icon">${ICONS.ENV}</div><div class="env-name">${env}</div></div>
                    <div class="env-stats"><span class="badge badge-outline">R: ${stats.r}</span><span class="badge badge-outline">H: ${stats.h}</span></div>
                </div>`;
            } else {
                return `<div class="env-item" onclick="openEnvEditor('${env}')"><div class="env-icon">${ICONS.ENV}</div><div class="env-name">${env}</div></div>`;
            }
        }).join('');
    } catch (e) {
        console.error("Render env list error", e);
    }
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    if (!app) return;
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;
    const select = document.getElementById('bindEnvSelect');
    select.innerHTML = '<option value="">未绑定 (清除)</option>' + envList.map(e => `<option value="${e}">${e}</option>`).join('');
    select.value = app.boundEnv || "";
    
    const mode = app.boundParam || "";
    const checkMerge = document.getElementById('checkMerge');
    checkMerge.checked = mode.includes('MERGE');
    
    if (mode.includes('MONITOR')) document.getElementById('modeMonitor').checked = true;
    else if (mode.includes('PASSTHROUGH')) document.getElementById('modePassthrough').checked = true;
    else document.getElementById('modeDefault').checked = true;

    const updateMergeState = () => {
        const isPassthrough = document.getElementById('modePassthrough').checked;
        checkMerge.disabled = isPassthrough;
        if (isPassthrough) checkMerge.checked = false;
    };
    updateMergeState();
    document.querySelectorAll('input[name="bindMode"]').forEach(el => el.onchange = updateMergeState);
    openModal('appConfigModal');
};

document.getElementById('btnSaveBinding').onclick = async () => {
    try {
        const env = document.getElementById('bindEnvSelect').value;
        const modeRadio = document.querySelector('input[name="bindMode"]:checked')?.value || "";
        const isMerge = document.getElementById('checkMerge').checked;
        let params = [];
        if (modeRadio) params.push(modeRadio);
        if (isMerge && modeRadio !== 'PASSTHROUGH') params.push('MERGE');
        const finalParam = params.join(' ');
        
        if (env) registry.set(currentBindingPkg, { env, param: finalParam });
        else registry.delete(currentBindingPkg);
        
        let content = "# Generated by WebUI\n";
        registry.forEach((val, key) => { content += `${key} ${val.env} ${val.param}\n`; });
        await exec(`echo '${content}' > ${INJECTOR_CONF}`);
        toast("绑定已更新");
        closeModal('appConfigModal');
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

window.openEnvEditor = async (envName) => {
    currentEditingEnv = envName;
    document.getElementById('editorEnvName').textContent = envName;
    const content = await run(`cat ${BASE_DIR}/${envName}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = content;
    parseConfigToVisual(content);
    document.getElementById('editorAlert').classList.remove('collapsed');
    const modalContent = document.querySelector('#envEditorModal .modal-content');
    modalContent.classList.remove('dark-theme');
    const visualRadio = document.querySelector('input[name="editorMode"][value="visual"]');
    if (visualRadio) { visualRadio.checked = true; visualRadio.dispatchEvent(new Event('change')); }
    openModal('envEditorModal');
};

const parseConfigToVisual = (text) => {
    const container = document.getElementById('ruleBuilderContainer');
    container.innerHTML = '';
    if (text) text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) addRuleRow('REDIRECT', normalizeToDisplay(parts[1]), normalizeToDisplay(parts.slice(2).join(' ')));
        else if (parts[0] === 'HIDE' && parts.length >= 2) addRuleRow('HIDE', normalizeToDisplay(parts[1]), '');
    });
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '');
};

const addRuleRow = (type, target, source) => {
    const div = document.createElement('div');
    div.className = 'rule-row';
    div.innerHTML = `<select class="form-select rule-type"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select><div class="rule-inputs"><input type="text" class="form-control rule-target" placeholder="原始路径" value="${target}"><input type="text" class="form-control rule-source ${type==='HIDE'?'hidden':''}" placeholder="重定向至" value="${source}"></div><button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>`;
    const select = div.querySelector('.rule-type');
    select.value = type;
    select.onchange = (e) => div.querySelector('.rule-source').classList.toggle('hidden', e.target.value === 'HIDE');
    div.querySelector('.btn-del').onclick = () => div.remove();
    setupAutocomplete(div.querySelector('.rule-target'));
    setupAutocomplete(div.querySelector('.rule-source'));
    document.getElementById('ruleBuilderContainer').appendChild(div);
};

// ... 其他辅助函数如 handleModeChange, Autocomplete 等保持不变 ...
// (为节省篇幅，此处省略 Autocomplete 及 monitorIgnore 等未变更的辅助逻辑，请确保这些函数在文件中存在)

// [补全 Autocomplete 与 建议框逻辑]
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

// Env Editor & Ignore Editor Toggle Logic
const handleModeChange = (isVisual, modalId, visualId, rawId, alertId, fabId, contentId, parseFunc, genFunc) => {
    const alertBox = document.getElementById(alertId);
    const visualEl = document.getElementById(visualId);
    const rawEl = document.getElementById(rawId);
    const fab = document.getElementById(fabId) || document.querySelector(`#${modalId} .fab-container`);
    const modalContent = document.querySelector(`#${modalId} .modal-content`);
    if (isVisual) {
        modalContent.classList.remove('dark-theme');
        rawEl.classList.remove('active');
        setTimeout(() => {
            rawEl.classList.add('hidden');
            visualEl.classList.remove('hidden');
            alertBox.classList.remove('collapsed');
            fab.classList.remove('hidden');
            parseFunc(document.getElementById(contentId).value);
            requestAnimationFrame(() => { visualEl.classList.add('active'); });
        }, 250);
    } else {
        modalContent.classList.add('dark-theme');
        visualEl.classList.remove('active');
        alertBox.classList.add('collapsed');
        fab.classList.add('hidden');
        setTimeout(() => {
            visualEl.classList.add('hidden');
            rawEl.classList.remove('hidden');
            document.getElementById(contentId).value = genFunc();
            requestAnimationFrame(() => { rawEl.classList.add('active'); });
        }, 250);
    }
};

document.querySelectorAll('input[name="editorMode"]').forEach(el => {
    el.onchange = (e) => handleModeChange(e.target.value === 'visual', 'envEditorModal', 'editorVisual', 'editorRaw', 'editorAlert', null, 'envRuleContent', parseConfigToVisual, generateConfigFromVisual);
});

// Ignore Editor
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

const generateConfigFromVisual = () => {
    let res = "";
    document.querySelectorAll('#ruleBuilderContainer .rule-row').forEach(row => {
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

document.getElementById('btnCreateEnv').onclick = async () => {
    try {
        const name = document.getElementById('newEnvName').value.trim();
        if (!name) return toast("名称不能为空");
        await exec(`touch ${BASE_DIR}/${name}.conf`);
        closeModal('newEnvModal');
        loadData();
    } catch (e) {
        toast("创建失败: " + e.message);
    }
};

document.getElementById('btnDeleteEnv').onclick = async () => {
    try {
        if (!confirm(`确定删除环境 ${currentEditingEnv} 吗?`)) return;
        await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`);
        let content = "# Generated by WebUI\n";
        registry.forEach((val, key) => { if (val.env !== currentEditingEnv) content += `${key} ${val.env} ${val.param}\n`; });
        await exec(`echo '${content}' > ${INJECTOR_CONF}`);
        closeModal('envEditorModal');
        loadData();
    } catch (e) {
        toast("删除失败: " + e.message);
    }
};

document.getElementById('btnSaveEnv').onclick = async () => {
    try {
        const isVisual = document.querySelector('input[name="editorMode"][value="visual"]').checked;
        const content = isVisual ? generateConfigFromVisual() : document.getElementById('envRuleContent').value;
        await exec(`echo '${content}' > ${BASE_DIR}/${currentEditingEnv}.conf`);
        toast("规则已保存");
        closeModal('envEditorModal');
        loadData();
    } catch (e) {
        toast("保存失败: " + e.message);
    }
};

document.getElementById('btnAddRuleRow').onclick = () => addRuleRow('REDIRECT', '', '');