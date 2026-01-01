import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';
import { mdiAndroid, mdiLayers, mdiDelete, mdiPencil, mdiFolder, mdiFile } from '@mdi/js';

// --- 常量 ---
const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

const PATH_PREFIX_STORAGE = '/storage/emulated/0';
const PATH_PREFIX_REAL = '/data/media/0';

// --- 状态 ---
let appConfigModal, envEditorModal, newEnvModal;
let appMap = new Map();
let envList = [];
let registry = new Map();
let currentEditingEnv = null;
let currentBindingPkg = null;

const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;
const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    ENV: getSvg(mdiLayers, 24, '#1266f1'),
    DELETE: getSvg(mdiDelete, 16, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e')
};

const run = async (cmd) => {
    try { const res = await exec(cmd); return res.stdout ? res.stdout.trim() : ""; } catch (e) { return ""; }
};

const debounce = (func, wait) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// --- 路径处理 (核心修改) ---
const normalizeToDisplay = (path) => {
    if (!path) return "";
    // 仅简化标准路径，其他绝对路径保持原样
    if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/";
    if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/";
    return path;
};

const normalizeToConfig = (path, isTarget) => {
    if (!path) return "";
    path = path.trim();
    
    // 如果是目标路径 (Target - App View)
    if (isTarget) {
        // 强制 /storage/emulated/0 除非用户输入了其他绝对路径
        if (path.startsWith('/')) return path; // 允许 /data/data 等
        // 相对路径默认补全
        return (PATH_PREFIX_STORAGE + '/' + path).replace(/\/+/g, '/');
    } 
    // 如果是源路径 (Source - Redirect To)
    else {
        // 任意路径支持：如果以 / 开头，直接保存
        if (path.startsWith('/')) return path;
        // 否则补全为 /data/media/0/
        return (PATH_PREFIX_REAL + '/' + path).replace(/\/+/g, '/');
    }
};

// --- 数据加载 ---
const loadData = async () => {
    try {
        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector');
        const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        registry.clear();
        regContent.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && !line.trim().startsWith('#')) registry.set(parts[0], { env: parts[1], param: parts[2] || "" });
        });
        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
        const infos = await getPackagesInfo(allPkgs);
        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info?.packageName) {
                    const reg = registry.get(info.packageName);
                    appMap.set(info.packageName, { ...info, boundEnv: reg?.env, boundParam: reg?.param });
                }
            });
        }
        renderAppList();
        renderEnvList();
    } catch (e) { toast("加载失败: " + e.message); }
};

const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const search = document.getElementById('appSearch').value.toLowerCase();
    const filter = document.querySelector('input[name="appFilter"]:checked').id;
    const items = [];
    appMap.forEach(app => {
        if (filter === 'filterUser' && app.isSystem) return;
        if (filter === 'filterSystem' && !app.isSystem) return;
        if (filter === 'filterBound' && !app.boundEnv) return;
        const label = app.appLabel || app.packageName;
        if (search && !label.toLowerCase().includes(search) && !app.packageName.toLowerCase().includes(search)) return;
        items.push(app);
    });
    items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || (a.appLabel||"").localeCompare(b.appLabel||""));
    listEl.innerHTML = items.length ? items.map(app => {
        let badge = "";
        if (app.boundEnv) {
            let color = "secondary", text = app.boundEnv;
            if (app.boundParam === 'MONITOR') { color = "warning"; text += " (监控)"; }
            else if (app.boundParam === 'PASSTHROUGH') { color = "danger"; text += " (直通)"; }
            else { color = "primary"; }
            badge = `<span class="badge badge-${color} shadow-0 ms-auto">${text}</span>`;
        }
        return `<div class="list-group-item list-group-item-action d-flex align-items-center px-2 py-2 border-0 border-bottom" onclick="openAppConfig('${app.packageName}')">
            <div class="me-3">${ICONS.ANDROID}</div>
            <div class="flex-grow-1 overflow-hidden"><div class="d-flex align-items-center w-100"><div class="fw-bold text-dark text-truncate me-2">${app.appLabel}</div>${badge}</div><small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small></div>
        </div>`;
    }).join('') : '<div class="text-center p-4 text-muted">无匹配应用</div>';
};

const renderEnvList = () => {
    const listEl = document.getElementById('envList');
    listEl.innerHTML = envList.map(env => `
        <div class="col-12 col-md-6"><div class="card shadow-0 border h-100 hover-shadow" onclick="openEnvEditor('${env}')" style="cursor:pointer">
            <div class="card-body p-3 d-flex align-items-center"><div class="me-3 text-primary">${ICONS.ENV}</div><div class="flex-grow-1"><h6 class="mb-0 fw-bold">${env}</h6><small class="text-muted">点击编辑规则</small></div><i class="fas fa-chevron-right text-muted opacity-25"></i></div>
        </div></div>`).join('') + `<div class="col-12 text-center mt-3 text-muted small" style="display: ${envList.length===0?'block':'none'}">暂无环境，请点击右上角新建</div>`;
};

