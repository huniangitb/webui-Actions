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

let appMap = new Map(), envList = [], envStats = new Map(), envViewMode = 'grid', registry = new Map();
let currentEditingEnv = null, currentBindingPkg = null, activeMounts = new Set(), statusPolling = null, currentAppFilter = 'filterUser', currentPid = null;

const PAGE_LIMIT = 50;
let ioState = { offset: 0, loading: false, hasMore: true, term: '' };
let sysState = { offset: 0, loading: false, hasMore: true, term: '' };

const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;
const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'), ENV: getSvg(mdiLayers, 24, '#1266f1'), DELETE: getSvg(mdiDelete, 18, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'), FILE: getSvg(mdiFile, 16, '#9e9e9e'), REFRESH: getSvg(mdiRefresh, 20, '#000'),
    SEARCH: getSvg(mdiMagnify, 18, '#868e96'), PLUS: getSvg(mdiPlus, 16, '#fff'), CLOSE: getSvg(mdiClose, 28, '#5f6368'),
    CHEVRON: getSvg(mdiChevronRight, 20, '#adb5bd'), FILTER: getSvg(mdiFilterVariant, 24, '#fff'), GRID: getSvg(mdiViewGrid, 24, '#fff'),
    LIST: getSvg(mdiViewList, 24, '#fff'), STOP: getSvg(mdiStop, 20, '#dc3545'), PLAY: getSvg(mdiPlay, 20, '#36a420'),
    EYE_OFF: getSvg(mdiEyeOff, 20, 'currentColor'), CLEAR: getSvg(mdiDeleteSweep, 20, '#fff')
};

// 封装执行函数，增加错误提示
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        if (res.stderr && !res.stdout) console.warn(res.stderr);
        return res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        toast(`执行失败: ${e.message || e}`);
        return "";
    }
};

const fetchActiveMounts = async () => {
    const fuseArgs = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
    const mounts = new Set();
    if (fuseArgs) fuseArgs.split('\n').forEach(line => { const match = line.match(/--pkg=([a-zA-Z0-9._]+)/); if (match) mounts.add(match[1]); });
    return mounts;
};

const updateMountStatus = async () => {
    activeMounts = await fetchActiveMounts();
    document.querySelectorAll('#appList .list-item').forEach(item => {
        const pkg = item.dataset.pkg, header = item.querySelector('.app-header'), badge = header.querySelector('.badge-success'), isMounted = activeMounts.has(pkg);
        if (isMounted && !badge) header.insertAdjacentHTML('beforeend', `<span class="badge badge-success">MOUNTED</span>`);
        else if (!isMounted && badge && badge.textContent === 'MOUNTED') badge.remove();
    });
};

