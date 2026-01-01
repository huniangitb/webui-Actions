import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

// 内联图标
const ICON_CONF = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzY2NiI+PHBhdGggZD0iTTE0IDJINmExIDIgMCAwIDAtMSAxVjIxaDEyVjhoLTRWMnptLTIgMTNoLjh2MkgxMnYtMnptMC00aC44djJIMTJ2LTJ6bTAtNGguOHYySDEydi0yem00IDhoLjh2MkgxNnYtMnptMC00aC44djJIMTZ2LTJ6bTAtNGguOHYySDE2di0yem0tNCA0SDZ2LTRoNHY0em0wLTZoLTRWNmg0djZ6Ii8+PC9zdmc+`;
const ICON_APP_DEFAULT = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2FhYSI+PHBhdGggZD0iTTEyIDJMMiA3djlsMTAgNSA0LjMtMi4xIDEuNyAxIDQuMy0yLjF2LTlsLTEwLTV6bTAgMTguNWwtOC00VjguMmw4IDQgOC00djYuM2wtOCA0eiIvPjwvc3ZnPg==`;

let ruleModalInstance, appPickerModalInstance;
let allInstalledApps = [];

const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res && res.stdout ? res.stdout.trim() : "";
    } catch (e) { return ""; }
};

const refreshMDB = () => {
    document.querySelectorAll('.form-outline').forEach(el => {
        const input = el.querySelector('input, textarea');
        if (input && input.value) el.classList.add('active');
        new mdb.Input(el).init();
    });
};

const highlightContent = (text) => {
    if (typeof text !== 'string' || !text) return '';
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

// --- 应用管理 ---
const loadConfigs = async () => {
    const ruleList = document.getElementById('ruleList');
    try {
        const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
        document.getElementById('mainConfig').value = main || "";

        const filesRaw = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        const pkgNames = filesRaw.split('\n')
            .filter(f => f && !f.includes('injector.conf'))
            .map(f => (f.split('/').pop() || "").replace('.conf', ''));

        if (pkgNames.length === 0) {
            ruleList.innerHTML = '<div class="p-5 text-center text-muted small">暂无应用规则</div>';
            return;
        }

        let infoMap = new Map();
        try {
            // 严格遵循文档: getPackagesInfo 返回 PackagesInfo 对象数组，包含 appLabel
            const infos = await getPackagesInfo(pkgNames);
            if (Array.isArray(infos)) {
                infos.forEach(info => { if (info && info.packageName) infoMap.set(info.packageName, info); });
            } else { toast("API Error: getPackagesInfo 未返回数组"); }
        } catch (e) { toast("API Error: 无法获取应用详情"); }

        ruleList.innerHTML = pkgNames.map(pkg => {
            const info = infoMap.get(pkg);
            const label = (info && info.appLabel) ? info.appLabel : pkg; // 使用 appLabel
            const iconSrc = info ? `ksu://icon/${pkg}` : ICON_CONF;
            const statusClass = info ? "text-dark" : "text-muted opacity-50";

            return `
            <div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom app-item-row" 
                 onclick="openRuleEditor('${pkg}', '${label.toString().replace(/'/g, "\\'")}')">
                <div class="d-flex align-items-center overflow-hidden">
                    <img src="${iconSrc}" class="app-icon rounded-circle me-3" onerror="this.src='${ICON_APP_DEFAULT}'">
                    <div class="text-truncate">
                        <div class="fw-bold ${statusClass}">${label}</div>
                        <small class="text-muted font-monospace" style="font-size: 10px;">${pkg}</small>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-muted opacity-25"></i>
            </div>`;
        }).join('');
    } catch (e) { toast("加载配置失败: " + e.message); }
    refreshMDB();
};

window.openRuleEditor = async (pkgName, appLabel) => {
    if (!pkgName) return;
    const content = await run(`cat ${BASE_DIR}/${pkgName}.conf`);
    document.getElementById('modalAppName').textContent = appLabel || pkgName;
    document.getElementById('modalAppPkg').textContent = pkgName;
    const imgEl = document.getElementById('modalAppIcon');
    imgEl.src = `ksu://icon/${pkgName}`;
    imgEl.onerror = () => { imgEl.src = ICON_APP_DEFAULT; };
    document.getElementById('modalRuleContent').value = content || "";
    document.getElementById('btnDeleteRule').onclick = () => deleteRule(pkgName);
    document.getElementById('btnModalSave').onclick = () => saveRule(pkgName);
    ruleModalInstance.show();
    setTimeout(refreshMDB, 200);
};

// --- 应用选择器 ---
document.getElementById('btnOpenAppPicker').onclick = async () => {
    const listContainer = document.getElementById('appPickerList');
    listContainer.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin text-primary fa-2x"></i></div>';
    appPickerModalInstance.show();
    try {
        const packages = await listPackages('user');
        if (!Array.isArray(packages)) throw new Error("listPackages 返回非数组");
        
        const infos = await getPackagesInfo(packages);
        allInstalledApps = (infos || []).filter(app => app && app.packageName);
        
        allInstalledApps.sort((a, b) => {
            const labelA = a.appLabel || a.packageName || "";
            const labelB = b.appLabel || b.packageName || "";
            return labelA.localeCompare(labelB, 'zh');
        });
        renderAppPickerList(allInstalledApps);
    } catch (e) { toast("获取列表失败: " + e.message); }
};

const renderAppPickerList = (apps) => {
    const listContainer = document.getElementById('appPickerList');
    if (apps.length === 0) { listContainer.innerHTML = '<div class="p-4 text-center text-muted">无匹配</div>'; return; }
    listContainer.innerHTML = apps.map(app => {
        const pkg = app.packageName;
        const label = app.appLabel || pkg;
        return `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0" 
             onclick="selectAppToConfig('${pkg}', '${label.toString().replace(/'/g, "\\'")}')">
            <img src="ksu://icon/${pkg}" class="app-icon-sm rounded-circle me-3" onerror="this.src='${ICON_APP_DEFAULT}'">
            <div class="text-truncate">
                <div class="fw-bold text-dark small">${label}</div>
                <small class="text-muted font-monospace" style="font-size: 10px;">${pkg}</small>
            </div>
        </div>`;
    }).join('');
};

window.selectAppToConfig = async (pkgName, label) => {
    appPickerModalInstance.hide();
    const exists = await run(`[ -f ${BASE_DIR}/${pkgName}.conf ] && echo "yes"`);
    if (exists !== "yes") {
        await run(`echo "# REDIRECT /storage/emulated/0/Target /data/media/0/Source" > ${BASE_DIR}/${pkgName}.conf`);
    }
    openRuleEditor(pkgName, label);
};

document.getElementById('appPickerSearch').oninput = (e) => {
    const term = (e.target.value || "").toLowerCase();
    const filtered = allInstalledApps.filter(app => 
        (app.appLabel && app.appLabel.toLowerCase().includes(term)) || 
        (app.packageName && app.packageName.toLowerCase().includes(term))
    );
    renderAppPickerList(filtered);
};

// --- 日志/监控 ---
const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    const filesRaw = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = filesRaw.split('\n').filter(f => f);
    if (fileList.length === 0) { select.innerHTML = '<option value="">无日志</option>'; return; }
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop() || "";
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name === 'injector.log' ? '系统日志' : name}</option>`;
    }).join('');
    const target = select.value || (fileList[0] ? fileList[0].split('/').pop() : "");
    if (target) {
        const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
        viewer.innerHTML = highlightContent(content);
        viewer.scrollTop = viewer.scrollHeight;
    }
};

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 150`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无监控</td></tr>'; return; }
    const searchTerm = (document.getElementById('ioSearch').value || "").toLowerCase();
    tbody.innerHTML = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, pkg, time, op, details] = m;
        if (searchTerm && !details.toLowerCase().includes(searchTerm) && !pkg.toLowerCase().includes(searchTerm)) return null;
        const displayDetails = details.replace(' -> ', ' <i class="fas fa-arrow-right mx-1 opacity-50"></i> ');
        return `<tr>
            <td class="text-muted small">${time}</td>
            <td><span class="badge badge-light text-dark border shadow-0 pkg-badge">${pkg}</span></td>
            <td class="text-center"><span class="badge shadow-0 op-${op}">${op}</span></td>
            <td class="text-wrap-path small">${displayDetails}</td>
        </tr>`;
    }).filter(r => r).join('');
};

