import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
let ruleModal;

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

// 语法高亮逻辑
const highlightContent = (text) => {
    return text
        .replace(/#(.*)/g, '<span class="log-comment">#$1</span>')
        .replace(/\b(REDIRECT|HIDE)\b/g, '<span class="log-keyword">$1</span>')
        .replace(/\[([\d:]+)\]/g, '<span class="log-time">[$1]</span>')
        .replace(/\[IO\]/g, '<span class="log-io-tag">[IO]</span>');
};

const loadConfigs = async () => {
    const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
    document.getElementById('mainConfig').value = main;
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    const ruleList = document.getElementById('ruleList');
    const ruleFiles = files.split('\n').filter(f => f && !f.includes('injector.conf'));
    
    ruleList.innerHTML = ruleFiles.length === 0 ? 
        '<div class="p-3 text-center text-muted small">暂无自定义规则</div>' :
        ruleFiles.map(f => {
            const name = f.split('/').pop();
            return `<div class="list-group-item d-flex justify-content-between align-items-center px-3 py-3 border-0 border-bottom">
                <div class="text-truncate me-2">
                    <i class="fas fa-cube text-primary me-2"></i>
                    <span class="fw-bold text-dark">${name.replace('.conf', '')}</span>
                </div>
                <div class="btn-group shadow-0">
                    <button class="btn btn-light btn-sm text-primary" onclick="editRuleFile('${name}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-light btn-sm text-danger" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    refreshMDB();
};

window.editRuleFile = async (filename) => {
    const content = await run(`cat ${BASE_DIR}/${filename}`);
    document.getElementById('modalRuleName').value = filename.replace('.conf', '');
    document.getElementById('modalRuleContent').value = content;
    ruleModal.show();
    setTimeout(refreshMDB, 200);
};

window.deleteRuleFile = async (filename) => {
    if(confirm(`确定删除 ${filename}?`)) {
        await run(`rm ${BASE_DIR}/${filename}`);
        toast("已删除"); loadConfigs();
    }
};

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
    const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
    logViewer.innerHTML = highlightContent(content);
    logViewer.scrollTop = logViewer.scrollHeight;
};

const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    // 使用 grep -H 确保输出文件名，排除系统日志
    const cmd = `grep -H "\\[IO\\]" ${LOG_DIR}/*.log | grep -v "injector.log" | tail -n 200`;
    const raw = await run(cmd);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-muted small">暂无应用监控数据</td></tr>';
        return;
    }

    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').reverse().map(line => {
        // 兼容双时间戳和文件路径解析
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

    tbody.innerHTML = rows || '<tr><td colspan="4" class="text-center p-4 small">无匹配结果</td></tr>';
};

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

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    await run(`echo '${document.getElementById('modalRuleContent').value}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide(); toast("保存成功"); loadConfigs();
};

document.getElementById('btnReload').onclick = async () => {
    toast("重启中..."); await run(`sh ${SERVICE_SH}`);
    setTimeout(checkStatus, 1500);
};

document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => {
        e.preventDefault();
        switchTab(el.getAttribute('href').substring(1));
    };
});

document.getElementById('logFileSelect').onchange = loadLogs;
document.getElementById('ioSearch').oninput = updateIOTable;
document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "REDIRECT /storage/emulated/0/目标 /data/media/0/实际";
    ruleModal.show(); setTimeout(refreshMDB, 250);
};

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
    ruleModal = new mdb.Modal(document.getElementById('ruleModal'));
    loadConfigs();
    checkStatus();
});