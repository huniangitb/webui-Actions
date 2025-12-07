// 关键修改: 显式导入 API 以满足打包器需求
import { exec as originalExec, toast as originalToast } from 'kernelsu';
import Chart from 'chart.js/auto';
import { mdiHome, mdiPencilBoxOutline } from '@mdi/js';

// 运行时检查 API 是否真实可用
const isKernelSUAvailable = typeof window.kernelsu !== 'undefined' && typeof originalExec === 'function';

// 创建安全调用的封装函数，供整个应用使用
const safeExec = isKernelSUAvailable 
    ? originalExec 
    : async (cmd) => {
        console.log(`[DEBUG MODE] EXEC: ${cmd}`);
        // 返回一个模拟的失败结果，防止应用崩溃
        return Promise.resolve({ errno: 1, stdout: '', stderr: 'KernelSU API not available' });
      };

const safeToast = isKernelSUAvailable 
    ? originalToast 
    : (msg, duration) => {
        console.log(`[DEBUG MODE] TOAST: ${msg} (Duration: ${duration})`);
      };

// --- 内联模块: logParser.js ---
function parseLogContent(ndjsonContent) { if (!ndjsonContent || ndjsonContent.trim() === '') return []; const parsedEntries = []; const lines = ndjsonContent.split('\n'); lines.forEach(line => { if (line.trim() === '') return; try { const stats = JSON.parse(line); if (!stats.timestamp || !stats.global_stats) return; const formattedTimestamp = stats.timestamp.replace('T', ' ').replace('Z', ''); const reclaimedSegments = (stats.gc_trim_stats && stats.gc_trim_stats.reclaimed_segments) ? stats.gc_trim_stats.reclaimed_segments : 0; const trimmedMBValue = (stats.gc_trim_stats && stats.gc_trim_stats.trimmed_mb) ? stats.gc_trim_stats.trimmed_mb : 0; const parsedEntry = { timestamp: formattedTimestamp, date: stats.timestamp.split('T')[0], deletedFiles: stats.global_stats.files_deleted || 0, deletedDirs: stats.global_stats.dirs_deleted || 0, dirtySegments: reclaimedSegments, fileCleanedMB: stats.global_stats.megabytes_deleted || 0, trimMB: trimmedMBValue, appStats: stats.app_stats || [] }; parsedEntries.push(parsedEntry); } catch (error) { console.error("解析 JSON 行失败:", error, "行内容:", line); } }); return parsedEntries; }
function updateLocalStorage(newData) { if (!newData || newData.length === 0) return; const storedData = JSON.parse(localStorage.getItem('logData') || '[]'); const dataMap = new Map(storedData.map(entry => [entry.timestamp, entry])); newData.forEach(newEntry => { dataMap.set(newEntry.timestamp, newEntry); }); const combinedData = Array.from(dataMap.values()); const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - 6); const filteredData = combinedData.filter(entry => new Date(entry.date) >= cutoffDate); localStorage.setItem('logData', JSON.stringify(filteredData)); }
function getStoredData() { return JSON.parse(localStorage.getItem('logData') || '[]'); }
function clearStoredData() { localStorage.removeItem('logData'); }

// --- 内联模块: icons.js ---
const icons = { home: mdiHome, edit: mdiPencilBoxOutline };