// --- 通用 ---
const switchTab = (tabId) => {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    document.querySelector(`[href="#${tabId}"]`)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('show', 'active');
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

const saveRule = async (pkgName) => {
    const content = document.getElementById('modalRuleContent').value;
    const res = await exec(`echo '${content}' > ${BASE_DIR}/${pkgName}.conf`);
    if (res.errno === 0) { ruleModalInstance.hide(); toast(`已保存`); loadConfigs(); }
    else toast("保存失败");
};

const deleteRule = async (pkgName) => {
    if (confirm(`确定删除?`)) { await run(`rm ${BASE_DIR}/${pkgName}.conf`); ruleModalInstance.hide(); loadConfigs(); }
};

document.getElementById('btnSaveMain').onclick = async () => {
    const res = await exec(`echo '${document.getElementById('mainConfig').value}' > ${BASE_DIR}/injector.conf`);
    if (res.errno === 0) toast("保存成功");
};

document.getElementById('btnReload').onclick = async () => {
    toast("重启中..."); await exec(`sh ${SERVICE_SH}`);
    setTimeout(checkStatus, 2000);
};

document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); switchTab(el.getAttribute('href').replace('#', '')); };
});

const checkStatus = () => {
    run("pgrep -f 'injector$'").then(pid => {
        const badge = document.getElementById('statusBadge');
        badge.className = pid ? "badge badge-success me-2" : "badge badge-danger me-2";
        badge.textContent = pid ? "RUNNING" : "STOPPED";
        document.getElementById('statusInfo').textContent = pid ? `PID: ${pid}` : "OFFLINE";
    });
};

document.addEventListener('DOMContentLoaded', () => {
    ruleModalInstance = new mdb.Modal(document.getElementById('ruleModal'));
    appPickerModalInstance = new mdb.Modal(document.getElementById('appPickerModal'));
    loadConfigs();
    checkStatus();
});