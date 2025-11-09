import { exec, toast } from 'kernelsu';
import { parseLogContent, updateLocalStorage, getStoredData, clearStoredData } from './logParser.js';
import { Ripple, Modal, initMDB } from 'mdb-ui-kit';
import Chart from 'chart.js/auto';

initMDB({ Ripple });

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM 元素获取 ---
    const globalGcStatusSpan = document.getElementById('global-gc-status');
    const dateSelect = document.getElementById('date-select');
    const appStatsList = document.getElementById('app-stats-list');
    const appStatsContainer = document.getElementById('app-stats-container');
    const appStatsTitle = document.getElementById('app-stats-title');
    const f2fsGcInfoContainer = document.getElementById('f2fs-gc-info-container');
    const gcControlButton = document.getElementById('gc-control-btn');
    const f2fsGcConfigContainer = document.getElementById('f2fs-gc-config-container');
    const f2fsChartsContainer = document.getElementById('f2fs-charts-container');
    const partitionGcStatusContainer = document.getElementById('partition-gc-status-container');
    const customizePartitionsBtn = document.getElementById('customize-partitions-btn');
    const partitionsModalEl = document.getElementById('partitions-modal');
    const partitionsModal = Modal.getInstance(partitionsModalEl) || new Modal(partitionsModalEl);
    const partitionsModalBody = document.getElementById('partitions-modal-body');
    const savePartitionsBtn = document.getElementById('save-partitions-btn');
    const refreshLogBtn = document.getElementById('refresh-log');
    const deleteLogBtn = document.getElementById('delete-log');
    const clearDataBtn = document.getElementById('clear-data');
    const restartModuleBtn = document.getElementById('restart-module');
    const cleanNowBtn = document.getElementById('clean-now-btn');

    // --- 状态变量 ---
    let isExt4 = false;
    let gcInfoIntervalId = null;
    let partitionCharts = new Map();
    let appNamesMap = new Map();
    let allDiscoveredPartitions = new Set();
    let hiddenPartitions = new Set(JSON.parse(localStorage.getItem('hiddenF2fsPartitions') || '[]'));
    let consecutiveErrors = 0; // 新增：用于记录连续错误次数

    // --- 辅助函数 ---
    const delay = ms => new Promise(res => setTimeout(res, ms));

    function formatDuration(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return "0s";
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m ${totalSeconds % 60}s`;
    }

    async function sendTcpCommand(command) {
        try {
            const clientPath = '/data/adb/modules/Clean-C/tcp_client';
            const fullCommand = `${clientPath} ${command}`;
            const { errno, stdout, stderr } = await exec(fullCommand);
            if (errno === 0) {
                consecutiveErrors = 0; // 成功后重置错误计数器
                if (!stdout.trim()) return [];
                try { 
                    const result = JSON.parse(stdout.trim());
                    return Array.isArray(result) ? result : [];
                } catch (e) {
                    toast(`解析服务器响应失败`);
                    return null;
                }
            } else {
                consecutiveErrors++; // 失败时增加错误计数器
                toast(`命令发送失败`);
                return null;
            }
        } catch (error) {
            consecutiveErrors++;
            toast(`执行命令发送程序失败`);
            return null;
        }
    }

    async function getGcStatusViaTcp() { return await sendTcpCommand('stats'); }

    async function loadAppNamesConfig() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/list.config');
            if (errno === 0) {
                stdout.split('\n').forEach(line => {
                    if (line.includes('=')) {
                        const [pkg, name] = line.split('=').map(item => item.trim());
                        if (pkg && name) appNamesMap.set(pkg, name);
                    }
                });
            } else if (!stderr.includes('No such file or directory')) console.error("Failed to load list.config:", stderr);
        } catch (error) { console.error("An exception occurred while loading list.config:", error); }
    }

    // --- F2FS 信息获取与更新 ---
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
        const partitionsData = await getGcStatusViaTcp();

        // 错误处理：如果获取数据失败
        if (partitionsData === null) {
            if (consecutiveErrors >= 3 && gcInfoIntervalId) {
                clearInterval(gcInfoIntervalId);
                gcInfoIntervalId = null;
                toast('无法连接后端，已停止自动刷新。请手动刷新。');
                globalGcStatusSpan.textContent = '连接失败';
                globalGcStatusSpan.className = 'badge bg-danger';
            }
            return;
        }

        if (Array.isArray(partitionsData)) {
            partitionsData.forEach(p => allDiscoveredPartitions.add(p.device_name));
            customizePartitionsBtn.style.display = allDiscoveredPartitions.size >= 2 ? 'block' : 'none';
            const visiblePartitions = partitionsData.filter(p => !hiddenPartitions.has(p.device_name));
            updatePartitionCharts(visiblePartitions);
            updatePartitionGcStatus(visiblePartitions);
        }
    }
    
    function updatePartitionCharts(partitionsData) {
        const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
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
                const canvasContainer = document.createElement('div');
                canvasContainer.className = 'partition-chart-canvas-container';
                const canvas = document.createElement('canvas');
                canvasContainer.appendChild(canvas);
                const label = document.createElement('p');
                label.className = 'partition-chart-label';
                label.textContent = device_name;
                wrapper.appendChild(canvasContainer);
                wrapper.appendChild(label);
                f2fsChartsContainer.appendChild(wrapper);
                const newChart = new Chart(canvas.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: [`脏段 (${dirty_segments})`, `空闲段 (${free_segments})`],
                        datasets: [{ data: [dirty_segments, free_segments], backgroundColor: ['#ff6384', '#36a2eb'], borderColor: isDarkMode ? '#2A2A2A' : '#f8f9fa' }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
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

    function updatePartitionGcStatus(gcStatusArray) {
        if (isExt4) return;

        partitionGcStatusContainer.innerHTML = '';
        const runningPartitions = gcStatusArray.filter(p => p.is_running && !hiddenPartitions.has(p.device_name));
        const anyGcRunning = runningPartitions.length > 0;

        if (anyGcRunning) {
            globalGcStatusSpan.style.display = 'none';
            partitionGcStatusContainer.style.display = 'flex';

            runningPartitions.forEach(status => {
                const { device_name, is_paused, elapsed_seconds, reclaimed_segments, pause_reason } = status;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'partition-gc-status-item';
                const deviceNameP = document.createElement('p');
                deviceNameP.textContent = device_name;
                itemDiv.appendChild(deviceNameP);
                const statusBadge = document.createElement('span');
                statusBadge.className = 'badge';
                const formattedTime = formatDuration(elapsed_seconds || 0);
                const reclaimed = reclaimed_segments || 0;
                if (is_paused) {
                    statusBadge.innerHTML = `暂停<br>原因: ${pause_reason || "未知"}<br>运行: ${formattedTime} | 回收: ${reclaimed}`;
                    statusBadge.classList.add('bg-warning');
                } else {
                    statusBadge.innerHTML = `运行中<br>运行: ${formattedTime} | 回收: ${reclaimed}`;
                    statusBadge.classList.add('bg-success');
                }
                itemDiv.appendChild(statusBadge);
                partitionGcStatusContainer.appendChild(itemDiv);
            });

            gcControlButton.textContent = '停止所有';
            gcControlButton.className = 'btn btn-sm btn-danger';
            gcControlButton.dataset.action = 'stop';
        } else {
            partitionGcStatusContainer.style.display = 'none';
            globalGcStatusSpan.style.display = 'inline-block';
            globalGcStatusSpan.textContent = 'GC回收: 关闭';
            globalGcStatusSpan.className = 'badge bg-secondary';
            gcControlButton.textContent = '开始所有';
            gcControlButton.className = 'btn btn-sm btn-success';
            gcControlButton.dataset.action = 'start';
        }
    }

    // --- 自定义分区显示模态框逻辑 ---
    customizePartitionsBtn.addEventListener('click', () => {
        partitionsModalBody.innerHTML = '';
        Array.from(allDiscoveredPartitions).sort().forEach(deviceName => {
            const isHidden = hiddenPartitions.has(deviceName);
            const formCheck = document.createElement('div');
            formCheck.className = 'form-check form-switch';
            formCheck.innerHTML = `
                <input class="form-check-input" type="checkbox" role="switch" id="switch-${deviceName}" data-device-name="${deviceName}" ${!isHidden ? 'checked' : ''}>
                <label class="form-check-label" for="switch-${deviceName}">${deviceName}</label>
            `;
            partitionsModalBody.appendChild(formCheck);
        });
        partitionsModal.show();
    });

    savePartitionsBtn.addEventListener('click', () => {
        const newHiddenPartitions = new Set();
        partitionsModalBody.querySelectorAll('.form-check-input').forEach(checkbox => {
            if (!checkbox.checked) {
                newHiddenPartitions.add(checkbox.dataset.deviceName);
            }
        });
        hiddenPartitions = newHiddenPartitions;
        localStorage.setItem('hiddenF2fsPartitions', JSON.stringify(Array.from(hiddenPartitions)));
        partitionsModal.hide();
        toast('显示偏好已保存');
        updateAllF2fsInfo();
    });

    // --- 图表初始化与更新 ---
    const barChartCtx = document.getElementById('bar-chart').getContext('2d');
    const barChart = new Chart(barChartCtx, {
        type: 'bar', data: { labels: [], datasets: [ { label: '文件清理 (MB)', backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }, { label: 'GC TRIM (MB)', backgroundColor: 'rgba(255, 159, 64, 0.2)', borderColor: 'rgba(255, 159, 64, 1)', borderWidth: 1, hidden: isExt4 }, { label: '回收脏段数', backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1, hidden: isExt4 }, { label: '已删除文件数', backgroundColor: 'rgba(255, 99, 132, 0.2)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }, { label: '已删除目录数', backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }, ] },
        options: { scales: { y: { beginAtZero: true } } },
    });

    // --- 日期选择器和日志数据处理 ---
    async function initDatePicker() {
        try {
            const { errno, stdout } = await exec('date +"%F"');
            if (errno !== 0) throw new Error('无法获取当前日期');
            const today = new Date(stdout.trim());
            const sixDaysAgo = new Date(today);
            sixDaysAgo.setDate(today.getDate() - 6);
            const formatDate = (d) => d.toISOString().split('T')[0];
            dateSelect.min = formatDate(sixDaysAgo);
            dateSelect.max = dateSelect.value = formatDate(today);
            dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        } catch (error) { toast(`初始化日期选择器失败: ${error.message}`); }
    }

    async function loadLogFile() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json');
            if (errno === 0 && stdout.trim() !== '') updateLocalStorage(parseLogContent(stdout));
            else if (errno !== 0 && !stderr.includes('No such file or directory')) throw new Error(`读取统计文件失败: ${stderr}`);
        } catch (error) { toast(`加载统计数据失败: ${error.message}`); }
        updateDisplaysForSelectedDate();
    }

    function aggregateAppStatsForDate(selectedDate) {
        const dailyEntries = getStoredData().filter(entry => entry.date === selectedDate);
        const aggregatedStats = new Map();
        dailyEntries.forEach(entry => entry.appStats?.forEach(app => {
            const existing = aggregatedStats.get(app.package_name) || { ...app, bytes_deleted: 0, megabytes_deleted: 0 };
            existing.bytes_deleted += app.bytes_deleted;
            existing.megabytes_deleted += app.megabytes_deleted;
            aggregatedStats.set(app.package_name, existing);
        }));
        return Array.from(aggregatedStats.values());
    }

    function updateAppStatsList(appStats) {
        appStatsList.innerHTML = '';
        appStatsContainer.classList.toggle('hidden', !appStats || appStats.length === 0);
        if (!appStats || appStats.length === 0) {
            appStatsList.innerHTML = '<li class="list-group-item text-muted">该日无应用数据清理记录。</li>';
            return;
        }
        appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted).forEach(app => {
            const displayName = appNamesMap.get(app.package_name) || app.package_name;
            appStatsList.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center"><span class="text-truncate me-3" title="${app.package_name}">${displayName}</span><span class="badge bg-primary rounded-pill">${app.megabytes_deleted.toFixed(2)} MB</span></li>`;
        });
    }

    function updateBarChart() {
        const storedData = getStoredData();
        const selectedDate = dateSelect.value;
        const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData;
        const aggregatedData = {};
        filteredData.forEach(entry => {
            const date = entry.date;
            if (!aggregatedData[date]) aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0, trimMB: 0 };
            Object.keys(aggregatedData[date]).forEach(key => aggregatedData[date][key] += entry[key] || 0);
        });
        barChart.data.datasets.forEach(ds => { if (ds.label.includes('GC') || ds.label.includes('脏段')) ds.hidden = isExt4; });
        const dates = Object.keys(aggregatedData).sort();
        barChart.data.labels = dates;
        barChart.data.datasets[0].data = dates.map(d => aggregatedData[d].fileCleanedMB);
        barChart.data.datasets[1].data = dates.map(d => aggregatedData[d].trimMB);
        barChart.data.datasets[2].data = dates.map(d => aggregatedData[d].dirtySegments);
        barChart.data.datasets[3].data = dates.map(d => aggregatedData[d].deletedFiles);
        barChart.data.datasets[4].data = dates.map(d => aggregatedData[d].deletedDirs);
        barChart.update('none');
    }

    function updateDisplaysForSelectedDate() {
        const selectedDate = dateSelect.value;
        updateBarChart();
        appStatsTitle.textContent = `应用清理详情 (${selectedDate})`;
        updateAppStatsList(aggregateAppStatsForDate(selectedDate));
    }

    // --- 事件监听器 ---
    clearDataBtn.addEventListener('click', () => { clearStoredData(); updateDisplaysForSelectedDate(); toast('数据已清除'); });
    gcControlButton.addEventListener('click', async () => {
        const action = gcControlButton.dataset.action;
        if (action === 'unknown') { toast('无法确定GC状态，请刷新。'); return; }
        gcControlButton.disabled = true; gcControlButton.textContent = '...';
        await sendTcpCommand(action === 'start' ? 'start_gc' : 'stop_gc');
        await delay(1500);
        gcControlButton.disabled = false;
        await updateAllF2fsInfo();
    });
    cleanNowBtn.addEventListener('click', async () => { toast('正在请求立即清理...'); await sendTcpCommand('clean_now'); });
    refreshLogBtn.addEventListener('click', async () => {
        toast('正在手动刷新...');
        // 如果自动刷新已停止，重新启动它
        if (!isExt4 && !gcInfoIntervalId) {
            gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000);
            toast('已重新启动自动刷新');
        }
        await loadLogFile();
        if (!isExt4) await updateAllF2fsInfo();
        toast('数据已刷新');
    });
    deleteLogBtn.addEventListener('click', async () => { try { await exec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json'); await loadLogFile(); toast('日志文件已删除'); } catch (error) { toast(`删除日志失败: ${error.message}`); } });
    restartModuleBtn.addEventListener('click', async () => { try { const { errno, stderr } = await exec('sh /data/adb/modules/Clean-C/rest.sh'); if (errno === 0) toast('模块已重启'); else toast(`重启模块失败: ${stderr || '未知错误'}`); } catch (error) { toast(`模块重启失败: ${error.message}`); } });

    // --- 页面初始化 ---
    await checkFileSystem();
    await initDatePicker();
    await loadAppNamesConfig();
    await loadLogFile();
    if (!isExt4) await updateAllF2fsInfo();
});