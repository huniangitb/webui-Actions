import { exec, toast } from 'kernelsu';
import { Ripple, Modal, initMDB } from 'mdb-ui-kit';
import Chart from 'chart.js/auto';
import { mdiHome, mdiPencilBoxOutline } from '@mdi/js';

initMDB({ Ripple });

// --- 内联模块: logParser.js ---
function parseLogContent(ndjsonContent) { if (!ndjsonContent || ndjsonContent.trim() === '') return []; const parsedEntries = []; const lines = ndjsonContent.split('\n'); lines.forEach(line => { if (line.trim() === '') return; try { const stats = JSON.parse(line); if (!stats.timestamp || !stats.global_stats) return; const formattedTimestamp = stats.timestamp.replace('T', ' ').replace('Z', ''); const reclaimedSegments = (stats.gc_trim_stats && stats.gc_trim_stats.reclaimed_segments) ? stats.gc_trim_stats.reclaimed_segments : 0; const trimmedMBValue = (stats.gc_trim_stats && stats.gc_trim_stats.trimmed_mb) ? stats.gc_trim_stats.trimmed_mb : 0; const parsedEntry = { timestamp: formattedTimestamp, date: stats.timestamp.split('T')[0], deletedFiles: stats.global_stats.files_deleted || 0, deletedDirs: stats.global_stats.dirs_deleted || 0, dirtySegments: reclaimedSegments, fileCleanedMB: stats.global_stats.megabytes_deleted || 0, trimMB: trimmedMBValue, appStats: stats.app_stats || [] }; parsedEntries.push(parsedEntry); } catch (error) { console.error("解析 JSON 行失败:", error, "行内容:", line); } }); return parsedEntries; }
function updateLocalStorage(newData) { if (!newData || newData.length === 0) return; const storedData = JSON.parse(localStorage.getItem('logData') || '[]'); const dataMap = new Map(storedData.map(entry => [entry.timestamp, entry])); newData.forEach(newEntry => { dataMap.set(newEntry.timestamp, newEntry); }); const combinedData = Array.from(dataMap.values()); const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - 6); const filteredData = combinedData.filter(entry => new Date(entry.date) >= cutoffDate); localStorage.setItem('logData', JSON.stringify(filteredData)); }
function getStoredData() { return JSON.parse(localStorage.getItem('logData') || '[]'); }
function clearStoredData() { localStorage.removeItem('logData'); }

// --- 内联模块: icons.js ---
const icons = { home: mdiHome, edit: mdiPencilBoxOutline };

