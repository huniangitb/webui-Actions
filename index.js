import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { 
    mdiAndroid, mdiRefresh, mdiBatteryCharging100, 
    mdiChartTimelineVariant, mdiDeleteSweep 
} from '@mdi/js';

// --- 配置常量 ---
const CSV_PATH = '/data/media/0/Android/battery_monitor/battery_history.csv';
const BATTERY_SYS_PATH = '/sys/class/power_supply/battery';

// --- 全局变量 ---
let chartInstance = null;
let cachedData = []; // 缓存数据用于主题切换

// --- 初始化入口 ---
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    refreshData();
    
    // 绑定按钮事件
    document.getElementById('btn-refresh').addEventListener('click', refreshData);
    document.getElementById('btn-delete').addEventListener('click', clearHistory);

    // 监听深色模式切换
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (cachedData.length > 0) renderLineChart(cachedData);
    });
});

// --- 图标渲染逻辑 ---
function renderIcon(targetId, path) {
    const el = document.getElementById(targetId);
    if (el) el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}" /></svg>`;
}

function initIcons() {
    renderIcon('icon-android', mdiAndroid);
    renderIcon('btn-refresh', mdiRefresh);
    renderIcon('icon-battery', mdiBatteryCharging100);
    renderIcon('icon-chart', mdiChartTimelineVariant);
    renderIcon('icon-delete', mdiDeleteSweep);
}

// --- 数据刷新逻辑 ---
async function refreshData() {
    const btn = document.getElementById('btn-refresh');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';

    try {
        await Promise.all([
            fetchSysfsData(),
            fetchCsvAndDrawChart()
        ]);
        toast('数据已更新');
    } catch (error) {
        console.error(error);
        toast('错误: ' + error.message);
    } finally {
        setTimeout(() => { btn.style.transform = 'none'; }, 500);
    }
}

// 1. 读取 Sysfs 节点 (健康度等)
async function fetchSysfsData() {
    const cmd = `
        cat ${BATTERY_SYS_PATH}/charge_full_design 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full_design;
        echo "|";
        cat ${BATTERY_SYS_PATH}/charge_full 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full;
        echo "|";
        cat ${BATTERY_SYS_PATH}/cycle_count 2>/dev/null
    `;
    
    const { stdout, errno } = await exec(cmd);
    if (errno !== 0) return;

    const parts = stdout.split('|').map(s => parseInt(s.trim()) || 0);
    let [design, full, cycles] = parts;

    // 单位修正 (uAh -> mAh)
    if (design > 100000) design = Math.round(design / 1000);
    if (full > 100000) full = Math.round(full / 1000);

    // 计算健康度
    const health = design > 0 ? ((full / design) * 100).toFixed(1) : 0;

    // 更新 DOM
    document.getElementById('val-design').innerText = `${design} mAh`;
    document.getElementById('val-full').innerText = `${full} mAh`;
    document.getElementById('val-cycle').innerText = cycles;
    
    const healthEl = document.getElementById('val-health');
    healthEl.innerText = `${health}%`;
    healthEl.style.color = health >= 80 ? 'var(--accent-color)' : 'var(--danger-color)';
}

// 2. 读取 CSV 并计算功率
async function fetchCsvAndDrawChart() {
    // 尝试读取文件
    const { stdout, errno } = await exec(`cat "${CSV_PATH}"`);
    
    if (errno !== 0) {
        renderLineChart([]); // 文件不存在则清空图表
        return;
    }

    const lines = stdout.trim().split('\n');
    const dataPoints = [];
    
    // 解析 CSV (从第1行开始，跳过Header)
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        // 确保数据列足够: timestamp,datetime,capacity,status,charge_counter,current,voltage,charge_full
        if (cols.length < 7) continue;

        // 获取基础数值
        const current_ma = parseInt(cols[5]); // 电流 mA
        const voltage_mv = parseInt(cols[6]); // 电压 mV
        
        // 计算功率 (W) = (电压mV * 电流mA) / 1,000,000
        // 使用 Math.abs 取绝对值，只关注“速率”大小，不关注方向
        const power_w = Math.abs((current_ma * voltage_mv) / 1000000);

        dataPoints.push({
            time: cols[1].split(' ')[1], // 取时间 HH:mm:ss
            capacity: parseInt(cols[2]), // 电量 %
            power: parseFloat(power_w.toFixed(2)) // 功率 W (保留2位小数)
        });
    }

    // 仅保留最后 60 条以优化性能
    cachedData = dataPoints.slice(-150);
    renderLineChart(cachedData);
}

// --- Chart.js 绘图配置 (功率版) ---
function renderLineChart(data) {
    const ctx = document.getElementById('batteryChart').getContext('2d');
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 根据深色模式定义颜色
    const colors = {
        grid: isDark ? '#333333' : '#eeeeee',
        text: isDark ? '#aaaaaa' : '#666666',
        lineCap: isDark ? '#80cbc4' : '#00897b',  // 电量线 (青色)
        linePower: isDark ? '#ffb74d' : '#f57c00' // 功率线 (橙色)
    };

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.time),
            datasets: [
                {
                    label: '电量 (%)',
                    data: data.map(d => d.capacity),
                    borderColor: colors.lineCap,
                    backgroundColor: colors.lineCap + '1A', // 10% 透明度填充
                    yAxisID: 'y',
                    tension: 0.3,
                    pointRadius: 1,
                    fill: true
                },
                {
                    label: '功率 (W)',
                    data: data.map(d => d.power),
                    borderColor: colors.linePower,
                    borderDash: [5, 5], // 虚线显示
                    yAxisID: 'y1', // 绑定到右侧 Y 轴
                    tension: 0.3,
                    pointRadius: 2, // 稍微大一点的点以便观察
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { labels: { color: colors.text } },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? '#ccc' : '#333',
                    borderColor: colors.grid,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y + (context.datasetIndex === 1 ? ' W' : '%');
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.text, maxTicksLimit: 6 }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0, max: 100,
                    grid: { color: colors.grid },
                    ticks: { color: colors.lineCap }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false }, // 右侧不显示网格线
                    ticks: { color: colors.linePower },
                    title: {
                        display: true,
                        text: '瓦特 (W)',
                        color: colors.linePower,
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

// --- 清除历史记录 ---
async function clearHistory() {
    const confirmClear = confirm("确定要删除所有历史记录吗？");
    if (!confirmClear) return;

    // 删除原文件
    const { errno } = await exec(`rm "${CSV_PATH}"`);
    
    if (errno === 0) {
        // 重新写入 CSV 表头
        const header = "timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah";
        await exec(`echo "${header}" > "${CSV_PATH}"`);
        
        toast('历史记录已清空');
        // 刷新图表（清空显示）
        refreshData();
    } else {
        toast('操作失败');
    }
}