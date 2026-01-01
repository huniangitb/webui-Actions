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

const initMDBInputs = () => {
    document.querySelectorAll('.form-outline').forEach(el => new mdb.Input(el).init());
};

// --- 配置管理 ---
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
            return `<div class="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                <div class="fw-bold text-dark text-truncate" style="max-width: 70%">${name}</div>
                <div class="btn-group shadow-0">
                    <button class="btn btn-light btn-sm" onclick="editRuleFile('${name}')"><i class="fas fa-edit text-primary"></i></button>
                    <button class="btn btn-light btn-sm" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash text-danger"></i></button>
                </div>
            </div>`;
        }).join('');
    initMDBInputs();
};

window.editRuleFile = async (filename) => {
    const content = await run(`cat ${BASE_DIR}/${filename}`);
    document.getElementById('modalRuleName').value = filename.replace('.conf', '');
    document.getElementById('modalRuleContent').value = content;
    ruleModal.show();
    setTimeout(initMDBInputs, 250);
};

window.deleteRuleFile = async (filename) => {
    if(confirm(`确定删除 ${filename}?`)) {
        await run(`rm ${BASE_DIR}/${filename}`);
        toast("已删除"); loadConfigs();
    }
};

// --- 日志查看 ---
const loadLogs = async () => {
    const logViewer = document.getElementById('logViewer');
    const select = document.getElementById('logFileSelect');
    const files = await run(`[ -d ${LOG_DIR} ] && ls ${LOG_DIR}/*.log 2>/dev/null`);
    const fileList = files.split('\n').filter(f => f);
    
    if (fileList.length === 0) {
        select.innerHTML = '<option value="">无日志文件</option>';
        logViewer.textContent = "未找到日志"; return;
    }
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name === 'injector.log' ? '系统日志' : name}</option>`;
    }).join('');

    const target = select.value || fileList[0].split('/').pop();
    const content = await run(`tail -c 50000 ${LOG_DIR}/${target} 2>/dev/null`);
    logViewer.textContent = content || "文件为空";
    logViewer.scrollTop = logViewer.scrollHeight;
};

// --- IO 监控 (核心逻辑更新) ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    // 查找所有以 .log 结尾但不是 injector.log 的文件，提取 [IO] 行
    const raw = await run(`find ${LOG_DIR} -name "*.log" ! -name "injector.log" -exec grep "\\[IO\\]" {} + | tail -n 150`);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center p-4 text-muted small">暂无应用监控数据</td></tr>';
        return;
    }

    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').reverse().map(line => {
        // 兼容双时间戳: [15:31:01] [15:31:01] [IO] ...
        // 正则解析: 1.时间 2.操作 3.路径及详情
        const m = line.match(/\[([\d:]+)\](?:\s+\[[\d:]+\])?\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        
        const [_, time, op, details] = m;
        if (searchTerm && !details.toLowerCase().includes(searchTerm)) return null;
        
        // 针对 RENAME 优化显示
        const displayDetails = details.replace(' -> ', ' <i class="fas fa-long-arrow-alt-right mx-1 text-muted"></i> ');

        return `<tr>
            <td class="text-muted small" style="width: 80px">${time}</td>
            <td class="text-center" style="width: 80px"><span class="badge badge-primary">${op}</span></td>
            <td class="text-wrap-path small">${displayDetails}</td>
        </tr>`;
    }).filter(r => r).join('');

    tbody.innerHTML = rows || '<tr><td colspan="3" class="text-center p-4 small">无匹配结果</td></tr>';
};

// --- Tab 切换 ---
const switchTab = (tabId) => {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    document.querySelector(`[href="#${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('show', 'active');
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

// --- 事件 ---
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
    setTimeout(() => {
        run("pgrep injector").then(pid => {
            document.getElementById('statusInfo').textContent = pid ? `运行中 (PID: ${pid.trim()})` : "已停止";
        });
    }, 1000);
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
    ruleModal.show(); setTimeout(initMDBInputs, 250);
};

document.addEventListener('DOMContentLoaded', () => {
    ruleModal = new mdb.Modal(document.getElementById('ruleModal'));
    loadConfigs();
    run("pgrep injector").then(pid => {
        document.getElementById('statusInfo').textContent = pid ? `运行中 (PID: ${pid.trim()})` : "未启动";
    });
});