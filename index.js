import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';
import { mdiAndroid, mdiLayers, mdiSwapHorizontal, mdiEyeOff, mdiDelete, mdiPencil } from '@mdi/js';

// --- 常量 ---
const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

// --- 状态 ---
let appConfigModal, envEditorModal, newEnvModal;
let appMap = new Map();
let envList = [];
let registry = new Map();
let currentEditingEnv = null;
let currentBindingPkg = null;

// --- 常见路径前缀 (用于补全) ---
const COMMON_PATHS = [
    '/data/media/0/',
    '/storage/emulated/0/',
    '/data/user/0/',
    '/sdcard/',
    '/system/fonts/',
    '/vendor/lib64/',
    '/data/local/tmp/'
];

const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;
const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    ENV: getSvg(mdiLayers, 24, '#1266f1'),
    DELETE: getSvg(mdiDelete, 16, 'currentColor'),
    EDIT: getSvg(mdiPencil, 16, 'currentColor')
};

const run = async (cmd) => {
    try { const res = await exec(cmd); return res.stdout ? res.stdout.trim() : ""; } catch (e) { return ""; }
};

// --- 数据加载 ---
const loadData = async () => {
    try {
        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files.split('\n')
            .map(f => f.split('/').pop().replace('.conf', ''))
            .filter(n => n && n !== 'injector');

        const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        registry.clear();
        regContent.split('\n').forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
                registry.set(parts[0], { env: parts[1], param: parts[2] || "" });
            }
        });

        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
        
        const infos = await getPackagesInfo(allPkgs);
        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info && info.packageName) {
                    const reg = registry.get(info.packageName);
                    appMap.set(info.packageName, {
                        ...info,
                        boundEnv: reg ? reg.env : null,
                        boundParam: reg ? reg.param : null
                    });
                }
            });
        }
        renderAppList();
        renderEnvList();
    } catch (e) { toast("加载失败: " + e.message); }
};

// --- 渲染应用列表 ---
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
            let color = "secondary"; // 默认
            let text = app.boundEnv;
            if (app.boundParam === 'MONITOR') { color = "warning"; text += " (监控)"; }
            else if (app.boundParam === 'PASSTHROUGH') { color = "danger"; text += " (直通)"; }
            else { color = "primary"; }
            badge = `<span class="badge badge-${color} shadow-0 ms-auto">${text}</span>`;
        }

        return `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-2 py-2 border-0 border-bottom" 
             onclick="openAppConfig('${app.packageName}')">
            <div class="me-3">${ICONS.ANDROID}</div>
            <div class="flex-grow-1 overflow-hidden">
                <div class="d-flex align-items-center w-100">
                    <div class="fw-bold text-dark text-truncate me-2">${app.appLabel}</div>
                    ${badge}
                </div>
                <small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small>
            </div>
        </div>`;
    }).join('') : '<div class="text-center p-4 text-muted">无匹配应用</div>';
};

// --- 渲染环境列表 ---
const renderEnvList = () => {
    const listEl = document.getElementById('envList');
    listEl.innerHTML = envList.map(env => `
        <div class="col-12 col-md-6">
            <div class="card shadow-0 border h-100 hover-shadow" onclick="openEnvEditor('${env}')" style="cursor:pointer">
                <div class="card-body p-3 d-flex align-items-center">
                    <div class="me-3 text-primary">${ICONS.ENV}</div>
                    <div class="flex-grow-1">
                        <h6 class="mb-0 fw-bold">${env}</h6>
                        <small class="text-muted">点击编辑规则</small>
                    </div>
                    <i class="fas fa-chevron-right text-muted opacity-25"></i>
                </div>
            </div>
        </div>
    `).join('') + `
        <div class="col-12 text-center mt-3 text-muted small" style="display: ${envList.length===0?'block':'none'}">
            暂无环境，请点击右上角新建
        </div>
    `;
};

