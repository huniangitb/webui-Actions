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

    function updateGcConfigToggleLabel(isChecked) { /* ... (此函数内容保持不变) ... */ }
    function updateScheduleModeUI() { /* ... (此函数内容保持不变) ... */ }
    function generateCronEditorUI() { /* ... (此函数内容保持不变) ... */ }
    function parseCronToUI(expression) { /* ... (此函数内容保持不变) ... */ }
    function generateCronFromUI() { /* ... (此函数内容保持不变) ... */ }
    async function loadConfigFile() { /* ... (此函数内容保持不变) ... */ }

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
            // ... (保存配置文件的逻辑) ...
            await sendTcpCommand('restart');
            toast('重启命令已发送');
        } catch (error) {
            onApiError(error.message);
        }
    });

    f2fsGcConfigToggle.addEventListener('change', () => updateGcConfigToggleLabel(f2fsGcConfigToggle.checked));
    document.querySelectorAll('input[name="schedule-mode"]').forEach(el => el.addEventListener('change', updateScheduleModeUI));
    cronEditorInlineContainer.addEventListener('click', (e) => { if (e.target.name && e.target.name.endsWith('-mode')) { const fieldKey = e.target.name.replace('-mode', ''); cronFields[fieldKey].el.querySelector('.cron-grid').classList.toggle('collapsed', e.target.value === '*'); } });
    const editRuleFile = async (fileName) => { /* ... (此函数内容保持不变) ... */ };
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