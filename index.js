import './style.scss';
import { exec, toast, listPackages, getPackagesInfo } from 'kernelsu';
import { 
    mdiAndroid, mdiLayers, mdiDelete, mdiFolder, mdiFile, 
    mdiRefresh, mdiMagnify, mdiPlus, mdiCloseCircle, mdiChevronRight,
    mdiFilterVariant 
} from '@mdi/js';

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
let currentAppFilter = 'filterUser';

const getSvg = (path, size = 24, color = 'currentColor') => 
    `<svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}"><path d="${path}"/></svg>`;

const ICONS = {
    ANDROID: getSvg(mdiAndroid, 32, '#757575'),
    ENV: getSvg(mdiLayers, 24, '#1266f1'),
    DELETE: getSvg(mdiDelete, 18, 'currentColor'),
    FOLDER: getSvg(mdiFolder, 16, '#ffca28'),
    FILE: getSvg(mdiFile, 16, '#9e9e9e'),
    REFRESH: getSvg(mdiRefresh, 20, '#000'),
    SEARCH: getSvg(mdiMagnify, 18, '#868e96'),
    PLUS: getSvg(mdiPlus, 16, '#fff'),
    CLOSE: getSvg(mdiCloseCircle, 26, '#868e96'),
    CHEVRON: getSvg(mdiChevronRight, 20, '#adb5bd'),
    FILTER: getSvg(mdiFilterVariant, 24, '#fff')
};

const checkStatus = async () => {
    const badge = document.getElementById('statusBadge');
    const info = document.getElementById('statusInfo');
    let pid = await run("pidof injector");
    if (!pid) pid = await run("pgrep -x injector");

    if (pid) {
        badge.className = "badge badge-success";
        badge.textContent = "RUNNING";
        info.textContent = `PID: ${pid.split(' ')[0]}`;
    } else {
        badge.className = "badge badge-gray";
        badge.textContent = "STOPPED";
        info.textContent = "OFFLINE";
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnReload').innerHTML = ICONS.REFRESH;
    document.getElementById('iconSearch').innerHTML = ICONS.SEARCH;
    document.getElementById('iconIoSearch').innerHTML = ICONS.SEARCH;
    document.getElementById('iconFilter').innerHTML = ICONS.FILTER;
    document.querySelectorAll('.btn-close').forEach(el => el.innerHTML = ICONS.CLOSE);
    document.getElementById('btnNewEnv').innerHTML = `<span style="display:flex;align-items:center;gap:4px">${getSvg(mdiPlus,14,'#fff')} 新建</span>`;
    document.getElementById('btnAddRuleRow').innerHTML = `<span style="display:flex;align-items:center;justify-content:center;gap:6px">${getSvg(mdiPlus,16,'#fff')} 添加规则</span>`;

    loadData();
    // 立即加载日志，无延迟
    loadLogs(); 
    checkStatus();

    document.getElementById('appSearch').oninput = renderAppList;
    
    const fabBtn = document.getElementById('btnFilterFab');
    const filterOpts = document.getElementById('filterOptions');
    
    fabBtn.onclick = (e) => {
        e.stopPropagation();
        filterOpts.classList.toggle('show');
    };
    
    document.addEventListener('click', (e) => {
        if (!filterOpts.contains(e.target) && !fabBtn.contains(e.target)) {
            filterOpts.classList.remove('show');
        }
    });

    document.querySelectorAll('.filter-opt').forEach(btn => {
        btn.onclick = () => {
            currentAppFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterOpts.classList.remove('show');
            renderAppList();
        };
    });
});

const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res.stdout ? res.stdout.trim() : "";
    } catch (e) {
        console.error("Exec error:", e);
        return "";
    }
};

const debounce = (func, wait) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// 优化 Modal 动画逻辑
window.openModal = (id) => {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('hiding');
        el.classList.add('show');
    }
};

window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('show')) {
        el.classList.add('hiding'); // 添加退出动画类
        // 等待动画结束后移除 show
        setTimeout(() => {
            el.classList.remove('show');
            el.classList.remove('hiding');
        }, 250); // 对应 CSS transition 时间
    }
};

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

