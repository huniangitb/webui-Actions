import './style.css';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile } from '@mdi/js';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const INJECTOR_CONF = `${BASE_DIR}/injector.conf`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
const PATH_PREFIX_STORAGE = '/storage/emulated/0';
const PATH_PREFIX_REAL = '/data/media/0';

let appMap = new Map();
let envList = [];
let registry = new Map();
let currentEditingEnv = null;
let currentBindingPkg = null;
let activeMounts = new Set();
let logPolling = null;

// 图标生成辅助函数
const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    ENV: getSvg(mdiLayers, 24, '#1266f1'),
    DELETE: getSvg(mdiDelete, 16, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e')
};

// KSU Exec 封装
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        console.error("Exec error:", e);
        return "";
    }
};

// 防抖函数
const debounce = (func, wait) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// 模态框控制
window.openModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
};
window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
};

// 路径处理
const normalizeToDisplay = (path) => {
    if (!path) return "";
    if (path.startsWith(PATH_PREFIX_REAL)) return path.substring(PATH_PREFIX_REAL.length) || "/";
    if (path.startsWith(PATH_PREFIX_STORAGE)) return path.substring(PATH_PREFIX_STORAGE.length) || "/";
    return path;
};

const normalizeToConfig = (path, isTarget) => {
    if (!path) return "";
    path = path.trim();
    if (isTarget) {
        if (path.startsWith('/')) return path;
        return (PATH_PREFIX_STORAGE + '/' + path).replace(/\/+/g, '/');
    } else {
        if (path.startsWith('/')) return path;
        return (PATH_PREFIX_REAL + '/' + path).replace(/\/+/g, '/');
    }
};

// 数据加载核心逻辑
const loadData = async () => {
    try {
        // 1. 获取挂载状态 (解析 fuse_daemon 参数)
        const fuseArgs = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
        activeMounts.clear();
        if (fuseArgs) {
            fuseArgs.split('\n').forEach(line => {
                const match = line.match(/--pkg=([a-zA-Z0-9._]+)/);
                if (match) activeMounts.add(match[1]);
            });
        }

        // 2. 获取环境列表
        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files ? files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector') : [];

        // 3. 获取绑定配置
        const regContent = await run(`cat ${INJECTOR_CONF} 2>/dev/null`);
        registry.clear();
        if (regContent) {
            regContent.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && !line.trim().startsWith('#')) {
                    registry.set(parts[0], { env: parts[1], param: parts[2] || "" });
                }
            });
        }

        // 4. 获取应用列表 (KSU API)
        const userPkgs = await listPackages('user') || [];
        const systemPkgs = await listPackages('system') || [];
        // 去重合并
        const allPkgs = [...new Set([...userPkgs, ...systemPkgs])];
        const infos = await getPackagesInfo(allPkgs);

        appMap.clear();
        if (Array.isArray(infos)) {
            infos.forEach(info => {
                if (info && info.packageName) {
                    const reg = registry.get(info.packageName);
                    appMap.set(info.packageName, { 
                        ...info, 
                        boundEnv: reg?.env, 
                        boundParam: reg?.param 
                    });
                }
            });
        }

        renderAppList();
        renderEnvList();
    } catch (e) {
        toast("加载失败: " + e.message);
        console.error(e);
    }
};

