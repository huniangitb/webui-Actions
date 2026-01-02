import './style.css'; // 引用新的纯 CSS
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile } from '@mdi/js';

const BASE_DIR = "/data/Namespace-Proxy", LOG_DIR = `${BASE_DIR}/log`, INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const PATH_PREFIX_STORAGE = '/storage/emulated/0', PATH_PREFIX_REAL = '/data/media/0';

let appMap = new Map(), envList = [], registry = new Map(), currentEditingEnv = null, currentBindingPkg = null;
let activeMounts = new Set(), logPolling = null;

const getSvg = (path, size = 24, color = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;
const ICONS = { ANDROID: getSvg(mdiAndroid, 32, '#757575'), FOLDER: getSvg(mdiFolder, 16, '#ffca28'), FILE: getSvg(mdiFile, 16, '#9e9e9e'), DELETE: getSvg(mdiDelete, 16, 'currentColor') };

const run = async (cmd) => { try { const res = await exec(cmd); return res.stdout ? res.stdout.trim() : ""; } catch (e) { return ""; } };
const debounce = (func, wait) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); }; };

// --- 模态框控制 ---
window.openModal = (id) => document.getElementById(id).classList.add('show');
window.closeModal = (id) => document.getElementById(id).classList.remove('show');

const normalizeToDisplay = (p) => p?.startsWith(PATH_PREFIX_REAL) ? p.substring(PATH_PREFIX_REAL.length) || "/" : (p?.startsWith(PATH_PREFIX_STORAGE) ? p.substring(PATH_PREFIX_STORAGE.length) || "/" : p);
const normalizeToConfig = (p, isTarget) => { p = p.trim(); if (p.startsWith('/')) return p; return (isTarget ? PATH_PREFIX_STORAGE : PATH_PREFIX_REAL + '/' + p).replace(/\/+/g, '/'); };

const loadData = async () => {
    try {
        const fuseArgs = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
        activeMounts.clear();
        fuseArgs.split('\n').forEach(line => { const m = line.match(/--pkg=([a-zA-Z0-9._]+)/); if (m) activeMounts.add(m[1]); });

        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector');
        const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        registry.clear();
        regContent.split('\n').forEach(l => { const p = l.trim().split(/\s+/); if (p.length >= 2 && !l.startsWith('#')) registry.set(p[0], { env: p[1], param: p[2] || "" }); });
        
        const pkgs = await listPackages('user').then(u => listPackages('system').then(s => [...new Set([...u, ...s])]));
        const infos = await getPackagesInfo(pkgs);
        appMap.clear();
        infos.forEach(i => { if (i?.packageName) { const r = registry.get(i.packageName); appMap.set(i.packageName, { ...i, boundEnv: r?.env, boundParam: r?.param }); } });
        renderAppList(); renderEnvList();
    } catch (e) { toast("Err: " + e.message); }
};

const renderAppList = () => {
    const list = document.getElementById('appList'), term = document.getElementById('appSearch').value.toLowerCase(), filter = document.querySelector('input[name="appFilter"]:checked').id;
    const items = Array.from(appMap.values()).filter(a => (filter === 'filterUser' ? !a.isSystem : (filter === 'filterSystem' ? a.isSystem : a.boundEnv)) && (a.appLabel?.toLowerCase().includes(term) || a.packageName.toLowerCase().includes(term)));
    
    list.innerHTML = items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || a.appLabel.localeCompare(b.appLabel)).map(a => {
        let badges = "";
        // 挂载状态紧跟应用名
        if (activeMounts.has(a.packageName)) badges += `<span class="badge badge-success" style="margin-left:6px">MOUNTED</span>`;
        if (a.boundEnv) badges += `<span class="badge badge-primary" style="margin-left:6px">${a.boundEnv}</span>`;
        
        return `<div class="list-item" onclick="openAppConfig('${a.packageName}')">
            <div class="me-3">${ICONS.ANDROID}</div>
            <div class="app-content">
                <div class="app-header">
                    <span class="app-name">${a.appLabel}</span>
                    ${badges}
                </div>
                <small class="text-muted font-monospace">${a.packageName}</small>
            </div>
        </div>`;
    }).join('');
};

const renderEnvList = () => {
    document.getElementById('envList').innerHTML = envList.map(e => `
        <div class="env-item" onclick="openEnvEditor('${e}')">
            <div style="flex:1"><h4 style="margin:0">${e}</h4></div>
            <i class="fas fa-chevron-right text-muted"></i>
        </div>`).join('');
};

