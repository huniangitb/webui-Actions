import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';
import { mdiAndroid, mdiFolderGoogleDrive, mdiEyeOff, mdiSwapHorizontal, mdiDelete } from '@mdi/js';

// --- 常量与全局变量 ---
const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";

let ruleModalInstance;
let appMap = new Map(); // 缓存所有应用信息: pkg -> info
let configMap = new Set(); // 缓存有配置文件的包名
let currentEditingPkg = null;

// SVG 图标生成器
const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    REDIRECT: getSvg(mdiSwapHorizontal, 18, '#00b74a'),
    HIDE: getSvg(mdiEyeOff, 18, '#f93154'),
    DELETE: getSvg(mdiDelete, 16, 'currentColor')
};

// --- 工具函数 ---
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res && res.stdout ? res.stdout.trim() : "";
    } catch (e) { return ""; }
};

const highlightLog = (text) => {
    if (!text) return '';
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

// --- 核心逻辑: 数据加载 ---
const loadAllData = async () => {
    const listContainer = document.getElementById('appList');
    listContainer.innerHTML = '<div class="text-center p-5 text-muted"><i class="fas fa-circle-notch fa-spin fa-2x"></i><div class="mt-2">加载应用列表...</div></div>';

    try {
        // 1. 获取已存在的配置文件
        const confFiles = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        configMap.clear();
        confFiles.split('\n').forEach(f => {
            const name = f.split('/').pop().replace('.conf', '');
            if (name && name !== 'injector') configMap.add(name);
        });

        // 2. 获取已安装应用列表 (用户+系统)
        // 注意：listPackages 行为取决于 KSU 版本，这里尝试获取所有并合并
        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])]; // 去重

        // 3. 批量获取应用详情
        const infos = await getPackagesInfo(allPkgs);
        appMap.clear();
        
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info && info.packageName) {
                    appMap.set(info.packageName, {
                        ...info,
                        hasConfig: configMap.has(info.packageName)
                    });
                }
            });
        }

        // 4. 渲染列表
        renderAppList();

    } catch (e) {
        toast("数据加载失败: " + e.message);
        listContainer.innerHTML = `<div class="text-center p-4 text-danger">加载失败<br>${e.message}</div>`;
    }
};

// --- 核心逻辑: 列表渲染 ---
const renderAppList = () => {
    const listContainer = document.getElementById('appList');
    const searchTerm = document.getElementById('appSearch').value.toLowerCase();
    const filterType = document.querySelector('input[name="appFilter"]:checked').id; // filterUser, filterSystem, filterConfigured

    const items = [];
    appMap.forEach(app => {
        // 筛选逻辑
        if (filterType === 'filterUser' && app.isSystem) return;
        if (filterType === 'filterSystem' && !app.isSystem) return;
        if (filterType === 'filterConfigured' && !app.hasConfig) return;

        // 搜索逻辑
        const label = app.appLabel || app.packageName;
        if (searchTerm && !label.toLowerCase().includes(searchTerm) && !app.packageName.toLowerCase().includes(searchTerm)) return;

        items.push(app);
    });

    // 排序: 已配置优先 -> 中文名排序
    items.sort((a, b) => {
        if (a.hasConfig !== b.hasConfig) return b.hasConfig - a.hasConfig;
        return (a.appLabel || "").localeCompare(b.appLabel || "", 'zh');
    });

    if (items.length === 0) {
        listContainer.innerHTML = '<div class="p-5 text-center text-muted">未找到匹配的应用</div>';
        return;
    }

    listContainer.innerHTML = items.map(app => {
        const label = app.appLabel || app.packageName;
        const statusBadge = app.hasConfig 
            ? `<span class="badge badge-success shadow-0 ms-2">已配置</span>` 
            : ``;
        
        return `
        <div class="list-group-item list-group-item-action d-flex align-items-center px-3 py-2 border-0 border-bottom" 
             onclick="openRuleEditor('${app.packageName}')">
            <div class="me-3 app-icon-wrapper">${ICONS.ANDROID}</div>
            <div class="flex-grow-1 overflow-hidden">
                <div class="d-flex align-items-center">
                    <div class="fw-bold text-dark text-truncate">${label}</div>
                    ${statusBadge}
                </div>
                <div class="d-flex justify-content-between">
                    <small class="text-muted font-monospace text-truncate" style="max-width: 80%">${app.packageName}</small>
                    <small class="text-muted ms-2">${app.isSystem ? 'System' : 'User'}</small>
                </div>
            </div>
            <i class="fas fa-chevron-right text-muted opacity-25 ms-2"></i>
        </div>`;
    }).join('');
};