const checkStatus = async () => {
    const badge = document.getElementById('statusBadge'), info = document.getElementById('statusInfo'), toggleBtn = document.getElementById('btnToggleStatus');
    let pid = await run("pidof injector") || await run("pgrep -x injector");
    currentPid = pid ? pid.split(' ')[0] : null;
    if (currentPid) {
        badge.className = "badge badge-success"; badge.textContent = "RUNNING"; info.textContent = `PID: ${currentPid}`;
        toggleBtn.innerHTML = ICONS.STOP; toggleBtn.style.background = "rgba(220, 53, 69, 0.1)"; toggleBtn.setAttribute('data-status', 'running');
    } else {
        badge.className = "badge badge-gray"; badge.textContent = "STOPPED"; info.textContent = "OFFLINE";
        toggleBtn.innerHTML = ICONS.PLAY; toggleBtn.style.background = "rgba(54, 164, 32, 0.1)"; toggleBtn.setAttribute('data-status', 'stopped');
    }
    await updateMountStatus();
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('iconSearch').innerHTML = ICONS.SEARCH; document.getElementById('iconIoSearch').innerHTML = ICONS.SEARCH;
    document.getElementById('iconFilter').innerHTML = ICONS.FILTER; document.getElementById('iconEnvView').innerHTML = ICONS.LIST;
    document.getElementById('btnMonitorIgnore').innerHTML = ICONS.EYE_OFF; document.getElementById('iconClearIo').innerHTML = ICONS.CLEAR;
    document.getElementById('iconClearLog').innerHTML = ICONS.CLEAR; document.querySelectorAll('.btn-close').forEach(el => el.innerHTML = ICONS.CLOSE);
    document.getElementById('btnNewEnv').innerHTML = `<span style="display:flex;align-items:center;gap:4px">${getSvg(mdiPlus,14,'#fff')} 新建</span>`;
    document.getElementById('btnAddRuleRow').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加规则</span>`;
    document.getElementById('btnAddIgnoreRow').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加路径</span>`;

    loadData().catch(e => toast(`初始化失败: ${e.message}`));
    checkStatus();
    statusPolling = setInterval(checkStatus, 2000);

    document.getElementById('appSearch').oninput = renderAppList;
    document.getElementById('btnEnvViewToggle').onclick = () => {
        envViewMode = envViewMode === 'grid' ? 'list' : 'grid';
        document.getElementById('iconEnvView').innerHTML = envViewMode === 'grid' ? ICONS.LIST : ICONS.GRID;
        renderEnvList();
    };

    const fabBtn = document.getElementById('btnFilterFab'), filterOpts = document.getElementById('filterOptions');
    fabBtn.onclick = (e) => { e.stopPropagation(); filterOpts.classList.toggle('show'); };
    document.addEventListener('click', (e) => { if (!filterOpts.contains(e.target) && !fabBtn.contains(e.target)) filterOpts.classList.remove('show'); });
    document.querySelectorAll('.filter-opt').forEach(btn => {
        btn.onclick = () => {
            currentAppFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); filterOpts.classList.remove('show'); renderAppList();
        };
    });

    const ioContainer = document.getElementById('ioTableContainer');
    const debouncedIoSearch = debounce(() => {
        ioState.offset = 0; ioState.hasMore = true; ioState.term = document.getElementById('ioSearch').value.trim();
        document.getElementById('ioTableBody').innerHTML = ''; fetchIoLogs();
    }, 500);
    document.getElementById('ioSearch').addEventListener('input', debouncedIoSearch);
    ioContainer.addEventListener('scroll', () => { if (ioContainer.scrollTop + ioContainer.clientHeight >= ioContainer.scrollHeight - 50) fetchIoLogs(); });

    document.getElementById('btnClearIo').onclick = async () => {
        await run(`${LOG_CTL} clear-io`); toast("IO日志已清理");
        ioState.offset = 0; ioState.hasMore = true; document.getElementById('ioTableBody').innerHTML = ''; fetchIoLogs();
    };

    const logSelect = document.getElementById('logSourceSelect'), logViewer = document.getElementById('logViewer');
    logSelect.addEventListener('change', () => { sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; fetchSysLogs(); });
    logViewer.addEventListener('scroll', () => { if (logSelect.value === 'internal' && logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 50) fetchSysLogs(); });
    document.getElementById('btnClearLog').onclick = async () => {
        if (logSelect.value === 'zygisk') await run("logcat -c"); else await run(`${LOG_CTL} clear-sys`);
        toast("日志已清空"); if (logSelect.value === 'internal') { sysState.offset = 0; sysState.hasMore = true; logViewer.innerHTML = ''; }
        fetchSysLogs();
    };
    document.getElementById('btnMonitorIgnore').onclick = openMonitorIgnoreEditor;
});

const debounce = (func, wait) => { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; };

const fetchIoLogs = async () => {
    if (ioState.loading || !ioState.hasMore) return;
    ioState.loading = true; document.getElementById('ioLoadingIndicator').classList.remove('hidden');
    const res = await run(`${LOG_CTL} search-io "${ioState.term}" ${PAGE_LIMIT} ${ioState.offset} api`);
    if (res) {
        const lines = res.split('\n'), lastLine = lines[lines.length - 1];
        let dataLines = lines;
        // 适配 DONE|total|remain 格式
        if (lastLine.startsWith('DONE|')) {
            const parts = lastLine.split('|');
            ioState.hasMore = parseInt(parts[2] || "0") > 0;
            dataLines = lines.slice(0, -1);
        } else if (lastLine === 'OK') {
            ioState.hasMore = false; dataLines = lines.slice(0, -1);
        }
        if (dataLines.length > 0) {
            ioState.offset += dataLines.length;
            renderIoRows(dataLines);
        } else {
            ioState.hasMore = false;
        }
    } else ioState.hasMore = false;
    ioState.loading = false; document.getElementById('ioLoadingIndicator').classList.add('hidden');
};