window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg; const a = appMap.get(pkg);
    document.getElementById('bindAppName').textContent = a.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;
    const s = document.getElementById('bindEnvSelect');
    s.innerHTML = '<option value="">未绑定</option>' + envList.map(e => `<option value="${e}">${e}</option>`).join('');
    s.value = a.boundEnv || "";
    const m = a.boundParam || "";
    document.getElementById(m === 'MONITOR' ? 'modeMonitor' : (m === 'PASSTHROUGH' ? 'modePassthrough' : 'modeDefault')).checked = true;
    openModal('appConfigModal');
};

document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value;
    const mode = document.querySelector('input[name="bindMode"]:checked').value;
    if (env) registry.set(currentBindingPkg, { env, param: mode }); else registry.delete(currentBindingPkg);
    let c = "# Generated\n"; registry.forEach((v, k) => c += `${k} ${v.env} ${v.param}\n`);
    await exec(`echo '${c}' > ${INJECTOR_CONF}`); closeModal('appConfigModal'); loadData();
};

window.openEnvEditor = async (e) => {
    currentEditingEnv = e; document.getElementById('editorEnvName').textContent = e;
    const c = await run(`cat ${BASE_DIR}/${e}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = c;
    parseVisual(c);
    document.querySelector('input[name="editorMode"][value="visual"]').click();
    openModal('envEditorModal');
};

const parseVisual = (c) => {
    const cont = document.getElementById('ruleBuilderContainer'); cont.innerHTML = '';
    c.split('\n').forEach(l => {
        const p = l.trim().split(/\s+/);
        if (p[0] === 'REDIRECT' && p.length >= 3) addRow('REDIRECT', normalizeToDisplay(p[1]), normalizeToDisplay(p.slice(2).join(' ')));
        else if (p[0] === 'HIDE' && p.length >= 2) addRow('HIDE', normalizeToDisplay(p[1]), '');
    });
    if (!cont.children.length) addRow('REDIRECT', '', '');
};

const addRow = (t, tg, src) => {
    const d = document.createElement('div'); d.className = 'rule-row';
    d.innerHTML = `
        <select class="form-select rule-type"><option value="REDIRECT">重定向</option><option value="HIDE">隐藏</option></select>
        <div class="rule-inputs">
            <input type="text" class="form-control rule-target" placeholder="原始路径" value="${tg}">
            <input type="text" class="form-control rule-source ${t==='HIDE'?'hidden':''}" placeholder="重定向至" value="${src}">
        </div>
        <button class="btn btn-close btn-del">${ICONS.DELETE}</button>`;
    d.querySelector('.rule-type').value = t;
    d.querySelector('.rule-type').onchange = (e) => d.querySelector('.rule-source').classList.toggle('hidden', e.target.value === 'HIDE');
    d.querySelector('.btn-del').onclick = () => d.remove();
    setupAutocomplete(d.querySelector('.rule-target')); setupAutocomplete(d.querySelector('.rule-source'));
    document.getElementById('ruleBuilderContainer').appendChild(d);
};

// --- Autocomplete (保持逻辑不变，仅适配样式) ---
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
    const autoScroll = () => { window._currentInput = input; setTimeout(() => input.scrollIntoView({behavior:'smooth',block:'center'}),300); if(input.value) input.dispatchEvent(new Event('input')); };
    input.addEventListener('focus', autoScroll); input.addEventListener('click', autoScroll);
    
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
        box.innerHTML = sug.map(s => `<div class="suggestion-item" onmousedown="event.preventDefault()" onclick="window._currentInput.value='${s.text}'; window._currentInput.dispatchEvent(new Event('input'))"><div style="margin-right:8px;width:16px">${s.icon}</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.text}</div></div>`).join('');
        box.style.display = 'block'; updatePos();
    }, 150));
};

document.addEventListener('click', (e) => { if (window._currentInput && !document.getElementById('suggestionBox').contains(e.target) && e.target !== window._currentInput) document.getElementById('suggestionBox').style.display = 'none'; }, true);

// --- 监控与日志 ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 50`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">无活动</td></tr>'; return; }
    const term = document.getElementById('ioSearch').value.toLowerCase();
    tbody.innerHTML = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, pkg, time, op, details] = m, app = appMap.get(pkg), name = app ? app.appLabel : pkg;
        if (term && !name.toLowerCase().includes(term) && !details.toLowerCase().includes(term)) return null;
        return `<tr><td class="text-muted">${time}</td><td><b>${name}</b></td><td><span class="op-tag op-${op}">${op}</span></td><td style="word-break:break-all">${details.replace(' -> ', ' &rarr; ')}</td></tr>`;
    }).filter(r=>r).join('');
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect'), viewer = document.getElementById('logViewer');
    const files = (await run(`ls ${LOG_DIR}/*.log 2>/dev/null`)).split('\n').filter(f=>f);
    const cur = select.value;
    if (select.options.length !== files.length) select.innerHTML = files.map(f => `<option value="${f.split('/').pop()}" ${f.split('/').pop()===cur?'selected':''}>${f.split('/').pop()}</option>`).join('');
    const target = select.value || (files[0] ? files[0].split('/').pop() : "");
    if (target) {
        const content = await run(`tail -n 100 ${LOG_DIR}/${target} 2>/dev/null`);
        if (viewer.getAttribute('data-len') != content.length) { viewer.innerHTML = content; viewer.scrollTop = viewer.scrollHeight; viewer.setAttribute('data-len', content.length); }
    } else viewer.innerHTML = '无日志文件';
};