// --- 原生 UI 控制模块 (已修改) ---
const NativeUI = {
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            document.querySelector('.app-wrapper').classList.add('is-blurred');
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },
    closeModal(modalOrId) {
        const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
        if (modal) {
            document.querySelector('.app-wrapper').classList.remove('is-blurred');
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    },
    initModals() {
        document.body.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-toggle="modal"]');
            if (trigger) {
                const targetId = trigger.getAttribute('data-target').substring(1);
                this.openModal(targetId);
                return;
            }
            const dismissBtn = e.target.closest('[data-dismiss="modal"]');
            const modal = e.target.closest('.modal');
            if (dismissBtn && modal) {
                this.closeModal(modal);
                return;
            }
            if (modal && e.target === modal) {
                this.closeModal(modal);
            }
        });
    },
    initTabs() {
        document.body.addEventListener('click', (e) => {
            const trigger = e.target.closest('.nav-pills .nav-link');
            if (!trigger) return;
            e.preventDefault();
            if (trigger.classList.contains('active')) return;
            const parent = trigger.closest('.nav-pills');
            const contentContainer = parent.nextElementSibling;
            parent.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            trigger.classList.add('active');
            contentContainer.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active', 'show'));
            const targetPane = contentContainer.querySelector(trigger.getAttribute('href'));
            if (targetPane) {
                targetPane.classList.add('active');
                void targetPane.offsetWidth;
                targetPane.classList.add('show');
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // --- 全局状态和元素 ---
    const loader = document.getElementById('loader');
    const appWrapper = document.querySelector('.app-wrapper');
    const pagesContainer = document.querySelector('.pages-container');
    let isExt4 = false;
    let gcInfoIntervalId = null;
    let isBackendOnline = true;
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // --- 强制加载逻辑 ---
    let isLoaded = false;
    const finishLoading = () => {
        if (isLoaded) return;
        isLoaded = true;
        loader.style.opacity = '0';
        loader.addEventListener('transitionend', () => {
            loader.style.display = 'none';
            requestAnimationFrame(() => {
                appWrapper.classList.add('loaded');
            });
        }, { once: true });
    };
    setTimeout(finishLoading, 5000);

    // --- 辅助函数 ---
    function generateRandomAurora() {
        const baseHue = Math.floor(Math.random() * 360);
        const hues = [
            baseHue,
            (baseHue + 60) % 360,
            (baseHue + 180) % 360,
            (baseHue + 240) % 360
        ];
        hues.forEach((hue, i) => {
            document.documentElement.style.setProperty(`--aurora-color-${i + 1}`, `hsl(${hue}, 90%, 70%)`);
        });
    }
    function injectIcons() { document.querySelectorAll('[data-icon]').forEach(el => { const iconName = el.getAttribute('data-icon'); if (icons[iconName]) el.setAttribute('d', icons[iconName]); }); }

    // --- SPA 页面切换逻辑 ---
    const pages = { home: document.getElementById('page-home'), edit: document.getElementById('page-edit') };
    const navItems = document.querySelectorAll('.nav-item');
    let currentPageId = 'home';

    function showPage(pageId) {
        if (pageId === currentPageId || !pagesContainer) return;
        const pageIndex = Object.keys(pages).indexOf(pageId);
        if (pageIndex === -1) return;
        const translateXValue = pageIndex * -50;
        pagesContainer.style.transform = `translateX(${translateXValue}%)`;
        navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageId);
        });
        currentPageId = pageId;
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.currentTarget.dataset.page;
            history.replaceState(null, '', `#${pageId}`);
            showPage(pageId);
        });
    });

    // --- 后端通信与状态检查 ---
    function disableBackendFeatures(reason) {
        if (!isBackendOnline) return;
        isBackendOnline = false;
        safeToast(reason, 4000);
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
    async function checkBackendProcess() { try { const { errno } = await safeExec('pgrep cleaner'); return errno === 0; } catch (e) { return false; } }
    async function sendTcpCommand(command) {
        if (!isBackendOnline) return null;
        try {
            const { errno, stdout } = await safeExec(`/data/adb/modules/Clean-C/tcp_client ${command}`);
            if (errno === 0) {
                if (!stdout.trim()) return [];
                try { return JSON.parse(stdout.trim()); } catch (e) { disableBackendFeatures('后端响应解析失败'); return null; }
            } else { disableBackendFeatures('后端通信失败'); return null; }
        } catch (error) { disableBackendFeatures('后端通信异常'); return null; }
    }

    // --- 主页逻辑 ---
    const initHomePage = (() => {
        const dateSelect = document.getElementById('date-select');
        const barChartWrapper = document.getElementById('bar-chart-wrapper');
        const appStatsList = document.getElementById('app-stats-list');
        const appStatsContainer = document.getElementById('app-stats-container');
        const appStatsTitle = document.getElementById('app-stats-title');
        const f2fsGcInfoContainer = document.getElementById('f2fs-gc-info-container');
        const gcControlButton = document.getElementById('gc-control-btn');
        const f2fsChartsContainer = document.getElementById('f2fs-charts-container');
        const partitionGcStatusContainer = document.getElementById('partition-gc-status-container');
        const customizePartitionsBtn = document.getElementById('customize-partitions-btn');
        const partitionsModalEl = document.getElementById('partitions-modal');
        const partitionsModalBody = document.getElementById('partitions-modal-body');
        const savePartitionsBtn = document.getElementById('save-partitions-btn');
        let partitionCharts = new Map();
        let appNamesMap = new Map();
        let allDiscoveredPartitions = new Set();
        let hiddenPartitions = new Set(JSON.parse(localStorage.getItem('hiddenF2fsPartitions') || '[]'));

        const getChartColors = () => {
            const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            return {
                textColor: isDarkMode ? '#f5f5f5' : '#6c757d',
                gridColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                doughnutBorderColor: isDarkMode ? '#323232' : '#f0f2f5',
            };
        };
        
        const initialChartColors = getChartColors();
        const barChart = new Chart(document.getElementById('bar-chart').getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: '文件清理 (MB)', data: [], backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }, { label: '回收脏段数', data: [], backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }, { label: '已删除文件数', data: [], backgroundColor: 'rgba(255, 99, 132, 0.2)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }, { label: '已删除目录数', data: [], backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
            options: {
                scales: {
                    y: { beginAtZero: true, grid: { color: initialChartColors.gridColor }, ticks: { color: initialChartColors.textColor } },
                    x: { grid: { color: initialChartColors.gridColor }, ticks: { color: initialChartColors.textColor } }
                },
                plugins: { legend: { labels: { color: initialChartColors.textColor } } }
            }
        });

        const updateChartTheme = () => {
            const newColors = getChartColors();
            barChart.options.scales.y.grid.color = newColors.gridColor;
            barChart.options.scales.y.ticks.color = newColors.textColor;
            barChart.options.scales.x.grid.color = newColors.gridColor;
            barChart.options.scales.x.ticks.color = newColors.textColor;
            barChart.options.plugins.legend.labels.color = newColors.textColor;
            barChart.update('none');
            partitionCharts.forEach(chart => {
                chart.data.datasets[0].borderColor = newColors.doughnutBorderColor;
                chart.update('none');
            });
        };

        function formatDuration(s) { if (isNaN(s) || s < 0) return "0s"; if (s < 60) return `${s}s`; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`; }
        async function checkFileSystem() { try { const { stdout } = await safeExec(`mount | grep " /data " | awk '{print $5}'`); isExt4 = (stdout.trim() === 'ext4'); f2fsGcInfoContainer.style.display = isExt4 ? 'none' : 'block'; if (isExt4 && gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; } if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); } } catch (error) { safeToast(`检查文件系统失败`); } }
        async function updateAllF2fsInfo(isManualRefresh = false) { const partitionsData = await sendTcpCommand('stats'); if (partitionsData === null) { if (gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; } return; } if (Array.isArray(partitionsData)) { partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name)); customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none'; const visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name)); updatePartitionCharts(visiblePartitions); updatePartitionGcStatus(visiblePartitions); } }
        function updatePartitionCharts(partitionsData) {
            const currentChartColors = getChartColors();
            const currentVisibleDevices = new Set(partitionsData.map(p => p.device_name));
            partitionsData.forEach(data => {
                const { device_name, dirty_segments, free_segments } = data;
                if (typeof dirty_segments !== 'number' || typeof free_segments !== 'number') return;
                if (partitionCharts.has(device_name)) {
                    const chart = partitionCharts.get(device_name);
                    chart.data.labels = [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`];
                    chart.data.datasets[0].data = [dirty_segments, free_segments];
                    chart.update('none');
                } else {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'partition-chart-wrapper';
                    wrapper.id = `chart-wrapper-${device_name}`;
                    wrapper.innerHTML = `<div class="partition-chart-canvas-container"><canvas></canvas></div><p class="partition-chart-label">${device_name}</p>`;
                    f2fsChartsContainer.appendChild(wrapper);
                    const newChart = new Chart(wrapper.querySelector('canvas').getContext('2d'), {
                        type: 'doughnut',
                        data: {
                            labels: [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`],
                            datasets: [{ data: [dirty_segments, free_segments], backgroundColor: ['#ff6384', '#36a2eb'], borderColor: currentChartColors.doughnutBorderColor }]
                        },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                    });
                    partitionCharts.set(device_name, newChart);
                }
            });
            for (const deviceName of partitionCharts.keys()) {
                if (!currentVisibleDevices.has(deviceName)) {
                    partitionCharts.get(deviceName).destroy();
                    document.getElementById(`chart-wrapper-${deviceName}`)?.remove();
                    partitionCharts.delete(deviceName);
                }
            }
        }
        function updatePartitionGcStatus(gcStatusArray) { if (isExt4) return; partitionGcStatusContainer.innerHTML = ''; const runningPartitions = gcStatusArray.filter(p => p.is_running && !hiddenPartitions.has(p.device_name)); const anyGcRunning = runningPartitions.length > 0; if (anyGcRunning) { document.getElementById('global-gc-status').style.display = 'none'; partitionGcStatusContainer.style.display = 'flex'; runningPartitions.forEach(({ device_name, is_paused, elapsed_seconds, reclaimed_segments, pause_reason }) => { const itemDiv = document.createElement('div'); itemDiv.className = 'partition-gc-status-item'; itemDiv.innerHTML = `<p>${device_name}</p><span class="badge ${is_paused ? 'bg-warning' : 'bg-success'}">${is_paused ? `暂停<br>原因: ${pause_reason || "未知"}` : '运行中'}<br>运行: ${formatDuration(elapsed_seconds || 0)} | 回收: ${reclaimed_segments || 0}</span>`; partitionGcStatusContainer.appendChild(itemDiv); }); gcControlButton.textContent = '停止所有'; gcControlButton.className = 'btn btn-sm btn-danger'; gcControlButton.dataset.action = 'stop'; } else { partitionGcStatusContainer.style.display = 'none'; const globalGcStatusSpan = document.getElementById('global-gc-status'); globalGcStatusSpan.style.display = 'inline-block'; globalGcStatusSpan.textContent = 'GC回收: 关闭'; globalGcStatusSpan.className = 'badge bg-secondary'; gcControlButton.textContent = '开始'; gcControlButton.className = 'btn btn-sm btn-success'; gcControlButton.dataset.action = 'start'; } }
        async function initDatePicker() { try { const { stdout } = await safeExec('date +"%F"'); const today = new Date(stdout.trim()); const sixDaysAgo = new Date(today); sixDaysAgo.setDate(today.getDate() - 6); const formatDate = (d) => d.toISOString().split('T')[0]; dateSelect.min = formatDate(sixDaysAgo); dateSelect.max = dateSelect.value = formatDate(today); } catch (e) { safeToast(`初始化日期选择器失败`); } }
        async function loadLogFile() { try { const { errno, stdout, stderr } = await safeExec('cat /data/adb/modules/Clean-C/stats.json'); if (errno === 0 && stdout.trim() !== '') updateLocalStorage(parseLogContent(stdout)); else if (errno !== 0 && !stderr.includes('No such file')) throw new Error(stderr); } catch (e) { safeToast(`加载统计数据失败: ${e.message}`); } updateDisplaysForSelectedDate(); }
        
        function updateDisplaysForSelectedDate() {
            const selectedDate = dateSelect.value;
            const storedData = getStoredData();
            const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData;
            const aggregatedData = {};
            filteredData.forEach(entry => {
                const date = entry.date;
                if (!aggregatedData[date]) aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0 };
                aggregatedData[date].deletedFiles += entry.deletedFiles || 0;
                aggregatedData[date].deletedDirs += entry.deletedDirs || 0;
                aggregatedData[date].dirtySegments += entry.dirtySegments || 0;
                aggregatedData[date].fileCleanedMB += entry.fileCleanedMB || 0;
            });
            barChart.data.datasets.forEach(ds => { if (ds.label.includes('脏段')) ds.hidden = isExt4; });
            const dates = Object.keys(aggregatedData).sort();
            barChart.data.labels = dates;
            barChart.data.datasets[0].data = dates.map(d => aggregatedData[d].fileCleanedMB);
            barChart.data.datasets[1].data = dates.map(d => aggregatedData[d].dirtySegments);
            barChart.data.datasets[2].data = dates.map(d => aggregatedData[d].deletedFiles);
            barChart.data.datasets[3].data = dates.map(d => aggregatedData[d].deletedDirs);
            barChart.update('none');
            appStatsTitle.textContent = `应用清理详情 (${selectedDate})`;
            const dailyEntries = getStoredData().filter(entry => entry.date === selectedDate);
            const aggregatedStats = new Map();
            dailyEntries.forEach(entry => entry.appStats?.forEach(app => {
                const existing = aggregatedStats.get(app.package_name) || { ...app, bytes_deleted: 0, megabytes_deleted: 0 };
                existing.bytes_deleted += app.bytes_deleted;
                existing.megabytes_deleted += app.megabytes_deleted;
                aggregatedStats.set(app.package_name, existing);
            }));
            const appStats = Array.from(aggregatedStats.values());
            appStatsList.innerHTML = '';
            
            if (!appStats || appStats.length === 0) {
                appStatsContainer.style.cssText = 'max-height: 0; margin: 0; padding: 0; opacity: 0; border: none;';
                barChartWrapper.style.marginBottom = '0';
                return;
            }
            appStatsContainer.style.cssText = '';
            barChartWrapper.style.marginBottom = '';
            
            appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted).forEach(app => {
                const displayName = appNamesMap.get(app.package_name) || app.package_name;
                appStatsList.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center"><span class="text-truncate me-3" title="${app.package_name}">${displayName}</span><span class="badge bg-primary rounded-pill">${app.megabytes_deleted.toFixed(2)} MB</span></li>`;
            });
        }
        
        dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        document.getElementById('clear-data').addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); safeToast('数据已清除'); });
        gcControlButton.addEventListener('click', async () => { const action = gcControlButton.dataset.action; if (action === 'unknown') return; gcControlButton.disabled = true; gcControlButton.textContent = '...'; await sendTcpCommand(action === 'start' ? 'start_gc' : 'stop_gc'); await delay(1500); gcControlButton.disabled = false; await updateAllF2fsInfo(true); });
        document.getElementById('clean-now-btn').addEventListener('click', async () => { safeToast('正在请求立即清理...'); await sendTcpCommand('clean_now'); });
        document.getElementById('refresh-log').addEventListener('click', async () => { safeToast('正在手动刷新...'); if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); safeToast('已重新启动自动刷新'); } await loadLogFile(); if (!isExt4) await updateAllF2fsInfo(true); safeToast('数据已刷新'); });
        document.getElementById('delete-log').addEventListener('click', async () => { try { await safeExec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json'); await loadLogFile(); safeToast('日志文件已删除'); } catch (e) { safeToast(`删除日志失败: ${e.message}`); } });
        document.getElementById('restart-module').addEventListener('click', async () => { safeToast('正在请求重启模块...'); await sendTcpCommand('restart'); safeToast('重启命令已发送'); });
        customizePartitionsBtn.addEventListener('click', () => { partitionsModalBody.innerHTML = ''; Array.from(allDiscoveredPartitions).sort().forEach(deviceName => { partitionsModalBody.innerHTML += `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="switch-${deviceName}" data-device-name="${deviceName}" ${!hiddenPartitions.has(deviceName) ? 'checked' : ''}><label class="form-check-label" for="switch-${deviceName}">${deviceName}</label></div>`; }); NativeUI.openModal('partitions-modal'); });
        savePartitionsBtn.addEventListener('click', () => { const newHidden = new Set(); partitionsModalBody.querySelectorAll('.form-check-input').forEach(cb => { if (!cb.checked) newHidden.add(cb.dataset.deviceName); }); hiddenPartitions = newHidden; localStorage.setItem('hiddenF2fsPartitions', JSON.stringify(Array.from(hiddenPartitions))); NativeUI.closeModal(partitionsModalEl); safeToast('显示偏好已保存'); updateAllF2fsInfo(true); });

        return async function() {
            await checkFileSystem();
            await initDatePicker();
            try { const { stdout } = await safeExec('cat /data/media/0/Android/清理规则/list.config'); stdout.split('\n').forEach(line => { if (line.includes('=')) { const [pkg, name] = line.split('=').map(item => item.trim()); if (pkg && name) appNamesMap.set(pkg, name); } }); } catch (e) { console.error("Error loading app names:", e); }
            await loadLogFile();
            if (!isExt4) await updateAllF2fsInfo(true);
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateChartTheme);
        };
    })();

    // --- 编辑页逻辑 ---
    const initEditPage = (() => {
        const configForm = document.getElementById('config-form');
        const retentionDaysInput = document.getElementById('retention-days');
        const cleanIntervalInput = document.getElementById('clean-interval');
        const f2fsGcConfigContainer = document.getElementById('f2fs-gc-config-container');
        const f2fsGcConfigToggle = document.getElementById('f2fs-gc-config-toggle');
        const scheduleModeCronRadio = document.getElementById('schedule-mode-cron');
        const intervalInputGroup = document.getElementById('interval-input-group');
        const cronInputGroup = document.getElementById('cron-input-group');
        const cronExpressionInput = document.getElementById('cron-expression');
        const cronEditorModalEl = document.getElementById('cron-editor-modal');
        const cronFields = { minutes: { el: document.getElementById('cron-minutes'), min: 0, max: 59, name: '分钟' }, hours: { el: document.getElementById('cron-hours'), min: 0, max: 23, name: '小时' }, dom: { el: document.getElementById('cron-dom'), min: 1, max: 31, name: '日' }, months: { el: document.getElementById('cron-months'), min: 1, max: 12, name: '月', labels: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'] }, dow: { el: document.getElementById('cron-dow'), min: 0, max: 6, name: '星期', labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] } };

        function updateScheduleModeUI() { const isCron = scheduleModeCronRadio.checked; intervalInputGroup.classList.toggle('hidden', isCron); cronInputGroup.classList.toggle('hidden', !isCron); cleanIntervalInput.required = !isCron; cronExpressionInput.required = isCron; }
        function generateCronEditorUI() {
            for (const key in cronFields) {
                const { el, min, max, name, labels } = cronFields[key];
                let gridHtml = '<div class="cron-grid collapsed">';
                for (let i = min; i <= max; i++) { gridHtml += `<div><input type="checkbox" class="btn-check" id="${key}-${i}" value="${i}"><label class="btn btn-outline-primary" for="${key}-${i}">${labels ? labels[i - min] : i}</label></div>`; }
                el.innerHTML = `<div class="btn-group mb-3 w-100"><input type="radio" class="btn-check mode-selector" name="${key}-mode" id="${key}-every" value="*" checked><label class="btn btn-outline-primary" for="${key}-every">每${(labels ? '个' : '') + name}</label><input type="radio" class="btn-check mode-selector" name="${key}-mode" id="${key}-specific" value="specific"><label class="btn btn-outline-primary" for="${key}-specific">指定</label></div>` + gridHtml + '</div>';
            }
            document.querySelectorAll('.mode-selector').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    const grid = e.target.closest('.tab-pane').querySelector('.cron-grid');
                    grid.classList.toggle('collapsed', e.target.value === '*');
                });
            });
        }
        function parseCronToUI(expression) {
            const parts = expression.split(' ');
            if (parts.length !== 5) return;
            ['minutes', 'hours', 'dom', 'months', 'dow'].forEach((key, i) => {
                const part = parts[i], field = cronFields[key], grid = field.el.querySelector('.cron-grid');
                field.el.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                if (part === '*') {
                    field.el.querySelector(`#${key}-every`).checked = true;
                    grid.classList.add('collapsed');
                } else {
                    field.el.querySelector(`#${key}-specific`).checked = true;
                    grid.classList.remove('collapsed');
                    part.split(',').forEach(range => {
                        if (range.includes('-')) { const [start, end] = range.split('-').map(Number); for (let j = start; j <= end; j++) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } }
                        else if (range.includes('/')) { const [_, step] = range.split('/').map(Number); for (let j = field.min; j <= field.max; j += step) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } }
                        else { const cb = field.el.querySelector(`#${key}-${Number(range)}`); if (cb) cb.checked = true; }
                    });
                }
            });
        }
        function generateCronFromUI() { return ['minutes', 'hours', 'dom', 'months', 'dow'].map(key => { const field = cronFields[key]; if (field.el.querySelector(`input[name="${key}-mode"]:checked`).value === '*') return '*'; const selected = Array.from(field.el.querySelectorAll('.cron-grid input:checked')).map(cb => Number(cb.value)); if (selected.length === 0 || selected.length === (field.max - field.min + 1)) return '*'; selected.sort((a, b) => a - b); const ranges = []; for (let i = 0; i < selected.length; i++) { let start = selected[i]; while (i + 1 < selected.length && selected[i+1] === selected[i] + 1) i++; ranges.push(start === selected[i] ? `${start}` : `${start}-${selected[i]}`); } return ranges.join(','); }).join(' '); }
        async function loadConfigFile() { try { const { errno, stdout } = await safeExec('cat /data/media/0/Android/清理规则/配置.txt'); if (errno === 0) { const config = {}; stdout.split('\n').forEach(line => { if (line.includes('=')) { const [key, value] = line.split('=').map(item => item.trim()); if (key && value) config[key] = value; } }); retentionDaysInput.value = config.保留天数 || '30'; if (config.cron表达式 && config.cron表达式.trim() !== '') { scheduleModeCronRadio.checked = true; cronExpressionInput.value = config.cron表达式; } else { cronExpressionInput.value = '0 * * * *'; } cleanIntervalInput.value = config.程序清理间隔秒数 || '3600'; const f2fsGcValue = config['f2fs-GC'] || 'n'; f2fsGcConfigToggle.checked = f2fsGcValue === 'y'; } } catch (e) { safeToast(`加载配置失败: ${e.message}`); } updateScheduleModeUI(); }
        
        configForm.addEventListener('submit', async (e) => { e.preventDefault(); try { const { errno, stdout, stderr } = await safeExec('cat /data/media/0/Android/清理规则/配置.txt'); let lines = (errno === 0) ? stdout.split('\n') : []; if (errno !== 0 && !stderr.includes('No such file')) throw new Error(`读取配置失败: ${stderr}`); const otherLines = lines.filter(l => !/^(保留天数=|程序清理间隔秒数=|cron表达式=|f2fs-GC=)/.test(l) && l.trim() !== ''); const newConfig = [...otherLines, `保留天数=${retentionDaysInput.value}`, `f2fs-GC=${f2fsGcConfigToggle.checked ? 'y' : 'n'}`]; if (scheduleModeCronRadio.checked) { newConfig.push(`cron表达式=${cronExpressionInput.value}`, `程序清理间隔秒数=${cleanIntervalInput.value}`); } else { newConfig.push(`程序清理间隔秒数=${cleanIntervalInput.value}`, `cron表达式=${cronExpressionInput.value || '0 * * * *'}`); } const updatedConfig = newConfig.join('\n'); const { errno: writeErrno, stderr: writeStderr } = await safeExec(`printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`); if (writeErrno !== 0) throw new Error(`写入配置失败: ${writeStderr}`); safeToast('配置已保存，正在请求重启模块...'); await sendTcpCommand('restart'); safeToast('重启命令已发送'); } catch (error) { safeToast(`操作失败: ${error.message}`); } });
        document.querySelectorAll('input[name="schedule-mode"]').forEach(el => el.addEventListener('change', updateScheduleModeUI));
        document.getElementById('edit-cron-btn').addEventListener('click', () => { parseCronToUI(cronExpressionInput.value); NativeUI.openModal('cron-editor-modal'); });
        document.getElementById('save-cron-btn').addEventListener('click', () => { cronExpressionInput.value = generateCronFromUI(); NativeUI.closeModal(cronEditorModalEl); });
        
        const editRuleFile = async (fileName) => { try { const { errno, stderr } = await safeExec(`am start -a android.intent.action.VIEW -d file:///data/media/0/Android/清理规则/${fileName} -t text/plain`); if (errno !== 0) throw new Error(stderr); safeToast(`尝试打开文件: ${fileName}`); } catch (e) { safeToast(`编辑文件失败: ${e.message}`); } };
        document.getElementById('edit-blacklist1').addEventListener('click', () => editRuleFile('blacklist1.txt'));
        document.getElementById('edit-blacklist2').addEventListener('click', () => editRuleFile('blacklist2.txt'));
        document.getElementById('edit-whitelist').addEventListener('click', () => editRuleFile('whitelist.txt'));

        return async function() {
            try { const { stdout } = await safeExec(`mount | grep " /data " | awk '{print $5}'`); f2fsGcConfigContainer.style.display = (stdout.trim() === 'ext4') ? 'none' : 'flex'; } catch (e) { console.error("Failed to check file system:", e); }
            generateCronEditorUI();
            await loadConfigFile();
        };
    })();

    // --- 应用初始化 ---
    async function initializeApp() {
        generateRandomAurora();
        injectIcons();
        NativeUI.initModals();
        NativeUI.initTabs();

        if (!await checkBackendProcess()) {
            disableBackendFeatures('后端服务未运行');
        }

        await Promise.all([
            initHomePage(),
            initEditPage()
        ]);
        
        const initialPageId = window.location.hash.substring(1) || 'home';
        const initialPageIndex = Object.keys(pages).indexOf(initialPageId);
        const validPageIndex = initialPageIndex > -1 ? initialPageIndex : 0;
        const initialTranslateX = validPageIndex * -50;
        currentPageId = Object.keys(pages)[validPageIndex];

        if (pagesContainer) {
            pagesContainer.style.transition = 'none';
            pagesContainer.style.transform = `translateX(${initialTranslateX}%)`;
            void pagesContainer.offsetWidth;
            pagesContainer.style.transition = '';
        }

        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === currentPageId));
        
        finishLoading();
    }

    initializeApp();
});