const renderIoRows = (lines) => {
    const html = lines.map(line => {
        const parts = line.split('|'); if (parts.length < 2) return '';
        const match = parts[1].match(/^\[(.*?)\] \[(.*?)\] (.*)$/); if (!match) return '';
        const [_, pkg, op, details] = match, app = appMap.get(pkg);
        const timeStr = new Date(parseInt(parts[0]) * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return `<tr><td class="text-muted small font-monospace">${timeStr}</td><td><div class="text-truncate" style="max-width:100px" title="${pkg}">${app ? app.appLabel : pkg}</div></td><td><span class="op-tag op-${op}">${op}</span></td><td class="break-all font-monospace small">${details}</td></tr>`;
    }).join('');
    document.getElementById('ioTableBody').insertAdjacentHTML('beforeend', html);
};

const fetchSysLogs = async () => {
    const source = document.getElementById('logSourceSelect').value, viewer = document.getElementById('logViewer');
    if (source === 'zygisk') {
        const content = await run("logcat -d -s Zygisk_Blocker NamespaceProxy_Injector");
        viewer.textContent = content || "无日志"; viewer.scrollTop = viewer.scrollHeight; return;
    }
    if (sysState.loading || !sysState.hasMore) return;
    sysState.loading = true; document.getElementById('sysLoadingIndicator').classList.remove('hidden');
    const res = await run(`${LOG_CTL} search-sys "" ${PAGE_LIMIT} ${sysState.offset} api`);
    if (res) {
        const lines = res.split('\n'), lastLine = lines[lines.length - 1];
        let dataLines = lines;
        if (lastLine.startsWith('DONE|')) {
            const parts = lastLine.split('|');
            sysState.hasMore = parseInt(parts[2] || "0") > 0;
            dataLines = lines.slice(0, -1);
        } else if (lastLine === 'OK') {
            sysState.hasMore = false; dataLines = lines.slice(0, -1);
        }
        if (dataLines.length > 0) {
            sysState.offset += dataLines.length;
            viewer.insertAdjacentText('beforeend', dataLines.join('\n') + '\n');
        } else {
            sysState.hasMore = false; if (sysState.offset === 0) viewer.textContent = "无内部日志";
        }
    } else sysState.hasMore = false;
    sysState.loading = false; document.getElementById('sysLoadingIndicator').classList.add('hidden');
};

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active')); document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active'); const targetId = btn.dataset.target; document.getElementById(targetId).classList.add('active');
        if (targetId === 'content-io') {
            ioState = { offset: 0, loading: false, hasMore: true, term: '' };
            document.getElementById('ioTableBody').innerHTML = ''; fetchIoLogs();
        } else if (targetId === 'content-log') {
            sysState = { offset: 0, loading: false, hasMore: true, term: '' };
            document.getElementById('logViewer').innerHTML = ''; fetchSysLogs();
        }
    };
});

const loadData = async () => {
    activeMounts = await fetchActiveMounts();
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    envList = files ? files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector' && n !== 'monitor_ignore') : [];
    const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
    registry.clear(); if (regContent) regContent.split('\n').forEach(line => { const parts = line.trim().split(/\s+/); if (parts.length >= 2 && !line.startsWith('#')) registry.set(parts[0], { env: parts[1], param: parts.slice(2).join(' ') || "" }); });
    const userPkgs = await listPackages('user') || [], systemPkgs = await listPackages('system') || [], allPkgs = [...new Set([...userPkgs, ...systemPkgs])], infos = await getPackagesInfo(allPkgs);
    appMap.clear(); if (Array.isArray(infos)) infos.forEach(info => { if (info?.packageName) { const reg = registry.get(info.packageName); appMap.set(info.packageName, { ...info, boundEnv: reg?.env, boundParam: reg?.param }); } });
    renderAppList(); renderEnvList();
};