const startPolling = () => { if (!logPolling) logPolling = setInterval(() => {
    const active = document.querySelector('.nav-item.active').dataset.target;
    if (active === 'content-io') updateIOTable(); if (active === 'content-log') loadLogs();
}, 1500); };
const stopPolling = () => { if (logPolling) { clearInterval(logPolling); logPolling = null; } };

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    document.getElementById('appSearch').oninput = renderAppList;
    document.querySelectorAll('input[name="appFilter"]').forEach(el => el.onchange = renderAppList);
    document.getElementById('btnReload').onclick = () => run(`sh ${SERVICE_SH}`).then(loadData);
    document.getElementById('btnNewEnv').onclick = () => { document.getElementById('newEnvName').value = ''; openModal('newEnvModal'); };
    document.getElementById('btnCreateEnv').onclick = async () => { await exec(`touch ${BASE_DIR}/${document.getElementById('newEnvName').value}.conf`); closeModal('newEnvModal'); loadData(); };
    document.getElementById('btnAddRuleRow').onclick = () => addRow('REDIRECT', '', '');
    document.getElementById('btnSaveEnv').onclick = async () => {
        let c = document.querySelector('input[value="visual"]').checked ? "" : document.getElementById('envRuleContent').value;
        if (document.querySelector('input[value="visual"]').checked) {
            document.querySelectorAll('.rule-row').forEach(r => { const t = r.querySelector('.rule-type').value, tg = r.querySelector('.rule-target').value, src = r.querySelector('.rule-source').value; if(tg) c += t==='REDIRECT' ? `REDIRECT ${normalizeToConfig(tg,true)} ${normalizeToConfig(src,false)}\n` : `HIDE ${normalizeToConfig(tg,true)}\n`; });
        }
        await exec(`echo '${c}' > ${BASE_DIR}/${currentEditingEnv}.conf`); closeModal('envEditorModal');
    };
    document.getElementById('btnDeleteEnv').onclick = async () => { if(confirm('Del?')) { await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`); closeModal('envEditorModal'); loadData(); } };
    document.querySelectorAll('input[name="editorMode"]').forEach(el => el.onchange = (e) => {
        document.getElementById('editorVisual').classList.toggle('hidden', e.target.value !== 'visual');
        document.getElementById('editorRaw').classList.toggle('hidden', e.target.value === 'visual');
        document.querySelector('.fab-container').classList.toggle('hidden', e.target.value !== 'visual');
        if (e.target.value === 'raw') document.getElementById('envRuleContent').value = document.getElementById('envRuleContent').value || ""; // Sync logic simplified
    });

    // Tab Logic
    document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.target;
        document.getElementById(target).classList.add('active');
        if (target === 'content-io' || target === 'content-log') startPolling(); else stopPolling();
    });

    run("pgrep -f 'injector$'").then(pid => {
        const b = document.getElementById('statusBadge'); b.className = `badge ${pid?'badge-success':'badge-gray'}`; b.textContent = pid ? "RUNNING" : "STOPPED";
        document.getElementById('statusInfo').textContent = pid ? `PID: ${pid}` : "OFFLINE";
    });
});