// --- 核心逻辑: 规则编辑器 ---
window.openRuleEditor = async (pkgName) => {
    currentEditingPkg = pkgName;
    const app = appMap.get(pkgName) || { packageName: pkgName, appLabel: pkgName, uid: '?' };
    
    // UI 初始化
    document.getElementById('modalAppName').textContent = app.appLabel;
    document.getElementById('modalAppPkg').textContent = app.packageName;
    document.getElementById('modalAppUid').textContent = `UID: ${app.uid}`;
    document.getElementById('modalAppIconContainer').innerHTML = ICONS.ANDROID;
    
    // 加载内容
    const content = await run(`cat ${BASE_DIR}/${pkgName}.conf 2>/dev/null`);
    document.getElementById('modalRuleContent').value = content;
    
    // 初始化图形界面
    parseConfigToVisual(content);
    
    // 默认切回图形模式
    document.getElementById('modeVisual').click();
    
    ruleModalInstance.show();
};

// 解析 Config 文本到图形界面
const parseConfigToVisual = (text) => {
    const container = document.getElementById('ruleBuilderContainer');
    container.innerHTML = '';
    
    const lines = text.split('\n');
    lines.forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return; // 忽略注释和空行

        // 简单解析: REDIRECT <target> <source> 或 HIDE <target>
        // 注意：路径中可能包含空格，这里假设标准格式为空格分隔
        // 更健壮的解析可能需要正则，这里简化处理
        const parts = line.split(/\s+/);
        const type = parts[0];
        
        if (type === 'REDIRECT' && parts.length >= 3) {
            const target = parts[1];
            const source = parts.slice(2).join(' '); // 剩余部分作为 source
            addRuleRow('REDIRECT', target, source);
        } else if (type === 'HIDE' && parts.length >= 2) {
            const target = parts.slice(1).join(' ');
            addRuleRow('HIDE', target, '');
        }
    });
    
    if (container.children.length === 0) {
        // 如果没有规则，默认添加一行空的
        addRuleRow('REDIRECT', '', '');
    }
};

// 添加一行规则输入框
const addRuleRow = (type = 'REDIRECT', target = '', source = '') => {
    const container = document.getElementById('ruleBuilderContainer');
    const div = document.createElement('div');
    div.className = 'rule-row card shadow-0 border mb-2 bg-white';
    div.innerHTML = `
        <div class="card-body p-2 d-flex align-items-center gap-2">
            <select class="form-select form-select-sm rule-type" style="width: 110px; flex-shrink: 0;">
                <option value="REDIRECT" ${type === 'REDIRECT' ? 'selected' : ''}>重定向</option>
                <option value="HIDE" ${type === 'HIDE' ? 'selected' : ''}>隐藏</option>
            </select>
            <div class="flex-grow-1 d-flex flex-column gap-1">
                <input type="text" class="form-control form-control-sm font-monospace rule-target" placeholder="目标路径 (Target)" value="${target}">
                <input type="text" class="form-control form-control-sm font-monospace rule-source ${type === 'HIDE' ? 'd-none' : ''}" placeholder="源路径 (Source)" value="${source}">
            </div>
            <button class="btn btn-link text-danger px-2 btn-del-row">${ICONS.DELETE}</button>
        </div>
    `;
    
    // 事件绑定
    const select = div.querySelector('.rule-type');
    const sourceInput = div.querySelector('.rule-source');
    select.onchange = () => {
        if (select.value === 'HIDE') sourceInput.classList.add('d-none');
        else sourceInput.classList.remove('d-none');
    };
    
    div.querySelector('.btn-del-row').onclick = () => div.remove();
    container.appendChild(div);
};

// 从图形界面生成 Config 文本
const generateConfigFromVisual = () => {
    const rows = document.querySelectorAll('.rule-row');
    let config = "# Generated by GUI\n";
    rows.forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const target = row.querySelector('.rule-target').value.trim();
        const source = row.querySelector('.rule-source').value.trim();
        
        if (!target) return;
        
        if (type === 'REDIRECT' && source) {
            config += `REDIRECT ${target} ${source}\n`;
        } else if (type === 'HIDE') {
            config += `HIDE ${target}\n`;
        }
    });
    return config;
};

// 保存规则
document.getElementById('btnModalSave').onclick = async () => {
    const isVisual = document.getElementById('modeVisual').checked;
    let content = "";
    
    if (isVisual) {
        content = generateConfigFromVisual();
    } else {
        content = document.getElementById('modalRuleContent').value;
    }
    
    const res = await exec(`echo '${content}' > ${BASE_DIR}/${currentEditingPkg}.conf`);
    if (res.errno === 0) {
        toast("保存成功");
        ruleModalInstance.hide();
        // 更新缓存状态
        const app = appMap.get(currentEditingPkg);
        if (app) app.hasConfig = true;
        renderAppList();
    } else {
        toast("保存失败");
    }
};

