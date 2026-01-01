import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
let ruleModal;

const run = async (cmd) => {
    const res = await exec(cmd);
    return res.stdout || "";
};

const initMDB = () => {
    document.querySelectorAll('.form-outline').forEach(el => new mdb.Input(el).init());
};

// --- 配置管理 ---
const loadConfigs = async () => {
    const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
    document.getElementById('mainConfig').value = main;
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    const ruleList = document.getElementById('ruleList');
    ruleList.innerHTML = files.split('\n').filter(f => f && !f.endsWith('injector.conf')).map(f => {
        const name = f.split('/').pop();
        return `<div class="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
            <div class="fw-bold text-dark text-truncate">${name}</div>
            <div class="btn-group shadow-0">
                <button class="btn btn-light btn-sm" onclick="editRuleFile('${name}')"><i class="fas fa-edit"></i></button>
                <button class="btn btn-light btn-sm text-danger" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
    initMDB();
};

window.editRuleFile = async (filename) => {
    document.getElementById('modalRuleName').value = filename.replace('.conf', '');
    document.getElementById('modalRuleContent').value = await run(`cat ${BASE_DIR}/${filename}`);
    ruleModal.show();
    setTimeout(initMDB, 200);
};

window.deleteRuleFile = async (filename) => {
    if(confirm(`确定删除 ${filename}?`)) {
        await run(`rm ${BASE_DIR}/${filename}`);
        toast("已删除"); loadConfigs();
    }
};

// --- 日志查看 (区分服务日志和应用日志) ---
const loadLogs = async () => {
    const files = await run(`[ -d ${LOG_DIR} ] && ls ${LOG_DIR}/*.log 2>/dev/null`);
    const select = document.getElementById('logFileSelect');
    const fileList = files.split('\n').filter(f => f);
    if (fileList.length === 0) {
        select.innerHTML = '<option>无日志</option>';
        document.getElementById('logViewer').textContent = "等待日志生成...";
        return;
    }
    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        const label = name === 'injector.log' ? `系统: ${name}` : `应用: ${name}`;
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${label}</option>`;
    }).join('');
    
    // 读取选中的日志内容
    const content = await run(`tail -c 50000 ${LOG_DIR}/${select.value} 2>/dev/null`);
    document.getElementById('logViewer').textContent = content || "文件为空";
};

// --- IO 监控 (仅从应用日志中提取 [IO] 条目) ---
const updateIOTable = async () => {
    // 排除 injector.log，只搜索应用日志
    const raw = await run(`[ -d ${LOG_DIR} ] && grep "\\[IO\\]" ${LOG_DIR}/[!injector]*.log 2>/dev/null | tail -n 150`);
    if (!raw) {
        document.getElementById('ioTableBody').innerHTML = '<tr><td colspan="3" class="text-center p-4">暂无应用监控数据</td></tr>';
        return;
    }
    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').filter(l => l.includes('[IO]')).reverse().map(line => {
        // 格式: path/to/log/file.log:[时间] [IO] 操作 路径
        const m = line.match(/.*\.log:\[(.*?)\]\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, time, op, path] = m;
        if (searchTerm && !path.toLowerCase().includes(searchTerm)) return null;
        return `<tr>
            <td class="text-muted small">${time}</td>
            <td class="text-center"><span class="badge badge-primary">${op}</span></td>
            <td class="text-wrap-path">${path}</td>
        </tr>`;
    }).filter(r => r).join('');
    document.getElementById('ioTableBody').innerHTML = rows || '<tr><td colspan="3" class="text-center p-4">无匹配结果</td></tr>';
};

// --- 动作绑定 ---
document.getElementById('btnSaveMain').onclick = async () => {
    await run(`echo '${document.getElementById('mainConfig').value}' > ${BASE_DIR}/injector.conf`);
    toast("主配置已保存");
};

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    await run(`echo '${document.getElementById('modalRuleContent').value}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide(); toast("规则已保存"); loadConfigs();
};

document.getElementById('btnReload').onclick = async () => {
    toast("执行 service.sh...");
    await run(`sh ${SERVICE_SH}`);
    toast("指令已发送");
};

document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "REDIRECT /storage/emulated/0/xxx /data/media/0/xxx";
    ruleModal.show(); setTimeout(initMDB, 200);
};

document.getElementById('logFileSelect').onchange = loadLogs;
document.getElementById('ioSearch').oninput = updateIOTable;

document.querySelectorAll('[data-mdb-tab-init]').forEach(el => {
    el.addEventListener('shown.mdb.tab', (e) => {
        if (e.target.id === 'tab-log') loadLogs();
        if (e.target.id === 'tab-io') updateIOTable();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    ruleModal = new mdb.Modal(document.getElementById('ruleModal'));
    loadConfigs();
    run("pgrep injector").then(pid => {
        document.getElementById('statusInfo').textContent = pid ? `服务运行中 (PID: ${pid.trim()})` : "服务未启动";
    });
});