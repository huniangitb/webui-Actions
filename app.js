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
    try {
        // 1. 初始化基础 UI
        injectIcons();
        initPageSwitcher();

        // 2. 检查后端状态
        if (!await checkBackendProcess()) {
            // 如果后端未运行，抛出一个错误，由 catch 块统一处理
            throw new Error('后端服务未运行');
        }

        // 3. 初始化各个页面的功能
        // 将统一的错误处理函数传递给每个模块，用于处理轮询等后续错误
        await initHomePage(handleApiError);
        await initEditPage(handleApiError);

    } catch (error) {
        // 捕获任何初始化阶段的错误
        handleApiError(error.message);
    } finally {
        // 4. 无论成功或失败，都必须显示应用界面
        showApp();
    }
});