import { exec, toast } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
let ruleModal;

// 初始化 MDB 组件
document.querySelectorAll('.form-outline').forEach((el) => new mdb.Input(el).init());

const run = async (cmd) => {
    const res = await exec(cmd);
    return res.stdout;
};

// --- 配置加载 ---
const loadConfigs = async () => {
    document.getElementById('mainConfig').value = await run(`cat ${BASE_DIR}/injector.conf`);
    const files = await run(`ls ${BASE_DIR}/*.conf`);
    const ruleList = document.getElementById('ruleList');
    
    ruleList.innerHTML = files.split('\n').filter(f => f && !f.endsWith('injector.conf')).map(f => {
        const name = f.split('/').pop();
        return `
        <div class="list-group-item d-flex justify-content-between align-items-center">
            <div class="text-truncate" style="max-width: 70%">${name}</div>
            <div>
                <button class="btn btn-link btn-sm text-primary" onclick="editRuleFile('${name}')"><i class="fas fa-edit"></i></button>
                <button class="btn btn-link btn-sm text-danger" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
};

window.editRuleFile = async (filename) => {
    document.getElementById('modalRuleName').value = filename.replace('.conf', '');
    document.getElementById('modalRuleContent').value = await run(`cat ${BASE_DIR}/${filename}`);
    ruleModal.show();
};

window.deleteRuleFile = async (filename) => {
    await run(`rm ${BASE_DIR}/${filename}`);
    toast("已删除");
    loadConfigs();
};

// --- 日志与 IO 监控 ---
const loadLogs = async () => {
    const files = await run(`ls ${LOG_DIR}/*.log`);
    const select = document.getElementById('logFileSelect');
    const current = select.value;
    select.innerHTML = files.split('\n').filter(f => f).map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name}</option>`;
    }).join('');
    if (select.value) {
        document.getElementById('logViewer').textContent = await run(`tail -n 500 ${LOG_DIR}/${select.value}`);
    }
};

const updateIOTable = async () => {
    const raw = await run(`grep "\\[IO\\]" ${LOG_DIR}/*.log | tail -n 200`);
    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    
    const rows = raw.split('\n').filter(l => l.includes('[IO]')).reverse().map(line => {
        const m = line.match(/\[(.*?)\]\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, time, op, path] = m;
        if (searchTerm && !path.toLowerCase().includes(searchTerm) && !op.toLowerCase().includes(searchTerm)) return null;
        
        return `<tr>
            <td class="text-muted">${time}</td>
            <td class="fw-bold text-primary">${op}</td>
            <td class="text-wrap">${path}</td>
        </tr>`;
    }).filter(r => r).join('');
    
    document.getElementById('ioTableBody').innerHTML = rows;
};

// --- 事件监听 ---
document.getElementById('btnSaveMain').onclick = async () => {
    const val = document.getElementById('mainConfig').value;
    await run(`echo '${val}' > ${BASE_DIR}/injector.conf`);
    toast("保存成功");
};

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    const content = document.getElementById('modalRuleContent').value;
    await run(`echo '${content}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide();
    toast("规则已保存");
    loadConfigs();
};

document.getElementById('btnReload').onclick = () => run("pkill -HUP injector").then(() => toast("已重载"));
document.getElementById('btnStop').onclick = () => run("pkill -TERM injector").then(() => toast("服务已停止"));
document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "REDIRECT /storage/emulated/0/xxx /data/media/0/xxx";
    ruleModal.show();
};

// Tab 切换逻辑
document.querySelectorAll('[data-mdb-tab-init]').forEach(el => {
    el.addEventListener('shown.mdb.tab', (e) => {
        const id = e.target.id;
        if (id === 'tab-log') loadLogs();
        if (id === 'tab-io') updateIOTable();
    });
});

document.getElementById('ioSearch').oninput = updateIOTable;

document.addEventListener('DOMContentLoaded', () => {
    ruleModal = new mdb.Modal(document.getElementById('ruleModal'));
    loadConfigs();
});