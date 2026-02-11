// 1. 导入必要的 API (移除了 exit)
import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { 
    mdiAndroid, mdiRefresh, mdiBatteryCharging100, 
    mdiChartTimelineVariant, mdiDeleteSweep 
} from '@mdi/js';

// --- 配置 ---
const CSV_PATH = '/data/media/0/Android/battery_monitor/battery_history.csv';
const BATTERY_SYS_PATH = '/sys/class/power_supply/battery';

// --- 全局状态 ---
let chartInstance = null;
let cachedData = []; // 缓存数据用于主题切换重绘

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. 渲染图标
    initIcons();
    // 2. 加载数据
    refreshData();
    
    // 3. 绑定事件
    document.getElementById('btn-refresh').addEventListener('click', refreshData);
    document.getElementById('btn-delete').addEventListener('click', clearHistory);

    // 4. 监听深色模式切换，自动重绘图表
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (cachedData.length > 0) renderLineChart(cachedData);
    });
});

// --- 图标注入 ---
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

// --- 数据处理主流程 ---
async function refreshData() {
    const btn = document.getElementById('btn-refresh');
    // 简单的旋转动画
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
        toast('数据加载错误: ' + error.message);
    } finally {
        setTimeout(() => { btn.style.transform = 'none'; }, 500);
    }
}

// 1. 读取 Sysfs 电池健康信息
async function fetchSysfsData() {
    // 组合命令：设计容量 | 当前容量 | 循环次数
    const cmd = `
        cat ${BATTERY_SYS_PATH}/charge_full_design 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full_design;
        echo "|";
        cat ${BATTERY_SYS_PATH}/charge_full 2>/dev/null || cat ${BATTERY_SYS_PATH}/energy_full;
        echo "|";
        cat ${BATTERY_SYS_PATH}/cycle_count 2>/dev/null
    `;
    
    const { stdout, errno } = await exec(cmd);
    if (errno !== 0) return; // 失败忽略

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

// 2. 读取 CSV 并绘制折线图
async function fetchCsvAndDrawChart() {
    const { stdout, errno } = await exec(`cat "${CSV_PATH}"`);
    
    if (errno !== 0) {
        // 文件不存在，清空图表
        renderLineChart([]);
        return;
    }

    const lines = stdout.trim().split('\n');
    const dataPoints = [];

    // CSV Header: timestamp,datetime,capacity,status,charge_counter_mah,current_now_ma,voltage_now_mv,charge_full_mah
    // Index:      0         1        2        3      4                   5               6               7
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue; // 数据不完整跳过

        dataPoints.push({
            time: cols[1].split(' ')[1], // 取 HH:mm:ss
            capacity: parseInt(cols[2]), // 电量 %
            current: parseInt(cols[5])   // 电流 mA (通常正数为充电/负数为放电，或反之，视内核而定)
        });
    }

    // 截取最后 60 条数据，保证渲染性能
    cachedData = dataPoints.slice(-60);
    renderLineChart(cachedData);
}

// --- Chart.js 折线图配置 ---
function renderLineChart(data) {
    const ctx = document.getElementById('batteryChart').getContext('2d');
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 样式适配
    const styles = {
        grid: isDark ? '#333' : '#eee',
        text: isDark ? '#aaa' : '#666',
        colorCap: isDark ? '#80cbc4' : '#00897b', // 电量线颜色
        colorCurr: isDark ? '#64b5f6' : '#1e88e5' // 电流线颜色
    };

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line', // 折线统计图
        data: {
            labels: data.map(d => d.time),
            datasets: [
                {
                    label: '电量 (%)',
                    data: data.map(d => d.capacity),
                    borderColor: styles.colorCap,
                    backgroundColor: styles.colorCap + '1A', // 10% 透明度
                    yAxisID: 'y',
                    tension: 0.3, // 曲线平滑度
                    pointRadius: 1, // 数据点大小
                    fill: true
                },
                {
                    label: '电流 (mA)',
                    data: data.map(d => d.current),
                    borderColor: styles.colorCurr,
                    borderDash: [5, 5], // 虚线
                    yAxisID: 'y1',
                    tension: 0.3,
                    pointRadius: 0,
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
                legend: {
                    labels: { color: styles.text }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
                    titleColor: isDark ? '#fff' : '#000',
                    bodyColor: isDark ? '#ddd' : '#333',
                    borderColor: styles.grid,
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: styles.text, maxTicksLimit: 5 }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    grid: { color: styles.grid },
                    ticks: { color: styles.colorCap }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: styles.colorCurr }
                }
            }
        }
    });
}

// --- 清空历史记录 ---
async function clearHistory() {
    const { errno } = await exec(`rm "${CSV_PATH}"`);
    
    if (errno === 0) {
        // 重写 CSV 表头
        const header = "timestamp,dat