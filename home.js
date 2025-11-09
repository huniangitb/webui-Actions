// home.js
import { exec, toast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { Modal } from 'mdb-ui-kit';
import { sendTcpCommand } from './api.js';
import { parseLogContent, updateLocalStorage, getStoredData, clearStoredData } from './logParser.js';

let gcInfoIntervalId = null;
let isBackendOnline = true; // 模块内部状态

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
            if (!isExt4 && !gcInfoIntervalId && isBackendOnline) {
                gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000);
            }
        } catch (error) {
            toast(`检查文件系统失败`);
        }
    }

    async function updateAllF2fsInfo() {
        if (!isBackendOnline) {
            if (gcInfoIntervalId) clearInterval(gcInfoIntervalId);
            return;
        }
        try {
            const partitionsData = await sendTcpCommand('stats');
            if (!partitionsData) return;
            partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name));
            customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none';
            const visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name));
            updatePartitionCharts(visiblePartitions);
            updatePartitionGcStatus(visiblePartitions);
        } catch (error) {
            isBackendOnline = false;
            if (gcInfoIntervalId) clearInterval(gcInfoIntervalId);
            onApiError(error.message);
        }
    }

    function updatePartitionCharts(partitionsData) { const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches; const currentVisibleDevices = new Set(partitionsData.map(p => p.device_name)); partitionsData.forEach(data => { const { device_name, dirty_segments, free_segments } = data; if (typeof dirty_segments !== 'number' || typeof free_segments !== 'number') return; if (partitionCharts.has(device_name)) { const chart = partitionCharts.get(device_name); chart.data.labels = [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`]; chart.data.datasets[0].data = [dirty_segments, free_segments]; chart.update('none'); } else { const wrapper = document.createElement('div'); wrapper.className = 'partition-chart-wrapper'; wrapper.id = `chart-wrapper-${device_name}`; wrapper.innerHTML = `<div class="partition-chart-canvas-container"><canvas></canvas></div><p class="partition-chart-label">${device_name}</p>`; f2fsChartsContainer.appendChild(wrapper); const newChart = new Chart(wrapper.querySelector('canvas').getContext('2d'), { type: 'doughnut', data: { labels: [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`], datasets: [{ data: [dirty_segments, free_segments], backgroundColor: ['#ff6384', '#36a2eb'], borderColor: isDarkMode ? '#2A2A2A' : '#f8f9fa' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } }); partitionCharts.set(device_name, newChart); } }); for (const deviceName of partitionCharts.keys()) { if (!currentVisibleDevices.has(deviceName)) { partitionCharts.get(deviceName).destroy(); document.getElementById(`chart-wrapper-${deviceName}`)?.remove(); partitionCharts.delete(deviceName); } } }
    function updatePartitionGcStatus(gcStatusArray) { if (isExt4) return; partitionGcStatusContainer.innerHTML = ''; const runningPartitions = gcStatusArray.filter(p => p.is_running && !hiddenPartitions.has(p.device_name)); const anyGcRunning = runningPartitions.length > 0; if (anyGcRunning) { document.getElementById('global-gc-status').style.display = 'none'; partitionGcStatusContainer.style.display = 'flex'; runningPartitions.forEach(({ device_name, is_paused, elapsed_seconds, reclaimed_segments, pause_reason }) => { const itemDiv = document.createElement('div'); itemDiv.className = 'partition-gc-status-item'; itemDiv.innerHTML = `<p>${device_name}</p><span class="badge ${is_paused ? 'bg-warning' : 'bg-success'}">${is_paused ? `暂停<br>原因: ${pause_reason || "未知"}` : '运行中'}<br>运行: ${formatDuration(elapsed_seconds || 0)} | 回收: ${reclaimed_segments || 0}</span>`; partitionGcStatusContainer.appendChild(itemDiv); }); gcControlButton.textContent = '停止所有'; gcControlButton.className = 'btn btn-sm btn-danger'; gcControlButton.dataset.action = 'stop'; } else { partitionGcStatusContainer.style.display = 'none'; const globalGcStatusSpan = document.getElementById('global-gc-status'); globalGcStatusSpan.style.display = 'inline-block'; globalGcStatusSpan.textContent = 'GC回收: 关闭'; globalGcStatusSpan.className = 'badge bg-secondary'; gcControlButton.textContent = '开始所有'; gcControlButton.className = 'btn btn-sm btn-success'; gcControlButton.dataset.action = 'start'; } }
    async function initDatePicker() { try { const { stdout } = await exec('date +"%F"'); const today = new Date(stdout.trim()); const sixDaysAgo = new Date(today); sixDaysAgo.setDate(today.getDate() - 6); const formatDate = (d) => d.toISOString().split('T')[0]; dateSelect.min = formatDate(sixDaysAgo); dateSelect.max = dateSelect.value = formatDate(today); } catch (e) { toast(`初始化日期选择器失败`); } }
    async function loadLogFile() { try { const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json'); if (errno === 0 && stdout.trim() !== '') updateLocalStorage(parseLogContent(stdout)); else if (errno !== 0 && !stderr.includes('No such file')) throw new Error(stderr); } catch (e) { toast(`加载统计数据失败: ${e.message}`); } updateDisplaysForSelectedDate(); }
    function updateDisplaysForSelectedDate() { const selectedDate = dateSelect.value; const storedData = getStoredData(); const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData; const aggregatedData = {}; filteredData.forEach(entry => { const date = entry.date; if (!aggregatedData[date]) aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0 }; aggregatedData[date].deletedFiles += entry.deletedFiles || 0; aggregatedData[date].deletedDirs += entry.deletedDirs || 0; aggregatedData[date].dirtySegments += entry.dirtySegments || 0; aggregatedData[date].fileCleanedMB += entry.fileCleanedMB || 0; }); barChart.data.datasets.forEach(ds => { if (ds.label.includes('脏段')) ds.hidden = isExt4; }); const dates = Object.keys(aggregatedData).sort(); barChart.data.labels = dates; barChart.data.datasets[0].data = dates.map(d => aggregatedData[d].fileCleanedMB); barChart.data.datasets[1].data = dates.map(d => aggregatedData[d].dirtySegments); barChart.data.datasets[2].data = dates.map(d => aggregatedData[d].deletedFiles); barChart.data.datasets[3].data = dates.map(d => aggregatedData[d].deletedDirs); barChart.update('none'); appStatsTitle.textContent = `应用清理详情 (${selectedDate})`; const dailyEntries = getStoredData().filter(entry => entry.date === selectedDate); const aggregatedStats = new Map(); dailyEntries.forEach(entry => entry.appStats?.forEach(app => { const existing = aggregatedStats.get(app.package_name) || { ...app, bytes_deleted: 0, megabytes_deleted: 0 }; existing.bytes_deleted += app.bytes_deleted; existing.megabytes_deleted += app.megabytes_deleted; aggregatedStats.set(app.package_name, existing); })); const appStats = Array.from(aggregatedStats.values()); appStatsList.innerHTML = ''; appStatsContainer.classList.toggle('hidden', !appStats || appStats.length === 0); if (!appStats || appStats.length === 0) { appStatsList.innerHTML = '<li class="list-group-item text-muted">该日无应用数据清理记录。</li>'; return; } appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted).forEach(app => { const displayName = appNamesMap.get(app.package_name) || app.package_name; appStatsList.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center"><span class="text-truncate me-3" title="${app.package_name}">${displayName}</span><span class="badge bg-primary rounded-pill">${app.megabytes_deleted.toFixed(2)} MB</span></li>`; }); }

    // Event Listeners
    dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
    document.getElementById('clear-data').addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); toast('数据已清除'); });
    gcControlButton.addEventListener('click', async () => { const action = gcControlButton.dataset.action; if (action === 'unknown') return; gcControlButton.disabled = true; gcControlButton.textContent = '...'; try { await sendTcpCommand(action === 'start' ? 'start_gc' : 'stop_gc'); await delay(1500); await updateAllF2fsInfo(); } catch (e) { onApiError(e.message); } finally { gcControlButton.disabled = false; } });
    document.getElementById('clean-now-btn').addEventListener('click', async () => { toast('正在请求立即清理...'); try { await sendTcpCommand('clean_now'); } catch (e) { onApiError(e.message); } });
    document.getElementById('refresh-log').addEventListener('click', async () => { toast('正在手动刷新...'); if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); toast('已重新启动自动刷新'); } await loadLogFile(); if (!isExt4) await updateAllF2fsInfo(); toast('数据已刷新'); });
    document.getElementById('delete-log').addEventListener('click', async () => { try { await exec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json'); await loadLogFile(); toast('日志文件已删除'); } catch (e) { toast(`删除日志失败: ${e.message}`); } });
    document.getElementById('restart-module').addEventListener('click', async () => { toast('正在请求重启模块...'); try { await sendTcpCommand('restart'); toast('重启命令已发送'); } catch (e) { onApiError(e.message); } });
    customizePartitionsBtn.addEventListener('click', () => { partitionsModalBody.innerHTML = ''; Array.from(allDiscoveredPartitions).sort().forEach(deviceName => { partitionsModalBody.innerHTML += `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="switch-${deviceName}" data-device-name="${deviceName}" ${!hiddenPartitions.has(deviceName) ? 'checked' : ''}><label class="form-check-label" for="switch-${deviceName}">${deviceName}</label></div>`; }); partitionsModal.show(); });
    savePartitionsBtn.addEventListener('click', () => { const newHidden = new Set(); partitionsModalBody.querySelectorAll('.form-check-input').forEach(cb => { if (!cb.checked) newHidden.add(cb.dataset.deviceName); }); hiddenPartitions = newHidden; localStorage.setItem('hiddenF2fsPartitions', JSON.stringify(Array.from(hiddenPartitions))); partitionsModal.hide(); toast('显示偏好已保存'); updateAllF2fsInfo(); });

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