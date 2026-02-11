import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { 
    mdiAndroid, mdiRefresh, mdiBatteryCharging100, 
    mdiChartTimelineVariant, mdiDeleteSweep 
} from '@mdi/js';

// --- 配置常量 ---
const LOG_DIR = '/data/media/0/Android/battery_monitor';
const PATHS = {
    current: `${LOG_DIR}/battery_history.csv`,
    prev: `${LOG_DIR}/battery_history.prev.csv`
};

// --- 全局状态 ---
let chartInstance = null;
let appState = {
    activeCycle: 'current', // 'current' or 'prev'
    data: {
        current: [],
        prev: []
    }
};

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    loadAllData();
    
    // 绑定事件
    document.getElementById('btn-refresh').addEventListener('click', loadAllData);
    document.getElementById('btn-delete').addEventListener('click', clearHistory);
    
    // 周期切换事件
    document.getElementById('btn-cycle-current').addEventListener('click', () => switchCycle('current'));
    document.getElementById('btn-cycle-prev').addEventListener('click', () => switchCycle('prev'));

    // 监听深色模式
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        renderUI(); // 重绘
    });
});

function initIcons() {
    const render = (id, path) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}" /></svg>`;
    };
    render('icon-android', mdiAndroid);
    render('btn-refresh', mdiRefresh);
    render('icon-battery', mdiBatteryCharging100);
    render('icon-chart', mdiChartTimelineVariant);
    render('icon-delete', mdiDeleteSweep);
}

// --- 数据加载 ---
async function loadAllData() {
    const btn = document.getElementById('btn-refresh');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';

    try {
        // 并行加载两个文件
        const [currRaw, prevRaw] = await Promise.all([
            readFile(PATHS.current),
            readFile(PATHS.prev)
        ]);

        appState.data.current = parseCSV(currRaw);
        appState.data.prev = parseCSV(prevRaw);

        renderUI();
        toast('数据已同步');
    } catch (e) {
        console.error(e);
        toast('部分数据加载失败');
    } finally {
        setTimeout(() => { btn.style.transform = 'none'; }, 500);
    }
}

// 通用读取函数
async function readFile(path) {
    const { stdout, errno } = await exec(`cat "${path}"`);
    return errno === 0 ? stdout : null;
}

// --- CSV 解析核心 ---
// Header: timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah
function parseCSV(rawContent) {
    if (!rawContent) return [];
    
    const lines = rawContent.trim().split('\n');
    const points = [];

    // 从第1行开始跳过表头
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 8) continue;

        const ts = parseInt(cols[0]); // Unix Timestamp (Seconds)
        const current_ma = parseInt(cols[5]);
        const voltage_mv = parseInt(cols[6]);
        
        // 计算功率 (W)
        const power_w = Math.abs((current_ma * voltage_mv) / 1000000);

        points.push({
            timestamp: ts * 1000, // 转换为毫秒供 Date 使用
            timeLabel: cols[1].split(' ')[1], // 取 "HH:mm:ss"
            fullDateTime: cols[1], // 完整日期供详情使用
            capacity: parseInt(cols[2]),
            status: cols[3], // Charging, Discharging, Full
            power: parseFloat(power_w.toFixed(2)),
            fullCap: parseInt(cols[7])
        });
    }
    return points;
}

// --- UI 渲染逻辑 ---

function switchCycle(cycle) {
    if (appState.activeCycle === cycle) return;
    appState.activeCycle = cycle;
    
    // 更新按钮样式
    document.querySelectorAll('.cycle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-cycle-${cycle}`).classList.add('active');
    
    renderUI();
}

function renderUI() {
    const dataset = appState.data[appState.activeCycle];
    const hasData = dataset && dataset.length > 0;

    // 1. 更新卡片统计信息 (取最后一条记录)
    if (hasData) {
        const last = dataset[dataset.length - 1];
        document.getElementById('status-title').textContent = `状态: ${translateStatus(last.status)}`;
        document.getElementById('val-time').textContent = last.fullDateTime; // 使用日志时间
        document.getElementById('val-cap').textContent = `${last.capacity}%`;
        document.getElementById('val-power').textContent = `${last.power} W`;
        document.getElementById('val-full-cap').textContent = `${last.fullCap} mAh`;
        
        // 更新底部状态标签
        const tag = document.getElementById('status-tag');
        tag.textContent = last.status;
        tag.setAttribute('data-status', last.status);
    } else {
        document.getElementById('status-title').textContent = "无数据";
        document.getElementById('val-time').textContent = "--";
        document.getElementById('val-cap').textContent = "--";
        document.getElementById('val-power').textContent = "--";
        document.getElementById('val-full-cap').textContent = "--";
        document.getElementById('status-tag').textContent = "Empty";
        document.getElementById('status-tag').removeAttribute('data-status');
    }

    document.getElementById('data-source-text').textContent = 
        `来源: ${appState.activeCycle === 'current' ? 'battery_history.csv' : 'battery_history.prev.csv'}`;

    // 2. 绘制图表
    renderChart(hasData ? dataset : []);
}

function translateStatus(status) {
    const map = {
        'Charging': '充电中',
        'Discharging': '放电中',
        'Full': '已充满',
        'Not charging': '未充电'
    };
    return map[status] || status;
}

// --- Chart.js 渲染 ---
function renderChart(data) {
    const ctx = document.getElementById('batteryChart').getContext('2d');
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 颜色配置
    const colors = {
        text: isDark ? '#aaa' : '#666',
        grid: isDark ? '#333' : '#eee',
        capLine: isDark ? '#80cbc4' : '#00796b',
        pwrLine: isDark ? '#ffcc80' : '#f57c00'
    };

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.timeLabel), // 使用日志中的 HH:mm:ss
            datasets: [
                {
                    label: '电量 (%)',
                    data: data.map(d => d.capacity),
                    borderColor: colors.capLine,
                    backgroundColor: colors.capLine + '20',
                    yAxisID: 'y',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 1
                },
                {
                    label: '功率 (W)',
                    data: data.map(d => d.power),
                    borderColor: colors.pwrLine,
                    borderDash: [5, 5],
                    yAxisID: 'y1',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: colors.text } },
                tooltip: {
                    callbacks: {
                        // 在 Tooltip 中显示完整日期时间
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            return data[idx].fullDateTime + " (" + data[idx].status + ")";
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: colors.text, maxTicksLimit: 6 },
                    grid: { display: false }
                },
                y: {
                    min: 0, max: 100,
                    position: 'left',
                    ticks: { color: colors.capLine },
                    grid: { color: colors.grid }
                },
                y1: {
                    position: 'right',
                    ticks: { color: colors.pwrLine },
                    grid: { display: false },
                    title: { display: true, text: '瓦特 (W)', color: colors.pwrLine }
                }
            }
        }
    });
}

// --- 清空历史 ---
async function clearHistory() {
    if (!confirm("确定要删除所有 CSV 记录吗？\n(包含当前和上一周期的记录)")) return;

    // 清空两个文件
    const header = "timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah";
    
    // 执行 Shell 命令链
    const cmd = `
        rm "${PATHS.current}" "${PATHS.prev}"; 
        echo "${header}" > "${PATHS.current}";
    `;
    
    const { errno } = await exec(cmd);
    
    if (errno === 0) {
        toast('历史记录已彻底清空');
        loadAllData(); // 重新加载
    } else {
        toast('操作失败');
    }
}