import { exec, spawn, toast, listPackages, getPackagesInfo, fullScreen, enableEdgeToEdge } from 'kernelsu';
import Chart from 'chart.js/auto';
import { mdiHome, mdiPencilBoxOutline } from '@mdi/js';
fullScreen(true);
enableEdgeToEdge(true);
// 添加控制台图标
const mdiConsole = "M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L12.41,13L8.4,17H5.57L9.58,13Z";

function parseLogContent(ndjsonContent) { 
    if (!ndjsonContent || ndjsonContent.trim() === '') return []; 
    const parsedEntries = []; 
    const lines = ndjsonContent.split('\n'); 
    lines.forEach(line => { 
        if (line.trim() === '') return; 
        try { 
            const stats = JSON.parse(line); 
            if (!stats.timestamp || !stats.global_stats) return; 
            const formattedTimestamp = stats.timestamp.replace('T', ' ').replace('Z', ''); 
            const reclaimedSegments = (stats.gc_trim_stats && stats.gc_trim_stats.reclaimed_segments) ? stats.gc_trim_stats.reclaimed_segments : 0; 
            const trimmedMBValue = (stats.gc_trim_stats && stats.gc_trim_stats.trimmed_mb) ? stats.gc_trim_stats.trimmed_mb : 0; 
            const parsedEntry = { 
                timestamp: formattedTimestamp, 
                date: stats.timestamp.split('T')[0], 
                deletedFiles: stats.global_stats.files_deleted || 0, 
                deletedDirs: stats.global_stats.dirs_deleted || 0, 
                dirtySegments: reclaimedSegments, 
                fileCleanedMB: stats.global_stats.megabytes_deleted || 0, 
                trimMB: trimmedMBValue, 
                appStats: stats.app_stats || [] 
            }; 
            parsedEntries.push(parsedEntry); 
        } catch (error) { 
            console.error("解析 JSON 行失败:", error, "行内容:", line); 
        } 
    }); 
    return parsedEntries; 
}

function updateLocalStorage(newData) { 
    if (!newData || newData.length === 0) return; 
    const storedData = JSON.parse(localStorage.getItem('logData') || '[]'); 
    const dataMap = new Map(storedData.map(entry => [entry.timestamp, entry])); 
    newData.forEach(newEntry => { dataMap.set(newEntry.timestamp, newEntry); }); 
    const combinedData = Array.from(dataMap.values()); 
    const cutoffDate = new Date(); 
    cutoffDate.setDate(cutoffDate.getDate() - 6); 
    const filteredData = combinedData.filter(entry => new Date(entry.date) >= cutoffDate); 
    localStorage.setItem('logData', JSON.stringify(filteredData)); 
}

function getStoredData() { return JSON.parse(localStorage.getItem('logData') || '[]'); }
function clearStoredData() { localStorage.removeItem('logData'); }