// --- 交互逻辑 ---
window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;

    const select = document.getElementById('bindEnvSelect');
    select.innerHTML = '<option value="">未绑定 (清除)</option>' + 
        envList.map(e => `<option value="${e}">${e}</option>`).join('');
    select.value = app.boundEnv || "";

    const mode = app.boundParam || "";
    document.getElementById(mode === 'MONITOR' ? 'modeMonitor' : (mode === 'PASSTHROUGH' ? 'modePassthrough' : 'modeDefault')).checked = true;

    appConfigModal.show();
};

document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value;
    const modeEl = document.querySelector('input[name="bindMode"]:checked');
    const mode = modeEl ? modeEl.value : "";

    if (env) registry.set(currentBindingPkg, { env, param: mode });
    else registry.delete(currentBindingPkg);

    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => content += `${key} ${val.env} ${val.param}\n`);
    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    toast("绑定已更新");
    appConfigModal.hide();
    loadData();
};

document.getElementById('btnNewEnv').onclick = () => {
    document.getElementById('newEnvName').value = '';
    newEnvModal.show();
};

document.getElementById('btnCreateEnv').onclick = async () => {
    const name = document.getElementById('newEnvName').value.trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) { toast("名称非法"); return; }
    if (envList.includes(name)) { toast("环境已存在"); return; }
    await exec(`touch ${BASE_DIR}/${name}.conf`);
    newEnvModal.hide();
    loadData();
};

