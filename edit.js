// edit.js
import { exec, toast } from 'kernelsu';
import { Tab } from 'mdb-ui-kit';
import { sendTcpCommand } from './api.js';

/**
 * @brief 初始化编辑页的所有功能和事件监听器。
 * @param {Function} onApiError - 当 API 调用失败时执行的回调函数。
 */
export async function initEditPage(onApiError) {
    const editPageContent = document.getElementById('edit-page-content');
    const cronEditorInlineContainer = document.getElementById('cron-editor-inline-container');
    const editCronBtn = document.getElementById('edit-cron-btn');
    const saveCronBtnInline = document.getElementById('save-cron-btn-inline');
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
    const cronFields = { minutes: { el: document.getElementById('cron-minutes'), min: 0, max: 59, name: '分钟' }, hours: { el: document.getElementById('cron-hours'), min: 0, max: 23, name: '小时' }, dom: { el: document.getElementById('cron-dom'), min: 1, max: 31, name: '日' }, months: { el: document.getElementById('cron-months'), min: 1, max: 12, name: '月', labels: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'] }, dow: { el: document.getElementById('cron-dow'), min: 0, max: 6, name: '星期', labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] } };

    function toggleCronEditor(show) {
        if (show) {
            parseCronToUI(cronExpressionInput.value);
            editPageContent.classList.add('hidden');
            cronEditorInlineContainer.classList.add('visible');
            editCronBtn.textContent = '关闭';
            cronEditorInlineContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            editPageContent.classList.remove('hidden');
            cronEditorInlineContainer.classList.remove('visible');
            editCronBtn.textContent = '编辑';
        }
    }

    function updateGcConfigToggleLabel(isChecked) { f2fsGcConfigToggleLabel.textContent = isChecked ? '已开启' : '已关闭'; f2fsGcConfigToggleLabel.classList.toggle('btn-success', isChecked); f2fsGcConfigToggleLabel.classList.toggle('btn-outline-secondary', !isChecked); }
    function updateScheduleModeUI() { const isCron = scheduleModeCronRadio.checked; intervalInputGroup.classList.toggle('hidden', isCron); cronInputGroup.classList.toggle('hidden', !isCron); cleanIntervalInput.required = !isCron; cronExpressionInput.required = isCron; }
    function generateCronEditorUI() { for (const key in cronFields) { const { el, min, max, name, labels } = cronFields[key]; let gridHtml = '<div class="cron-grid collapsed">'; for (let i = min; i <= max; i++) { gridHtml += `<div><input type="checkbox" class="btn-check" id="${key}-${i}" value="${i}"><label class="btn btn-outline-primary" for="${key}-${i}">${labels ? labels[i - min] : i}</label></div>`; } el.innerHTML = `<div class="btn-group mb-3 w-100"><input type="radio" class="btn-check" name="${key}-mode" id="${key}-every" value="*" checked><label class="btn btn-outline-primary" for="${key}-every">每${(labels ? '个' : '') + name}</label><input type="radio" class="btn-check" name="${key}-mode" id="${key}-specific" value="specific"><label class="btn btn-outline-primary" for="${key}-specific">指定</label></div>` + gridHtml + '</div>'; } }
    function parseCronToUI(expression) { const parts = expression.split(' '); if (parts.length !== 5) return; ['minutes', 'hours', 'dom', 'months', 'dow'].forEach((key, i) => { const part = parts[i], field = cronFields[key]; field.el.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false); if (part === '*') { field.el.querySelector(`#${key}-every`).checked = true; field.el.querySelector('.cron-grid').classList.add('collapsed'); } else { field.el.querySelector(`#${key}-specific`).checked = true; field.el.querySelector('.cron-grid').classList.remove('collapsed'); part.split(',').forEach(range => { if (range.includes('-')) { const [start, end] = range.split('-').map(Number); for (let j = start; j <= end; j++) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } } else if (range.includes('/')) { const [_, step] = range.split('/').map(Number); for (let j = field.min; j <= field.max; j += step) { const cb = field.el.querySelector(`#${key}-${j}`); if (cb) cb.checked = true; } } else { const cb = field.el.querySelector(`#${key}-${Number(range)}`); if (cb) cb.checked = true; } }); } }); }
    function generateCronFromUI() { return ['minutes', 'hours', 'dom', 'months', 'dow'].map(key => { const field = cronFields[key]; if (field.el.querySelector(`input[name="${key}-mode"]:checked`).value === '*') return '*'; const selected = Array.from(field.el.querySelectorAll('.cron-grid input:checked')).map(cb => Number(cb.value)); if (selected.length === 0 || selected.length === (field.max - field.min + 1)) return '*'; selected.sort((a, b) => a - b); const ranges = []; for (let i = 0; i < selected.length; i++) { let start = selected[i]; while (i + 1 < selected.length && selected[i+1] === selected[i] + 1) i++; ranges.push(start === selected[i] ? `${start}` : `${start}-${selected[i]}`); } return ranges.join(','); }).join(' '); }
    async function loadConfigFile() { try { const { errno, stdout } = await exec('cat /data/media/0/Android/清理规则/配置.txt'); if (errno === 0) { const config = {}; stdout.split('\n').forEach(line => { if (line.includes('=')) { const [key, value] = line.split('=').map(item => item.trim()); if (key && value) config[key] = value; } }); retentionDaysInput.value = config.保留天数 || '30'; if (config.cron表达式 && config.cron表达式.trim() !== '') { scheduleModeCronRadio.checked = true; cronExpressionInput.value = config.cron表达式; } else { cronExpressionInput.value = '0 * * * *'; } cleanIntervalInput.value = config.程序清理间隔秒数 || '3600'; const f2fsGcValue = config['f2fs-GC'] || 'n'; f2fsGcConfigToggle.checked = f2fsGcValue === 'y'; } } catch (e) { toast(`加载配置失败: ${e.message}`); } updateScheduleModeUI(); updateGcConfigToggleLabel(f2fsGcConfigToggle.checked); }

    // Event Listeners
    editCronBtn.addEventListener('click', () => {
        const isVisible = cronEditorInlineContainer.classList.contains('visible');
        toggleCronEditor(!isVisible);
    });
    saveCronBtnInline.addEventListener('click', () => {
        cronExpressionInput.value = generateCronFromUI();
        toggleCronEditor(false);
    });

    document.querySelectorAll('#cron-tabs [data-mdb-toggle="pill"]').forEach(triggerEl => {
        const tab = new Tab(triggerEl);
        triggerEl.addEventListener('click', (event) => {
            event.preventDefault();
            tab.show();
        });
    });
    cronEditorInlineContainer.addEventListener('shown.bs.tab', () => {
        void cronEditorInlineContainer.offsetWidth;
    });

    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const { errno, stdout, stderr } = await exec('cat /data/media/0/Android/清理规则/配置.txt');
            let lines = (errno === 0) ? stdout.split('\n') : [];
            if (errno !== 0 && !stderr.includes('No such file')) throw new Error(`读取配置失败: ${stderr}`);
            const otherLines = lines.filter(l => !/^(保留天数=|程序清理间隔秒数=|cron表达式=|f2fs-GC=)/.test(l) && l.trim() !== '');
            const newConfig = [...otherLines, `保留天数=${retentionDaysInput.value}`, `f2fs-GC=${f2fsGcConfigToggle.checked ? 'y' : 'n'}`];
            if (scheduleModeCronRadio.checked) {
                newConfig.push(`cron表达式=${cronExpressionInput.value}`, `程序清理间隔秒数=${cleanIntervalInput.value}`);
            } else {
                newConfig.push(`程序清理间隔秒数=${cleanIntervalInput.value}`, `cron表达式=${cronExpressionInput.value || '0 * * * *'}`);
            }
            const updatedConfig = newConfig.join('\n');
            const { errno: writeErrno, stderr: writeStderr } = await exec(`printf "%s" "${updatedConfig.replace(/"/g, '\\"')}" > /data/media/0/Android/清理规则/配置.txt`);
            if (writeErrno !== 0) throw new Error(`写入配置失败: ${writeStderr}`);
            
            toast('配置已保存，正在请求重启模块...');
            await sendTcpCommand('restart');
            toast('重启命令已发送');
        } catch (error) {
            // 如果是 API 错误，则调用 onApiError，否则显示 toast
            if (error.message.includes('后端')) {
                onApiError(error.message);
            } else {
                toast(`操作失败: ${error.message}`);
            }
        }
    });

    f2fsGcConfigToggle.addEventListener('change', () => updateGcConfigToggleLabel(f2fsGcConfigToggle.checked));
    document.querySelectorAll('input[name="schedule-mode"]').forEach(el => el.addEventListener('change', updateScheduleModeUI));
    cronEditorInlineContainer.addEventListener('click', (e) => { if (e.target.name && e.target.name.endsWith('-mode')) { const fieldKey = e.target.name.replace('-mode', ''); cronFields[fieldKey].el.querySelector('.cron-grid').classList.toggle('collapsed', e.target.value === '*'); } });
    const editRuleFile = async (fileName) => { try { const { errno, stderr } = await exec(`am start -a android.intent.action.VIEW -d file:///data/media/0/Android/清理规则/${fileName} -t text/plain`); if (errno !== 0) throw new Error(stderr); toast(`尝试打开文件: ${fileName}`); } catch (e) { toast(`编辑文件失败: ${e.message}`); } };
    document.getElementById('edit-blacklist1').addEventListener('click', () => editRuleFile('blacklist1.txt'));
    document.getElementById('edit-blacklist2').addEventListener('click', () => editRuleFile('blacklist2.txt'));
    document.getElementById('edit-whitelist').addEventListener('click', () => editRuleFile('whitelist.txt'));

    // Initial Load
    try {
        const { stdout } = await exec(`mount | grep " /data " | awk '{print $5}'`);
        f2fsGcConfigContainer.style.display = (stdout.trim() === 'ext4') ? 'none' : 'block';
    } catch (e) {
        console.error("Failed to check file system:", e);
    }
    generateCronEditorUI();
    await loadConfigFile();
}