// 渲染应用列表
const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const searchVal = document.getElementById('appSearch').value.toLowerCase();
    const filterEl = document.querySelector('input[name="appFilter"]:checked');
    const filter = filterEl ? filterEl.id : 'filterUser';

    const items = [];
    appMap.forEach(app => {
        // 过滤逻辑
        if (filter === 'filterUser' && app.isSystem) return;
        if (filter === 'filterSystem' && !app.isSystem) return;
        if (filter === 'filterBound' && !app.boundEnv) return;

        // 搜索逻辑
        const label = app.appLabel || app.packageName;
        if (searchVal && !label.toLowerCase().includes(searchVal) && !app.packageName.toLowerCase().includes(searchVal)) return;

        items.push(app);
    });

    // 排序：已绑定 > 字母顺序
    items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || (a.appLabel || "").localeCompare(b.appLabel || ""));

    listEl.innerHTML = items.length ? items.map(app => {
        let badges = "";
        // 挂载状态
        if (activeMounts.has(app.packageName)) {
            badges += `<span class="badge badge-success" style="margin-left:6px">MOUNTED</span>`;
        }
        // 绑定环境
        if (app.boundEnv) {
            let colorClass = "badge-primary";
            if (app.boundParam === 'MONITOR') colorClass = "badge-warning";
            else if (app.boundParam === 'PASSTHROUGH') colorClass = "badge-success";
            badges += `<span class="badge ${colorClass}" style="margin-left:6px">${app.boundEnv}</span>`;
        }

        return `
        <div class="list-item" onclick="openAppConfig('${app.packageName}')">
            <div class="me-3">${ICONS.ANDROID}</div>
            <div class="app-content">
                <div class="app-header">
                    <span class="app-name">${app.appLabel}</span>
                    ${badges}
                </div>
                <small class="text-muted font-monospace">${app.packageName}</small>
            </div>
        </div>`;
    }).join('') : '<div style="text-align:center;padding:20px;color:var(--text-muted)">无匹配应用</div>';
};

// 渲染环境列表
const renderEnvList = () => {
    const listEl = document.getElementById('envList');
    if (envList.length === 0) {
        listEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">暂无环境，请新建</div>';
        return;
    }
    listEl.innerHTML = envList.map(env => `
        <div class="env-item" onclick="openEnvEditor('${env}')">
            <div style="flex:1"><h4 style="margin:0;font-size:15px;">${env}</h4></div>
            <i class="fas fa-chevron-right text-muted"></i>
        </div>`).join('');
};

// 打开应用配置模态框
window.openAppConfig = (pkg) => {
    currentBindingPkg = pkg;
    const app = appMap.get(pkg);
    if (!app) return;

    document.getElementById('bindAppName').textContent = app.appLabel;
    document.getElementById('bindAppPkg').textContent = pkg;
    document.getElementById('bindAppIcon').innerHTML = ICONS.ANDROID;

    const select = document.getElementById('bindEnvSelect');
    select.innerHTML = '<option value="">未绑定 (清除)</option>' + 
        envList.map(e => `<option value="${e}">${e}</option>`).join('');
    
    select.value = app.boundEnv || "";
    
    const mode = app.boundParam || "";
    if (mode === 'MONITOR') document.getElementById('modeMonitor').checked = true;
    else if (mode === 'PASSTHROUGH') document.getElementById('modePassthrough').checked = true;
    else document.getElementById('modeDefault').checked = true;

    openModal('appConfigModal');
};

// 保存应用绑定
document.getElementById('btnSaveBinding').onclick = async () => {
    const env = document.getElementById('bindEnvSelect').value;
    const modeEl = document.querySelector('input[name="bindMode"]:checked');
    const mode = modeEl ? modeEl.value : "";

    if (env) {
        registry.set(currentBindingPkg, { env, param: mode });
    } else {
        registry.delete(currentBindingPkg);
    }

    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => {
        content += `${key} ${val.env} ${val.param}\n`;
    });

    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    toast("绑定已更新");
    closeModal('appConfigModal');
    loadData();
};

// 新建环境
document.getElementById('btnNewEnv').onclick = () => {
    document.getElementById('newEnvName').value = '';
    openModal('newEnvModal');
};

document.getElementById('btnCreateEnv').onclick = async () => {
    const name = document.getElementById('newEnvName').value.trim();
    if (!name) return toast("名称不能为空");
    
    await exec(`touch ${BASE_DIR}/${name}.conf`);
    closeModal('newEnvModal');
    loadData();
};

