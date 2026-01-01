import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';
import { mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile } from '@mdi/js';

const BASE_DIR = "/data/Namespace-Proxy", LOG_DIR = `${BASE_DIR}/log`, INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const PATH_PREFIX_STORAGE = '/storage/emulated/0', PATH_PREFIX_REAL = '/data/media/0';

let appConfigModal, envEditorModal, newEnvModal;
let appMap = new Map(), envList = [], registry = new Map(), currentEditingEnv = null, currentBindingPkg = null;
let mountedPackages = new Set(); // 存储 fuse_daemon 挂载的应用
let logInterval = null; // 日志轮询定时器

const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;
const ICONS = { ANDROID: getSvg(mdiAndroid, 32, '#757575'), FOLDER: getSvg(mdiFolder, 16, '#ffca28'), FILE: getSvg(mdiFile, 16, '#9e9e9e'), DELETE: getSvg(mdiDelete, 16, 'currentColor') };

const run = async (cmd) => { try { const res = await exec(cmd); return res.stdout ? res.stdout.trim() : ""; } catch (e) { return ""; } };
const debounce = (func, wait) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); }; };

const normalizeToDisplay = (p) => p?.startsWith(PATH_PREFIX_REAL) ? p.substring(PATH_PREFIX_REAL.length) || "/" : (p?.startsWith(PATH_PREFIX_STORAGE) ? p.substring(PATH_PREFIX_STORAGE.length) || "/" : p);
const normalizeToConfig = (p, isTarget) => { p = p.trim(); if (p.startsWith('/')) return p; return (isTarget ? PATH_PREFIX_STORAGE : PATH_PREFIX_REAL + '/' + p).replace(/\/+/g, '/'); };

const loadData = async () => {
    // 1. 获取基础配置
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    envList = files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector');
    
    // 2. 获取绑定关系
    const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
    registry.clear();
    regContent.split('\n').forEach(l => { const p = l.trim().split(/\s+/); if (p.length >= 2 && !l.startsWith('#')) registry.set(p[0], { env: p[1], param: p[2] || "" }); });

    // 3. 核心：检测 fuse_daemon 挂载状态
    // 通过 ps -A -o args 获取所有进程参数，检查是否包含包名
    const psRes = await run("ps -A -o args | grep fuse_daemon");
    mountedPackages.clear();
    if (psRes) {
        const lines = psRes.split('\n');
        // 预处理为大字符串以加速检查，或者对每行进行匹配
        // 为了准确性，我们假设参数中包含包名字符串
        // 这种方式比对每个包执行 pgrep 要快得多
        const psText = psRes; 
    }

    // 4. 获取应用列表
    const pkgs = await listPackages('user').then(u => listPackages('system').then(s => [...new Set([...u, ...s])]));
    const infos = await getPackagesInfo(pkgs);
    appMap.clear();
    
    infos.forEach(i => { 
        if (i?.packageName) { 
            const r = registry.get(i.packageName); 
            // 检查该包名是否出现在 fuse_daemon 的参数中
            const isMounted = psRes.includes(i.packageName);
            appMap.set(i.packageName, { ...i, boundEnv: r?.env, boundParam: r?.param, isMounted }); 
        } 
    });
    
    renderAppList(); renderEnvList();
};

const renderAppList = () => {
    const list = document.getElementById('appList'), term = document.getElementById('appSearch').value.toLowerCase(), filter = document.querySelector('input[name="appFilter"]:checked').id;
    const items = Array.from(appMap.values()).filter(a => (filter === 'filterUser' ? !a.isSystem : (filter === 'filterSystem' ? a.isSystem : a.boundEnv)) && (a.appLabel?.toLowerCase().includes(term) || a.packageName.toLowerCase().includes(term)));
    
    list.innerHTML = items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || a.appLabel.localeCompare(b.appLabel)).map(a => {
        let badges = "";
        if (a.isMounted) badges += `<span class="badge badge-success shadow-0 me-1">MOUNTED</span>`;
        if (a.boundEnv) badges += `<span class="badge badge-primary shadow-0">${a.boundEnv}</span>`;
        
        return `<div class="list-group-item list-group-item-action d-flex align-items-center px-2 py-2 border-0 border-bottom" onclick="openAppConfig('${a.packageName}')">
            <div class="me-3">${ICONS.ANDROID}</div>
            <div class="flex-grow-1 overflow-hidden">
                <div class="d-flex align-items-center w-100">
                    <div class="fw-bold text-dark text-truncate me-2">${a.appLabel}</div>
                    <div class="ms-auto d-flex align-items-center">${badges}</div>
                </div>
                <small class="text-muted font-monospace text-truncate d-block">${a.packageName}</small>
            </div>
        </div>`;
    }).join('');
};

const renderEnvList = () => {
    document.getElementById('envList').innerHTML = envList.map(e => `
        <div class="col-12 col-md-6"><div class="card shadow-0 border h-100 hover-shadow" onclick="openEnvEditor('${e}')" style="cursor:pointer">
            <div class="card-body p-3 d-flex align-items-center"><div class="flex-grow-1"><h6 class="mb-0 fw-bold">${e}</h6></div><i class="fas fa-chevron-right text-muted opacity-25"></i></div>
        </div></div>`).join('');
};