// --- 交互逻辑 ---
window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;
    const select = document.getElementById('bindEnvSelect');
    select.innerHTML = '<option value="">未绑定 (清除)</option>' + envList.map(e => `<option value="${e}">${e}</option>`).join('');
    select.value = app.boundEnv || "";
    const mode = app.boundParam || "";
    document.getElementById(mode === 'MONITOR' ? 'modeMonitor' : (mode === 'PASSTHROUGH' ? 'modePassthrough' : 'modeDefault')).checked = true;
    appConfigModal.show();
};

document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value;
    const mode = document.querySelector('input[name="bindMode"]:checked').value;
    if (env) registry.set(currentBindingPkg, { env, param: mode }); else registry.delete(currentBindingPkg);
    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => content += `${key} ${val.env} ${val.param}\n`);
    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    toast("绑定已更新");
    appConfigModal.hide();
    loadData();
};

document.getElementById('btnNewEnv').onclick = () => { document.getElementById('newEnvName').value = ''; newEnvModal.show(); };
document.getElementById('btnCreateEnv').onclick = async () => {
    const name = document.getElementById('newEnvName').value.trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return toast("名称非法");
    if (envList.includes(name)) return toast("环境已存在");
    await exec(`touch ${BASE_DIR}/${name}.conf`);
    newEnvModal.hide();
    loadData();
};

// --- 升级版自动补全 ---
const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    
    // 聚焦时自动滚动到上方 (输入法避让)
    input.addEventListener('focus', () => {
        setTimeout(() => {
            const container = document.getElementById('editorVisual');
            // 将输入框滚动到容器顶部附近 (保留一点 padding)
            // offsetTop 是相对于父定位元素的，这里需要计算相对于滚动容器的位置
            // 简单处理：将当前行滚动到顶部
            const row = input.closest('.rule-row');
            if (row && container) {
                // 计算 row 相对于 container 的位置
                container.scrollTo({
                    top: row.offsetTop - 10, // 留 10px 顶部间距
                    behavior: 'smooth'
                });
            }
        }, 300); // 延时等待键盘弹出
    });

    const performSearch = debounce(async (val) => {
        let searchPath = ""; 
        let displayPrefix = ""; 
        
        // 1. 路径解析逻辑
        if (!val || !val.startsWith('/')) {
            // 相对路径 -> 默认在 /data/media/0 下搜索
            searchPath = PATH_PREFIX_REAL;
            if (val) {
                if (val.endsWith('/')) {
                    searchPath += '/' + val;
                }
            }
            displayPrefix = ""; 
        } else {
            // 绝对路径 -> 尝试搜索
            if (val.startsWith(PATH_PREFIX_STORAGE)) {
                const rel = val.substring(PATH_PREFIX_STORAGE.length);
                searchPath = PATH_PREFIX_REAL + rel;
            } else {
                searchPath = val;
            }
            if (!searchPath.endsWith('/')) {
                const lastSlash = searchPath.lastIndexOf('/');
                searchPath = searchPath.substring(0, lastSlash + 1) || '/';
            }
            const lastSlashVal = val.lastIndexOf('/');
            displayPrefix = val.substring(0, lastSlashVal + 1);
        }
        
        const filterKey = val.endsWith('/') ? "" : val.split('/').pop();

        try {
            const res = await exec(`ls -F -1 "${searchPath}" 2>/dev/null | head -n 20`);
            if (!res || !res.stdout) { box.style.display = 'none'; return; }

            const lines = res.stdout.split('\n');
            const suggestions = lines
                .filter(line => line.startsWith(filterKey))
                .map(line => {
                    const isDir = line.endsWith('/');
                    const name = isDir ? line.slice(0, -1) : line;
                    const fullPath = displayPrefix + name + (isDir ? '/' : '');
                    return { text: fullPath, icon: isDir ? ICONS.FOLDER : ICONS.FILE };
                });

            if (suggestions.length === 0) { box.style.display = 'none'; return; }

            box.innerHTML = suggestions.map(s => `
                <button class="list-group-item list-group-item-action py-2 px-3 border-0 d-flex align-items-center" onclick="applySuggestion('${s.text}')">
                    <div class="me-3" style="width:16px">${s.icon}</div>
                    <div class="fw-bold font-monospace small text-truncate">${s.text}</div>
                </button>
            `).join('');

            // 定位逻辑 (右对齐 + 宽度限制)
            const rect = input.getBoundingClientRect();
            const containerRect = document.querySelector('.modal-body').getBoundingClientRect();
            
            // 宽度限制：屏幕一半，或者最大 300
            const maxWidth = Math.min(300, window.innerWidth / 2);
            box.style.width = maxWidth + 'px';
            
            // 右对齐：Box 右边缘与 Input 右边缘对齐
            // left = (Input右边缘相对Container距离) - Box宽度
            // Input右边缘相对Container = (rect.right - containerRect.left)
            const leftPos = (rect.right - containerRect.left) - maxWidth;
            
            box.style.top = (rect.bottom - containerRect.top + document.querySelector('#editorVisual').scrollTop) + 'px';
            box.style.left = leftPos + 'px';
            box.style.display = 'block';
            window._currentInput = input;

        } catch (e) { box.style.display = 'none'; }
    }, 200);

    input.addEventListener('input', (e) => performSearch(e.target.value));
    input.addEventListener('focus', (e) => performSearch(e.target.value));
    input.addEventListener('blur', () => setTimeout(() => box.style.display = 'none', 200));
};