// 打开环境编辑器
window.openEnvEditor = async (envName) => {
    currentEditingEnv = envName;
    document.getElementById('editorEnvName').textContent = envName;
    
    const content = await run(`cat ${BASE_DIR}/${envName}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = content;
    
    parseConfigToVisual(content);
    
    // 默认切换到图形模式
    const visualRadio = document.querySelector('input[name="editorMode"][value="visual"]');
    if (visualRadio) {
        visualRadio.checked = true;
        visualRadio.dispatchEvent(new Event('change'));
    }
    
    openModal('envEditorModal');
};

// 切换编辑器模式
document.querySelectorAll('input[name="editorMode"]').forEach(el => {
    el.onchange = (e) => {
        const isVisual = e.target.value === 'visual';
        document.getElementById('editorVisual').classList.toggle('hidden', !isVisual);
        document.getElementById('editorRaw').classList.toggle('hidden', isVisual);
        document.querySelector('.fab-container').classList.toggle('hidden', !isVisual);
        
        if (!isVisual) {
            // 切换到源码模式，生成配置
            document.getElementById('envRuleContent').value = generateConfigFromVisual();
        } else {
            // 切换到图形模式，解析配置
            parseConfigToVisual(document.getElementById('envRuleContent').value);
        }
    };
});

// 解析配置到图形界面
const parseConfigToVisual = (text) => {
    const container = document.getElementById('ruleBuilderContainer');
    container.innerHTML = '';
    
    if (text) {
        text.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'REDIRECT' && parts.length >= 3) {
                const target = normalizeToDisplay(parts[1]);
                const source = normalizeToDisplay(parts.slice(2).join(' '));
                addRuleRow('REDIRECT', target, source);
            } else if (parts[0] === 'HIDE' && parts.length >= 2) {
                const target = normalizeToDisplay(parts[1]);
                addRuleRow('HIDE', target, '');
            }
        });
    }
    
    if (container.children.length === 0) {
        addRuleRow('REDIRECT', '', '');
    }
};

// 添加规则行
const addRuleRow = (type, target, source) => {
    const div = document.createElement('div');
    div.className = 'rule-row';
    div.innerHTML = `
        <select class="form-select rule-type">
            <option value="REDIRECT">重定向</option>
            <option value="HIDE">隐藏</option>
        </select>
        <div class="rule-inputs">
            <input type="text" class="form-control rule-target" placeholder="原始路径" value="${target}">
            <input type="text" class="form-control rule-source ${type==='HIDE'?'hidden':''}" placeholder="重定向至" value="${source}">
        </div>
        <button class="btn btn-close btn-del">${ICONS.DELETE}</button>
    `;

    const select = div.querySelector('.rule-type');
    select.value = type;
    select.onchange = (e) => {
        div.querySelector('.rule-source').classList.toggle('hidden', e.target.value === 'HIDE');
    };

    div.querySelector('.btn-del').onclick = () => div.remove();

    setupAutocomplete(div.querySelector('.rule-target'));
    setupAutocomplete(div.querySelector('.rule-source'));

    document.getElementById('ruleBuilderContainer').appendChild(div);
};

// 从图形界面生成配置
const generateConfigFromVisual = () => {
    let res = "";
    document.querySelectorAll('.rule-row').forEach(row => {
        const type = row.querySelector('.rule-type').value;
        const target = row.querySelector('.rule-target').value.trim();
        const source = row.querySelector('.rule-source').value.trim();
        
        if (target) {
            if (type === 'REDIRECT' && source) {
                res += `REDIRECT ${normalizeToConfig(target, true)} ${normalizeToConfig(source, false)}\n`;
            } else if (type === 'HIDE') {
                res += `HIDE ${normalizeToConfig(target, true)}\n`;
            }
        }
    });
    return res;
};

document.getElementById('btnAddRuleRow').onclick = () => addRuleRow('REDIRECT', '', '');

// 保存环境配置
document.getElementById('btnSaveEnv').onclick = async () => {
    const isVisual = document.querySelector('input[name="editorMode"][value="visual"]').checked;
    const content = isVisual ? generateConfigFromVisual() : document.getElementById('envRuleContent').value;
    
    await exec(`echo '${content}' > ${BASE_DIR}/${currentEditingEnv}.conf`);
    toast("规则已保存");
    closeModal('envEditorModal');
};

// 删除环境
document.getElementById('btnDeleteEnv').onclick = async () => {
    if (!confirm(`确定删除环境 ${currentEditingEnv} 吗?`)) return;
    
    await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`);
    
    // 清理引用该环境的绑定
    let content = "# Generated by WebUI\n";
    registry.forEach((val, key) => {
        if (val.env !== currentEditingEnv) {
            content += `${key} ${val.env} ${val.param}\n`;
        }
    });
    await exec(`echo '${content}' > ${INJECTOR_CONF}`);
    
    closeModal('envEditorModal');
    loadData();
};

