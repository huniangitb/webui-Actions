import { exec, toast } from 'kernelsu';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Tab, Modal } from 'bootstrap';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
let ruleModal;

// 工具：执行命令
const run = async (cmd) => {
    const res = await exec(cmd);
    if (res.errno !== 0) console.error(`CMD: ${cmd} Failed`, res.stderr);
    return res.stdout;
};

// --- 配置管理 ---
const loadConfigs = async () => {
    document.getElementById('mainConfig').value = await run(`cat ${BASE_DIR}/injector.conf`);
    const files = await run(`ls ${BASE_DIR}/*.conf`);
    const ruleList = document.getElementById('ruleList');
    ruleList.innerHTML = files.split('\n').filter(f => f && !f.endsWith('injector.conf')).map(f => {
        const name = f.split('/').pop();
        return `<div class="list-group-item d-flex justify-content-between align-items-center">
            <span>${name}</span>
            <div>
                <button class="btn btn-outline-primary btn-sm me-2" onclick="editRuleFile('${name}')">编辑</button>
                <button class="btn btn-outline-danger btn-sm" onclick="deleteRuleFile('${name}')">删除</button>
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
    if (confirm(`确认删除 ${filename}?`)) {
        await run(`rm ${BASE_DIR}/${filename}`);
        toast("规则已删除");
        loadConfigs();
    }
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
        return `<tr><td class="text-muted">${time}</td><td class="fw-bold text-primary">${op}</td><td class="text-break">${path}</td></tr>`;
    }).filter(r => r).join('');
    document.getElementById('ioTableBody').innerHTML = rows;
};

// --- 事件绑定 ---
document.getElementById('btnSaveMain').onclick = async () => {
    const val = document.getElementById('mainConfig').value;
    await run(`echo '${val}' > ${BASE_DIR}/injector.conf`);
    toast("主配置已保存");
};

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    const content = document.getElementById('modalRuleContent').value;
    if (!name) return toast("包名不能为空");
    await run(`echo '${content}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide();
    toast("规则已保存");
    loadConfigs();
};

document.getElementById('btnReload').onclick = () => run("pkill -HUP injector").then(() => toast("已发送重载信号"));
document.getElementById('btnStop').onclick = () => run("pkill -TERM injector").then(() => toast("服务已停止"));
document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "# REDIRECT /storage/emulated/0/xxx /data/media/0/xxx";
    ruleModal.show();
};

// 切换 Tab 刷新数据
document.querySelectorAll('button[data-bs-target]').forEach(btn => {
    btn.onclick = () => {
        const target = btn.getAttribute('data-bs-target');
        document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
        document.querySelector(target).classList.add('show', 'active');
        if (target === '#tabLog') loadLogs();
        if (target === '#tabIO') updateIOTable();
    };
});

// 定时刷新 IO 列表
setInterval(() => {
    if (document.getElementById('tabIO').classList.contains('active')) updateIOTable();
}, 3000);

document.addEventListener('DOMContentLoaded', () => {
    ruleModal = new Modal(document.getElementById('ruleModal'));
    loadConfigs();
});