window.openEnvEditor = async (envName) => {
    currentEditingEnv = envName;
    document.getElementById('editorEnvName').textContent = envName;
    const content = await run(`cat ${BASE_DIR}/${envName}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = content;
    
    parseConfigToVisual(content);
    // 强制切回图形模式
    const visualBtn = document.getElementById('modeVisual');
    visualBtn.checked = true;
    // 手动触发切换逻辑
    switchEditorMode('visual');
    
    envEditorModal.show();
};

// 修复：模式切换逻辑
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

document.querySelectorAll('input[name="editorMode"]').forEach(el => {
    el.addEventListener('change', (e) => switchEditorMode(e.target.value === 'visual' ? 'visual' : 'raw'));
});

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
    
    let dirty = false;
    registry.forEach((val, key) => { if (val.env === currentEditingEnv) { registry.delete(key); dirty = true; } });
    if (dirty) {
        let content = "# Generated by WebUI\n";
        registry.forEach((val, key) => content += `${key} ${val.env} ${val.param}\n`);
        await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    }
    envEditorModal.hide();
    loadData();
};

// --- 自动补全功能 ---
const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    
    const showSuggestions = () => {
        const val = input.value;
        if (!val) { box.style.display = 'none'; return; }

        let suggestions = [];
        
        // 1. 智能映射建议 (如果不是以 / 开头)
        if (!val.startsWith('/')) {
            suggestions.push({
                text: `/data/media/0/${val}`,
                desc: `映射到标准存储: .../${val}`
            });
        }

        // 2. 常见路径匹配
        COMMON_PATHS.forEach(path => {
            if (path.startsWith(val) || val.startsWith(path)) {
                suggestions.push({ text: path, desc: '常见路径' });
            }
        });

        if (suggestions.length === 0) { box.style.display = 'none'; return; }

        // 渲染建议
        box.innerHTML = suggestions.map(s => `
            <button class="list-group-item list-group-item-action py-2 px-3 border-0" onclick="applySuggestion('${s.text}')">
                <div class="fw-bold font-monospace small">${s.text}</div>
                <div class="text-muted" style="font-size: 10px;">${s.desc}</div>
            </button>
        `).join('');

        // 定位
        const rect = input.getBoundingClientRect();
        // 需要计算相对于 modal-body 的位置，因为 modal-body 是 relative
        const containerRect = document.querySelector('.modal-body').getBoundingClientRect();
        
        box.style.top = (rect.bottom - containerRect.top + document.querySelector('#editorVisual').scrollTop) + 'px';
        box.style.left = (rect.left - containerRect.left) + 'px';
        box.style.width = rect.width + 'px';
        box.style.display = 'block';
        
        // 保存当前操作的 input 引用
        window._currentInput = input;
    };

    input.addEventListener('input', showSuggestions);
    input.addEventListener('focus', showSuggestions);
    // 延迟隐藏，以便点击生效
    input.addEventListener('blur', () => setTimeout(() => box.style.display = 'none', 200));
};

window.applySuggestion = (text) => {
    if (window._currentInput) {
        window._currentInput.value = text;
        window._currentInput.focus(); // 保持焦点
    }
    document.getElementById('suggestionBox').style.display = 'none';
};

// --- 图形编辑器 ---
const parseConfigToVisual = (text) => {
    const container = document.getElementById('ruleBuilderContainer');
    container.innerHTML = '';
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) addRuleRow('REDIRECT', parts[1], parts.slice(2).join(' '));
        else if (parts[0] === 'HIDE' && parts.length >= 2) addRuleRow('HIDE', parts.slice(1).join(' '), '');
    });
    if (container.children.length === 0) addRuleRow('REDIRECT', '', '');
};

const addRuleRow = (type, target, source) => {
    const div = document.createElement('div');
    div.className = 'rule-row card shadow-0 border mb-2 bg-white';
    div.innerHTML = `
        <div class="card-body p-2 d-flex align-items-center gap-2">
            <select class="form-select form-select-sm rule-type" style="width:100px"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select>
            <div class="flex-grow-1 d-flex flex-column gap-1">
                <input type="text" class="form-control form-control-sm font-monospace rule-target" placeholder="目标路径 (Target)" value="${target}">
                <input type="text" class="form-control form-control-sm font-monospace rule-source" placeholder="源路径 (Source)" value="${source}">
            </div>
            <button class="btn btn-link text-danger px-2 btn-del">${ICONS.DELETE}</button>
        </div>`;
    
    div.querySelector('.rule-type').value = type;
    const sourceInput = div.querySelector('.rule-source');
    const targetInput = div.querySelector('.rule-target');
    
    if(type==='HIDE') sourceInput.classList.add('d-none');
    
    div.querySelector('.rule-type').onchange = (e) => {
        sourceInput.classList.toggle('d-none', e.target.value === 'HIDE');
    };
    div.querySelector('.btn-del').onclick = () => div.remove();
    
    // 绑定自动补全
    setupAutocomplete(targetInput);
    setupAutocomplete(sourceInput);

    document.getElementById('ruleBuilderContainer').appendChild(div);
};

const generateConfigFromVisual = () => {
    let res = "";
    document.querySelectorAll('.rule-row').forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const target = row.querySelector('.rule-target').value.trim();
        const source = row.querySelector('.rule-source').value.trim();
        if(target) res += type === 'REDIRECT' ? `REDIRECT ${target} ${source}\n` : `HIDE ${target}\n`;
    });
    return res;
};
document.getElementById('btnAddRuleRow').onclick = () => addRuleRow('REDIRECT', '', '');

// --- 监控与日志 ---
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
        return `<tr>
            <td class="text-muted">${time}</td>
            <td><div class="fw-bold">${name}</div></td>
            <td><span class="badge shadow-0 op-${op}">${op}</span></td>
            <td class="text-wrap-path">${details.replace(' -> ', ' <i class="fas fa-arrow-right opacity-50"></i> ')}</td>
        </tr>`;
    }).filter(r=>r).join('');
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    
    // 获取文件列表
    const files = (await run(`ls ${LOG_DIR}/*.log 2>/dev/null`)).split('\n').filter(f=>f);
    const currentVal = select.value;
    
    // 渲染下拉框
    select.innerHTML = files.map(f => {
        const n = f.split('/').pop();
        return `<option value="${n}" ${n===currentVal?'selected':''}>${n}</option>`;
    }).join('');
    
    // 确定要加载的文件
    const target = select.value || (files[0] ? files[0].split('/').pop() : "");
    if (target) {
        const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
        viewer.innerHTML = content.replace(/\[IO\]/g, '<span class="text-info">[IO]</span>');
        viewer.scrollTop = viewer.scrollHeight;
    } else {
        viewer.innerHTML = '<div class="text-muted p-3">无日志文件</div>';
    }
};

// 修复：日志切换监听
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