const loadData = async () => {
    try {
        const fuseArgs = await run("ps -A -o args | grep fuse_daemon | grep -v grep");
        activeMounts.clear();
        if (fuseArgs) {
            fuseArgs.split('\n').forEach(line => {
                const match = line.match(/--pkg=([a-zA-Z0-9._]+)/);
                if (match) activeMounts.add(match[1]);
            });
        }

        const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
        envList = files ? files.split('\n').map(f => f.split('/').pop().replace('.conf', '')).filter(n => n && n !== 'injector') : [];

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

const renderAppList = () => {
    const listEl = document.getElementById('appList');
    const searchVal = document.getElementById('appSearch').value.toLowerCase();
    
    const items = [];
    appMap.forEach(app => {
        if (currentAppFilter === 'filterUser' && app.isSystem) return;
        if (currentAppFilter === 'filterSystem' && !app.isSystem) return;
        if (currentAppFilter === 'filterBound' && !app.boundEnv) return;

        const label = app.appLabel || app.packageName;
        if (searchVal && !label.toLowerCase().includes(searchVal) && !app.packageName.toLowerCase().includes(searchVal)) return;

        items.push(app);
    });

    items.sort((a, b) => (!!b.boundEnv - !!a.boundEnv) || (a.appLabel || "").localeCompare(b.appLabel || ""));

    listEl.innerHTML = items.length ? items.map(app => {
        let mountedBadge = "";
        let envBadge = "";
        
        if (activeMounts.has(app.packageName)) {
            mountedBadge = `<span class="badge badge-success">MOUNTED</span>`;
        }

        if (app.boundEnv) {
            let colorClass = "badge-primary";
            if (app.boundParam === 'MONITOR') colorClass = "badge-warning";
            else if (app.boundParam === 'PASSTHROUGH') colorClass = "badge-success";
            envBadge = `<span class="badge ${colorClass} badge-pill">${app.boundEnv}</span>`;
        }

        return `
        <div class="list-item" onclick="openAppConfig('${app.packageName}')">
            <div class="app-main">
                <div class="app-icon-wrapper">${ICONS.ANDROID}</div>
                <div class="app-content">
                    <div class="app-header">
                        <span class="app-name">${app.appLabel}</span>
                        ${mountedBadge}
                    </div>
                    <small class="text-muted font-monospace text-truncate d-block">${app.packageName}</small>
                </div>
            </div>
            <div class="app-end">
                ${envBadge}
            </div>
        </div>`;
    }).join('') : '<div class="empty-state">无匹配应用</div>';
};

const renderEnvList = () => {
    const listEl = document.getElementById('envList');
    if (envList.length === 0) {
        listEl.innerHTML = '<div class="empty-state full-col">暂无环境，请新建</div>';
        return;
    }
    listEl.innerHTML = envList.map(env => `
        <div class="env-item" onclick="openEnvEditor('${env}')">
            <div class="env-icon">${ICONS.ENV}</div>
            <div class="env-name">${env}</div>
            <div class="env-arrow">${ICONS.CHEVRON}</div>
        </div>`).join('');
};

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

window.openEnvEditor = async (envName) => {
    currentEditingEnv = envName;
    document.getElementById('editorEnvName').textContent = envName;
    
    const content = await run(`cat ${BASE_DIR}/${envName}.conf 2>/dev/null`);
    document.getElementById('envRuleContent').value = content;
    
    parseConfigToVisual(content);
    
    const visualRadio = document.querySelector('input[name="editorMode"][value="visual"]');
    if (visualRadio) {
        visualRadio.checked = true;
        visualRadio.dispatchEvent(new Event('change'));
    }
    
    openModal('envEditorModal');
};

document.querySelectorAll('input[name="editorMode"]').forEach(el => {
    el.onchange = (e) => {
        const isVisual = e.target.value === 'visual';
        document.getElementById('editorVisual').classList.toggle('hidden', !isVisual);
        document.getElementById('editorRaw').classList.toggle('hidden', isVisual);
        document.querySelector('.fab-container').classList.toggle('hidden', !isVisual);
        
        if (!isVisual) {
            document.getElementById('envRuleContent').value = generateConfigFromVisual();
        } else {
            parseConfigToVisual(document.getElementById('envRuleContent').value);
        }
    };
});

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
        <button class="btn btn-icon-sm btn-del">${ICONS.DELETE}</button>
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

document.getElementById('btnSaveEnv').onclick = async () => {
    const isVisual = document.querySelector('input[name="editorMode"][value="visual"]').checked;
    const content = isVisual ? generateConfigFromVisual() : document.getElementById('envRuleContent').value;
    
    await exec(`echo '${content}' > ${BASE_DIR}/${currentEditingEnv}.conf`);
    toast("规则已保存");
    closeModal('envEditorModal');
};

document.getElementById('btnDeleteEnv').onclick = async () => {
    if (!confirm(`确定删除环境 ${currentEditingEnv} 吗?`)) return;
    
    await run(`rm ${BASE_DIR}/${currentEditingEnv}.conf`);
    
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

// ... autocomplete (无变化) ...
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

document.addEventListener('click', (e) => {
    const box = document.getElementById('suggestionBox');
    if (box.style.display === 'none') return;
    if (e.target === window._currentInput) return;
    if (box.contains(e.target)) return;
    box.style.display = 'none';
}, true);

const setupAutocomplete = (input) => {
    const box = document.getElementById('suggestionBox');
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
                    <div class="s-icon">${s.icon}</div>
                    <div class="s-text">${s.text}</div>
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

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    const raw = await run(`grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log"`);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">无活动</td></tr>';
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
            <td class="text-muted small">${time}</td>
            <td><div class="text-truncate" style="max-width:100px">${name}</div></td>
            <td><span class="op-tag op-${op}">${op}</span></td>
            <td class="break-all">${details.replace(' -> ', ' &rarr; ')}</td>
        </tr>`;
    }).filter(r => r).join('');
};

const loadLogs = async () => {
    const select = document.getElementById('logFileSelect');
    const viewer = document.getElementById('logViewer');
    
    const filesRaw = await run(`ls ${LOG_DIR}/*.log 2>/dev/null`);
    const files = filesRaw ? filesRaw.split('\n').filter(f => f) : [];
    
    let optionsHtml = `<option value="ZYGISK">Zygisk (Logcat)</option>`;
    files.forEach(f => {
        const name = f.split('/').pop();
        optionsHtml += `<option value="${name}">${name}</option>`;
    });

    if (select.innerHTML !== optionsHtml) {
        const oldVal = select.value;
        select.innerHTML = optionsHtml;
        
        const hasInjector = files.find(f => f.includes('injector.log'));
        const isValid = oldVal && (oldVal === 'ZYGISK' || files.find(f => f.endsWith(oldVal)));

        if (hasInjector && (!isValid || oldVal === "")) {
            select.value = 'injector.log';
        } else if (isValid) {
            select.value = oldVal;
        } else {
            select.value = files.length > 0 ? files[0].split('/').pop() : 'ZYGISK';
        }
    }
    
    if (!select.value && files.find(f => f.includes('injector.log'))) {
        select.value = 'injector.log';
    }

    const target = select.value;
    let content = "";
    
    if (target === 'ZYGISK') {
        content = await run("logcat -d -s Zygisk_Blocker");
    } else if (target) {
        content = await run(`tail -n 200 ${LOG_DIR}/${target} 2>/dev/null`);
    }

    const currentLen = viewer.getAttribute('data-len');
    if (currentLen != content.length) {
        viewer.innerHTML = content ? content : "无日志内容";
        viewer.scrollTop = viewer.scrollHeight;
        viewer.setAttribute('data-len', content.length);
    }
};

// 立即响应下拉框变化
document.getElementById('logFileSelect').addEventListener('change', loadLogs);

document.getElementById('btnReload').onclick = async () => {
    await exec(`sh ${SERVICE_SH}`);
    toast("Reloading...");
    setTimeout(loadData, 1000);
    setTimeout(checkStatus, 1500);
};

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        const targetId = btn.dataset.target;
        document.getElementById(targetId).classList.add('active');

        if (targetId === 'content-io' || targetId === 'content-log') {
            // 切换 Tab 时立即刷新一次，减少等待
            if (targetId === 'content-io') updateIOTable();
            if (targetId === 'content-log') loadLogs();
            startPolling();
        } else {
            stopPolling();
        }
    };
});

const startPolling = () => {
    if (logPolling) return;
    // 立即执行一次
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