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
import 'mdb-ui-kit/js/mdb.es.min.js';
import Chart from 'chart.js/auto';

// --- 自动错误日志记录模块 ---

const LOG_FILE_PATH = '/data/adb/modules/Clean-C/webui.log';
initMDB({ Ripple });
/**
 * 将错误信息异步写入到设备上的日志文件。
 * @param {string|Error} errorInfo - 要记录的错误信息或 Error 对象。
 */
async function logErrorToFile(errorInfo) {
    try {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        let logMessage;
        if (errorInfo instanceof Error) {
            logMessage = `[${timestamp}] ERROR: ${errorInfo.message}\nSTACK: ${errorInfo.stack}`;
        } else {
            logMessage = `[${timestamp}] LOG: ${String(errorInfo)}`;
        }

        // 对消息进行转义，以安全地传递给 shell
        const escapedMessage = logMessage.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        
        // 使用 echo 和 >> 追加到文件
        const command = `echo "${escapedMessage}" >> ${LOG_FILE_PATH}`;
        
        // "Fire-and-forget" - 我们执行它，但不等待它完成，以免阻塞 UI
        exec(command).catch(e => {
            // 如果日志记录本身失败，只在控制台报告，避免无限循环
            console.log('WebUI logErrorToFile failed:', e);
        });
    } catch (e) {
        console.log('WebUI logErrorToFile caught an exception:', e);
    }
}

// 1. 重写 console.error
const originalConsoleError = console.error;
console.error = function(...args) {
    // 仍然在开发者控制台打印错误
    originalConsoleError.apply(console, args);
    // 将错误信息格式化为字符串并写入文件
    const errorMessage = args.map(arg => {
        if (arg instanceof Error) {
            return `${arg.message}\n${arg.stack}`;
        }
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }).join(' ');
    logErrorToFile(`console.error: ${errorMessage}`);
};

// 2. 捕获未处理的同步错误
window.onerror = function(message, source, lineno, colno, error) {
    const fullMessage = `Uncaught Error: ${message} at ${source}:${lineno}:${colno}`;
    logErrorToFile(error || fullMessage);
    // 返回 true 以防止错误在控制台中重复显示
    return true;
};

// 3. 捕获未处理的 Promise rejections
window.addEventListener('unhandledrejection', function(event) {
    logErrorToFile(event.reason || 'Unhandled promise rejection');
});