// ... (setupAutocomplete, openAppConfig, btnSaveBinding, openEnvEditor 等保持不变) ...
const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    const updatePos = () => {
        if (box.style.display === 'none' || window._currentInput !== input) return;
        const r = input.getBoundingClientRect();
        box.style.width = Math.min(300, window.innerWidth - 20) + 'px';
        box.style.left = Math.max(10, Math.min(r.left, window.innerWidth - box.offsetWidth - 10)) + 'px';
        box.style.top = (window.innerHeight - r.bottom < box.offsetHeight && r.top > box.offsetHeight ? r.top - box.offsetHeight - 2 : r.bottom + 2) + 'px';
        requestAnimationFrame(updatePos);
    };
    input.addEventListener('focus', () => { 
        window._currentInput = input; 
        setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        if(input.value) input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('input', debounce(async (e) => {
        let val = e.target.value, parent = PATH_PREFIX_REAL, prefix = "", base = "/";
        const clean = val.replace(/^\/+/, '');
        if (!clean) parent += '/';
        else if (clean.endsWith('/')) { parent += '/' + clean; base = "/" + clean; }
        else { const idx = clean.lastIndexOf('/'); if (idx === -1) prefix = clean; else { const dir = clean.substring(0, idx + 1); parent += '/' + dir; prefix = clean.substring(idx + 1); base = "/" + dir; } }
        const res = await exec(`ls -F -1 "${parent.replace(/\/+/g, '/')}" 2>/dev/null | head -n 30`);
        if (!res?.stdout) { box.style.display = 'none'; return; }
        const sug = res.stdout.split('\n').filter(l => l.startsWith(prefix)).map(l => ({ text: base + (l.endsWith('/') ? l : l), icon: l.endsWith('/') ? ICONS.FOLDER : ICONS.FILE }));
        if (!sug.length) { box.style.display = 'none'; return; }
        box.innerHTML = sug.map(s => `<div class="list-group-item py-2 px-3 border-0 d-flex align-items-center suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.text}'; window._currentInput.dispatchEvent(new Event('input'))"><div class="me-3">${s.icon}</div><div class="small text-truncate">${s.text}</div></div>`).join('');
        box.style.display = 'block'; updatePos();
    }, 150));
};

document.addEventListener('click', (e) => { if (window._currentInput && !document.getElementById('suggestionBox').contains(e.target) && e.target !== window._currentInput) document.getElementById('suggestionBox').style.display = 'none'; }, true);

window.openAppConfig = (pkg) => {
    const a = appMap.get(pkg); currentBindingPkg = pkg;
    document.getElementById('bindAppName').textContent = a.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    const s = document.getElementById('bindEnvSelect');
    s.innerHTML = '<option value="">未绑定</option>' + envList.map(e => `<option value="${e}">${e}</option>`).join('');
    s.value = a.boundEnv || "";
    appConfigModal.show();
};

document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value;
    const mode = document.querySelector('input[name="bindMode"]:checked').value; // 修复：获取模式
    if (env) registry.set(currentBindingPkg, { env, param: mode }); else registry.delete(currentBindingPkg);
    let c = "# Generated\n"; registry.forEach((v, k) => c += `${k} ${v.env} ${v.param}\n`);
    await exec(`echo '${c}' > ${INJECTOR_CONF}`); appConfigModal.hide(); loadData();
};

