import 'mdb-ui-kit/css/mdb.min.css'; // 由 JS 引入 CSS 确保 Parcel 正确解析
import './style.scss';
import { exec, toast } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
let ruleModal;

const initInputs = () => {
    document.querySelectorAll('.form-outline').forEach((el) => {
        new mdb.Input(el).init();
    });
};

const run = async (cmd) => {
    const res = await exec(cmd);
    return res.stdout;
};

const loadConfigs = async () => {
    const main = await run(`cat ${BASE_DIR}/injector.conf`);
    document.getElementById('mainConfig').value = main;
    
    const files = await run(`ls ${BASE_DIR}/*.conf`);
    const ruleList = document.getElementById('ruleList');
    
    ruleList.innerHTML = files.split('\n')
        .filter(f => f && !f.endsWith('injector.conf'))
        .map(f => {
            const name = f.split('/').pop();
            return `
            <div class="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                <div class="fw-bold text-dark text-truncate" style="max-width: 70%">${name}</div>
                <div class="btn-group shadow-0">
                    <button class="btn btn-light btn-sm" onclick="editRuleFile('${name}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-light btn-sm text-danger" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    initInputs();
};

window.editRuleFile = async (filename) => {
    document.getElementById('modalRuleName').value = filename.replace('.conf', '');
    document.getElementById('modalRuleContent').value = await run(`cat ${BASE_DIR}/${filename}`);
    ruleModal.show();
    setTimeout(initInputs, 200);
};

window.deleteRuleFile = async (filename) => {
    if(confirm(`确定删除 ${filename}?`)) {
        await run(`rm ${BASE_DIR}/${filename}`);
        toast("已删除");
        loadConfigs();
    }
};

const loadLogs = async () => {
    const files = await run(`ls ${LOG_DIR}/*.log`);
    const select = document.getElementById('logFileSelect');
    const current = select.value;
    select.innerHTML = files.split('\n').filter(f => f).map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name}</option>`;
    }).join('');
    if (select.value) {
        document.getElementById('logViewer').textContent = await run(`tail -c 50000 ${LOG_DIR}/${select.value}`);
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
            <td class="text-muted small">${time}</td>
            <td class="text-center"><span class="badge badge-primary">${op}</span></td>
            <td class="text-wrap-path">${path}</td>
        </tr>`;
    }).filter(r => r).join('');
    
    document.getElementById('ioTableBody').innerHTML = rows;
};

document.getElementById('btnSaveMain').onclick = async () => {
    const val = document.getElementById('mainConfig').value;
    await run(`echo '${val}' > ${BASE_DIR}/injector.conf`);
    toast("主配置已保存");
};

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    const content = document.getElementById('modalRuleContent').value;
    if(!name) return toast("包名不能为空");
    await run(`echo '${content}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide();
    toast("规则已保存");
    loadConfigs();
};

document.getElementById('btnReload').onclick = () => run("pkill -HUP injector").then(() => toast("服务已重载"));
document.getElementById('btnStop').onclick = () => run("pkill -TERM injector").then(() => toast("服务已停止"));
document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "REDIRECT /storage/emulated/0/目标路径 /data/media/0/实际路径";
    ruleModal.show();
    setTimeout(initInputs, 200);
};

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