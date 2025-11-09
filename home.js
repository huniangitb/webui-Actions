// home.js
import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { Modal } from 'mdb-ui-kit';
import { sendTcpCommand } from './api.js';
import { parseLogContent, updateLocalStorage, getStoredData, clearStoredData } from './logParser.js';

let gcInfoIntervalId = null;

/**
 * @brief 初始化主页的所有功能和事件监听器。
 * @param {Function} onApiError - 当 API 调用失败时执行的回调函数。
 */
export async function initHomePage(onApiError) {
    const dateSelect = document.getElementById('date-select');
    const appStatsList = document.getElementById('app-stats-list');
    const appStatsContainer = document.getElementById('app-stats-container');
    const appStatsTitle = document.getElementById('app-stats-title');
    const f2fsGcInfoContainer = document.getElementById('f2fs-gc-info-container');
    const gcControlButton = document.getElementById('gc-control-btn');
    const f2fsChartsContainer = document.getElementById('f2fs-charts-container');
    const partitionGcStatusContainer = document.getElementById('partition-gc-status-container');
    const customizePartitionsBtn = document.getElementById('customize-partitions-btn');
    const partitionsModal = new Modal(document.getElementById('partitions-modal'));
    const partitionsModalBody = document.getElementById('partitions-modal-body');
    const savePartitionsBtn = document.getElementById('save-partitions-btn');
    
    let isExt4 = false;
    let partitionCharts = new Map();
    let appNamesMap = new Map();
    let allDiscoveredPartitions = new Set();
    let hiddenPartitions = new Set(JSON.parse(localStorage.getItem('hiddenF2fsPartitions') || '[]'));
    const barChart = new Chart(document.getElementById('bar-chart').getContext('2d'), { type: 'bar', data: { labels: [], datasets: [{ label: '文件清理 (MB)', data: [], backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }, { label: '回收脏段数', data: [], backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }, { label: '已删除文件数', data: [], backgroundColor: 'rgba(255, 99, 132, 0.2)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }, { label: '已删除目录数', data: [], backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] }, options: { scales: { y: { beginAtZero: true } } } });

    const delay = ms => new Promise(res => setTimeout(res, ms));
    function formatDuration(s) { if (isNaN(s) || s < 0) return "0s"; if (s < 60) return `${s}s`; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`; }
    
    async function checkFileSystem() {
        try {
            const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`);
            isExt4 = (stdout.trim() === 'ext4');
            f2fsGcInfoContainer.style.display = isExt4 ? 'none' : 'block';
            if (isExt4 && gcInfoIntervalId) {
                clearInterval(gcInfoIntervalId);
                gcInfoIntervalId = null;
            }
            if (!isExt4 && !gcInfoIntervalId) {
                gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000);
            }
        } catch (error) {
            toast(`检查文件系统失败`);
        }
    }

    async function updateAllF2fsInfo() {
        try {
            const partitionsData = await sendTcpCommand('stats');
            if (!partitionsData) return;
            partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name));
            customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none';
            const visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name));
            updatePartitionCharts(visiblePartitions);
            updatePartitionGcStatus(visiblePartitions);
        } catch (error) {
            if (gcInfoIntervalId) {
                clearInterval(gcInfoIntervalId);
                gcInfoIntervalId = null;
            }
            onApiError(error.message);
        }
    }

    function updatePartitionCharts(partitionsData) { /* ... (此函数内容保持不变) ... */ }
    function updatePartitionGcStatus(gcStatusArray) { /* ... (此函数内容保持不变) ... */ }
    
    async function initDatePicker() { /* ... (此函数内容保持不变) ... */ }
    async function loadLogFile() { /* ... (此函数内容保持不变) ... */ }
    function updateDisplaysForSelectedDate() { /* ... (此函数内容保持不变) ... */ }

    // Event Listeners
    dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
    document.getElementById('clear-data').addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); toast('数据已清除'); });
    gcControlButton.addEventListener('click', async () => { /* ... (此函数内容保持不变, 但内部 sendTcpCommand 会抛错) ... */ });
    document.getElementById('clean-now-btn').addEventListener('click', async () => { /* ... */ });
    document.getElementById('refresh-log').addEventListener('click', async () => { /* ... */ });
    document.getElementById('delete-log').addEventListener('click', async () => { /* ... */ });
    document.getElementById('restart-module').addEventListener('click', async () => { /* ... */ });
    customizePartitionsBtn.addEventListener('click', () => { /* ... */ });
    savePartitionsBtn.addEventListener('click', () => { /* ... */ });

    // Initial Load
    await checkFileSystem();
    await initDatePicker();
    try {
        const { stdout } = await exec('cat /data/media/0/Android/清理规则/list.config');
        stdout.split('\n').forEach(line => {
            if (line.includes('=')) {
                const [pkg, name] = line.split('=').map(item => item.trim());
                if (pkg && name) appNamesMap.set(pkg, name);
            }
        });
    } catch (e) {
        console.error("Error loading app names:", e);
    }
    await loadLogFile();
    if (!isExt4) await updateAllF2fsInfo();
}