window.applySuggestion = (text) => {
    if (window._currentInput) {
        window._currentInput.value = text;
        window._currentInput.focus();
        window._currentInput.dispatchEvent(new Event('input'));
    }
};

// --- 环境编辑器 ---
window.openEnvEditor = async (envName) => {
    currentEditingEnv = envName;
    document.getElementById('editorEnvName').textContent = envName;
    const content = await run(`cat ${BASE_DIR}/${envName}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = content;
    parseConfigToVisual(content);
    document.getElementById('modeVisual').click();
    switchEditorMode('visual');
    envEditorModal.show();
};

const switchEditorMode = (mode) => {
    const visual = document.getElementById('editorVisual');
    const raw = document.getElementById('editorRaw');
    if (mode === 'visual') {
        parseConfigToVisual(document.getElementById('envRuleContent').value);
        visual.classList.remove('d-none');
        raw.classList.add('d-none');
    } else {
        document.getElementById('envRuleContent').value = generateConfigFromVisual();
        visual.classList.add('d-none');
        raw.classList.remove('d-none');
    }
};
document.querySelectorAll('input[name="editorMode"]').forEach(el => el.addEventListener('change', (e) => switchEditorMode(e.target.value)));

const parseConfigToVisual = (text) => {
    const container = document.getElementById('ruleBuilderContainer');
    container.innerHTML = '';
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) {
            const displayTarget = normalizeToDisplay(parts[1]);
            const displaySource = normalizeToDisplay(parts.slice(2).join(' '));
            addRuleRow('REDIRECT', displayTarget, displaySource);
        } else if (parts[0] === 'HIDE' && parts.length >= 2) {
            const displayTarget = normalizeToDisplay(parts.slice(1).join(' '));
            addRuleRow('HIDE', displayTarget, '');
        }
    });
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '');
};

const addRuleRow = (type, target, source) => {
    const div = document.createElement('div');
    div.className = 'rule-row card shadow-0 border mb-2 bg-white';
    div.innerHTML = `
        <div class="card-body p-2 d-flex align-items-center gap-2">
            <select class="form-select form-select-sm rule-type" style="width:90px"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select>
            <div class="flex-grow-1 d-flex flex-column gap-1">
                <div class="input-group input-group-sm">
                    <span class="input-group-text border-0 bg-light text-muted" style="width: 80px;">原始路径</span>
                    <input type="text" class="form-control font-monospace rule-target" placeholder="App看到的 (如 Download)" value="${target}">
                </div>
                <div class="input-group input-group-sm rule-source-group">
                    <span class="input-group-text border-0 bg-light text-muted" style="width: 80px;">重定向至</span>
                    <input type="text" class="form-control font-monospace rule-source" placeholder="实际存储 (如 MyFolder)" value="${source}">
                </div>
            </div>
            <button class="btn btn-link text-danger px-2 btn-del ms-auto align-self-center">${ICONS.DELETE}</button>
        </div>`;
    
    div.querySelector('.rule-type').value = type;
    const sourceGroup = div.querySelector('.rule-source-group');
    const targetInput = div.querySelector('.rule-target');
    const sourceInput = div.querySelector('.rule-source');
    
    if(type==='HIDE') sourceGroup.classList.add('d-none');
    div.querySelector('.rule-type').onchange = (e) => sourceGroup.classList.toggle('d-none', e.target.value === 'HIDE');
    div.querySelector('.btn-del').onclick = () => div.remove();
    
    setupAutocomplete(targetInput);
    setupAutocomplete(sourceInput);
    document.getElementById('ruleBuilderContainer').appendChild(div);
};

const generateConfigFromVisual = () => {
    let res = "";
    document.querySelectorAll('.rule-row').forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const targetDisplay = row.querySelector('.rule-target').value.trim();
        const sourceDisplay = row.querySelector('.rule-source').value.trim();
        if(targetDisplay) {
            const configTarget = normalizeToConfig(targetDisplay, true);
            if (type === 'REDIRECT' && sourceDisplay) {
                const configSource = normalizeToConfig(sourceDisplay, false);
                res += `REDIRECT ${configTarget} ${configSource}\n`;
            } else if (type === 'HIDE') {
                res += `HIDE ${configTarget}\n`;
            }
        }
    });
    return res;
};
document.getElementById('btnAddRuleRow').onclick = () => addRuleRow('REDIRECT', '', '');

document.getElementById('btnSaveEnv').onclick = async () => {
    const isVisual = document.getElementById('modeVisual').checked;
    const content = isVisual ? generateConfigFromVisual() : document.getElementById('envRuleContent').value;
    await exec(`echo '${content}' > ${BASE_DIR}/${currentEditingEnv}.conf`);
    toast("规则已保存");
    envEditorModal.hide();
};

document.getElementById('btnDeleteEnv').onclick = async () => {
    if(!confirm(`删除环境 ${currentEditingEnv} ?`)) return;
    await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`);
    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => { if (val.env !== currentEditingEnv) content += `${key} ${val.env} ${val.param}\n`; });
    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    envEditorModal.hide();
    loadData();
};

