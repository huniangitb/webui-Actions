import { exec, toast } from 'kernelsu';
import { Ripple, Modal, initMDB } from 'mdb-ui-kit';
import { icons } from './icons.js';

initMDB({ Ripple });

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM 元素获取 ---
    const configForm = document.getElementById('config-form');
    const retentionDaysInput = document.getElementById('retention-days');
    const cleanIntervalInput = document.getElementById('clean-interval');
    const editBlacklist1Btn = document.getElementById('edit-blacklist1');
    const editBlacklist2Btn = document.getElementById('edit-blacklist2');
    const editWhitelistBtn = document.getElementById('edit-whitelist');
    const f2fsGcConfigContainer = document.getElementById('f2fs-gc-config-container');
    const f2fsGcConfigToggle = document.getElementById('f2fs-gc-config-toggle');
    const f2fsGcConfigToggleLabel = document.getElementById('f2fs-gc-config-toggle-label');
    const scheduleModeIntervalRadio = document.getElementById('schedule-mode-interval');
    const scheduleModeCronRadio = document.getElementById('schedule-mode-cron');
    const intervalInputGroup = document.getElementById('interval-input-group');
    const cronInputGroup = document.getElementById('cron-input-group');
    const cronExpressionInput = document.getElementById('cron-expression');
    const editCronBtn = document.getElementById('edit-cron-btn');
    const cronEditorModalEl = document.getElementById('cron-editor-modal');
    const cronEditorModal = Modal.getInstance(cronEditorModalEl) || new Modal(cronEditorModalEl);
    const saveCronBtn = document.getElementById('save-cron-btn');

    // 手动实现 Tab 切换逻辑
    const cronTabTriggers = document.querySelectorAll('#cron-tabs a[data-mdb-toggle="pill"]');
    cronTabTriggers.forEach(clickedTrigger => {
        clickedTrigger.addEventListener('click', (event) => {
            event.preventDefault();
            if (clickedTrigger.classList.contains('active')) return;
            cronTabTriggers.forEach(trigger => trigger.classList.remove('active'));
            clickedTrigger.classList.add('active');
            const cronTabPanes = document.querySelectorAll('#cron-tabs-content .tab-pane');
            cronTabPanes.forEach(pane => pane.classList.remove('active', 'show'));
            const targetPane = document.querySelector(clickedTrigger.getAttribute('href'));
            if (targetPane) {
                targetPane.classList.add('active');
                setTimeout(() => targetPane.classList.add('show'), 10);
            }
        });
    });

    // --- 辅助函数 ---
    function injectIcons() {
        document.querySelectorAll('[data-icon]').forEach(el => {
            const iconName = el.getAttribute('data-icon');
            if (icons[iconName]) {
                el.setAttribute('d', icons[iconName]);
            }
        });
    }

    async function checkFileSystem() {
        try {
            const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`);
            const isExt4 = (stdout.trim() === 'ext4');
            f2fsGcConfigContainer.style.display = isExt4 ? 'none' : 'block';
        } catch (error) {
            console.error("Failed to check file system:", error);
        }
    }

    // --- 配置表单处理 ---
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await saveConfigFile(
                retentionDaysInput.value,
                document.querySelector('input[name="schedule-mode"]:checked').value,
                cleanIntervalInput.value,
                cronExpressionInput.value,
                f2fsGcConfigToggle.checked ? 'y' : 'n'
            );
            toast('配置已保存，正在重启模块...');
            await exec('sh /data/adb/modules/Clean-C/rest.sh');
            toast('模块已重启');
        } catch (error) { toast(`操作失败: ${error.message}`); }
    });

    async function loadConfigFile() {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt');
            if (errno === 0) {
                const config = parseConfig(stdout);
                retentionDaysInput.value = config.保留天数 || '30';
                if (config.cron表达式 && config.cron表达式.trim() !== '') {
                    scheduleModeCronRadio.checked = true;
                    cronExpressionInput.value = config.cron表达式;
                } else {
                    scheduleModeIntervalRadio.checked = true;
                    cronExpressionInput.value = '0 * * * *';
                }
                cleanIntervalInput.value = config.程序清理间隔秒数 || '3600';
                updateScheduleModeUI();
                const f2fsGcValue = config['f2fs-GC'] || 'n';
                f2fsGcConfigToggle.checked = f2fsGcValue === 'y';
                updateGcConfigToggleLabel(f2fsGcConfigToggle.checked);
            } else if (!stderr.includes('No such file or directory')) {
                toast(`错误: ${stderr}`);
            } else {
                updateScheduleModeUI(); updateGcConfigToggleLabel(false);
            }
        } catch (error) { toast(`加载配置失败: ${error.message}`); }
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

    async function saveConfigFile(retentionDays, scheduleMode, cleanInterval, cronExpression, f2fsGcEnabled) {
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt');
            let lines = (errno === 0) ? stdout.split('\n') : [];
            if (errno !== 0 && !stderr.includes('No such file or directory')) throw new Error(`读取配置失败: ${stderr}`);
            
            const otherLines = lines.filter(l => !/^(保留天数=|程序清理间隔秒数=|cron表达式=|f2fs-GC=)/.test(l) && l.trim() !== '');
            const newConfig = [...otherLines, `保留天数=${retentionDays}`, `f2fs-GC=${f2fsGcEnabled}`];
            if (scheduleMode === 'cron') {
                newConfig.push(`cron表达式=${cronExpression}`, `程序清理间隔秒数=${cleanInterval}`);
            } else {
                newConfig.push(`程序清理间隔秒数=${cleanInterval}`);
                const oldCron = cronExpressionInput.value || '0 * * * *';
                newConfig.push(`cron表达式=${oldCron}`);
            }
            
            const updatedConfig = newConfig.join('\n');
            const { errno: writeErrno, stderr: writeStderr } = await exec(`printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`);
            if (writeErrno !== 0) throw new Error(`写入配置失败: ${writeStderr}`);
        } catch (error) { throw error; }
    }

    function updateGcConfigToggleLabel(isChecked) {
        f2fsGcConfigToggleLabel.textContent = isChecked ? '已开启' : '已关闭';
        f2fsGcConfigToggleLabel.classList.toggle('btn-success', isChecked);
        f2fsGcConfigToggleLabel.classList.toggle('btn-outline-secondary', !isChecked);
    }

    f2fsGcConfigToggle.addEventListener('change', () => updateGcConfigToggleLabel(f2fsGcConfigToggle.checked));

    function updateScheduleModeUI() {
        const isCron = scheduleModeCronRadio.checked;
        intervalInputGroup.classList.toggle('hidden', isCron);
        cronInputGroup.classList.toggle('hidden', !isCron);
        cleanIntervalInput.required = !isCron;
        cronExpressionInput.required = isCron;
    }

    [scheduleModeIntervalRadio, scheduleModeCronRadio].forEach(el => el.addEventListener('change', updateScheduleModeUI));

    // --- Cron 编辑器逻辑 ---
    const cronFields = {
        minutes: { el: document.getElementById('cron-minutes'), min: 0, max: 59, name: '分钟' },
        hours: { el: document.getElementById('cron-hours'), min: 0, max: 23, name: '小时' },
        dom: { el: document.getElementById('cron-dom'), min: 1, max: 31, name: '日' },
        months: { el: document.getElementById('cron-months'), min: 1, max: 12, name: '月', labels: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'] },
        dow: { el: document.getElementById('cron-dow'), min: 0, max: 6, name: '星期', labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] }
    };

    function generateCronEditorUI() {
        for (const key in cronFields) {
            const { el, min, max, name, labels } = cronFields[key];
            const tabText = name;

            let optionsHtml = `<div class="btn-group mb-3 w-100"><input type="radio" class="btn-check" name="${key}-mode" id="${key}-every" value="*" checked><label class="btn btn-outline-primary" for="${key}-every">每${(labels ? '个' : '') + tabText}</label><input type="radio" class="btn-check" name="${key}-mode" id="${key}-specific" value="specific"><label class="btn btn-outline-primary" for="${key}-specific">指定</label></div>`;
            let gridHtml = '<div class="cron-grid collapsed">';
            for (let i = min; i <= max; i++) {
                const label = labels ? labels[i - min] : i;
                gridHtml += `<div><input type="checkbox" class="btn-check" id="${key}-${i}" value="${i}"><label class="btn btn-outline-primary" for="${key}-${i}">${label}</label></div>`;
            }
            gridHtml += '</div>';
            el.innerHTML = optionsHtml + gridHtml;
        }
    }

    cronEditorModalEl.addEventListener('click', (e) => {
        if (e.target.name && e.target.name.endsWith('-mode')) {
            const fieldKey = e.target.name.replace('-mode', '');
            const grid = cronFields[fieldKey].el.querySelector('.cron-grid');
            grid.classList.toggle('collapsed', e.target.value === '*');
        }
    });

    function parseCronToUI(expression) {
        const parts = expression.split(' ');
        if (parts.length !== 5) return;
        const keys = ['minutes', 'hours', 'dom', 'months', 'dow'];
        keys.forEach((key, i) => {
            const part = parts[i];
            const field = cronFields[key];
            const everyRadio = field.el.querySelector(`#${key}-every`);
            const specificRadio = field.el.querySelector(`#${key}-specific`);
            const grid = field.el.querySelector('.cron-grid');
            
            field.el.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

            if (part === '*') {
                everyRadio.checked = true;
                grid.classList.add('collapsed');
            } else {
                specificRadio.checked = true;
                grid.classList.remove('collapsed');
                part.split(',').forEach(range => {
                    if (range.includes('-')) {
                        const [start, end] = range.split('-').map(Number);
                        for (let j = start; j <= end; j++) {
                            const cb = field.el.querySelector(`#${key}-${j}`);
                            if (cb) cb.checked = true;
                        }
                    } else if (range.includes('/')) {
                        const [_, step] = range.split('/').map(Number);
                        for (let j = field.min; j <= field.max; j += step) {
                             const cb = field.el.querySelector(`#${key}-${j}`);
                            if (cb) cb.checked = true;
                        }
                    } else {
                        const cb = field.el.querySelector(`#${key}-${Number(range)}`);
                        if (cb) cb.checked = true;
                    }
                });
            }
        });
    }

    function generateCronFromUI() {
        const keys = ['minutes', 'hours', 'dom', 'months', 'dow'];
        const parts = keys.map(key => {
            const field = cronFields[key];
            const mode = field.el.querySelector(`input[name="${key}-mode"]:checked`).value;
            if (mode === '*') return '*';
            
            const selected = Array.from(field.el.querySelectorAll('.cron-grid input:checked')).map(cb => Number(cb.value));
            if (selected.length === 0) return '*';
            if (selected.length === (field.max - field.min + 1)) return '*';

            selected.sort((a, b) => a - b);
            const ranges = [];
            for (let i = 0; i < selected.length; i++) {
                let start = selected[i];
                while (i + 1 < selected.length && selected[i+1] === selected[i] + 1) i++;
                let end = selected[i];
                ranges.push(start === end ? `${start}` : `${start}-${end}`);
            }
            return ranges.join(',');
        });
        return parts.join(' ');
    }

    editCronBtn.addEventListener('click', () => {
        parseCronToUI(cronExpressionInput.value);
        cronEditorModal.show();
    });

    saveCronBtn.addEventListener('click', () => {
        cronExpressionInput.value = generateCronFromUI();
        cronEditorModal.hide();
    });

    // --- 文件编辑事件监听器 ---
    const editRuleFile = async (fileName) => {
        try {
            const filePath = `/data/media/0/Android/清理规则/${fileName}`;
            const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file://${filePath} -t text/plain`);
            if (errno !== 0) throw new Error(`编辑文件失败: ${stderr}`);
            toast(`尝试打开文件: ${fileName}`);
        } catch (error) { toast(`编辑文件失败: ${error.message}`); }
    };
    editBlacklist1Btn.addEventListener('click', () => editRuleFile('blacklist1.txt'));
    editBlacklist2Btn.addEventListener('click', () => editRuleFile('blacklist2.txt'));
    editWhitelistBtn.addEventListener('click', () => editRuleFile('whitelist.txt'));

    // --- 页面初始化 ---
    injectIcons();
    generateCronEditorUI();
    await checkFileSystem();
    await loadConfigFile();
});