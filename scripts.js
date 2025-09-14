// scripts.js

// 重要提示：为了让涟漪效果 (Ripple) 正常工作，
// 你的 PostCSS/PurgeCSS 配置 (.postcssrc.js) 必须将相关样式加入安全列表。
// 示例:
// safelist: {
//   greedy: [/^ripple/],
//   keyframes: ['ripple-wave'],
// }

import { exec, toast } from 'kernelsu';
import { parseLogContent, updateLocalStorage, getStoredData, clearStoredData } from './logParser.js';
// MDB 会通过 data-* 属性自动初始化，我们只需要导入模块即可。
import 'mdb-ui-kit/js/mdb.es.min.js';
import Chart from 'chart.js/auto';

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM 元素获取 ---
    const configForm = document.getElementById('config-form');
    const retentionDaysInput = document.getElementById('retention-days');
    const cleanIntervalInput = document.getElementById('clean-interval');
    const editBlacklist1Btn = document.getElementById('edit-blacklist1');
    const editBlacklist2Btn = document.getElementById('edit-blacklist2');
    const editWhitelistBtn = document.getElementById('edit-whitelist');
    const refreshLogBtn = document.getElementById('refresh-log');
    const deleteLogBtn = document.getElementById('delete-log');
    const clearDataBtn = document.getElementById('clear-data');
    const restartModuleBtn = document.getElementById('restart-module');
    const gcStatusSpan = document.getElementById('gc-status');
    const dateSelect = document.getElementById('date-select');
    const appStatsList = document.getElementById('app-stats-list');
    const appStatsTitle = document.getElementById('app-stats-title');
    const f2fsGcInfoContainer = document.getElementById('f2fs-gc-info-container');
    const gcControlButton = document.getElementById('gc-control-btn');
    const f2fsGcConfigContainer = document.getElementById('f2fs-gc-config-container');
    const f2fsGcConfigToggle = document.getElementById('f2fs-gc-config-toggle');
    const f2fsGcConfigToggleLabel = document.getElementById('f2fs-gc-config-toggle-label');
    const cleanNowBtn = document.getElementById('clean-now-btn');

    // --- 状态变量 ---
    let isExt4 = false;
    let gcInfoIntervalId = null;
    let lastChartData = { dirty: -1, free: -1 };
    let appNamesMap = new Map();

    // --- 辅助函数 ---
    const delay = ms => new Promise(res => setTimeout(res, ms));

    /**
     * 通过执行 tcp_client 程序发送命令
     * @param {string} command 要发送的命令名称
     * @returns {Promise<object|null>} 如果有 JSON 响应则返回解析后的对象，否则返回 null
     */
    async function sendTcpCommand(command) {
        try {
            const clientPath = '/data/adb/modules/Clean-C/bin/tcp_client';
            const fullCommand = `${clientPath} ${command}`;
            const { errno, stdout, stderr } = await exec(fullCommand);

            if (errno === 0) {
                if (!stdout.trim()) {
                    console.warn(`TCP Command '${command}' sent, but received no response content.`); // 添加 console 输出
                    toast(`命令 '${command}' 已发送，无响应内容。`);
                    return { status: "ok", message: "no content" };
                }
                try {
                    return JSON.parse(stdout.trim());
                } catch (jsonError) {
                    console.error(`Failed to parse TCP server response for command '${command}':`, jsonError, `Original response: ${stdout.trim()}`); // 添加 console 输出
                    toast(`解析服务器响应失败: ${stdout.trim()}`);
                    return null;
                }
            } else {
                console.error(`TCP Command '${command}' failed with error code ${errno}: ${stderr || 'Unknown error'}`); // 添加 console 输出
                toast(`发送命令失败: ${stderr || '未知错误'}`);
                return null;
            }
        } catch (error) {
            console.error(`Execution of tcp_client failed for command '${command}':`, error.message); // 添加 console 输出
            toast(`执行命令发送程序失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 通过 TCP 获取 GC 状态
     * @returns {Promise<object|null>} 返回解析后的 GC 状态 JSON 对象，失败返回 null
     */
    async function getGcStatusViaTcp() {
        const response = await sendTcpCommand('stats'); // 统一使用 'stats' 命令
        return response;
    }

    /**
     * 加载并解析应用名称配置文件 list.config
     */
    async function loadAppNamesConfig() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/list.config');
            if (errno !== 0 && !stderr.includes('No such file or directory')) { // 仅在非文件不存在的错误时打印
                console.error("Failed to load list.config:", stderr); // 添加 console 输出
            }
            if (errno === 0) {
                const lines = stdout.split('\n');
                lines.forEach(line => {
                    if (line.includes('=')) {
                        const [pkg, name] = line.split('=').map(item => item.trim());
                        if (pkg && name) {
                            appNamesMap.set(pkg, name);
                        }
                    }
                });
            }
        } catch (error) {
            console.error("An exception occurred while loading list.config:", error); // 添加 console 输出
        }
    }

    // --- F2FS 信息获取与更新 ---
    async function getF2fsSegmentsInfoForChart() {
        try {
            const command = `
                DATA_DEVICE=$(getprop dev.mnt.dev.data)
                if [ -z "$DATA_DEVICE" ]; then exit 1; fi
                SYSFS_PATH="/sys/fs/f2fs/$DATA_DEVICE"
                if [ ! -d "$SYSFS_PATH" ]; then SYSFS_PATH="/sys/fs/mifs/$DATA_DEVICE"; fi
                if [ ! -d "$SYSFS_PATH" ]; then exit 1; fi
                cat "$SYSFS_PATH/dirty_segments"
                echo "---SPLIT---"
                cat "$SYSFS_PATH/free_segments"
            `;
            const { errno, stdout } = await exec(command);
            if (errno === 0) {
                const parts = stdout.split('---SPLIT---');
                return {
                    dirty_segments: parts[0]?.trim(),
                    free_segments: parts[1]?.trim(),
                };
            } else {
                console.warn(`Failed to get F2FS segment info (exec errno: ${errno}): ${stdout.trim() || 'No output'} ${stderr.trim() || 'No stderr'}`); // 添加 console 输出
            }
        } catch (e) {
            console.warn("An exception occurred while getting F2FS segment info:", e); // 添加 console 输出
        }
        return null;
    }

    async function checkFileSystem() {
        try {
            const { errno, stdout, stderr } = await exec(`mount | grep " /data " | awk '{print $5}'`);
            isExt4 = (errno !== 0 || stdout.trim() === 'ext4');

            if (isExt4) {
                if (f2fsGcInfoContainer) f2fsGcInfoContainer.style.display = 'none';
                if (f2fsGcConfigContainer) f2fsGcConfigContainer.style.display = 'none';
                if (gcInfoIntervalId) {
                    clearInterval(gcInfoIntervalId);
                    gcInfoIntervalId = null;
                }
            } else {
                if (f2fsGcInfoContainer) f2fsGcInfoContainer.style.display = 'block';
                if (f2fsGcConfigContainer) f2fsGcConfigContainer.style.display = 'block';
                if (!gcInfoIntervalId) {
                    gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000); // 2秒更新一次，避免过于频繁
                }
            }
        } catch (error) {
            console.error("Failed to check file system:", error); // 添加 console 输出
            toast(`检查文件系统失败: ${error.message}`);
        }
    }

    async function updateAllF2fsInfo() {
        const segmentInfo = await getF2fsSegmentsInfoForChart();
        const statusInfo = await getGcStatusViaTcp();

        if (segmentInfo) {
            updateSegmentChart(segmentInfo);
        }
        updateGcStatusAndControls(statusInfo); // 总是更新，即使 statusInfo 为 null
    }
    
    function updateSegmentChart(info) {
        if (isExt4 || !info) return;
        const dirty = parseInt(info.dirty_segments, 10);
        const free = parseInt(info.free_segments, 10);
        if (isNaN(dirty) || isNaN(free)) return;

        if (dirty !== lastChartData.dirty || free !== lastChartData.free) {
            segmentChart.data.labels = [`脏段 (${dirty})`, `空闲段 (${free})`];
            segmentChart.data.datasets[0].data = [dirty, free];
            segmentChart.update('none');
            lastChartData.dirty = dirty;
            lastChartData.free = free;
        }
    }

    function updateGcStatusAndControls(gcStatusArray) {
        if (isExt4) return;

        if (!gcStatusArray || !Array.isArray(gcStatusArray)) {
            console.error("Invalid GC status data received:", gcStatusArray); // 添加 console 输出
            gcStatusSpan.textContent = '状态\n错误';
            gcStatusSpan.className = 'badge bg-danger';
            gcControlButton.textContent = '状态未知';
            gcControlButton.className = 'btn btn-sm btn-outline-secondary';
            gcControlButton.dataset.action = 'unknown';
            return;
        }

        // 即使数组为空，也显示为关闭状态
        const gcStatus = gcStatusArray[0] || { is_running: false };

        if (!gcStatus.is_running) {
            gcStatusSpan.textContent = 'GC回收\n关闭';
            gcStatusSpan.className = 'badge bg-secondary';
            gcControlButton.textContent = '开始';
            gcControlButton.className = 'btn btn-sm btn-success';
            gcControlButton.dataset.action = 'start';
        } else {
            const elapsed = gcStatus.elapsed_seconds || 0;
            const reclaimed = gcStatus.reclaimed_segments || 0;

            if (gcStatus.is_paused) {
                const reason = gcStatus.pause_reason || "未知";
                gcStatusSpan.innerHTML = `GC回收: 暂停<br>原因: ${reason}<br>已运行: ${elapsed}s | 已回收: ${reclaimed}`;
                gcStatusSpan.className = 'badge bg-warning';
                gcControlButton.textContent = '停止';
                gcControlButton.className = 'btn btn-sm btn-danger';
                gcControlButton.dataset.action = 'stop';
            } else {
                gcStatusSpan.innerHTML = `GC回收: 运行中<br>已运行: ${elapsed}s | 已回收: ${reclaimed}`;
                gcStatusSpan.className = 'badge bg-success';
                gcControlButton.textContent = '停止';
                gcControlButton.className = 'btn btn-sm btn-danger';
                gcControlButton.dataset.action = 'stop';
            }
        }
    }

    // --- 配置表单处理 ---
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const retentionDays = retentionDaysInput.value;
        const cleanInterval = cleanIntervalInput.value;
        const f2fsGcEnabled = f2fsGcConfigToggle.checked ? 'y' : 'n';
        try {
            await saveConfigFile(retentionDays, cleanInterval, f2fsGcEnabled);
            toast('配置已保存，请重启模块以应用所有更改。');
        } catch (error) {
            console.error("Failed to save config file:", error); // 添加 console 输出
            toast(`保存配置失败: ${error.message}`);
        }
    });

    async function loadConfigFile() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt');
            if (errno === 0) {
                const config = parseConfig(stdout);
                retentionDaysInput.value = config.保留天数 || '30';
                cleanIntervalInput.value = config.程序清理间隔秒数 || '3600';
                const f2fsGcValue = config['f2fs-GC'] || 'n';
                f2fsGcConfigToggle.checked = f2fsGcValue === 'y';
                updateGcConfigToggleLabel(f2fsGcConfigToggle.checked);
            } else if (!stderr.includes('No such file or directory')) { // 仅在非文件不存在的错误时打印
                console.error("Failed to load config file (exec errno):", stderr); // 添加 console 输出
                toast(`错误: ${stderr}`);
            }
        } catch (error) {
            console.error("Failed to load config file (exception):", error); // 添加 console 输出
            toast(`加载配置失败: ${error.message}`);
        }
    }

    function parseConfig(text) {
        const config = {};
        text.split('\n').forEach(line => {
            if (line.includes('=')) {
                const [key, value] = line.split('=').map(item => item.trim());
                if (key && value) config[key] = value;
            }
        });
        return config;
    }

    async function saveConfigFile(retentionDays, cleanInterval, f2fsGcEnabled) {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt');
            let lines = [];
            if (errno === 0) {
                lines = stdout.split('\n');
            } else if (!stderr.includes('No such file or directory')) {
                console.error("Failed to read config file for saving (exec errno):", stderr); // 添加 console 输出
                toast(`读取配置文件失败: ${stderr}`);
                throw new Error(`读取配置文件失败: ${stderr}`); // 抛出错误以便上层捕获
            }

            let hasRetention = false, hasInterval = false, hasF2fsGc = false;
            lines = lines.map(line => {
                if (line.startsWith('保留天数=')) { hasRetention = true; return `保留天数=${retentionDays}`; }
                if (line.startsWith('程序清理间隔秒数=')) { hasInterval = true; return `程序清理间隔秒数=${cleanInterval}`; }
                if (line.startsWith('f2fs-GC=')) { hasF2fsGc = true; return `f2fs-GC=${f2fsGcEnabled}`; }
                return line;
            });
            if (!hasRetention) lines.push(`保留天数=${retentionDays}`);
            if (!hasInterval) lines.push(`程序清理间隔秒数=${cleanInterval}`);
            if (!hasF2fsGc) lines.push(`f2fs-GC=${f2fsGcEnabled}`);
            
            const updatedConfig = lines.filter(line => line.trim() !== '').join('\n');
            const command = `printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`;
            const { errno: writeErrno, stderr: writeStderr } = await exec(command);
            if (writeErrno !== 0) {
                console.error("Failed to write config file:", writeStderr); // 添加 console 输出
                toast(`错误: ${writeStderr}`);
                throw new Error(`写入配置文件失败: ${writeStderr}`); // 抛出错误以便上层捕获
            }
        } catch (error) {
            console.error("An exception occurred while saving config file:", error); // 添加 console 输出
            throw error; // 重新抛出异常
        }
    }

    function updateGcConfigToggleLabel(isChecked) {
        if (isChecked) {
            f2fsGcConfigToggleLabel.textContent = '已开启';
            f2fsGcConfigToggleLabel.classList.remove('btn-outline-secondary');
            f2fsGcConfigToggleLabel.classList.add('btn-success');
        } else {
            f2fsGcConfigToggleLabel.textContent = '已关闭';
            f2fsGcConfigToggleLabel.classList.remove('btn-success');
            f2fsGcConfigToggleLabel.classList.add('btn-outline-secondary');
        }
    }

    f2fsGcConfigToggle.addEventListener('change', () => {
        updateGcConfigToggleLabel(f2fsGcConfigToggle.checked);
    });

    // --- 图表初始化与更新 ---
    const segmentChartCtx = document.getElementById('segment-chart').getContext('2d');
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const segmentChart = new Chart(segmentChartCtx, {
        type: 'doughnut',
        data: {
            labels: ['脏段 (0)', '空闲段 (0)'],
            datasets: [{ data: [0, 0], backgroundColor: ['#ff6384', '#36a2eb'], borderColor: isDarkMode ? '#2A2A2A' : '#f8f9fa', borderWidth: 1, }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
        },
    });

    const barChartCtx = document.getElementById('bar-chart').getContext('2d');
    const barChart = new Chart(barChartCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                { label: '文件清理 (MB)', data: [], backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 },
                { label: 'GC TRIM (MB)', data: [], backgroundColor: 'rgba(255, 159, 64, 0.2)', borderColor: 'rgba(255, 159, 64, 1)', borderWidth: 1, hidden: isExt4 },
                { label: '回收脏段数', data: [], backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1, hidden: isExt4 },
                { label: '已删除文件数', data: [], backgroundColor: 'rgba(255, 99, 132, 0.2)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 },
                { label: '已删除目录数', data: [], backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 },
            ],
        },
        options: { scales: { y: { beginAtZero: true } } },
    });

    // --- 日期选择器和日志数据处理 ---
    async function initDatePicker() {
        try {
            const { errno, stdout, stderr } = await exec('date +"%F"');
            if (errno !== 0) {
                console.error("Failed to get current date (exec errno):", stderr); // 添加 console 输出
                throw new Error('无法获取当前日期');
            }
            const today = new Date(stdout.trim());
            const sixDaysAgo = new Date(today);
            sixDaysAgo.setDate(today.getDate() - 6);
            const formatDate = (date) => date.toISOString().split('T')[0];
            dateSelect.min = formatDate(sixDaysAgo);
            dateSelect.max = formatDate(today);
            dateSelect.value = formatDate(today);
            dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        } catch (error) {
            console.error("Failed to initialize date picker:", error); // 添加 console 输出
            toast(`初始化日期选择器失败: ${error.message}`);
        }
    }

    async function loadLogFile() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json');
            if (errno === 0 && stdout.trim() !== '') {
                const parsedData = parseLogContent(stdout);
                updateLocalStorage(parsedData);
            } else if (errno !== 0 && !stderr.includes('No such file or directory')) {
                console.error("Failed to read stats.json (exec errno):", stderr); // 添加 console 输出
                throw new Error(`读取统计文件失败: ${stderr}`);
            }
        } catch (error) {
            console.error("Failed to load statistics data (exception):", error); // 添加 console 输出
            toast(`加载统计数据失败: ${error.message}`);
        }
        updateDisplaysForSelectedDate();
    }

    function aggregateAppStatsForDate(selectedDate) {
        const storedData = getStoredData();
        const dailyEntries = storedData.filter(entry => entry.date === selectedDate);
        const aggregatedStats = new Map();
        dailyEntries.forEach(entry => {
            entry.appStats?.forEach(app => {
                if (aggregatedStats.has(app.package_name)) {
                    const existing = aggregatedStats.get(app.package_name);
                    existing.bytes_deleted += app.bytes_deleted;
                    existing.megabytes_deleted += app.megabytes_deleted;
                } else {
                    aggregatedStats.set(app.package_name, { ...app });
                }
            });
        });
        return Array.from(aggregatedStats.values());
    }

    function updateAppStatsList(appStats) {
        appStatsList.innerHTML = '';
        if (!appStats || appStats.length === 0) {
            const li = document.createElement('li');
            li.className = 'list-group-item text-muted';
            li.textContent = '该日无应用数据清理记录。';
            appStatsList.appendChild(li);
            return;
        }
        appStats.sort((a, b) => b.bytes_deleted - a.bytes_deleted);
        appStats.forEach(app => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            const displayName = appNamesMap.get(app.package_name) || app.package_name;
            li.innerHTML = `
                <span class="text-truncate me-3" title="${app.package_name}">${displayName}</span>
                <span class="badge bg-primary rounded-pill">${app.megabytes_deleted.toFixed(2)} MB</span>
            `;
            appStatsList.appendChild(li);
        });
    }

    function updateBarChart() {
        const storedData = getStoredData();
        const selectedDate = dateSelect.value;
        const filteredData = selectedDate ? storedData.filter(entry => entry.date === selectedDate) : storedData;
        
        const aggregatedData = {};
        filteredData.forEach(entry => {
            const date = entry.date;
            if (!aggregatedData[date]) {
                aggregatedData[date] = { deletedFiles: 0, deletedDirs: 0, dirtySegments: 0, fileCleanedMB: 0, trimMB: 0 };
            }
            aggregatedData[date].deletedFiles += entry.deletedFiles;
            aggregatedData[date].deletedDirs += entry.deletedDirs;
            aggregatedData[date].dirtySegments += entry.dirtySegments;
            aggregatedData[date].fileCleanedMB += entry.fileCleanedMB;
            aggregatedData[date].trimMB += entry.trimMB;
        });

        barChart.data.datasets.forEach(dataset => {
            if (dataset.label === 'GC TRIM (MB)' || dataset.label === '回收脏段数') {
                dataset.hidden = isExt4;
            }
        });

        const dates = Object.keys(aggregatedData).sort();
        barChart.data.labels = dates;
        barChart.data.datasets[0].data = dates.map(date => aggregatedData[date].fileCleanedMB);
        barChart.data.datasets[1].data = dates.map(date => aggregatedData[date].trimMB);
        barChart.data.datasets[2].data = dates.map(date => aggregatedData[date].dirtySegments);
        barChart.data.datasets[3].data = dates.map(date => aggregatedData[date].deletedFiles);
        barChart.data.datasets[4].data = dates.map(date => aggregatedData[date].deletedDirs);
        barChart.update('none');
    }

    function updateDisplaysForSelectedDate() {
        const selectedDate = dateSelect.value;
        updateBarChart();
        appStatsTitle.textContent = `应用清理详情 (${selectedDate})`;
        const aggregatedData = aggregateAppStatsForDate(selectedDate);
        updateAppStatsList(aggregatedData);
    }

    // --- 事件监听器 ---
    clearDataBtn.addEventListener('click', () => {
        clearStoredData();
        updateDisplaysForSelectedDate();
        toast('数据已清除');
    });

    gcControlButton.addEventListener('click', async () => {
        const action = gcControlButton.dataset.action;
        if (action === 'unknown') {
            console.warn("GC control button clicked with unknown action."); // 添加 console 输出
            toast('无法确定GC状态，请刷新。');
            return;
        }

        gcControlButton.disabled = true;
        gcControlButton.textContent = '...';

        const command = action === 'start' ? 'start_gc' : 'stop_gc';
        // sendTcpCommand 内部已处理 console.error
        await sendTcpCommand(command);

        await delay(1500); // 增加延迟，给服务器处理时间
        gcControlButton.disabled = false;
        await updateAllF2fsInfo();
    });

    cleanNowBtn.addEventListener('click', async () => {
        toast('正在请求立即清理...');
        // sendTcpCommand 内部已处理 console.error
        await sendTcpCommand('clean_now');
    });

    const editRuleFile = async (fileName) => {
        try {
            const filePath = `/data/media/0/Android/清理规则/${fileName}`;
            const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file://${filePath} -t text/plain`);
            if (errno !== 0) {
                console.error(`Failed to edit file '${fileName}' (exec errno):`, stderr); // 添加 console 输出
                throw new Error(`编辑文件失败: ${stderr}`);
            }
            toast(`尝试打开文件: ${fileName}`);
        } catch (error) {
            console.error(`Failed to edit file '${fileName}' (exception):`, error); // 添加 console 输出
            toast(`编辑文件失败: ${error.message}`);
        }
    };
    editBlacklist1Btn.addEventListener('click', () => editRuleFile('blacklist1.txt'));
    editBlacklist2Btn.addEventListener('click', () => editRuleFile('blacklist2.txt'));
    editWhitelistBtn.addEventListener('click', () => editRuleFile('whitelist.txt'));

    refreshLogBtn.addEventListener('click', async () => {
        await loadLogFile();
        if (!isExt4) {
            await updateAllF2fsInfo();
        }
        toast('数据已刷新');
    });

    deleteLogBtn.addEventListener('click', async () => {
        try {
            const { errno, stderr } = await exec('rm -f /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/stats.json');
            if (errno !== 0) {
                console.error("Failed to delete log files (exec errno):", stderr); // 添加 console 输出
                throw new Error(`删除日志失败: ${stderr}`);
            }
            await loadLogFile(); // 重新加载以反映删除后的状态
            toast('日志文件已删除');
        } catch (error) {
            console.error("Failed to delete log files (exception):", error); // 添加 console 输出
            toast(`删除日志失败: ${error.message}`);
        }
    });

    restartModuleBtn.addEventListener('click', async () => {
        try {
            const { errno, stderr } = await exec('sh /data/adb/modules/Clean-C/rest.sh');
            if (errno === 0) {
                toast('模块已重启');
            } else {
                console.error("Failed to restart module (exec errno):", stderr); // 添加 console 输出
                toast(`重启模块失败: ${stderr || '未知错误'}`);
            }
        } catch (error) {
            console.error("An exception occurred while restarting module:", error); // 添加 console 输出
            toast(`模块重启失败: ${error.message}`);
        }
    });

    // --- 页面初始化 ---
    await checkFileSystem();
    await initDatePicker();
    await loadConfigFile();
    await loadAppNamesConfig();
    await loadLogFile();
    if (!isExt4) {
        await updateAllF2fsInfo();
    }
});