// --- 错误日志记录模块结束 ---


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

    async function sendTcpCommand(command) {
        try {
            const clientPath = '/data/adb/modules/Clean-C/bin/tcp_client';
            const fullCommand = `${clientPath} ${command}`;
            const { errno, stdout, stderr } = await exec(fullCommand);

            if (errno === 0) {
                if (!stdout.trim()) {
                    toast(`命令 '${command}' 成功，但无响应内容。`);
                    return { status: "ok", message: "no content" };
                }
                try {
                    return JSON.parse(stdout.trim());
                } catch (jsonError) {
                    const error = new Error(`解析服务器响应失败: ${stdout.trim()}`);
                    error.cause = jsonError;
                    throw error;
                }
            } else {
                throw new Error(`发送命令失败: ${stderr || '未知错误'}`);
            }
        } catch (error) {
            logErrorToFile(error); // 记录执行或解析错误
            toast(error.message);
            return null;
        }
    }

    async function getGcStatusViaTcp() {
        const response = await sendTcpCommand('stats');
        if (response && Array.isArray(response)) {
            return response;
        } else if (response && response.error) {
            console.error("服务器返回错误:", response.error);
            return null;
        }
        return response; // 可能为 null
    }

    async function loadAppNamesConfig() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/list.config');
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
            } else if (!stderr.includes('No such file or directory')) {
                throw new Error(`加载 list.config 失败: ${stderr}`);
            }
        } catch (error) {
            console.error(error); // 会被重写的 console.error 捕获并记录
        }
    }

    // --- F2FS 信息获取与更新 ---
    async function getF2fsSegmentsInfoForChart() {
        try {
            const command = `
                F2FS_DEVICES=$(ls /sys/fs/f2fs/ 2>/dev/null)
                if [ -z "$F2FS_DEVICES" ]; then exit 1; fi
                FIRST_DEVICE=$(echo "$F2FS_DEVICES" | head -n 1)
                SYSFS_PATH="/sys/fs/f2fs/$FIRST_DEVICE"
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
            }
        } catch (e) {
            // 这是一个预期的、非关键的错误，只在控制台警告
            console.warn("获取 F2FS 段信息失败:", e.message);
        }
        return null;
    }

    async function checkFileSystem() {
        try {
            const { errno, stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`);
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
                    gcInfoIntervalId = setInterval(updateAllF2fsInfo, 2000);
                }
            }
        } catch (error) {
            toast(`检查文件系统失败: ${error.message}`);
            console.error(error);
        }
    }

    async function updateAllF2fsInfo() {
        const segmentInfo = await getF2fsSegmentsInfoForChart();
        const gcStatusArray = await getGcStatusViaTcp();
        if (segmentInfo) {
            updateSegmentChart(segmentInfo);
        }
        updateGcStatusAndControls(gcStatusArray);
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

        gcStatusSpan.innerHTML = '';
        gcControlButton.style.display = 'none';

        if (!gcStatusArray || !Array.isArray(gcStatusArray)) {
            const p = document.createElement('p');
            p.className = 'badge bg-danger';
            p.textContent = '状态获取失败';
            gcStatusSpan.appendChild(p);
            return;
        }
        if (gcStatusArray.length === 0) {
            const p = document.createElement('p');
            p.className = 'badge bg-secondary';
            p.textContent = '未发现 F2FS 设备';
            gcStatusSpan.appendChild(p);
            return;
        }
        
        let anyRunning = false;
        gcStatusArray.forEach(deviceStatus => {
            const container = document.createElement('div');
            container.className = 'mb-2';
            
            let statusText = `<strong>${deviceStatus.device_name} (${deviceStatus.mount_point}):</strong> `;
            let badgeClass = 'badge bg-secondary';

            if (!deviceStatus.is_running) {
                statusText += '关闭';
            } else {
                anyRunning = true;
                const elapsed = deviceStatus.elapsed_seconds || 0;
                const reclaimed = deviceStatus.reclaimed_segments || 0;

                if (deviceStatus.is_paused) {
                    const reason = deviceStatus.pause_reason || "未知";
                    statusText += `暂停 (${reason})<br>已运行: ${elapsed}s | 已回收: ${reclaimed}`;
                    badgeClass = 'badge bg-warning';
                } else {
                    statusText += `运行中<br>已运行: ${elapsed}s | 已回收: ${reclaimed}`;
                    badgeClass = 'badge bg-success';
                }
            }
            
            container.innerHTML = `<span class="${badgeClass}">${statusText}</span>`;
            gcStatusSpan.appendChild(container);
        });

        gcControlButton.style.display = 'inline-block';
        if (anyRunning) {
            gcControlButton.textContent = '全部停止';
            gcControlButton.className = 'btn btn-sm btn-danger';
            gcControlButton.dataset.action = 'stop';
        } else {
            gcControlButton.textContent = '全部开始';
            gcControlButton.className = 'btn btn-sm btn-success';
            gcControlButton.dataset.action = 'start';
        }
    }

    // --- 配置表单处理 ---
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const retentionDays = retentionDaysInput.value;
        const cleanInterval = cleanIntervalInput.value;
        const f2fsGcEnabled = f2fsGcConfigToggle.checked ? 'y' : 'n';
        await saveConfigFile(retentionDays, cleanInterval, f2fsGcEnabled);
        toast('配置已保存，请重启模块以应用所有更改。');
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
            } else {
                throw new Error(stderr);
            }
        } catch (error) {
            toast(`加载配置失败: ${error.message}`);
            console.error(error);
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
                throw new Error(`读取配置文件失败: ${stderr}`);
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
                throw new Error(`写入配置文件失败: ${writeStderr}`);
            }
        } catch (error) {
            toast(`保存配置失败: ${error.message}`);
            console.error(error);
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
            tooltip: { enabled: true },
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
        options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
    });

    function updateChartTheme(isDarkMode) {
        const textColor = isDarkMode ? '#f8f9fa' : '#2A2A2A';
        const bgColor = isDarkMode ? 'rgba(51, 51, 51, 0.8)' : 'rgba(248, 249, 250, 0.8)';
        
        segmentChart.data.datasets[0].borderColor = isDarkMode ? '#2A2A2A' : '#f8f9fa';
        segmentChart.options.plugins.tooltip.backgroundColor = bgColor;
        segmentChart.options.plugins.tooltip.titleColor = textColor;
        segmentChart.options.plugins.tooltip.bodyColor = textColor;
        segmentChart.update('none'); 

        barChart.options.scales.y.ticks.color = textColor;
        barChart.options.scales.x.ticks.color = textColor;
        barChart.options.plugins.legend.labels.color = textColor;
        barChart.options.plugins.tooltip.backgroundColor = bgColor;
        barChart.options.plugins.tooltip.titleColor = textColor;
        barChart.options.plugins.tooltip.bodyColor = textColor;
        barChart.update('none');
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        updateChartTheme(e.matches);
    });
    updateChartTheme(isDarkMode);

    // --- 日期选择器和日志数据处理 ---
    async function initDatePicker() {
        try {
            const { errno, stdout } = await exec('date +"%F"');
            if (errno !== 0) throw new Error('无法获取当前日期');
            const today = new Date(stdout.trim());
            const sixDaysAgo = new Date(today);
            sixDaysAgo.setDate(today.getDate() - 6);
            const formatDate = (date) => date.toISOString().split('T')[0];
            dateSelect.min = formatDate(sixDaysAgo);
            dateSelect.max = formatDate(today);
            dateSelect.value = formatDate(today);
            dateSelect.addEventListener('change', updateDisplaysForSelectedDate);
        } catch (error) {
            toast(`初始化日期选择器失败: ${error.message}`);
            console.error(error);
        }
    }

    async function loadLogFile() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/adb/modules/Clean-C/stats.json');
            if (errno === 0 && stdout.trim() !== '') {
                const parsedData = parseLogContent(stdout);
                updateLocalStorage(parsedData);
            } else if (errno !== 0 && !stderr.includes('No such file or directory')) {
                throw new Error(`读取统计文件失败: ${stderr}`);
            }
        } catch (error) {
            toast(`加载统计数据失败: ${error.message}`);
            console.error(error);
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
            toast('无法确定GC状态，请刷新。');
            return;
        }

        gcControlButton.disabled = true;
        gcControlButton.textContent = '...';

        const command = action === 'start' ? 'start_gc' : 'stop_gc';
        await sendTcpCommand(command);

        await delay(1500);
        gcControlButton.disabled = false;
        await updateAllF2fsInfo();
    });

    cleanNowBtn.addEventListener('click', async () => {
        toast('正在请求立即清理...');
        await sendTcpCommand('clean_now');
    });

    const editRuleFile = async (fileName) => {
        try {
            const filePath = `/data/media/0/Android/清理规则/${fileName}`;
            const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file://${filePath} -t text/plain`);
            if (errno !== 0) throw new Error(`编辑文件失败: ${stderr}`);
            toast(`尝试打开文件: ${fileName}`);
        } catch (error) {
            toast(`编辑文件失败: ${error.message}`);
            console.error(error);
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
            const { errno, stderr } = await exec('rm -f /data/adb/modules/Clean-C/stats.json /data/adb/modules/Clean-C/run.log /data/adb/modules/Clean-C/run.log.old /data/adb/modules/Clean-C/app-clean.log');
            if (errno !== 0) throw new Error(`删除日志失败: ${stderr}`);
            await loadLogFile();
            toast('日志文件已删除');
        } catch (error) {
            toast(`删除日志失败: ${error.message}`);
            console.error(error);
        }
    });

    restartModuleBtn.addEventListener('click', async () => {
        try {
            const { errno, stderr } = await exec('sh /data/adb/modules/Clean-C/rest.sh');
            if (errno === 0) {
                toast('模块已重启');
            } else {
                throw new Error(`重启模块失败: ${stderr || '未知错误'}`);
            }
        } catch (error) {
            toast(`模块重启失败: ${error.message}`);
            console.error(error);
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