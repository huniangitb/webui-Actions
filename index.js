import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';
import { mdiAndroid, mdiFileDocumentOutline } from '@mdi/js';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

let ruleModalInstance, appPickerModalInstance;
let allInstalledApps = [];

// SVG 图标
const getSvg = (path, color = "currentColor") => `<svg viewBox="0 0 24 24" fill="${color}" style="width:100%;height:100%"><path d="${path}"/></svg>`;
const ICON_APP_DEFAULT = getSvg(mdiAndroid, "#aaa");

// 执行命令封装
const run = async (cmd) => {
    try {
        const { stdout } = await exec(cmd);
        return stdout ? stdout.trim() : "";
    } catch (e) { return ""; }
};

// 刷新 MDB 输入框状态
const refreshMDB = () => {
    document.querySelectorAll('.form-outline').forEach(el => {
        const input = el.querySelector('input, textarea');
        if (input && input.value) el.classList.add('active');
        new mdb.Input(el).init();
    });
};

// 日志高亮
const highlightContent = (text) => {
    if (!text) return '';
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

// --- 配置管理 ---
const loadConfigs = async () => {
    const ruleList = document.getElementById('ruleList');
    try {
        // 加载全局配置：显式重定向错误流，防止 exec 抛出异常导致后续代码不执行
        const main = await run(`cat ${BASE_DIR}/injector.conf 2>/dev/null`);
        document.getElementById('mainConfig').value = main || "";

        const filesRaw = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        const pkgNames = filesRaw.split('\n')
            .filter(f => f && !f.includes('injector.conf'))
            .map(f => f.split('/').pop().replace('.conf', ''));

        if (pkgNames.length === 0) {
            ruleList.innerHTML = '<div class="p-5 text-center text-muted small">暂无应用规则</div>';
            return;
        }

        const infos = await getPackagesInfo(pkgNames);
        const infoMap = new Map(infos.map(i => [i.packageName, i]));

        ruleList.innerHTML = pkgNames.map(pkg => {
            const info = infoMap.get(pkg);
            const label = info?.label || pkg;
            return `
            <div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom app-item-row" 
                 onclick="openRuleEditor('${pkg}', '${label.replace(/'/g, "\\'")}')">
                <div class="d-flex align-items-center overflow-hidden">
                    <img src="ksu://icon/${pkg}" class="app-icon rounded-circle me-3" onerror="this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';this.outerHTML='<div class=app-icon>${ICON_APP_DEFAULT}</div>'">
                    <div class="text-truncate">
                        <div class="fw-bold ${info ? 'text-dark' : 'text-muted'}">${label}</div>
                        <small class="text-muted font-monospace" style="font-size: 10px;">${pkg}</small>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-muted opacity-25"></i>
            </div>`;
        }).join('');
    } catch (e) { toast("加载失败: " + e.message); }
    refreshMDB();
};

window.openRuleEditor = async (pkg, label) => {
    const content = await run(`cat ${BASE_DIR}/${pkg}.conf 2>/dev/null`);
    document.getElementById('modalAppName').textContent = label;
    document.getElementById('modalAppPkg').textContent = pkg;
    document.getElementById('modalAppIcon').src = `ksu://icon/${pkg}`;
    document.getElementById('modalRuleContent').value = content || "";
    document.getElementById('btnDeleteRule').onclick = () => deleteRule(pkg);
    document.getElementById('btnModalSave').onclick = () => saveRule(pkg);
    ruleModalInstance.show();
    setTimeout(refreshMDB, 200);
};

// --- 应用选择器 ---
document.getElementById('btnOpenAppPicker').onclick = async () => {
    const listContainer = document.getElementById('appPickerList');
    listContainer.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>';
    appPickerModalInstance.show();
    try {
        const packages = await listPackages('user');
        const infos = await getPackagesInfo(packages);
        allInstalledApps = infos.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
        renderAppPicker(allInstalledApps);
    } catch (e) { toast("获取列表失败"); }
};

const renderAppPicker = (apps) => {
    document.getElementById('appPickerList').innerHTML = apps.map(app => `
    <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0" 
         onclick="selectAppToConfig('${app.packageName}', '${app.label.replace(/'/g, "\\'")}')">
        <img src="ksu://icon/${app.packageName}" class="app-icon-sm rounded-circle me-3" onerror="this.outerHTML='<div class=app-icon-sm>${ICON_APP_DEFAULT}</div>'">
        <div class="text-truncate">
            <div class="fw-bold text-dark small">${app.label}</div>
            <small class="text-muted font-monospace" style="font-size: 10px;">${app.packageName}</small>
        </div>
    </div>`).join('');
};

window.selectAppToConfig = async (pkg, label) => {
    appPickerModalInstance.hide();
    const exists = await run(`[ -f ${BASE_DIR}/${pkg}.conf ] && echo 1`);
    if (!exists) await exec(`echo "# REDIRECT /storage/emulated/0/Target /data/media/0/Source" > ${BASE_DIR}/${pkg}.conf`);
    openRuleEditor(pkg, label);
};

document.getElementById('appPickerSearch').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allInstalledApps.filter(a => a.label.toLowerCase().includes(term) || a.packageName.toLowerCase().includes(term));
    renderAppPicker(filtered);
};