// --- 监控与日志 (保持不变) ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 100`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" class="text-center p-3 text-muted">无活动</td></tr>'; return; }
    const term = document.getElementById('ioSearch').value.toLowerCase();
    tbody.innerHTML = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, pkg, time, op, details] = m;
        const app = appMap.get(pkg);
        const name = app ? app.appLabel : pkg;
        if (term && !name.toLowerCase().includes(term) && !details.toLowerCase().includes(term)) return null;
        return `<tr><td class="text-muted">${time}</td><td><div class="fw-bold">${name}</div></td><td><span class="badge shadow-0 op-${op}">${op}</span></td><td class="text-wrap-path">${details.replace(' -> ', ' <i class="fas fa-arrow-right opacity-50"></i> ')}</td></tr>`;
    }).filter(r=>r).join('');
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    const files = (await run(`ls ${LOG_DIR}/*.log 2>/dev/null`)).split('\n').filter(f=>f);
    const cur = select.value;
    select.innerHTML = files.map(f => `<option value="${f.split('/').pop()}" ${f.split('/').pop()===cur?'selected':''}>${f.split('/').pop()}</option>`).join('');
    const target = select.value || (files[0] ? files[0].split('/').pop() : "");
    if (target) {
        const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
        viewer.innerHTML = content.replace(/\[IO\]/g, '<span class="text-info">[IO]</span>');
        viewer.scrollTop = viewer.scrollHeight;
    } else viewer.innerHTML = '<div class="text-muted p-3">无日志文件</div>';
};
document.getElementById('logFileSelect').addEventListener('change', loadLogs);

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    appConfigModal = new mdb.Modal(document.getElementById('appConfigModal'));
    envEditorModal = new mdb.Modal(document.getElementById('envEditorModal'));
    newEnvModal = new mdb.Modal(document.getElementById('newEnvModal'));
    loadData();
    document.getElementById('appSearch').oninput = renderAppList;
    document.querySelectorAll('input[name="appFilter"]').forEach(el => el.onchange = renderAppList);
    document.getElementById('btnReload').onclick = async () => { await exec(`sh ${SERVICE_SH}`); toast("Reloading..."); setTimeout(loadData, 1000); };
    document.querySelectorAll('.nav-link').forEach(el => el.onclick = (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
        el.classList.add('active');
        const target = el.getAttribute('href').replace('#', '');
        document.getElementById(target).classList.add('show', 'active');
        if (target === 'content-io') updateIOTable();
        if (target === 'content-log') loadLogs();
    });
    run("pgrep -f 'injector$'").then(pid => {
        document.getElementById('statusBadge').className = pid ? "badge badge-success me-2" : "badge badge-danger me-2";
        document.getElementById('statusBadge').textContent = pid ? "RUNNING" : "STOPPED";
        document.getElementById('statusInfo').textContent = pid ? `PID: ${pid}` : "OFFLINE";
    });
});