const icons = { home: mdiHome, edit: mdiPencilBoxOutline, monitor: mdiConsole };

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
    const loader = document.getElementById('loader');
    const appWrapper = document.querySelector('.app-wrapper');
    const pagesContainer = document.querySelector('.pages-container');
    let isExt4 = false;
    let gcInfoIntervalId = null;
    let isBackendOnline = true;
    const delay = ms => new Promise(res => setTimeout(res, ms));

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

    function generateRandomAurora() {
        const baseHue = Math.floor(Math.random() * 360);
        const hues = [baseHue, (baseHue + 60) % 360, (baseHue + 180) % 360, (baseHue + 240) % 360];
        hues.forEach((hue, i) => {
            document.documentElement.style.setProperty(`--aurora-color-${i + 1}`, `hsl(${hue}, 90%, 70%)`);
        });
    }
    function injectIcons() { document.querySelectorAll('[data-icon]').forEach(el => { const iconName = el.getAttribute('data-icon'); if (icons[iconName]) el.setAttribute('d', icons[iconName]); }); }

    // 更新页面映射
    const pages = { 
        home: document.getElementById('page-home'), 
        edit: document.getElementById('page-edit'),
        monitor: document.getElementById('page-monitor')
    };
    const navItems = document.querySelectorAll('.nav-item');
    let currentPageId = 'home';
    function showPage(pageId) {
        if (pageId === currentPageId || !pagesContainer) return;
        const pageIndex = Object.keys(pages).indexOf(pageId);
        if (pageIndex === -1) return;
        // 使用 100/3% 作为三页布局的偏移量
        pagesContainer.style.transform = `translateX(${pageIndex * -(100 / 3)}%)`;
        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === pageId));
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

    function disableBackendFeatures(reason) {
        if (!isBackendOnline) return;
        isBackendOnline = false;
        toast(reason, 4000);
        document.querySelectorAll('#clean-now-btn, #refresh-log, #restart-module, #gc-control-btn, #config-form button[type="submit"]').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('disabled');
        });
        if (gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; }
        const globalGcStatusSpan = document.getElementById('global-gc-status');
        if (globalGcStatusSpan) {
            globalGcStatusSpan.textContent = '后端离线';
            globalGcStatusSpan.className = 'badge bg-danger';
        }
    }
    async function checkBackendProcess() { try { const { errno } = await exec('pgrep cleaner'); return errno === 0; } catch (e) { return false; } }
    async function sendTcpCommand(command) {
        if (!isBackendOnline) return null;
        try {
            const { errno, stdout } = await exec(`/data/adb/modules/Clean-C/tcp_client ${command}`);
            if (errno === 0) {
                if (!stdout.trim()) return [];
                try { return JSON.parse(stdout.trim()); } catch (e) { disableBackendFeatures('后端响应解析失败'); return null; }
            } else { disableBackendFeatures('后端通信失败'); return null; }
        } catch (error) { disableBackendFeatures('后端通信异常'); return null; }
    }

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
        const partitionsModalBody = document.getElementById('partitions-modal-body');
        const savePartitionsBtn = document.getElementById('save-partitions-btn');
        let partitionCharts = new Map();
        let appInfoMap = new Map(); 
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
                responsive: true, maintainAspectRatio: false,
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
        async function checkFileSystem() { try { const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`); isExt4 = (stdout.trim() === 'ext4'); f2fsGcInfoContainer.style.display = isExt4 ? 'none' : 'block'; if (isExt4 && gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; } if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); } } catch (error) { toast(`检查文件系统失败`); } }
        
        async function updateAllF2fsInfo() {
            const partitionsData = await sendTcpCommand('stats');
            if (partitionsData === null) {
                if (gcInfoIntervalId) { clearInterval(gcInfoIntervalId); gcInfoIntervalId = null; }
                return;
            }
            if (Array.isArray(partitionsData)) {
                partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name));
                customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none';
                
                let visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name));
                
                if (visiblePartitions.length > 1) {
                    visiblePartitions.sort((a, b) => b.dirty_segments - a.dirty_segments);
                    visiblePartitions = [visiblePartitions[0]];
                }

                updatePartitionCharts(visiblePartitions);
                updatePartitionGcStatus(visiblePartitions);
            }
        }

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
        async function initDatePicker() { try { const { stdout } = await exec('date +"%F"'); const today = new Date(stdout.trim()); const sixDaysAgo = new Date(today); sixDaysAgo.setDate(today.getDate() - 6); const formatDate = (d) => d.toISOString().split('T')[0]; dateSelect.min = formatDate(sixDaysAgo); dateSelect.max = dateSelect.value = formatDate(today); } catch (e) { toast(`初始化日期选择器失败`); } }
        async function loadLogFile() { try { const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json'); if (errno === 0 && stdout.trim() !== '') updateLocalStorage(parseLogContent(stdout)); else if (errno !== 0 && !stderr.includes('No such file')) throw new Error(stderr); } catch (e) { toast(`加载统计数据失败: ${e.message}`); } updateDisplaysForSelectedDate(); }
        
        async function refreshAppInfoCache(packageNames) {
            if (!packageNames || packageNames.length === 0) return;
            const unknownPackages = packageNames.filter(pkg => !appInfoMap.has(pkg));
            if (unknownPackages.length > 0) {
                try {
                    const infos = await getPackagesInfo(unknownPackages);
                    infos.forEach(info => {
                        appInfoMap.set(info.packageName, info);
                    });
                } catch (e) {
                    console.error("KernelSU getPackagesInfo 失败:", e);
                }
            }
        }

        async function updateDisplaysForSelectedDate() {
            const selectedDate = dateSelect.value;
            const storedData = getStoredData();
            const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData;
            
            const aggregatedData = {};
            const allPackagesInLog = new Set();

            filteredData.forEach(entry => {
                const date = entry.date;
                if (!aggregatedData[date]) aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0 };
                aggregatedData[date].deletedFiles += entry.deletedFiles || 0;
                aggregatedData[date].deletedDirs += entry.deletedDirs || 0;
                aggregatedData[date].dirtySegments += entry.dirtySegments || 0;
                aggregatedData[date].fileCleanedMB += entry.fileCleanedMB || 0;
                entry.appStats?.forEach(app => allPackagesInLog.add(app.package_name));
            });

            refreshAppInfoCache(Array.from(allPackagesInLog)).then(() => {
                if (dateSelect.value === selectedDate) renderAppStatsList(selectedDate);
            });

            barChart.data.datasets.forEach(ds => { if (ds.label.includes('脏段')) ds.hidden = isExt4; });
            const dates = Object.keys(aggregatedData).sort();
            barChart.data.labels = dates;
            barChart.data.datasets[0].data = dates.map(d => aggregatedData[d].fileCleanedMB);
            barChart.data.datasets[1].data = dates.map(d => aggregatedData[d].dirtySegments);
            barChart.data.datasets[2].data = dates.map(d => aggregatedData[d].deletedFiles);
            barChart.data.datasets[3].data = dates.map(d => aggregatedData[d].deletedDirs);
            barChart.update('none');
            
            renderAppStatsList(selectedDate);
        }

        function renderAppStatsList(selectedDate) {
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
                appStatsContainer.style.display = 'none';
                return;
            }
            appStatsContainer.style.display = 'flex';
            appStatsContainer.style.visibility = 'visible';
            appStatsContainer.style.opacity = '1';
            appStatsContainer.style.maxHeight = '500px';
            
            appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted).forEach(app => {
                const info = appInfoMap.get(app.package_name);
                const displayName = info ? info.appLabel : app.package_name;
                const iconUrl = `ksu://icon/${app.package_name}`;
                
                appStatsList.innerHTML += `
                    <li class="list-group-item d-flex align-items-center">
                        <img src="${iconUrl}" class="app-icon me-2" style="width:24px;height:24px;border-radius:4px;object-fit:cover;" onerror="this.style.display='none'">
                        <div class="app-name text-truncate flex-grow-1" title="${app.package_name}">${displayName}</div>
                        <div class="app-size badge bg-primary rounded-pill ms-2">${app.megabytes_deleted.toFixed(2)} MB</div>
                    </li>`;
            });
        }
        
        dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        document.getElementById('clear-data').addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); toast('数据已清除'); });
        gcControlButton.addEventListener('click', async () => { const action = gcControlButton.dataset.action; if (action === 'unknown') return; gcControlButton.disabled = true; gcControlButton.textContent = '...'; await sendTcpCommand(action === 'start' ? 'start_gc' : 'stop_gc'); await delay(1500); gcControlButton.disabled = false; await updateAllF2fsInfo(); });
        document.getElementById('clean-now-btn').addEventListener('click', async () => { toast('正在请求立即清理...'); await sendTcpCommand('clean_now'); });
        document.getElementById('refresh-log').addEventListener('click', async () => { toast('正在手动刷新...'); if (!isExt4 && !gcInfoIntervalId && isBackendOnline) { gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); toast('已重新启动自动刷新'); } await loadLogFile(); if (!isExt4) await updateAllF2fsInfo(); toast('数据已刷新'); });
        document.getElementById('delete-log').addEventListener('click', async () => { try { await exec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json'); await loadLogFile(); toast('日志文件已删除'); } catch (e) { toast(`删除日志失败: ${e.message}`); } });
        document.getElementById('restart-module').addEventListener('click', async () => { toast('正在请求重启模块...'); await sendTcpCommand('restart'); toast('重启命令已发送'); });
        customizePartitionsBtn.addEventListener('click', () => { partitionsModalBody.innerHTML = ''; Array.from(allDiscoveredPartitions).sort().forEach(deviceName => { partitionsModalBody.innerHTML += `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="switch-${deviceName}" data-device-name="${deviceName}" ${!hiddenPartitions.has(deviceName) ? 'checked' : ''}><label class="form-check-label" for="switch-${deviceName}">${deviceName}</label></div>`; }); NativeUI.openModal('partitions-modal'); });
        savePartitionsBtn.addEventListener('click', () => { const newHidden = new Set(); partitionsModalBody.querySelectorAll('.form-check-input').forEach(cb => { if (!cb.checked) newHidden.add(cb.dataset.deviceName); }); hiddenPartitions = newHidden; localStorage.setItem('hiddenF2fsPartitions', JSON.stringify(Array.from(hiddenPartitions))); NativeUI.closeModal('partitions-modal'); toast('显示偏好已保存'); updateAllF2fsInfo(); });

        return async function() {
            await checkFileSystem();
            await initDatePicker();
            
            try {
                const userPkgs = await listPackages("user");
                const infos = await getPackagesInfo(userPkgs);
                infos.forEach(info => appInfoMap.set(info.packageName, info));
            } catch (e) {
                console.error("初始化应用列表失败:", e);
            }

            await loadLogFile();
            if (!isExt4) await updateAllF2fsInfo();
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateChartTheme);
        };
    })();

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
        async function loadConfigFile() { try { const { errno, stdout } = await exec('cat /data/media/0/Android/清理规则/配置.txt'); if (errno === 0) { const config = {}; stdout.split('\n').forEach(line => { if (line.includes('=')) { const [key, value] = line.split('=').map(item => item.trim()); if (key && value) config[key] = value; } }); retentionDaysInput.value = config.保留天数 || '30'; if (config.cron表达式 && config.cron表达式.trim() !== '') { scheduleModeCronRadio.checked = true; cronExpressionInput.value = config.cron表达式; } else { cronExpressionInput.value = '0 * * * *'; } cleanIntervalInput.value = config.程序清理间隔秒数 || '3600'; const f2fsGcValue = config['f2fs-GC'] || 'n'; f2fsGcConfigToggle.checked = f2fsGcValue === 'y'; } } catch (e) { toast(`加载配置失败: ${e.message}`); } updateScheduleModeUI(); }
        
        configForm.addEventListener('submit', async (e) => { e.preventDefault(); try { const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt'); let lines = (errno === 0) ? stdout.split('\n') : []; if (errno !== 0 && !stderr.includes('No such file')) throw new Error(`读取配置失败: ${stderr}`); const otherLines = lines.filter(l => !/^(保留天数=|程序清理间隔秒数=|cron表达式=|f2fs-GC=)/.test(l) && l.trim() !== ''); const newConfig = [...otherLines, `保留天数=${retentionDaysInput.value}`, `f2fs-GC=${f2fsGcConfigToggle.checked ? 'y' : 'n'}`]; if (scheduleModeCronRadio.checked) { newConfig.push(`cron表达式=${cronExpressionInput.value}`, `程序清理间隔秒数=${cleanIntervalInput.value}`); } else { newConfig.push(`程序清理间隔秒数=${cleanIntervalInput.value}`, `cron表达式=${cronExpressionInput.value || '0 * * * *'}`); } const updatedConfig = newConfig.join('\n'); const { errno: writeErrno, stderr: writeStderr } = await exec(`printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`); if (writeErrno !== 0) throw new Error(`写入配置失败: ${writeStderr}`); toast('配置已保存，正在请求重启模块...'); await sendTcpCommand('restart'); toast('重启命令已发送'); } catch (error) { toast(`操作失败: ${error.message}`); } });
        document.querySelectorAll('input[name="schedule-mode"]').forEach(el => el.addEventListener('change', updateScheduleModeUI));
        document.getElementById('edit-cron-btn').addEventListener('click', () => { parseCronToUI(cronExpressionInput.value); NativeUI.openModal('cron-editor-modal'); });
        document.getElementById('save-cron-btn').addEventListener('click', () => { cronExpressionInput.value = generateCronFromUI(); NativeUI.closeModal(cronEditorModalEl); });
        
        const editRuleFile = async (fileName) => { try { const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file:///data/media/0/Android/清理规则/${fileName} -t text/plain`); if (errno !== 0) throw new Error(stderr); toast(`尝试打开文件: ${fileName}`); } catch (e) { toast(`编辑文件失败: ${e.message}`); } };
        document.getElementById('edit-blacklist1').addEventListener('click', () => editRuleFile('blacklist1.txt'));
        document.getElementById('edit-blacklist2').addEventListener('click', () => editRuleFile('blacklist2.txt'));
        document.getElementById('edit-whitelist').addEventListener('click', () => editRuleFile('whitelist.txt'));

        return async function() {
            try { const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`); f2fsGcConfigContainer.style.display = (stdout.trim() === 'ext4') ? 'none' : 'flex'; } catch (e) { console.error("Failed to check file system:", e); }
            generateCronEditorUI();
            await loadConfigFile();
        };
    })();

    const initMonitorPage = (() => {
        const pkgSearch = document.getElementById('monitor-pkg-search');
        const pkgSelect = document.getElementById('monitor-pkg-select');
        const startBtn = document.getElementById('start-monitor-btn');
        const stopBtn = document.getElementById('stop-monitor-btn');
        const logOutput = document.getElementById('monitor-log-output');
        const filterHitsToggle = document.getElementById('filter-hits-only');
        const clearMonitorBtn = document.getElementById('clear-monitor-log');
        
        let tailProcess = null;
        let readingLogs = false;
        let allAppInfos = [];
        let activeRules = [];

        async function populatePackages() {
            try {
                const pkgs = await listPackages("user");
                allAppInfos = await getPackagesInfo(pkgs);
                allAppInfos.sort((a, b) => a.appLabel.localeCompare(b.appLabel));
                renderAppOptions(allAppInfos);
            } catch (e) {
                console.error("加载监控应用列表失败:", e);
            }
        }

        function renderAppOptions(infos) {
            pkgSelect.innerHTML = '<option value="" disabled selected>选择应用...</option>';
            infos.forEach(info => {
                const opt = document.createElement('option');
                opt.value = info.packageName;
                opt.textContent = `${info.appLabel} (${info.packageName})`;
                pkgSelect.appendChild(opt);
            });
        }

        // 应用搜索过滤
        pkgSearch.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const filtered = allAppInfos.filter(info => 
                info.appLabel.toLowerCase().includes(val) || 
                info.packageName.toLowerCase().includes(val)
            );
            renderAppOptions(filtered);
        });

        async function getRules() {
            let rules = [];
            try {
                const [b1, b2] = await Promise.all([
                    exec('cat /data/media/0/Android/清理规则/blacklist1.txt'),
                    exec('cat /data/media/0/Android/清理规则/blacklist2.txt')
                ]);
                if(b1.errno === 0) rules.push(...b1.stdout.split('\n'));
                if(b2.errno === 0) rules.push(...b2.stdout.split('\n'));
                rules = rules.map(r => r.trim()).filter(r => r && !r.startsWith('#') && !r.startsWith('//') && !r.includes('*')); 
            } catch (e) { console.error("获取规则失败", e); }
            return rules;
        }

        function appendLogLine(line) {
            if (!line.trim()) return;
            const isHit = activeRules.some(r => line.includes(r));
            
            // 过滤：如果开启了“仅显示命中”且当前行未命中，则跳过
            if (filterHitsToggle.checked && !isHit) return;

            const div = document.createElement('div');
            div.textContent = line;
            if (isHit) div.className = 'text-highlight';
            
            logOutput.appendChild(div);
            logOutput.scrollTop = logOutput.scrollHeight;
        }

        // 加载历史日志
        async function loadHistoricalLogs() {
            try {
                const { errno, stdout } = await exec('cat /dev/fuse-app/io.log');
                if (errno === 0 && stdout) {
                    logOutput.innerHTML += '<div class="text-info">--- 历史日志开始 ---</div>';
                    stdout.split('\n').forEach(appendLogLine);
                    logOutput.innerHTML += '<div class="text-info">--- 历史日志结束 ---</div>';
                }
            } catch (e) { console.log("无历史日志或读取失败"); }
        }

        startBtn.addEventListener('click', async () => {
            const pkg = pkgSelect.value;
            if (!pkg) return toast('未选择应用');
            
            startBtn.disabled = true;
            stopBtn.disabled = false;
            logOutput.innerHTML = '<div class="text-info">正在准备环境...</div>';
            
            activeRules = await getRules();
            await loadHistoricalLogs();
            
            readingLogs = true;

            try {
                await exec(`mkdir -p /cache/fuse/ && cp /data/adb/modules/Clean-C/injector /cache/fuse/ && cp /data/adb/modules/Clean-C/fuse_daemon /cache/fuse/ && chmod 777 /cache/fuse/*`);
                await exec(`/cache/fuse/injector "${pkg}"`);
                await exec(`monkey -p ${pkg} 1`);
                
                tailProcess = spawn('tail', ['-f', '/dev/fuse-app/io.log']);
                let buffer = '';
                tailProcess.stdout.on('data', (data) => {
                    if (!readingLogs) return;
                    buffer += data;
                    let lines = buffer.split('\n');
                    buffer = lines.pop();
                    lines.forEach(appendLogLine);
                });
            } catch (e) {
                toast('启动失败: ' + e.message);
                stopMonitor();
            }
        });

        async function stopMonitor() {
            readingLogs = false;
            const pkg = pkgSelect.value;
            if (tailProcess) {
                await exec(`pkill -f "tail -f /dev/fuse-app/io.log"`);
                tailProcess = null;
            }
            // 杀死目标应用
            if (pkg) await exec(`am force-stop ${pkg}`);
            
            await exec(`rm -r /cache/fuse/`);
            logOutput.innerHTML += `<div class="text-info">[系统] 监控已停止，应用已关闭。</div>`;
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }

        stopBtn.addEventListener('click', stopMonitor);
        clearMonitorBtn.addEventListener('click', () => { logOutput.innerHTML = ''; });

        return async function() {
            await populatePackages();
            activeRules = await getRules(); // 预加载规则
        };
    })();


    try {
        generateRandomAurora();
        injectIcons();
        NativeUI.initModals();
        NativeUI.initTabs();

        if (!await checkBackendProcess()) {
            disableBackendFeatures('后端服务未运行');
        }
        await initHomePage();
        await initEditPage();
        await initMonitorPage();
        
        const initialPageId = window.location.hash.substring(1) || 'home';
        const initialPageIndex = Object.keys(pages).indexOf(initialPageId);
        const validPageIndex = initialPageIndex > -1 ? initialPageIndex : 0;
        const initialTranslateX = validPageIndex * -(100 / 3);
        currentPageId = Object.keys(pages)[validPageIndex];

        if (pagesContainer) {
            pagesContainer.style.transition = 'none';
            pagesContainer.style.transform = `translateX(${initialTranslateX}%)`;
            void pagesContainer.offsetWidth;
            pagesContainer.style.transition = '';
        }
        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === currentPageId));
    } catch (error) {
        console.error("初始化失败:", error);
        toast("应用初始化失败，请检查日志。", 5000);
    } finally {
        finishLoading();
    }
});