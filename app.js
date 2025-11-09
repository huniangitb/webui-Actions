// app.js
import { Ripple, Tab, initMDB } from 'mdb-ui-kit';
import { checkBackendProcess } from './api.js';
import { initHomePage } from './home.js';
import { initEditPage } from './edit.js';
import { initPageSwitcher, injectIcons, showApp, disableBackendFeatures } from './ui.js';

// 初始化 MDB 组件
initMDB({ Ripple, Tab });

// 全局状态
let isBackendOnline = true;

/**
 * @brief 当任何 API 调用失败时，统一处理函数。
 * @param {string} reason 失败原因。
 */
function handleApiError(reason) {
    if (isBackendOnline) {
        isBackendOnline = false;
        disableBackendFeatures(reason);
    }
}

// 主应用逻辑
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 初始化基础 UI
    injectIcons();
    initPageSwitcher();

    // 2. 检查后端状态
    if (!await checkBackendProcess()) {
        handleApiError('后端服务未运行');
    }

    // 3. 初始化各个页面的功能
    // 将统一的错误处理函数传递给每个模块
    await initHomePage(handleApiError);
    await initEditPage(handleApiError);

    // 4. 显示应用
    showApp();
});