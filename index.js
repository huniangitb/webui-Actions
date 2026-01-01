import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, fullScreen, enableInsets, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

fullScreen(false); 
enableInsets(true);

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

let ruleModalInstance;
let appPickerModalInstance;
let allInstalledApps = []; // 缓存应用列表

const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res.stdout.trim() || "";
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
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

// --- 图形化配置管理 ---

// 加载已配置的规则列表
const loadConfigs = async () => {
    const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
    document.getElementById('mainConfig').value = main;
    
    // 获取所有 .conf 文件
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    const ruleList = document.getElementById('ruleList');
    
    // 过滤出包名
    const pkgNames = files.split('\n')
        .filter(f => f && !f.includes('injector.conf'))
        .map(f => f.split('/').pop().replace('.conf', ''));
    
    if (pkgNames.length === 0) {
        ruleList.innerHTML = '<div class="p-5 text-center text-muted"><i class="fas fa-box-open fa-2x mb-3"></i><br>暂无已配置的应用</div>';
        return;
    }

    // 使用 KSU API 获取应用详细信息 (图标、名称)
    try {
        const packagesInfo = await getPackagesInfo(pkgNames);
        
        // 构建 Map 方便查找，处理已卸载但残留配置的情况
        const infoMap = new Map();
        packagesInfo.forEach(info => infoMap.set(info.packageName, info));

        ruleList.innerHTML = pkgNames.map(pkg => {
            const info = infoMap.get(pkg);
            // 如果应用已卸载，显示默认图标和包名
            const label = info ? info.label : pkg;
            const iconSrc = info ? `ksu://icon/${pkg}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDMiA2IDIgMjIgMTIgMjJzMTAtMTYgMTAtMjBMMTIgMnpNMTAgMTZoLTR2LTRoNHY0em0wLTZoLTRWNmg0djZ6Ii8+PC9zdmc+'; // 简单的盾牌图标
            const statusColor = info ? 'text-dark' : 'text-muted text-decoration-line-through';

            return `
            <div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom app-item-row" onclick="openRuleEditor('${pkg}', '${label.replace(/'/g, "\\'")}')">
                <div class="d-flex align-items-center overflow-hidden">
                    <img src="${iconSrc}" class="app-icon rounded-circle me-3" loading="lazy">
                    <div class="text-truncate">
                        <div class="fw-bold ${statusColor}">${label}</div>
                        <small class="text-muted font-monospace" style="font-size: 11px;">${pkg}</small>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-muted opacity-25"></i>
            </div>`;
        }).join('');
    } catch (e) {
        console.error("Failed to get packages info", e);
        ruleList.innerHTML = `<div class="text-danger p-3">获取应用信息失败: ${e.message}</div>`;
    }
    
    refreshMDB();
};

// 打开规则编辑器
window.openRuleEditor = async (pkgName, appLabel) => {
    const content = await run(`cat ${BASE_DIR}/${pkgName}.conf`);
    
    document.getElementById('modalAppName').textContent = appLabel || pkgName;
    document.getElementById('modalAppPkg').textContent = pkgName;
    document.getElementById('modalAppIcon').src = `ksu://icon/${pkgName}`;
    document.getElementById('modalRuleContent').value = content;
    
    // 绑定删除按钮事件
    document.getElementById('btnDeleteRule').onclick = () => deleteRule(pkgName);
    
    // 绑定保存按钮事件
    document.getElementById('btnModalSave').onclick = () => saveRule(pkgName);

    ruleModalInstance.show();
    setTimeout(refreshMDB, 200);
};

const saveRule = async (pkgName) => {
    const content = document.getElementById('modalRuleContent').value;
    await run(`echo '${content}' > ${BASE_DIR}/${pkgName}.conf`);
    ruleModalInstance.hide();
    toast(`已保存规则: ${pkgName}`);
    loadConfigs();
};

const deleteRule = async (pkgName) => {
    if(confirm(`确定要删除 ${pkgName} 的配置吗？`)) {
        await run(`rm ${BASE_DIR}/${pkgName}.conf`);
        ruleModalInstance.hide();
        toast("规则已删除");
        loadConfigs();
    }
};

// --- 应用选择器逻辑 ---

// 打开应用选择器
document.getElementById('btnOpenAppPicker').onclick = async () => {
    const listContainer = document.getElementById('appPickerList');
    listContainer.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin text-primary fa-2x"></i></div>';
    appPickerModalInstance.show();

    try {
        // 获取所有用户应用
        const packages = await listPackages('user');
        allInstalledApps = await getPackagesInfo(packages);
        
        // 按应用名称排序
        allInstalledApps.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
        
        renderAppPickerList(allInstalledApps);
    } catch (e) {
        listContainer.innerHTML = `<div class="text-danger p-3">加载应用列表失败: ${e}</div>`;
    }
};

// 渲染应用选择列表
const renderAppPickerList = (apps) => {
    const html = apps.map(app => `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0" 
             onclick="selectAppToConfig('${app.packageName}', '${app.label.replace(/'/g, "\\'")}')">
            <img src="ksu://icon/${app.packageName}" class="app-icon-sm rounded-circle me-3" loading="lazy">
            <div class="text-truncate">
                <div class="fw-bold text-dark">${app.label}</div>
                <small class="text-muted font-monospace" style="font-size: 10px;">${app.packageName}</small>
            </div>
        </div>
    `).join('');
    document.getElementById('appPickerList').innerHTML = html;
};

// 选择应用后，创建空配置并打开编辑器
window.selectAppToConfig = async (pkgName, label) => {
    appPickerModalInstance.hide();
    // 检查是否已存在
    const exists = await run(`[ -f ${BASE_DIR}/${pkgName}.conf ] && echo "yes"`);
    if (!exists) {
        // 创建默认模板
        await run(`echo "# REDIRECT /storage/emulated/0/Target /data/media/0/Source" > ${BASE_DIR}/${pkgName}.conf`);
    }
    openRuleEditor(pkgName, label);
};

// 应用搜索过滤
document.getElementById('appPickerSearch').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allInstalledApps.filter(app => 
        app.label.toLowerCase().includes(term) || 
        app.packageName.toLowerCase().includes(term)
    );
    renderAppPickerList(filtered);
};

// --- 日志与监控 (保持原有逻辑) ---
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
    const cmd = `grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 200`;
    const raw = await run(cmd);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无应用监控数据</td></tr>';
        return;
    }

    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').reverse().map(line => {
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
    tbody.innerHTML = rows;
};

// --- 初始化与事件 ---
const switchTab = (tabId) => {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    document.querySelector(`[href="#${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('show', 'active');
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

document.getElementById('btnSaveMain').onclick = async () => {
    await run(`echo '${document.getElementById('mainConfig').value}' > ${BASE_DIR}/injector.conf`);
    toast("主配置已保存");
};

document.getElementById('btnReload').onclick = async () => {
    toast("重启中..."); await run(`sh ${SERVICE_SH}`);
    setTimeout(checkStatus, 1500);
};

document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); switchTab(el.getAttribute('href').substring(1)); };
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
            info.textContent = `PID: ${pid.trim()}`;
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
    
    // 初始化折叠组件
    document.querySelectorAll('[data-mdb-collapse-init]').forEach(el => new mdb.Collapse(el));

    loadConfigs();
    checkStatus();
});