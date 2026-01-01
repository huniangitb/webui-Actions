import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

// 内联 SVG 图标 (确保无网络/无API时的显示)
const ICON_CONF = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzY2NiI+PHBhdGggZD0iTTE0IDJINmExIDIgMCAwIDAtMSAxVjIxaDEyVjhoLTRWMnptLTIgMTNoLjh2MkgxMnYtMnptMC00aC44djJIMTJ2LTJ6bTAtNGguOHYySDEydi0yem00IDhoLjh2MkgxNnYtMnptMC00aC44djJIMTZ2LTJ6bTAtNGguOHYySDE2di0yem0tNCA0SDZ2LTRoNHY0em0wLTZoLTRWNmg0djZ6Ii8+PC9zdmc+`;
const ICON_APP_DEFAULT = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2FhYSI+PHBhdGggZD0iTTEyIDJMMiA3djlsMTAgNSA0LjMtMi4xIDEuNyAxIDQuMy0yLjF2LTlsLTEwLTV6bTAgMTguNWwtOC00VjguMmw4IDQgOC00djYuM2wtOCA0eiIvPjwvc3ZnPg==`;

let ruleModalInstance;
let appPickerModalInstance;
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

// --- 应用配置管理 (增强容错) ---
const loadConfigs = async () => {
    const ruleList = document.getElementById('ruleList');
    try {
        const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
        document.getElementById('mainConfig').value = main || "";

        const filesRaw = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        const pkgNames = filesRaw.split('\n')
            .filter(f => f && !f.includes('injector.conf'))
            .map(f => {
                const parts = f.split('/');
                return (parts.pop() || "").replace('.conf', '');
            });

        if (pkgNames.length === 0) {
            ruleList.innerHTML = '<div class="p-5 text-center text-muted small">暂无应用规则</div>';
            return;
        }

        // 尝试获取应用信息，即使失败也继续渲染
        let infoMap = new Map();
        try {
            const packagesInfo = await getPackagesInfo(pkgNames);
            if (packagesInfo && Array.isArray(packagesInfo)) {
                packagesInfo.forEach(info => {
                    if (info && info.packageName) {
                        infoMap.set(info.packageName, info);
                    }
                });
            }
        } catch (apiErr) {
            console.warn("getPackagesInfo failed:", apiErr);
            // 不中断流程，降级显示
        }

        ruleList.innerHTML = pkgNames.map(pkg => {
            const info = infoMap.get(pkg);
            // 降级策略：有 info 用 label，否则用 pkg
            const label = (info && info.label) ? info.label : pkg;
            const safeLabel = label.toString().replace(/'/g, "\\'");
            
            // 图标策略：有 info 尝试 ksu://，否则用默认 SVG
            // 注意：即使是 ksu:// 也可能加载失败，所以保留 onerror
            const iconSrc = info ? `ksu://icon/${pkg}` : ICON_CONF;
            const statusClass = info ? "text-dark" : "text-muted"; // 未安装的应用置灰

            return `
            <div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom app-item-row" 
                 onclick="openRuleEditor('${pkg}', '${safeLabel}')">
                <div class="d-flex align-items-center overflow-hidden">
                    <img src="${iconSrc}" class="app-icon rounded-circle me-3" 
                         onerror="this.src='${ICON_APP_DEFAULT}'">
                    <div class="text-truncate">
                        <div class="fw-bold ${statusClass}">${label}</div>
                        <small class="text-muted font-monospace" style="font-size: 11px;">${pkg}</small>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-muted opacity-25"></i>
            </div>`;
        }).join('');

    } catch (e) {
        ruleList.innerHTML = `<div class="alert alert-danger m-3 small">加载异常: ${e.message}</div>`;
    }
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

const saveRule = async (pkgName) => {
    const content = document.getElementById('modalRuleContent').value;
    await run(`echo '${content}' > ${BASE_DIR}/${pkgName}.conf`);
    ruleModalInstance.hide();
    toast(`已保存: ${pkgName}`);
    loadConfigs();
};

const deleteRule = async (pkgName) => {
    if (confirm(`确定删除 ${pkgName} 的配置?`)) {
        await run(`rm ${BASE_DIR}/${pkgName}.conf`);
        ruleModalInstance.hide();
        toast("规则已删除");
        loadConfigs();
    }
};

// --- 应用选择器 ---
document.getElementById('btnOpenAppPicker').onclick = async () => {
    const listContainer = document.getElementById('appPickerList');
    listContainer.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin text-primary fa-2x"></i></div>';
    appPickerModalInstance.show();
    
    try {
        // 步骤 1: 列出包名
        const packages = await listPackages('user');
        if (!packages || packages.length === 0) throw new Error("未获取到应用列表");

        // 步骤 2: 批量获取信息 (容错处理)
        let infos = [];
        try {
            infos = await getPackagesInfo(packages);
        } catch (e) {
            console.warn("getPackagesInfo failed in picker", e);
            // 降级：手动构造只有包名的对象
            infos = packages.map(p => ({ packageName: p, label: p }));
        }

        // 步骤 3: 过滤与排序
        allInstalledApps = (infos || []).filter(app => app && app.packageName);
        allInstalledApps.sort((a, b) => {
            const labelA = a.label || a.packageName;
            const labelB = b.label || b.packageName;
            return labelA.localeCompare(labelB, 'zh');
        });
        
        renderAppPickerList(allInstalledApps);
    } catch (e) {
        listContainer.innerHTML = `<div class="text-danger p-3 small">加载失败: ${e.message}</div>`;
    }
};

const renderAppPickerList = (apps) => {
    const listContainer = document.getElementById('appPickerList');
    if (!apps || apps.length === 0) {
        listContainer.innerHTML = '<div class="p-4 text-center text-muted">没有匹配的应用</div>';
        return;
    }
    listContainer.innerHTML = apps.map(app => {
        const pkg = app.packageName;
        const label = app.label || pkg;
        const safeLabel = label.toString().replace(/'/g, "\\'");
        
        return `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0" 
             onclick="selectAppToConfig('${pkg}', '${safeLabel}')">
            <img src="ksu://icon/${pkg}" class="app-icon-sm rounded-circle me-3" 
                 onerror="this.src='${ICON_APP_DEFAULT}'">
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
    const filtered = allInstalledApps.filter(app => {
        const l = (app.label || "").toLowerCase();
        const p = (app.packageName || "").toLowerCase();
        return l.includes(term) || p.includes(term);
    });
    renderAppPickerList(filtered);
};

// --- 日志与监控 (保持不变) ---
const loadLogs = async () => {
    const logViewer = document.getElementById('logViewer');
    const select = document.getElementById('logFileSelect');
    const files = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = files.split('\n').filter(f => f);
    
    if (fileList.length === 0) {
        select.innerHTML = '<option value="">无日志</option>';
        logViewer.textContent = "未找到日志"; return;
    }
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name}</option>`;
    }).join('');

    const target = select.value || fileList[0].split('/').pop();
    const content = await run(`tail -c 30000 ${LOG_DIR}/${target} 2>/dev/null`);
    logViewer.innerHTML = highlightContent(content);
    logViewer.scrollTop = logViewer.scrollHeight;
};

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 150`);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无数据</td></tr>';
        return;
    }

    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
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

const switchTab = (tabId) => {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    document.querySelector(`[href="#${tabId}"]`)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('show', 'active');
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

document.getElementById('btnSaveMain').onclick = async () => {
    const val = document.getElementById('mainConfig').value;
    const res = await exec(`echo '${val}' > ${BASE_DIR}/injector.conf`);
    if (res && res.errno === 0) toast("主配置已保存");
};

document.getElementById('btnReload').onclick = async () => {
    toast("正在重启...");
    await exec(`sh ${SERVICE_SH}`);
    setTimeout(checkStatus, 2000);
};

document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); switchTab(el.getAttribute('href').replace('#', '')); };
});

document.getElementById('logFileSelect').onchange = loadLogs;
document.getElementById('ioSearch').oninput = updateIOTable;

const checkStatus = () => {
    run("pgrep -f 'injector$'").then(pid => {
        const badge = document.getElementById('statusBadge');
        const info = document.getElementById('statusInfo');
        if (pid) {
            badge.className = "badge badge-success me-2";
            badge.textContent = "RUNNING";
            info.textContent = `PID: ${pid}`;
        } else {
            badge.className = "badge badge-danger me-2";
            badge.textContent = "STOPPED";
            info.textContent = "服务未运行";
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    ruleModalInstance = new mdb.Modal(document.getElementById('ruleModal'));
    appPickerModalInstance = new mdb.Modal(document.getElementById('appPickerModal'));
    
    document.querySelectorAll('[data-mdb-collapse-init]').forEach(el => new mdb.Collapse(el));

    loadConfigs();
    checkStatus();
});