const renderAppList = () => {
    const listEl = document.getElementById('appList'), val = document.getElementById('appSearch').value.toLowerCase(), items = [];
    appMap.forEach(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return;
        if (currentAppFilter === 'filterBound' && !app.boundEnv) return;
        if (val && !app.appLabel.toLowerCase().includes(val) && !app.packageName.toLowerCase().includes(val)) return;
        items.push(app);
    });
    items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || a.appLabel.localeCompare(b.appLabel));
    listEl.innerHTML = items.length ? items.map(app => {
        const param = app.boundParam || ""; let bCls = 'badge-primary', bStl = '', bTxt = app.boundEnv;
        if (param.includes('MONITOR')) bCls = 'badge-warning'; else if (param.includes('PASSTHROUGH')) bCls = 'badge-success';
        if (param.includes('MERGE')) { bTxt += ' (M)'; if (!param.includes('MONITOR') && !param.includes('PASSTHROUGH')) bStl = 'style="background:#6f42c1"'; }
        return `<div class="list-item" data-pkg="${app.packageName}" onclick="openAppConfig('${app.packageName}')"><div class="app-main"><div class="app-icon-wrapper">${ICONS.ANDROID}</div><div class="app-content"><div class="app-header"><span class="app-name">${app.appLabel}</span>${activeMounts.has(app.packageName)?'<span class="badge badge-success">MOUNTED</span>':''}</div><small class="text-muted font-monospace d-block">${app.packageName}</small></div></div><div class="app-end">${app.boundEnv?`<span class="badge ${bCls} badge-pill" ${bStl}>${bTxt}</span>`:''}</div></div>`;
    }).join('') : '<div class="empty-state">无匹配应用</div>';
};

const renderEnvList = () => {
    const listEl = document.getElementById('envList'); if (!envList.length) { listEl.innerHTML = '<div class="empty-state">暂无环境</div>'; return; }
    listEl.className = `grid-list scroll-y ${envViewMode==='list'?'list-mode':''}`;
    listEl.innerHTML = envList.map(env => `<div class="env-item" onclick="openEnvEditor('${env}')"><div class="env-info"><div class="env-icon">${ICONS.ENV}</div><div class="env-name">${env}</div></div></div>`).join('');
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg; const app = appMap.get(pkg); if (!app) return;
    document.getElementById('bindAppName').textContent = app.appLabel; document.getElementById('bindAppPkg').textContent = pkg; document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;
    const sel = document.getElementById('bindEnvSelect'); sel.innerHTML = '<option value="">未绑定</option>' + envList.map(e => `<option value="${e}">${e}</option>`).join('');
    sel.value = app.boundEnv || ""; const mode = app.boundParam || "", cm = document.getElementById('checkMerge');
    cm.checked = mode.includes('MERGE'); if (mode.includes('MONITOR')) document.getElementById('modeMonitor').checked = true; else if (mode.includes('PASSTHROUGH')) document.getElementById('modePassthrough').checked = true; else document.getElementById('modeDefault').checked = true;
    const upd = () => { cm.disabled = document.getElementById('modePassthrough').checked; if (cm.disabled) cm.checked = false; };
    upd(); document.querySelectorAll('input[name="bindMode"]').forEach(el => el.onchange = upd); openModal('appConfigModal');
};

document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value, r = document.querySelector('input[name="bindMode"]:checked')?.value || "", m = document.getElementById('checkMerge').checked;
    let p = []; if (r) p.push(r); if (m && r !== 'PASSTHROUGH') p.push('MERGE');
    if (env) registry.set(currentBindingPkg, { env, param: p.join(' ') }); else registry.delete(currentBindingPkg);
    let c = "# Generated by WebUI\n"; registry.forEach((v, k) => c += `${k} ${v.env} ${v.param}\n`);
    await run(`echo '${c}' > ${INJECTOR_CONF}`); toast("已保存"); closeModal('appConfigModal'); loadData();
};

window.openModal = (id) => { const el = document.getElementById(id); if (el) { el.classList.remove('hiding'); el.classList.add('show'); } };
window.closeModal = (id) => { const el = document.getElementById(id); if (el?.classList.contains('show')) { el.classList.add('hiding'); setTimeout(() => { el.classList.remove('show','hiding'); }, 250); } };

const normalizeToDisplay = (path) => { if (!path) return ""; if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/"; if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/"; return path; };
const normalizeToConfig = (path, isTarget) => { if (!path) return ""; path = path.trim(); if (isTarget) { if (path.startsWith('/')) return path; return (PATH_PREFIX_STORAGE + '/' + path).replace(/\/+/g, '/'); } else { if (path.startsWith('/')) return path; return (PATH_PREFIX_REAL + '/' + path).replace(/\/+/g, '/'); } };

