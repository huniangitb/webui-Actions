// ui.js
import { toast } from 'kernelsu';
import { icons } from './icons.js';

/**
 * @brief 初始化 SPA 页面切换逻辑。
 */
export function initPageSwitcher() {
    const pages = {
        home: document.getElementById('page-home'),
        edit: document.getElementById('page-edit')
    };
    const navItems = document.querySelectorAll('.nav-item');

    function showPage(pageId) {
        Object.values(pages).forEach(page => page.style.display = 'none');
        if (pages[pageId]) {
            pages[pageId].style.display = 'block';
        }
        navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageId);
        });
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.currentTarget.dataset.page;
            history.replaceState(null, '', `#${pageId}`);
            showPage(pageId);
        });
    });

    // 初始页面加载
    const initialPage = window.location.hash.substring(1) || 'home';
    showPage(initialPage);
}

/**
 * @brief 注入 SVG 图标。
 */
export function injectIcons() {
    document.querySelectorAll('[data-icon]').forEach(el => {
        const iconName = el.getAttribute('data-icon');
        if (icons[iconName]) {
            el.setAttribute('d', icons[iconName]);
        }
    });
}

/**
 * @brief 显示加载完成后的主界面。
 */
export function showApp() {
    // 修复：使用 querySelector 获取 class
    document.querySelector('.app-wrapper').classList.add('loaded');
    document.getElementById('loader').style.display = 'none';
}

/**
 * @brief 禁用所有与后端交互的功能。
 * @param {string} reason 禁用的原因。
 */
export function disableBackendFeatures(reason) {
    toast(reason, 4000);
    document.querySelectorAll('#clean-now-btn, #refresh-log, #restart-module, #gc-control-btn, #config-form button[type="submit"]').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
    });
    const globalGcStatusSpan = document.getElementById('global-gc-status');
    if (globalGcStatusSpan) {
        globalGcStatusSpan.textContent = '后端离线';
        globalGcStatusSpan.className = 'badge bg-danger';
    }
}