document.addEventListener('DOMContentLoaded', async () => {
    // --- 全局状态和元素 ---
    const loader = document.getElementById('loader');
    const appWrapper = document.querySelector('.app-wrapper');
    let isExt4 = false;
    let gcInfoIntervalId = null;
    let isBackendOnline = true; 
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // --- SPA 页面切换逻辑 ---
    const pages = { home: document.getElementById('page-home'), edit: document.getElementById('page-edit') };
    const navItems = document.querySelectorAll('.nav-item');
    function showPage(pageId) {
        Object.values(pages).forEach(page => page.style.display = 'none');
        if (pages[pageId]) pages[pageId].style.display = 'block';
        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === pageId));
    }
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.currentTarget.dataset.page;
            // 使用 history.replaceState 替换 URL，不产生历史记录，实现返回即退出
            history.replaceState(null, '', `#${pageId}`);
            showPage(pageId);
        });
    });

    // --- 后端通信与状态检查 ---
    function disableBackendFeatures(reason) {
        if (!isBackendOnline) return; 
        isBackendOnline = false;
        toast(reason, 4000);
        
        document.querySelectorAll('#clean-now-btn, #refresh-log, #restart-module, #gc-control-btn, #config-form button[type="submit"]').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('disabled');
        });
        
        if (gcInfoIntervalId) {
            clearInterval(gcInfoIntervalId);
            gcInfoIntervalId = null;
        }
        const globalGcStatusSpan = document.getElementById('global-gc-status');
        if (globalGcStatusSpan) {
            globalGcStatusSpan.textContent = '后端离线';
            globalGcStatusSpan.className = 'badge bg-danger';
        }
    }

    async function checkBackendProcess() {
        try {
            const { errno } = await exec('pgrep cleaner');
            return errno === 0;
        } catch (e) {
            return false;
        }
    }

    async function sendTcpCommand(command) {
        if (!isBackendOnline) return null;
        try {
            const { errno, stdout, stderr } = await exec(`/data/adb/modules/Clean-C/tcp_client ${command}`);
            if (errno === 0) {
                if (!stdout.trim()) return [];
                try { return JSON.parse(stdout.trim()); } catch (e) {
                    disableBackendFeatures('后端响应解析失败');
                    return null;
                }
            } else {
                disableBackendFeatures('后端通信失败');
                return null;
            }
        } catch (error) {
            disableBackendFeatures('后端通信异常');
            return null;
        }
    }

    // --- 辅助函数 ---
    function injectIcons() { document.querySelectorAll('[data-icon]').forEach(el => { const iconName = el.getAttribute('data-icon'); if (icons[iconName]) el.setAttribute('d', icons[iconName]); }); }

    // --- 主页逻辑 ---
    const initHomePage = (() => {
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
        let partitionCharts = new Map();
        let appNamesMap = new Map();
        let allDiscoveredPartitions = new Set();
        let hiddenPartitions = new Set(JSON.parse(localStorage.getItem('hiddenF2fsPartitions') || '[]'));
        const barChart = new Chart(document.getElementById('bar-chart').getContext('2d'), { type: 'bar', data: { labels: [], datasets: [{ label: '文件清理 (MB)', data: [], backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }, { label: '回收脏段数', data: [], backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }, { label: '已删除文件数', data: [], backgroundColor: 'rgba(255, 99, 132, 0.2)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }, { label: '已删除目录数', data: [], backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] }, options: { scales: { y: { beginAtZero: true } } } });

        function formatDuration(s) { if (isNaN(s) || s < 0) return "0s"; if (s < 60) return `${s}s`; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`; }
        async function checkFileSystem() { try { const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`); isExt4 = (stdout.trim() === 'ext4'); f2fsGcInfoContainer.style.display = isExt4 ? 'none' : 'block'; if (isExt4 && gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; } if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); } } catch (error) { toast(`检查文件系统失败`); } }
        async function updateAllF2fsInfo(isManualRefresh = false) { const partitionsData = await sendTcpCommand('stats'); if (partitionsData === null) { if (gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; } return; } if (Array.isArray(partitionsData)) { partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name)); customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none'; const visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name)); updatePartitionCharts(visiblePartitions); updatePartitionGcStatus(visiblePartitions); } }
        function updatePartitionCharts(partitionsData) { const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches; const currentVisibleDevices = new Set(partitionsData.map(p => p.device_name)); partitionsData.forEach(data => { const { device_name, dirty_segments, free_segments } = data; if (typeof dirty_segments !== 'number' || typeof free_segments !== 'number') return; if (partitionCharts.has(device_name)) { const chart = partitionCharts.get(device_name); chart.data.labels = [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`]; chart.data.datasets[0].data = [dirty_segments, free_segments]; chart.update('none'); } else { const wrapper = document.createElement('div'); wrapper.className = 'partition-chart-wrapper'; wrapper.id = `chart-wrapper-${device_name}`; wrapper.innerHTML = `<div class="partition-chart-canvas-container"><canvas></canvas></div><p class="partition-chart-label">${device_name}</p>`; f2fsChartsContainer.appendChild(wrapper); const newChart = new Chart(wrapper.querySelector('canvas').getContext('2d'), { type: 'doughnut', data: { labels: [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`], datasets: [{ data: [dirty_segments, free_segments], backgroundColor: ['#ff6384', '#36a2eb'], borderColor: isDarkMode ? '#2A2A2A' : '#f8f9fa' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } }); partitionCharts.set(device_name, newChart); } }); for (const deviceName of partitionCharts.keys()) { if (!currentVisibleDevices.has(deviceName)) { partitionCharts.get(deviceName).destroy(); document.getElementById(`chart-wrapper-${deviceName}`)?.remove(); partitionCharts.delete(deviceName); } } }
        function updatePartitionGcStatus(gcStatusArray) { if (isExt4) return; partitionGcStatusContainer.innerHTML = ''; const runningPartitions = gcStatusArray.filter(p => p.is_running && !hiddenPartitions.has(p.device_name)); const anyGcRunning = runningPartitions.length > 0; if (anyGcRunning) { document.getElementById('global-gc-status').style.display = 'none'; partitionGcStatusContainer.style.display = 'flex'; runningPartitions.forEach(({ device_name, is_paused, elapsed_seconds, reclaimed_segments, pause_reason }) => { const itemDiv = document.createElement('div'); itemDiv.className = 'partition-gc-status-item'; itemDiv.innerHTML = `<p>${device_name}</p><span class="badge ${is_paused ? 'bg-warning' : 'bg-success'}">${is_paused ? `暂停<br>原因: ${pause_reason || "未知"}` : '运行中'}<br>运行: ${formatDuration(elapsed_seconds || 0)} | 回收: ${reclaimed_segments || 0}</span>`; partitionGcStatusContainer.appendChild(itemDiv); }); gcControlButton.textContent = '停止所有'; gcControlButton.className = 'btn btn-sm btn-danger'; gcControlButton.dataset.action = 'stop'; } else { partitionGcStatusContainer.style.display = 'none'; const globalGcStatusSpan = document.getElementById('global-gc-status'); globalGcStatusSpan.style.display = 'inline-block'; globalGcStatusSpan.textContent = 'GC回收: 关闭'; globalGcStatusSpan.className = 'badge bg-secondary'; gcControlButton.textContent = '开始所有'; gcControlButton.className = 'btn btn-sm btn-success'; gcControlButton.dataset.action = 'start'; } }
        async function initDatePicker() { try { const { stdout } = await exec('date +"%F"'); const today = new Date(stdout.trim()); const sixDaysAgo = new Date(today); sixDaysAgo.setDate(today.getDate() - 6); const formatDate = (d) => d.toISOString().split('T')[0]; dateSelect.min = formatDate(sixDaysAgo); dateSelect.max = dateSelect.value = formatDate(today); } catch (e) { toast(`初始化日期选择器失败`); } }
        async function loadLogFile() { try { const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json'); if (errno === 0 && stdout.trim() !== '') updateLocalStorage(parseLogContent(stdout)); else if (errno !== 0 && !stderr.includes('No such file')) throw new Error(stderr); } catch (e) { toast(`加载统计数据失败: ${e.message}`); } updateDisplaysForSelectedDate(); }
        function updateDisplaysForSelectedDate() { const selectedDate = dateSelect.value; const storedData = getStoredData(); const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData; const aggregatedData = {}; filteredData.forEach(entry => { const date = entry.date; if (!aggregatedData[date]) aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0 }; aggregatedData[date].deletedFiles += entry.deletedFiles || 0; aggregatedData[date].deletedDirs += entry.deletedDirs || 0; aggregatedData[date].dirtySegments += entry.dirtySegments || 0; aggregatedData[date].fileCleanedMB += entry.fileCleanedMB || 0; }); barChart.data.datasets.forEach(ds => { if (ds.label.includes('脏段')) ds.hidden = isExt4; }); const dates = Object.keys(aggregatedData).sort(); barChart.data.labels = dates; barChart.data.datasets[0].data = dates.map(d => aggregatedData[d].fileCleanedMB); barChart.data.datasets[1].data = dates.map(d => aggregatedData[d].dirtySegments); barChart.data.datasets[2].data = dates.map(d => aggregatedData[d].deletedFiles); barChart.data.datasets[3].data = dates.map(d => aggregatedData[d].deletedDirs); barChart.update('none'); appStatsTitle.textContent = `应用清理详情 (${selectedDate})`; const dailyEntries = getStoredData().filter(entry => entry.date === selectedDate); const aggregatedStats = new Map(); dailyEntries.forEach(entry => entry.appStats?.forEach(app => { const existing = aggregatedStats.get(app.package_name) || { ...app, bytes_deleted: 0, megabytes_deleted: 0 }; existing.bytes_deleted += app.bytes_deleted; existing.megabytes_deleted += app.megabytes_deleted; aggregatedStats.set(app.package_name, existing); })); const appStats = Array.from(aggregatedStats.values()); appStatsList.innerHTML = ''; appStatsContainer.classList.toggle('hidden', !appStats || appStats.length === 0); if (!appStats || appStats.length === 0) { appStatsList.innerHTML = '<li class="list-group-item text-muted">该日无应用数据清理记录。</li>'; return; } appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted).forEach(app => { const displayName = appNamesMap.get(app.package_name) || app.package_name; appStatsList.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center"><span class="text-truncate me-3" title="${app.package_name}">${displayName}</span><span class="badge bg-primary rounded-pill">${app.megabytes_deleted.toFixed(2)} MB</span></li>`; }); }
        
        dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        document.getElementById('clear-data').addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); toast('数据已清除'); });
        gcControlButton.addEventListener('click', async () => { const action = gcControlButton.dataset.action; if (action === 'unknown' || !isBackendOnline) return; gcControlButton.disabled = true; gcControlButton.textContent = '...'; await sendTcpCommand(action === 'start' ? 'start_gc' : 'stop_gc'); await delay(1500); gcControlButton.disabled = false; await updateAllF2fsInfo(true); });
        document.getElementById('clean-now-btn').addEventListener('click', async () => { if (!isBackendOnline) return; toast('正在请求立即清理...'); await sendTcpCommand('clean_now'); });
        document.getElementById('refresh-log').addEventListener('click', async () => { toast('正在手动刷新...'); if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); toast('已重新启动自动刷新'); } await loadLogFile(); if (!isExt4) await updateAllF2fsInfo(true); toast('数据已刷新'); });
        document.getElementById('delete-log').addEventListener('click', async () => { try { await exec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json'); await loadLogFile(); toast('日志文件已删除'); } catch (e) { toast(`删除日志失败: ${e.message}`); } });
        document.getElementById('restart-module').addEventListener('click', async () => { if (!isBackendOnline) return; toast('正在请求重启模块...'); await sendTcpCommand('restart'); toast('重启命令已发送'); });
        customizePartitionsBtn.addEventListener('click', () => { partitionsModalBody.innerHTML = ''; Array.from(allDiscoveredPartitions).sort().forEach(deviceName => { partitionsModalBody.innerHTML += `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="switch-${deviceName}" data-device-name="${deviceName}" ${!hiddenPartitions.has(deviceName) ? 'checked' : ''}><label class="form-check-label" for="switch-${deviceName}">${deviceName}</label></div>`; }); partitionsModal.show(); });
        savePartitionsBtn.addEventListener('click', () => { const newHidden = new Set(); partitionsModalBody.querySelectorAll('.form-check-input').forEach(cb => { if (!cb.checked) newHidden.add(cb.dataset.deviceName); }); hiddenPartitions = newHidden; localStorage.setItem('hiddenF2fsPartitions', JSON.stringify(Array.from(hiddenPartitions))); partitionsModal.hide(); toast('显示偏好已保存'); updateAllF2fsInfo(true); });

        return async function() {
            await checkFileSystem();
            await initDatePicker();
            try { const { stdout } = await exec('cat /data/media/0/Android/清理规则/list.config'); stdout.split('\n').forEach(line => { if (line.includes('=')) { const [pkg, name] = line.split('=').map(item => item.trim()); if (pkg && name) appNamesMap.set(pkg, name); } }); } catch (e) { console.error("Error loading app names:", e); }
            await loadLogFile();
            if (!isExt4) await updateAllF2fsInfo(true);
        };
    })();

    // --- 编辑页逻辑 ---
    const initEditPage = (() => {
        const configForm = document.getElementById('config-form');
        const retentionDaysInput = document.getElementById('retention-days');
        const cleanIntervalInput = document.getElementById('clean-interval');
        const f2fsGcConfigContainer = document.getElementById('f2fs-gc-config-container');
        const f2fsGcConfigToggle = document.getElementById('f2fs-gc-config-toggle');
        const f2fsGcConfigToggleLabel = document.getElementById('f2fs-gc-config-toggle-label');
        const scheduleModeCronRadio = document.getElementById('schedule-mode-cron');
        const intervalInputGroup = document.getElementById('interval-input-group');
        const cronInputGroup = document.getElementById('cron-input-group');
        const cronExpressionInput = document.getElementById('cron-expression');
        const cronEditorModal = new Modal(document.getElementById('cron-editor-modal'));
        const cronTabTriggers = document.querySelectorAll('#cron-tabs a[data-mdb-toggle="pill"]');
        const cronFields = { minutes: { el: document.getElementById('cron-minutes'), min: 0, max: 59, name: '分钟' }, hours: { el: document.getElementById('cron-hours'), min: 0, max: 23, name: '小时' }, dom: { el: document.getElementById('cron-dom'), min: 1, max: 31, name: '日' }, months: { el: document.getElementById('cron-months'), min: 1, max: 12, name: '月', labels: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'] }, dow: { el: document.getElementById('cron-dow'), min: 0, max: 6, name: '星期', labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] } };

        function updateGcConfigToggleLabel(isChecked) { f2fsGcConfigToggleLabel.textContent = isChecked ? '已开启' : '已关闭'; f2fsGcConfigToggleLabel.classList.toggle('btn-success', isChecked); f2fsGcConfigToggleLabel.classList.toggle('btn-outline-secondary', !isChecked); }
        function updateScheduleModeUI() { const isCron = scheduleModeCronRadio.checked; intervalInputGroup.classList.toggle('hidden', isCron); cronInputGroup.classList.toggle('hidden', !isCron); cleanIntervalInput.required = !isCron; cronExpressionInput.required = isCron; }
        function generateCronEditorUI() { for (const key in cronFields) { const { el, min, max, name, labels } = cronFields[key]; let gridHtml = '<div class="cron-grid collapsed">'; for (let i = min; i <= max; i++) { gridHtml += `<div><input type="checkbox" class="btn-check" id="${key}-${i}" value="${i}"><label class="btn btn-outline-primary" for="${key}-${i}">${labels ? labels[i - min] : i}</label></div>`; } el.innerHTML = `<div class="btn-group mb-3 w-100"><input type="radio" class="btn-check" name="${key}-mode" id="${key}-every" value="*" checked><label class="btn btn-outline-primary" for="${key}-every">每${(labels ? '个' : '') + name}</label><input type="radio" class="btn-check" name="${key}-mode" id="${key}-specific" value="specific"><label class="btn btn-outline-primary" for="${key}-specific">指定</label></div>` + gridHtml + '</div>'; } }
        function parseCronToUI(expression) { const parts = expression.split(' '); if (parts.length !== 5) return; ['minutes', 'hours', 'dom', 'months', 'dow'].forEach((key, i) => { const part = parts[i], field = cronFields[key]; field.el.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false); if (part === '*') { field.el.querySelector(`#${key}-every`).checked = true; field.el.querySelector('.cron-grid').classList.add('collapsed'); } else { field.el.querySelector(`#${key}-specific`).checked = true; field.el.querySelector('.cron-grid').classList.remove('collapsed'); part.split(',').forEach(range => { if (range.includes('-')) { const [start, end] = range.split('-').map(Number); for (let j = start; j <= end; j++) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } } else if (range.includes('/')) { const [_, step] = range.split('/').map(Number); for (let j = field.min; j <= field.max; j += step) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } } else { const cb = field.el.querySelector(`#${key}-${Number(range)}`); if (cb) cb.checked = true; } }); } }); }
        function generateCronFromUI() { return ['minutes', 'hours', 'dom', 'months', 'dow'].map(key => { const field = cronFields[key]; if (field.el.querySelector(`input[name="${key}-mode"]:checked`).value === '*') return '*'; const selected = Array.from(field.el.querySelectorAll('.cron-grid input:checked')).map(cb => Number(cb.value)); if (selected.length === 0 || selected.length === (field.max - field.min + 1)) return '*'; selected.sort((a, b) => a - b); const ranges = []; for (let i = 0; i < selected.length; i++) { let start = selected[i]; while (i + 1 < selected.length && selected[i+1] === selected[i] + 1) i++; ranges.push(start === selected[i] ? `${start}` : `${start}-${selected[i]}`); } return ranges.join(','); }).join(' '); }
        async function loadConfigFile() { try { const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt'); if (errno === 0) { const config = {}; stdout.split('\n').forEach(line => { if (line.includes('=')) { const [key, value] = line.split('=').map(item => item.trim()); if (key && value) config[key] = value; } }); retentionDaysInput.value = config.保留天数 || '30'; if (config.cron表达式 && config.cron表达式.trim() !== '') { scheduleModeCronRadio.checked = true; cronExpressionInput.value = config.cron表达式; } else { cronExpressionInput.value = '0 * * * *'; } cleanIntervalInput.value = config.程序清理间隔秒数 || '3600'; const f2fsGcValue = config['f2fs-GC'] || 'n'; f2fsGcConfigToggle.checked = f2fsGcValue === 'y'; } } catch (e) { toast(`加载配置失败: ${e.message}`); } updateScheduleModeUI(); updateGcConfigToggleLabel(f2fsGcConfigToggle.checked); }
        
        configForm.addEventListener('submit', async (e) => { e.preventDefault(); if (!isBackendOnline) return; try { const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt'); let lines = (errno === 0) ? stdout.split('\n') : []; if (errno !== 0 && !stderr.includes('No such file')) throw new Error(`读取配置失败: ${stderr}`); const otherLines = lines.filter(l => !/^(保留天数=|程序清理间隔秒数=|cron表达式=|f2fs-GC=)/.test(l) && l.trim() !== ''); const newConfig = [...otherLines, `保留天数=${retentionDaysInput.value}`, `f2fs-GC=${f2fsGcConfigToggle.checked ? 'y' : 'n'}`]; if (scheduleModeCronRadio.checked) { newConfig.push(`cron表达式=${cronExpressionInput.value}`, `程序清理间隔秒数=${cleanIntervalInput.value}`); } else { newConfig.push(`程序清理间隔秒数=${cleanIntervalInput.value}`, `cron表达式=${cronExpressionInput.value || '0 * * * *'}`); } const updatedConfig = newConfig.join('\n'); const { errno: writeErrno, stderr: writeStderr } = await exec(`printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`); if (writeErrno !== 0) throw new Error(`写入配置失败: ${writeStderr}`); toast('配置已保存，正在请求重启模块...'); await sendTcpCommand('restart'); toast('重启命令已发送'); } catch (error) { toast(`操作失败: ${error.message}`); } });
        f2fsGcConfigToggle.addEventListener('change', () => updateGcConfigToggleLabel(f2fsGcConfigToggle.checked));
        document.querySelectorAll('input[name="schedule-mode"]').forEach(el => el.addEventListener('change', updateScheduleModeUI));
        document.getElementById('edit-cron-btn').addEventListener('click', () => { parseCronToUI(cronExpressionInput.value); cronEditorModal.show(); });
        document.getElementById('save-cron-btn').addEventListener('click', () => { cronExpressionInput.value = generateCronFromUI(); cronEditorModal.hide(); });
        
        // Cron 编辑器标签页切换逻辑 (使用 transitionend 确保动画同步)
        cronTabTriggers.forEach(clickedTrigger => {
            clickedTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                if (clickedTrigger.classList.contains('active')) return;

                const currentPane = document.querySelector('#cron-tabs-content .tab-pane.active');
                const targetPane = document.querySelector(clickedTrigger.getAttribute('href'));
                const currentGrid = currentPane?.querySelector('.cron-grid');
                
                // 核心切换逻辑
                const switchTabs = () => {
                    // 1. 移除旧的 active 状态
                    cronTabTriggers.forEach(trigger => trigger.classList.remove('active'));
                    document.querySelectorAll('#cron-tabs-content .tab-pane').forEach(pane => {
                        pane.classList.remove('active', 'show');
                    });

                    // 2. 添加新的 active 状态
                    clickedTrigger.classList.add('active');
                    if (targetPane) {
                        targetPane.classList.add('active');
                        
                        // 强制浏览器重绘
                        void targetPane.offsetWidth;

                        targetPane.classList.add('show');

                        // 3. 检查新面板是否需要展开，并触发展开动画
                        const targetIsSpecific = targetPane.querySelector('input[value="specific"]')?.checked;
                        if (targetIsSpecific) {
                            setTimeout(() => { // 稍等 CSS show 动画开始
                                targetPane.querySelector('.cron-grid')?.classList.remove('collapsed');
                            }, 10);
                        }
                    }
                };

                // 如果当前面板是展开的 (即非 collapsed)，则先收起并监听动画结束事件
                if (currentGrid && !currentGrid.classList.contains('collapsed')) {
                    // 添加一次性事件监听器
                    currentGrid.addEventListener('transitionend', function onTransitionEnd(e) {
                        // 确保是 max-height 动画结束时才触发
                        if (e.propertyName === 'max-height') {
                            currentGrid.removeEventListener('transitionend', onTransitionEnd);
                            switchTabs();
                        }
                    });
                    // 触发收缩动画
                    currentGrid.classList.add('collapsed');
                } else {
                    // 如果当前面板已经是收缩状态，直接切换
                    switchTabs();
                }
            });
        });

        document.getElementById('cron-editor-modal').addEventListener('click', (e) => { if (e.target.name && e.target.name.endsWith('-mode')) { const fieldKey = e.target.name.replace('-mode', ''); cronFields[fieldKey].el.querySelector('.cron-grid').classList.toggle('collapsed', e.target.value === '*'); } });
        const editRuleFile = async (fileName) => { try { const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file:///data/media/0/Android/清理规则/${fileName} -t text/plain`); if (errno !== 0) throw new Error(stderr); toast(`尝试打开文件: ${fileName}`); } catch (e) { toast(`编辑文件失败: ${e.message}`); } };
        document.getElementById('edit-blacklist1').addEventListener('click', () => editRuleFile('blacklist1.txt'));
        document.getElementById('edit-blacklist2').addEventListener('click', () => editRuleFile('blacklist2.txt'));
        document.getElementById('edit-whitelist').addEventListener('click', () => editRuleFile('whitelist.txt'));

        return async function() {
            try { const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`); f2fsGcConfigContainer.style.display = (stdout.trim() === 'ext4') ? 'none' : 'block'; } catch (e) { console.error("Failed to check file system:", e); }
            generateCronEditorUI();
            await loadConfigFile();
        };
    })();

    // --- 应用初始化 ---
    injectIcons();

    // 优先检查后端进程
    if (!await checkBackendProcess()) {
        disableBackendFeatures('后端服务 cleaner 未运行，功能已禁用');
    }

    await initHomePage();
    await initEditPage();

    const initialPage = window.location.hash.substring(1) || 'home';
    // 替换历史记录，防止滑动返回
    history.replaceState(null, '', `#${initialPage}`);
    showPage(initialPage);

    // 初始化完成，显示界面
    appWrapper.classList.add('loaded');
    loader.style.display = 'none';
});