document.getElementById('btnToggleStatus').onclick = async () => {
    const isR = document.getElementById('btnToggleStatus').getAttribute('data-status') === 'running';
    if (isR) { if (currentPid) await run(`kill -15 ${currentPid}`); toast("停止信号已发送"); } else { await run(`sh ${SERVICE_SH}`); toast("正在启动..."); setTimeout(loadData, 1000); }
    setTimeout(checkStatus, 500);
};

window.openEnvEditor = async (n) => {
    currentEditingEnv = n; document.getElementById('editorEnvName').textContent = n;
    const c = await run(`cat ${BASE_DIR}/${n}.conf 2>/dev/null`); document.getElementById('envRuleContent').value = c;
    parseRules(c); openModal('envEditorModal');
};

const parseRules = (t) => {
    const c = document.getElementById('ruleBuilderContainer'); c.innerHTML = '';
    if (t) t.split('\n').forEach(l => {
        const p = l.trim().split(/\s+/);
        if (p[0] === 'REDIRECT' && p.length >= 3) addRuleRow('REDIRECT', p[1], p.slice(2).join(' '));
        else if (p[0] === 'HIDE' && p.length >= 2) addRuleRow('HIDE', p[1], '');
    });
    if (!c.children.length) addRuleRow('REDIRECT', '', '');
};

const addRuleRow = (t, tg, s) => {
    const d = document.createElement('div'); d.className = 'rule-row';
    d.innerHTML = `<select class="form-select rule-type"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select><div class="rule-inputs"><input type="text" class="form-control" value="${normalizeToDisplay(tg)}"><input type="text" class="form-control ${t==='HIDE'?'hidden':''}" value="${normalizeToDisplay(s)}"></div><button class="btn btn-icon-sm">${ICONS.DELETE}</button>`;
    const sel = d.querySelector('select'); sel.value = t;
    sel.onchange = (e) => d.querySelectorAll('input')[1].classList.toggle('hidden', e.target.value === 'HIDE');
    d.querySelector('button').onclick = () => d.remove();
    document.getElementById('ruleBuilderContainer').appendChild(d);
};

document.getElementById('btnSaveEnv').onclick = async () => {
    let res = "";
    document.querySelectorAll('#ruleBuilderContainer .rule-row').forEach(row => {
        const type = row.querySelector('select').value, inputs = row.querySelectorAll('input'), tg = inputs[0].value.trim(), s = inputs[1].value.trim();
        if (tg) {
            if (type === 'REDIRECT' && s) res += `REDIRECT ${normalizeToConfig(tg, true)} ${normalizeToConfig(s, false)}\n`;
            else if (type === 'HIDE') res += `HIDE ${normalizeToConfig(tg, true)}\n`;
        }
    });
    await run(`echo '${res}' > ${BASE_DIR}/${currentEditingEnv}.conf`); toast("规则已保存"); closeModal('envEditorModal');
};

const openMonitorIgnoreEditor = async () => {
    const c = await run(`cat ${MONITOR_IGNORE_CONF} 2>/dev/null`); document.getElementById('monitorIgnoreContent').value = c;
    const container = document.getElementById('ignoreBuilderContainer'); container.innerHTML = '';
    if (c) c.split('\n').filter(l => l.trim()).forEach(l => {
        const d = document.createElement('div'); d.className = 'rule-row';
        d.innerHTML = `<div class="rule-inputs"><input type="text" class="form-control" value="${l.trim()}"></div><button class="btn btn-icon-sm">${ICONS.DELETE}</button>`;
        d.querySelector('button').onclick = () => d.remove(); container.appendChild(d);
    });
    openModal('monitorIgnoreModal');
};

document.getElementById('btnAddIgnoreRow').onclick = () => {
    const d = document.createElement('div'); d.className = 'rule-row';
    d.innerHTML = `<div class="rule-inputs"><input type="text" class="form-control" value=""></div><button class="btn btn-icon-sm">${ICONS.DELETE}</button>`;
    d.querySelector('button').onclick = () => d.remove(); document.getElementById('ignoreBuilderContainer').appendChild(d);
};

document.getElementById('btnSaveIgnore').onclick = async () => {
    let res = ""; document.querySelectorAll('#ignoreBuilderContainer .rule-row input').forEach(i => { if (i.value.trim()) res += i.value.trim() + "\n"; });
    await run(`echo '${res}' > ${MONITOR_IGNORE_CONF}`); toast("配置已保存"); closeModal('monitorIgnoreModal');
};