import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { 
    mdiAndroid, mdiRefresh, mdiClose, mdiBatteryCharging100, 
    mdiChartTimelineVariant, mdiDeleteSweep 
} from '@mdi/js';

// --- 配置 ---
const CSV_PATH = '/data/media/0/Android/battery_monitor/battery_history.csv';
const BATTERY_SYS_PATH = '/sys/class/power_supply/battery';

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    refreshAll();

    // 绑定事件 (已移除 exit 绑定)
    document.getElementById('btn-refresh').addEventListener('click', refreshAll);
    document.getElementById('btn-delete').addEventListener('click', clearHistory);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (lastData.length > 0) renderChart(lastData);
    });
});

// --- 1. 图标渲染 ---
function renderIcon(path) {
    return `<svg viewBox="0 0 24 24"><path d="${path}" /></svg>`;
}

function initIcons() {
    document.getElementById('icon-android').innerHTML = renderIcon(mdiAndroid);
    document.getElementById('btn-refresh').innerHTML = renderIcon(mdiRefresh);
    document.getElementById('icon-battery').innerHTML = renderIcon(mdiBatteryCharging100);
    document.getElementById('icon-chart').innerHTML = renderIcon(mdiChartTimelineVariant);
    document.getElementById('icon-delete').innerHTML = renderIcon(mdiDeleteSweep);
}

// --- 2. 数据获取 ---
let lastChartData = null; // 缓存数据用于主题切换时重绘

async function refreshData() {
    const btn = document.getElementById('btn-refresh');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s';
    
    try {
        await Promise.all([
            fetchSysfsHealth(),
            fetchCsvHistory()
        ]);
        toast('数据已更新');
    } catch (error) {
        console.error(error);
        toast('获取数据失败');
    } finally {
        setTimeout(() => { btn.style.transform = 'none'; }, 500);
    }
}

// 获取 /sys 节点健康信息
async function fetchSysfsHealth() {
    const cmd = `
        cat ${BATTERY_SYS_PATH}/charge_full_design 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full_design;
        echo "|";
        cat ${BATTERY_SYS_PATH}/charge_full 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full;
        echo "|";
        cat ${BATTERY_SYS_PATH}/cycle_count 2>/dev/null
    `;
    const { stdout, errno } = await exec(cmd);
    if (errno !== 0) return;

    const [designRaw, fullRaw, cycles] = stdout.split('|').map(s => parseInt(s.trim()) || 0);
    
    // 单位转换 uAh -> mAh
    const design = designRaw > 100000 ? Math.round(designRaw / 1000) : designRaw;
    const full = fullRaw > 100000 ? Math.round(fullRaw / 1000) : fullRaw;
    const health = design > 0 ? ((full / design) * 100).toFixed(1) : 0;

    document.getElementById('val-design').textContent = `${design} mAh`;
    document.getElementById('val-full').textContent = `${full} mAh`;
    document.getElementById('val-cycle').textContent = cycles;
    document.getElementById('val-health').textContent = `${health}%`;
    
    // 健康度颜色根据数值变化
    const healthEl = document.getElementById('val-health');
    healthEl.style.color = health >= 80 ? 'var(--accent-color)' : 'var(--danger-color)';
}

// 获取 CSV 并处理
async function fetchCsvHistory() {
    const { stdout, errno } = await exec(`cat "${CSV_PATH}"`);
    if (errno !== 0) {
        lastChartData = [];
        renderChart([]);
        return;
    }

    const lines = stdout.trim().split('\n');
    const data = [];
    
    // CSV Header: timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah
    // Index:      0         1        2        3      4                  5              6              7
    
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',');
        if (row.length < 7) continue;

        data.push({
            label: row[1].split(' ')[1], // 取时间部分
            capacity: parseInt(row[2]),
            current: parseInt(row[5]),
            voltage: parseInt(row[6]) / 1000 // mV -> V
        });
    }
    
    // 取最后 60 个点防止卡顿
    lastChartData = data.slice(-60);
    renderChart(lastChartData);
}

// --- 3. 图表绘制 (支持深色模式) ---
let chartInstance = null;

function renderChart(data) {
    const ctx = document.getElementById('batteryChart');
    
    // 检测当前是否为深色模式
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // 根据模式设置颜色
    const gridColor = isDark ? '#333333' : '#e0e0e0';
    const textColor = isDark ? '#9e9e9e' : '#666666';
    const capColor  = isDark ? '#80cbc4' : '#00695c'; // 电量颜色
    const voltColor = isDark ? '#90caf9' : '#1976d2'; // 电压颜色

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.label),
            datasets: [
                {
                    label: '电量 (%)',
                    data: data.map(d => d.capacity),
                    borderColor: capColor,
                    backgroundColor: isDark ? 'rgba(128, 203, 196, 0.1)' : 'rgba(0, 105, 92, 0.1)',
                    fill: true,
                    yAxisID: 'y',
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 1
                },
                {
                    label: '电压 (V)',
                    data: data.map(d => d.voltage),
                    borderColor: voltColor,
                    borderDash: [4, 4],
                    yAxisID: 'y1',
                    tension: 0.3,
                    borderWidth: 1.5,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: textColor } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? '#ccc' : '#333',
                    borderColor: gridColor,
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, maxTicksLimit: 6 }
                },
                y: {
                    type: 'linear', position: 'left',
                    min: 0, max: 100,
                    grid: { color: gridColor },
                    ticks: { color: capColor }
                },
                y1: {
                    type: 'linear', position: 'right',
                    grid: { display: false },
                    ticks: { color: voltColor }
                }
            }
        }
    });
}

// --- 4. 删除功能 ---
async function deleteHistory() {
    const { errno } = await exec(`rm "${CSV_PATH}"`);
    if (errno === 0) {
        // 重写 Header
        const header = "timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah";
        await exec(`echo "${header}" > "${CSV_PATH}"`);
        refreshData();
        toast('历史记录已清除');
    } else {
        toast('清除失败');
    }
}