window.openEnvEditor = async (e) => {
    currentEditingEnv = e; document.getElementById('editorEnvName').textContent = e;
    const c = await run(`cat ${BASE_DIR}/${e}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = c;
    parseVisual(c); envEditorModal.show();
};

const parseVisual = (c) => {
    const cont = document.getElementById('ruleBuilderContainer'); cont.innerHTML = '';
    c.split('\n').forEach(l => {
        const p = l.trim().split(/\s+/);
        if (p[0] === 'REDIRECT') addRow('REDIRECT', normalizeToDisplay(p[1]), normalizeToDisplay(p.slice(2).join(' ')));
        else if (p[0] === 'HIDE') addRow('HIDE', normalizeToDisplay(p[1]), '');
    });
    if (!cont.children.length) addRow('REDIRECT', '', '');
};

const addRow = (t, tg, src) => {
    const d = document.createElement('div'); d.className = 'rule-row card shadow-0 border mb-2 bg-white';
    d.innerHTML = `<div class="card-body p-2 d-flex align-items-center gap-2">
        <select class="form-select form-select-sm rule-type" style="width:90px"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select>
        <div class="flex-grow-1 d-flex flex-column gap-1">
            <input type="text" class="form-control form-control-sm rule-target" placeholder="原始路径" value="${tg}">
            <input type="text" class="form-control form-control-sm rule-source ${t==='HIDE'?'d-none':''}" placeholder="重定向至" value="${src}">
        </div>
        <button class="btn btn-link text-danger p-1 btn-del">${ICONS.DELETE}</button>
    </div>`;
    d.querySelector('.rule-type').value = t;
    d.querySelector('.rule-type').onchange = (e) => d.querySelector('.rule-source').classList.toggle('d-none', e.target.value === 'HIDE');
    d.querySelector('.btn-del').onclick = () => d.remove();
    setupAutocomplete(d.querySelector('.rule-target')); setupAutocomplete(d.querySelector('.rule-source'));
    document.getElementById('ruleBuilderContainer').appendChild(d);
};

document.getElementById('btnAddRuleRow').onclick = () => addRow('REDIRECT', '', '');
document.getElementById('btnSaveEnv').onclick = async () => {
    let c = ""; document.querySelectorAll('.rule-row').forEach(r => {
        const t = r.querySelector('.rule-type').value, tg = r.querySelector('.rule-target').value.trim(), src = r.querySelector('.rule-source').value.trim();
        if(tg) c += t === 'REDIRECT' ? `REDIRECT ${normalizeToConfig(tg, true)} ${normalizeToConfig(src, false)}\n` : `HIDE ${normalizeToConfig(tg, true)}\n`;
    });
    await exec(`echo '${c}' > ${BASE_DIR}/${currentEditingEnv}.conf`); envEditorModal.hide();
};

document.getElementById('btnDeleteEnv').onclick = async () => {
    if(!confirm(`删除环境 ${currentEditingEnv} ?`)) return;
    await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`);
    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => { if (val.env !== currentEditingEnv) content += `${key} ${val.env} ${val.param}\n`; });
    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    envEditorModal.hide(); loadData();
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

// --- 日志监控核心逻辑 ---

const startLogMonitor = () => {
    if (logInterval) return;
    updateIOTable(); // 立即执行一次
    logInterval = setInterval(updateIOTable, 1000); // 每秒刷新
};

const stopLogMonitor = () => {
    if (logInterval) { clearInterval(logInterval); logInterval = null; }
};

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    // 使用 tail -n 50 获取最新日志
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 50`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" class="text-center p-3 text-muted">等待活动...</td></tr>'; return; }
    
    const term = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, pkg, time, op, details] = m, app = appMap.get(pkg), name = app ? app.appLabel : pkg;
        if (term && !name.toLowerCase().includes(term) && !details.toLowerCase().includes(term)) return null;
        return `<tr><td class="text-muted">${time}</td><td><div class="fw-bold">${name}</div></td><td><span class="badge shadow-0 op-${op}">${op}</span></td><td class="text-wrap-path">${details.replace(' -> ', ' <i class="fas fa-arrow-right opacity-50"></i> ')}</td></tr>`;
    }).filter(r=>r).join('');
    
    // 只有内容变化时才更新DOM，防止闪烁（简单比对长度或内容hash即可，这里直接替换）
    if (tbody.innerHTML !== rows) tbody.innerHTML = rows;
};

// --- 初始化与事件 ---

document.addEventListener('DOMContentLoaded', () => {
    appConfigModal = new mdb.Modal(document.getElementById('appConfigModal'));
    envEditorModal = new mdb.Modal(document.getElementById('envEditorModal'));
    newEnvModal = new mdb.Modal(document.getElementById('newEnvModal'));
    loadData();
    document.getElementById('appSearch').oninput = renderAppList;
    document.querySelectorAll('input[name="appFilter"]').forEach(el => el.onchange = renderAppList);
    document.getElementById('btnReload').onclick = () => run(`sh ${BASE_DIR}/service.sh`).then(loadData);

    // 导航栏切换逻辑：控制日志监控开关
    document.querySelectorAll('.nav-link').forEach(el => el.onclick = (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
        el.classList.add('active');
        const target = el.getAttribute('href').replace('#', '');
        document.getElementById(target).classList.add('show', 'active');
        
        // 只有在监控页签才开启轮询
        if (target === 'content-io') startLogMonitor(); else stopLogMonitor();
        // 日志文件页签加载一次
        if (target === 'content-log') {
            const select = document.getElementById('logFileSelect');
            run(`ls ${LOG_DIR}/*.log 2>/dev/null`).then(res => {
                const files = res.split('\n').filter(f=>f);
                const cur = select.value;
                select.innerHTML = files.map(f => `<option value="${f.split('/').pop()}" ${f.split('/').pop()===cur?'selected':''}>${f.split('/').pop()}</option>`).join('');
                if(select.value) select.dispatchEvent(new Event('change'));
            });
        }
    });
    
    // 日志文件查看器逻辑
    document.getElementById('logFileSelect').onchange = async (e) => {
        const viewer = document.getElementById('logViewer');
        if(!e.target.value) return;
        const content = await run(`tail -c 50000 ${LOG_DIR}/${e.target.value} 2>/dev/null`);
        viewer.innerHTML = content.replace(/\[IO\]/g, '<span class="text-info">[IO]</span>');
        viewer.scrollTop = viewer.scrollHeight;
    };
});