// 删除规则
document.getElementById('btnDeleteRule').onclick = async () => {
    if (!confirm("确定要删除此应用的所有环境规则吗？")) return;
    await run(`rm ${BASE_DIR}/${currentEditingPkg}.conf`);
    const app = appMap.get(currentEditingPkg);
    if (app) app.hasConfig = false;
    ruleModalInstance.hide();
    renderAppList();
    toast("规则已删除");
};

// 编辑器模式切换
document.querySelectorAll('input[name="editorMode"]').forEach(el => {
    el.onchange = () => {
        const visual = document.getElementById('editorVisual');
        const raw = document.getElementById('editorRaw');
        if (document.getElementById('modeVisual').checked) {
            // Raw -> Visual (尝试解析)
            parseConfigToVisual(document.getElementById('modalRuleContent').value);
            visual.classList.remove('d-none');
            raw.classList.add('d-none');
        } else {
            // Visual -> Raw
            document.getElementById('modalRuleContent').value = generateConfigFromVisual();
            visual.classList.add('d-none');
            raw.classList.remove('d-none');
        }
    };
});

document.getElementById('btnAddRuleRow').onclick = () => addRuleRow();

// --- 监控逻辑优化 ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 100`);
    if (!raw) { tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无活动</td></tr>'; return; }
    
    const searchTerm = (document.getElementById('ioSearch').value || "").toLowerCase();
    
    tbody.innerHTML = raw.split('\n').reverse().map(line => {
        const m = line.match(/\/([^\/]+)\.log:\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        
        const [_, pkg, time, op, details] = m;
        // 使用 appMap 获取应用名称
        const appInfo = appMap.get(pkg);
        const appName = appInfo ? appInfo.appLabel : pkg;
        
        // 搜索过滤
        if (searchTerm && 
            !appName.toLowerCase().includes(searchTerm) && 
            !pkg.toLowerCase().includes(searchTerm) && 
            !details.toLowerCase().includes(searchTerm)) return null;
        
        const displayDetails = details.replace(' -> ', ' <i class="fas fa-arrow-right mx-1 opacity-50"></i> ');
        
        return `<tr>
            <td class="text-muted small">${time}</td>
            <td>
                <div class="fw-bold text-dark" style="font-size: 12px;">${appName}</div>
                <div class="text-muted" style="font-size: 10px;">${pkg}</div>
            </td>
            <td class="text-center"><span class="badge shadow-0 op-${op}">${op}</span></td>
            <td class="text-wrap-path small">${displayDetails}</td>
        </tr>`;
    }).filter(r => r).join('');
};

// --- 通用事件 ---
document.getElementById('appSearch').oninput = renderAppList;
document.querySelectorAll('input[name="appFilter"]').forEach(el => el.onchange = renderAppList);

// Tab 切换逻辑
document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
        
        el.classList.add('active');
        const targetId = el.getAttribute('href').replace('#', '');
        document.getElementById(targetId).classList.add('show', 'active');
        
        if (targetId === 'content-global') loadGlobalConfig();
        if (targetId === 'content-log') loadLogs();
        if (targetId === 'content-io') updateIOTable();
    };
});

const loadGlobalConfig = async () => {
    const main = await run(`cat ${BASE_DIR}/injector.conf 2>/dev/null`);
    document.getElementById('mainConfig').value = main;
};

document.getElementById('btnSaveMain').onclick = async () => {
    const res = await exec(`echo '${document.getElementById('mainConfig').value}' > ${BASE_DIR}/injector.conf`);
    if (res.errno === 0) toast("全局配置已保存");
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    const filesRaw = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = filesRaw.split('\n').filter(f => f);
    
    // 保持选中状态
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        const label = name === 'injector.log' ? '系统日志 (injector.log)' : name;
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${label}</option>`;
    }).join('');
    
    const target = select.value || (fileList[0] ? fileList[0].split('/').pop() : "");
    if (target) {
        const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
        viewer.innerHTML = highlightLog(content);
        viewer.scrollTop = viewer.scrollHeight;
    }
};
document.getElementById('logFileSelect').onchange = loadLogs;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    ruleModalInstance = new mdb.Modal(document.getElementById('ruleModal'));
    loadAllData();
    
    // 状态检查
    run("pgrep -f 'injector$'").then(pid => {
        const badge = document.getElementById('statusBadge');
        badge.className = pid ? "badge badge-success me-2" : "badge badge-danger me-2";
        badge.textContent = pid ? "RUNNING" : "STOPPED";
        document.getElementById('statusInfo').textContent = pid ? `PID: ${pid}` : "OFFLINE";
    });
});