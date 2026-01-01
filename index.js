import 'mdb-ui-kit/css/mdb.min.css';
import './style.scss';
import { exec, toast } from 'kernelsu';
import * as mdb from 'mdb-ui-kit';

const BASE_DIR = "/data/Namespace-Proxy";
const LOG_DIR = `${BASE_DIR}/log`;
const SERVICE_SH = "/data/adb/modules/Namespace-Proxy/service.sh";
let ruleModal;

// 封装执行函数，增加调试输出
const run = async (cmd) => {
    try {
        const res = await exec(cmd);
        return res.stdout.trim() || "";
    } catch (e) {
        console.error("Exec Error:", e);
        return "";
    }
};

// 强制初始化所有 MDB 输入框
const initMDBInputs = () => {
    document.querySelectorAll('.form-outline').forEach(el => {
        new mdb.Input(el).init();
    });
};

// --- 配置管理 ---
const loadConfigs = async () => {
    const main = await run(`[ -f ${BASE_DIR}/injector.conf ] && cat ${BASE_DIR}/injector.conf`);
    document.getElementById('mainConfig').value = main;
    
    const files = await run(`ls ${BASE_DIR}/*.conf 2>/dev/null`);
    const ruleList = document.getElementById('ruleList');
    
    const ruleFiles = files.split('\n').filter(f => f && !f.includes('injector.conf'));
    
    if (ruleFiles.length === 0) {
        ruleList.innerHTML = '<div class="p-3 text-center text-muted small">暂无自定义规则</div>';
    } else {
        ruleList.innerHTML = ruleFiles.map(f => {
            const name = f.split('/').pop();
            return `<div class="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                <div class="fw-bold text-dark text-truncate" style="max-width: 70%">${name}</div>
                <div class="btn-group shadow-0">
                    <button class="btn btn-light btn-sm" onclick="editRuleFile('${name}')"><i class="fas fa-edit text-primary"></i></button>
                    <button class="btn btn-light btn-sm" onclick="deleteRuleFile('${name}')"><i class="fas fa-trash text-danger"></i></button>
                </div>
            </div>`;
        }).join('');
    }
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
        logViewer.textContent = "目录为空或不存在: " + LOG_DIR;
        return;
    }

    const current = select.value;
    select.innerHTML = fileList.map(f => {
        const name = f.split('/').pop();
        return `<option value="${name}" ${name === current ? 'selected' : ''}>${name === 'injector.log' ? '系统日志' : name}</option>`;
    }).join('');

    const targetFile = select.value || fileList[0].split('/').pop();
    const content = await run(`tail -c 50000 ${LOG_DIR}/${targetFile} 2>/dev/null`);
    logViewer.textContent = content || "文件内容为空";
    logViewer.scrollTop = logViewer.scrollHeight; // 滚动到底部
};

// --- IO 监控 ---
const updateIOTable = async () => {
    const tbody = document.getElementById('ioTableBody');
    // 使用更稳健的命令：列出所有应用日志（排除系统日志）并搜索 [IO]
    const raw = await run(`find ${LOG_DIR} -name "*.log" ! -name "injector.log" -exec grep "\\[IO\\]" {} + | tail -n 100`);
    
    if (!raw) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center p-4 text-muted small">暂无监控数据 (仅应用日志包含IO信息)</td></tr>';
        return;
    }

    const searchTerm = document.getElementById('ioSearch').value.toLowerCase();
    const rows = raw.split('\n').reverse().map(line => {
        // 解析格式: /path/to/log: [时间] [IO] 操作 路径
        const m = line.match(/.*:\[(.*?)\]\s+\[IO\]\s+(\w+)\s+(.*)/);
        if (!m) return null;
        const [_, time, op, path] = m;
        if (searchTerm && !path.toLowerCase().includes(searchTerm)) return null;
        
        return `<tr>
            <td class="text-muted small">${time}</td>
            <td class="text-center"><span class="badge badge-primary">${op}</span></td>
            <td class="text-wrap-path">${path}</td>
        </tr>`;
    }).filter(r => r).join('');

    tbody.innerHTML = rows || '<tr><td colspan="3" class="text-center p-4 small">无匹配搜索结果</td></tr>';
};

// --- 自动切换 Tab 逻辑 ---
const switchTab = (tabId) => {
    // 移除所有激活状态
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    
    // 激活当前
    document.querySelector(`[href="#${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('show', 'active');

    // 触发数据加载
    if (tabId === 'content-log') loadLogs();
    if (tabId === 'content-io') updateIOTable();
};

// --- 事件绑定 ---
document.getElementById('btnSaveMain').onclick = async () => {
    const content = document.getElementById('mainConfig').value;
    await run(`echo '${content}' > ${BASE_DIR}/injector.conf`);
    toast("主配置保存成功");
};

document.getElementById('btnModalSave').onclick = async () => {
    const name = document.getElementById('modalRuleName').value;
    const content = document.getElementById('modalRuleContent').value;
    if(!name) return toast("包名不能为空");
    await run(`echo '${content}' > ${BASE_DIR}/${name}.conf`);
    ruleModal.hide(); toast("规则保存成功"); loadConfigs();
};

document.getElementById('btnReload').onclick = async () => {
    toast("正在重启服务...");
    await run(`sh ${SERVICE_SH}`);
    setTimeout(() => {
        run("pgrep injector").then(pid => {
            document.getElementById('statusInfo').textContent = pid ? `运行中 (PID: ${pid.trim()})` : "未启动";
        });
    }, 1000);
};

// 绑定 Tab 点击
document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = (e) => {
        e.preventDefault();
        const id = el.getAttribute('href').substring(1);
        switchTab(id);
    };
});

document.getElementById('logFileSelect').onchange = loadLogs;
document.getElementById('ioSearch').oninput = updateIOTable;
document.getElementById('btnAddRule').onclick = () => {
    document.getElementById('modalRuleName').value = "";
    document.getElementById('modalRuleContent').value = "REDIRECT /storage/emulated/0/目标 /data/media/0/实际";
    ruleModal.show();
    setTimeout(initMDBInputs, 250);
};

document.addEventListener('DOMContentLoaded', () => {
    ruleModal = new mdb.Modal(document.getElementById('ruleModal'));
    loadConfigs();
    run("pgrep injector").then(pid => {
        document.getElementById('statusInfo').textContent = pid ? `运行中 (PID: ${pid.trim()})` : "服务未启动";
    });
});