import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

let ruleModalInstance;
let appPickerModalInstance;
let allInstalledApps = [];

// 动态注入安全区域样式
if (!document.getElementById('ksu-insets-style')) {
    const link = document.createElement('link');
    link.id = 'ksu-insets-style';
    link.rel = 'stylesheet';
    link.href = '/internal/insets.css';
    document.head.appendChild(link);
}

// 通用执行函数
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res && res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        return "";
    }
};

// 刷新 MDB 输入框状态
const refreshMDB = () => {
    document.querySelectorAll('.form-outline').forEach(el => {
        const input = el.querySelector('input, textarea');
        if (input && input.value) el.classList.add('active');
        new mdb.Input(el).init();
    });
};

// 语法高亮处理器
const highlightContent = (text) => {
    if (typeof text !== 'string' || !text) return '';
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

// --- 应用配置管理 ---
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
                const fileName = parts.pop() || "";
                return fileName.replace('.conf', '');
            });

        if (pkgNames.length === 0) {
            ruleList.innerHTML = '<div class="p-5 text-center text-muted small">暂无应用规则</div>';
        } else {
            const packagesInfo = await getPackagesInfo(pkgNames);
            const infoMap = new Map();
            if (packagesInfo && Array.isArray(packagesInfo)) {
                packagesInfo.forEach(info => {
                    if (info && info.packageName) infoMap.set(info.packageName, info);
                });
            }

            ruleList.innerHTML = pkgNames.map(pkg => {
                const info = infoMap.get(pkg);
                const label = (info && info.label) ? info.label : pkg;
                const safeLabel = label.toString().replace(/'/g, "\\'");
                const iconSrc = info ? `ksu://icon/${pkg}` : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
                
                return `
                <div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom app-item-row" 
                     onclick="openRuleEditor('${pkg}', '${safeLabel}')">
                    <div class="d-flex align-items-center overflow-hidden">
                        <img src="${iconSrc}" class="app-icon rounded-circle me-3">
                        <div class="text-truncate">
                            <div class="fw-bold text-dark">${label}</div>
                            <small class="text-muted font-monospace" style="font-size: 11px;">${pkg}</small>
                        </div>
                    </div>
                    <i class="fas fa-chevron-right text-muted opacity-25"></i>
                </div>`;
            }).join('');
        }
    } catch (e) {
        ruleList.innerHTML = `<div class="alert alert-danger m-3 small">加载配置异常: ${e.message}</div>`;
    }
    refreshMDB();
};

window.openRuleEditor = async (pkgName, appLabel) => {
    if (!pkgName) return;
    const content = await run(`cat ${BASE_DIR}/${pkgName}.conf`);
    document.getElementById('modalAppName').textContent = appLabel || pkgName;
    document.getElementById('modalAppPkg').textContent = pkgName;
    document.getElementById('modalAppIcon').src = `ksu://icon/${pkgName}`;
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
        const packages = await listPackages('user');
        if (packages && Array.isArray(packages)) {
            const infos = await getPackagesInfo(packages);
            
            // 关键修复：1. 过滤掉 API 返回的空值 2. 增强排序安全性
            allInstalledApps = (infos || []).filter(app => app && (app.label || app.packageName));
            
            allInstalledApps.sort((a, b) => {
                const labelA = a.label || a.packageName || "";
                const labelB = b.label || b.packageName || "";
                return labelA.localeCompare(labelB, 'zh');
            });
            
            renderAppPickerList(allInstalledApps);
        } else {
            throw new Error("无法获取安装包列表");
        }
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
        const pkg = app.packageName || "unknown";
        const label = app.label || pkg;
        const safeLabel = label.toString().replace(/'/g, "\\'");
        return `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0" 
             onclick="selectAppToConfig('${pkg}', '${safeLabel}')">
            <img src="ksu://icon/${pkg}" class="app-icon-sm rounded-circle me-3">
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
        (app.label && app.label.toLowerCase().includes(term)) || 
        (app.packageName && app.packageName.toLowerCase().includes(term))
    );
    renderAppPickerList(filtered);
};

// --- 日志与监控 ---
const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    const filesRaw = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = filesRaw.split('\n').filter(f => f);
    
    if (fileList.length === 0) {
        select.innerHTML = '<option value="">无日志</option>';
        viewer.textContent = "未找到日志文件";
        return;
    }
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
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无监控数据</td></tr>';
        return;
    }

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

// --- 通用逻辑 ---
const switchTab = (tabId) => {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    
    const targetLink = document.querySelector(`[href="#${tabId}"]`);
    const targetPane = document.getElementById(tabId);
    
    if (targetLink) targetLink.classList.add('active');
    if (targetPane) targetPane.classList.add('show', 'active');
    
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

document.getElementById('btnSaveMain').onclick = async () => {
    const val = document.getElementById('mainConfig').value;
    const res = await exec(`echo '${val}' > ${BASE_DIR}/injector.conf`);
    if (res && res.errno === 0) toast("主配置已保存");
    else toast("保存失败");
};

document.getElementById('btnReload').onclick = async () => {
    toast("正在重启...");
    const res = await exec(`sh ${SERVICE_SH}`);
    if (res && res.errno === 0) {
        toast("重启指令已发送");
        setTimeout(checkStatus, 2000);
    } else {
        toast("重启失败");
    }
};

document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => {
        e.preventDefault();
        const id = el.getAttribute('href').replace('#', '');
        switchTab(id);
    };
});

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
    
    document.querySelectorAll('[data-mdb-collapse-init]').forEach(el => {
        new mdb.Collapse(el);
    });

    loadConfigs();
    checkStatus();
});