// --- 自动补全逻辑 ---
const updateBoxPosition = (input) => {
    const box = document.getElementById('suggestionBox');
    if (box.style.display === 'none' || !input) return;

    const rect = input.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const boxHeight = box.offsetHeight || 200;
    const maxWidth = Math.min(300, window.innerWidth - 20);
    
    box.style.width = maxWidth + 'px';
    
    let leftPos = rect.left;
    if (leftPos + maxWidth > window.innerWidth) leftPos = window.innerWidth - maxWidth - 10;
    box.style.left = leftPos + 'px';

    const spaceBelow = viewportHeight - rect.bottom;
    // 智能上下翻转
    if (spaceBelow < boxHeight && rect.top > boxHeight) {
        box.style.top = (rect.top - boxHeight - 2) + 'px';
    } else {
        box.style.top = (rect.bottom + 2) + 'px';
    }
};

const startAutoUpdate = (input) => {
    const box = document.getElementById('suggestionBox');
    const loop = () => {
        if (box.style.display !== 'none' && window._currentInput === input) {
            updateBoxPosition(input);
            requestAnimationFrame(loop);
        }
    };
    requestAnimationFrame(loop);
};

// 全局点击监听，隐藏补全框
document.addEventListener('click', (e) => {
    const box = document.getElementById('suggestionBox');
    if (box.style.display === 'none') return;
    if (e.target === window._currentInput) return;
    if (box.contains(e.target)) return;
    box.style.display = 'none';
}, true);

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
    
    // 聚焦时自动上滑
    const autoScroll = () => {
        window._currentInput = input;
        setTimeout(() => {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
        if (input.value) input.dispatchEvent(new Event('input'));
    };

    input.addEventListener('focus', autoScroll);
    input.addEventListener('click', autoScroll);

    const performSearch = debounce(async (val) => {
        let parentDir = PATH_PREFIX_REAL;
        let searchPrefix = "";
        let displayBase = "/";
        
        const cleanVal = val ? val.replace(/^\/+/, '') : "";
        if (!cleanVal) {
            parentDir = PATH_PREFIX_REAL + '/';
        } else if (cleanVal.endsWith('/')) {
            parentDir = PATH_PREFIX_REAL + '/' + cleanVal;
            displayBase = "/" + cleanVal;
        } else {
            const lastSlashIndex = cleanVal.lastIndexOf('/');
            if (lastSlashIndex === -1) {
                searchPrefix = cleanVal;
            } else {
                const dirPart = cleanVal.substring(0, lastSlashIndex + 1);
                parentDir = PATH_PREFIX_REAL + '/' + dirPart;
                searchPrefix = cleanVal.substring(lastSlashIndex + 1);
                displayBase = "/" + dirPart;
            }
        }
        
        parentDir = parentDir.replace(/\/+/g, '/');

        try {
            const res = await exec(`ls -F -1 "${parentDir}" 2>/dev/null | head -n 30`);
            if (!res || !res.stdout) {
                box.style.display = 'none';
                return;
            }
            
            const suggestions = res.stdout.split('\n')
                .filter(l => l.startsWith(searchPrefix))
                .map(line => {
                    const isDir = line.endsWith('/');
                    const name = isDir ? line.slice(0, -1) : line;
                    return { 
                        text: displayBase + name + (isDir ? '/' : ''), 
                        icon: isDir ? ICONS.FOLDER : ICONS.FILE 
                    };
                });

            if (suggestions.length === 0) {
                box.style.display = 'none';
                return;
            }

            box.innerHTML = suggestions.map(s => `
                <div class="suggestion-item" 
                     onmousedown="event.preventDefault()" 
                     onclick="window.applySuggestion('${s.text}')">
                    <div style="margin-right:8px;width:16px">${s.icon}</div>
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.text}</div>
                </div>
            `).join('');

            box.style.display = 'block';
            startAutoUpdate(input);
        } catch (e) {
            box.style.display = 'none';
        }
    }, 150);

    input.addEventListener('input', (e) => performSearch(e.target.value));
};

window.applySuggestion = (text) => {
    if (window._currentInput) {
        window._currentInput.value = text;
        window._currentInput.dispatchEvent(new Event('input'));
    }
};

// --- 监控与日志 ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 50`);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">无活动</td></tr>';
        return;
    }

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
            <td><b>${name}</b></td>
            <td><span class="op-tag op-${op}">${op}</span></td>
            <td style="word-break:break-all">${details.replace(' -> ', ' &rarr; ')}</td>
        </tr>`;
    }).filter(r => r).join('');
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    
    // 获取日志文件列表
    const filesRaw = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const files = filesRaw ? filesRaw.split('\n').filter(f => f) : [];
    
    // 构造选项，包含 Zygisk
    let optionsHtml = `<option value="ZYGISK">Zygisk (Logcat)</option>`;
    files.forEach(f => {
        const name = f.split('/').pop();
        optionsHtml += `<option value="${name}">${name}</option>`;
    });

    // 仅当内容变化时更新 DOM，避免重置选中状态
    if (select.innerHTML !== optionsHtml) {
        const oldVal = select.value;
        select.innerHTML = optionsHtml;
        if (oldVal) select.value = oldVal;
    }

    // 默认选中策略: injector.log > 第一个文件 > Zygisk
    if (!select.value || select.value === "") {
        if (files.find(f => f.includes('injector.log'))) {
            select.value = 'injector.log';
        } else if (files.length > 0) {
            select.value = files[0].split('/').pop();
        } else {
            select.value = 'ZYGISK';
        }
    }

    const target = select.value;
    let content = "";
    
    if (target === 'ZYGISK') {
        content = await run("logcat -d -s Zygisk_Blocker -t 100");
    } else if (target) {
        content = await run(`tail -n 100 ${LOG_DIR}/${target} 2>/dev/null`);
    }

    // 更新视图 (简单 Diff 防止闪烁)
    const currentLen = viewer.getAttribute('data-len');
    if (currentLen != content.length) {
        viewer.innerHTML = content ? content : "无日志内容";
        viewer.scrollTop = viewer.scrollHeight;
        viewer.setAttribute('data-len', content.length);
    }
};

document.getElementById('logFileSelect').addEventListener('change', loadLogs);

// 轮询控制
const startPolling = () => {
    if (logPolling) return;
    
    // 立即执行一次，消除延迟
    const activeBtn = document.querySelector('.nav-item.active');
    if (activeBtn) {
        const target = activeBtn.dataset.target;
        if (target === 'content-io') updateIOTable();
        if (target === 'content-log') loadLogs();
    }

    logPolling = setInterval(() => {
        const btn = document.querySelector('.nav-item.active');
        if (btn) {
            const t = btn.dataset.target;
            if (t === 'content-io') updateIOTable();
            if (t === 'content-log') loadLogs();
        }
    }, 1500);
};

const stopPolling = () => {
    if (logPolling) {
        clearInterval(logPolling);
        logPolling = null;
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // 绑定事件
    document.getElementById('appSearch').oninput = renderAppList;
    document.querySelectorAll('input[name="appFilter"]').forEach(el => el.onchange = renderAppList);
    
    document.getElementById('btnReload').onclick = async () => {
        await exec(`sh ${SERVICE_SH}`);
        toast("Reloading...");
        setTimeout(loadData, 1000);
    };

    // Tab 切换逻辑
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => {
            // UI 切换
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const targetId = btn.dataset.target;
            document.getElementById(targetId).classList.add('active');

            // 轮询控制
            if (targetId === 'content-io' || targetId === 'content-log') {
                startPolling();
            } else {
                stopPolling();
            }
        };
    });

    // 状态检查
    run("pgrep -f 'injector$'").then(pid => {
        const badge = document.getElementById('statusBadge');
        const info = document.getElementById('statusInfo');
        
        if (pid) {
            badge.className = "badge badge-success";
            badge.textContent = "RUNNING";
            info.textContent = `PID: ${pid}`;
        } else {
            badge.className = "badge badge-gray";
            badge.textContent = "STOPPED";
            info.textContent = "OFFLINE";
        }
    });
});