// --- 日志与监控 ---
const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    const files = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = files.split('\n').filter(f => f);
    if (!fileList.length) { select.innerHTML = '<option>无日志</option>'; return; }
    
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name === 'injector.log' ? '系统日志' : name}</option>`;
    }).join('');
    
    const target = select.value || fileList[0].split('/').pop();
    const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
    viewer.innerHTML = highlightContent(content);
    viewer.scrollTop = viewer.scrollHeight;
};

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 150`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无监控</td></tr>'; return; }
    
    const term = document.getElementById('ioSearch').value.toLowerCase();
    tbody.innerHTML = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, pkg, time, op, details] = m;
        if (term && !details.toLowerCase().includes(term) && !pkg.toLowerCase().includes(term)) return null;
        return `<tr>
            <td class="text-muted small">${time}</td>
            <td><span class="badge badge-light text-dark border shadow-0 pkg-badge">${pkg}</span></td>
            <td class="text-center"><span class="badge shadow-0 op-${op}">${op}</span></td>
            <td class="text-wrap-path small">${details.replace(' -> ', ' <i class="fas fa-arrow-right mx-1 opacity-50"></i> ')}</td>
        </tr>`;
    }).filter(r => r).join('');
};

// --- 通用操作 ---
const saveRule = async (pkg) => {
    const { errno } = await exec(`echo '${document.getElementById('modalRuleContent').value}' > ${BASE_DIR}/${pkg}.conf`);
    if (errno === 0) { ruleModalInstance.hide(); toast("保存成功"); loadConfigs(); }
};

const deleteRule = async (pkg) => {
    if (confirm("确定删除？")) { await exec(`rm ${BASE_DIR}/${pkg}.conf`); ruleModalInstance.hide(); loadConfigs(); }
};

document.getElementById('btnSaveMain').onclick = async () => {
    const { errno } = await exec(`echo '${document.getElementById('mainConfig').value}' > ${BASE_DIR}/injector.conf`);
    toast(errno === 0 ? "保存成功" : "保存失败");
};

document.getElementById('btnReload').onclick = async () => {
    toast("正在重启服务...");
    await exec(`sh ${SERVICE_SH}`);
    setTimeout(checkStatus, 2000);
};

const switchTab = (id) => {
    document.querySelectorAll('.nav-link, .tab-pane').forEach(el => el.classList.remove('active', 'show'));
    document.querySelector(`[href="#${id}"]`).classList.add('active');
    document.getElementById(id).classList.add('show', 'active');
    if (id === 'content-log') loadLogs();
    if (id === 'content-io') updateIOTable();
};

document.querySelectorAll('.nav-link').forEach(el => el.onclick = (e) => { e.preventDefault(); switchTab(el.getAttribute('href').slice(1)); });

const checkStatus = async () => {
    const pid = await run("pgrep -f 'injector$'");
    const badge = document.getElementById('statusBadge');
    badge.className = `badge badge-${pid ? 'success' : 'danger'} me-2`;
    badge.textContent = pid ? "RUNNING" : "STOPPED";
    document.getElementById('statusInfo').textContent = pid ? `PID: ${pid}` : "OFFLINE";
};

document.addEventListener('DOMContentLoaded', () => {
    ruleModalInstance = new mdb.Modal(document.getElementById('ruleModal'));
    appPickerModalInstance = new mdb.Modal(document.getElementById('appPickerModal'));
    loadConfigs();
    checkStatus();
});