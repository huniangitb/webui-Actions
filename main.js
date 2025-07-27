// 导入 MDB-UI-Kit 组件 和 Chart.js
import Chart from 'chart.js/auto';
import { Ripple, Range, Input, Modal, initMDB } from 'mdb-ui-kit';
import { exec, toast } from 'kernelsu';
import i18next from './i18n.js';
import { mdiFileEdit, mdiLock, mdiTune, mdiSync, mdiRestore } from '@mdi/js';

// --- 常量和全局变量 ---
const MODULE_ID = "miuicx_color_tuner";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
let currentConfigPath = ''; 
// [修改] 新的节点路径
const KCAL_RED_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_red";
const KCAL_GREEN_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_green";
const KCAL_BLUE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_blue";
const RANGE_CONFIG_KEY = 'kcalWebUIRanges';

const BACKLIGHT_PATH = "/sys/class/backlight/panel0-backlight/brightness";
const MAX_BRIGHTNESS_PATH = "/sys/class/backlight/panel0-backlight/max_brightness";

const FIXED_PRECISION = 100;
// [修改] 新的默认配置结构
const defaultConfig = {
    red: { intercept: 256.0, slope: 0.0 },
    green: { intercept: 256.0, slope: 0.0 },
    blue: { intercept: 256.0, slope: 0.0 },
};

const defaultRanges = {
    intercept: { min: 0, max: 256 },
    slope: { min: -50, max: 50 },
};

const icons = { mdiFileEdit, mdiLock, mdiTune, mdiSync, mdiRestore };

let globalConfig = JSON.parse(JSON.stringify(defaultConfig)); // 深拷贝
let maxBrightness = 4095;
let currentRefreshRate = 60;
let colorChart = null;
let nodeStatusModal = null;
let rangeConfigModal = null;
let isEditMode = false;
let lastKnownRefreshRate = 0;
let lastKnownBrightness = -1;

// --- DOM 元素 ---
const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessValue = document.getElementById('brightnessValue');
const refreshRateValue = document.getElementById('refreshRateValue');
const saveButton = document.getElementById('saveButton');
const resetConfigButton = document.getElementById('resetConfigButton');
const readNodeButton = document.getElementById('readNodeButton');
const customizeRangeButton = document.getElementById('customizeRangeButton');
const chartCanvas = document.getElementById('colorCurveChart');
const toggleEditModeButton = document.getElementById('toggleEditModeButton');
const configEditorContainer = document.getElementById('global-config-editor');

// [修改] 新的UI元素
const uiElements = {
    red: {
        interceptSlider: document.getElementById('redInterceptSlider'),
        interceptInput: document.getElementById('redInterceptInput'),
        slopeSlider: document.getElementById('redSlopeSlider'),
        slopeInput: document.getElementById('redSlopeInput'),
    },
    green: {
        interceptSlider: document.getElementById('greenInterceptSlider'),
        interceptInput: document.getElementById('greenInterceptInput'),
        slopeSlider: document.getElementById('greenSlopeSlider'),
        slopeInput: document.getElementById('greenSlopeInput'),
    },
    blue: {
        interceptSlider: document.getElementById('blueInterceptSlider'),
        interceptInput: document.getElementById('blueInterceptInput'),
        slopeSlider: document.getElementById('blueSlopeSlider'),
        slopeInput: document.getElementById('blueSlopeInput'),
    },
};

const interceptRangeMin = document.getElementById('interceptRangeMin');
const interceptRangeMax = document.getElementById('interceptRangeMax');
const slopeRangeMin = document.getElementById('slopeRangeMin');
const slopeRangeMax = document.getElementById('slopeRangeMax');
const saveRangeButton = document.getElementById('saveRangeButton');

// --- SVG 图标创建函数 ---
function createIcon(path) {
  if (!path) return '';
  return `<svg class="svg-icon me-2" viewBox="0 0 24 24"><path d="${path}" /></svg>`;
}

// --- 轮询函数 ---
async function pollSystemStatus() {
    try {
        const { stdout } = await exec('settings get system peak_refresh_rate');
        const newRate = Math.round(parseFloat(stdout.trim())) || 60;
        if (newRate !== lastKnownRefreshRate) {
            console.log(`Refresh rate changed: ${lastKnownRefreshRate} -> ${newRate}`);
            lastKnownRefreshRate = newRate;
            currentRefreshRate = newRate;
            refreshRateValue.innerText = `${currentRefreshRate} Hz`;
            currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
            toast(i18next.t('toast.refreshRateChanged', { rate: newRate }), 'info');
            await loadConfigAndRender();
        }
    } catch (e) { /* 忽略错误 */ }

    try {
        const { stdout } = await exec(`cat ${BACKLIGHT_PATH}`);
        const newBrightness = parseInt(stdout.trim());
        if (newBrightness !== lastKnownBrightness) {
            console.log(`Brightness changed: ${lastKnownBrightness} -> ${newBrightness}`);
            lastKnownBrightness = newBrightness;
            const percentage = Math.round(((newBrightness - 1) / (maxBrightness - 1)) * 100);
            brightnessValue.innerText = i18next.t('status.brightnessValue', { value: newBrightness, percent: percentage });
            brightnessSlider.value = percentage;
        }
    } catch (e) { /* 忽略错误 */ }
}

// --- 多语言UI更新 ---
function updateUIText() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = i18next.t(key, { returnObjects: true });

        if (typeof translation === 'object' && translation.icon && translation.text) {
            const iconPath = icons[translation.icon];
            el.innerHTML = `${createIcon(iconPath)}${translation.text}`;
        } else {
            el.innerHTML = translation;
        }
    });
    document.documentElement.lang = i18next.language;
    document.title = i18next.t('title');
    document.querySelectorAll('.form-outline').forEach((formOutline) => {
        new Input(formOutline).update();
    });
    updateChart();
    toggleEditMode(isEditMode);
}

// --- 编辑/查看模式切换 ---
function toggleEditMode(enable) {
    isEditMode = enable;
    const controls = configEditorContainer.querySelectorAll('input[type="range"], input[type="number"]');
    controls.forEach(control => {
        control.disabled = !enable;
    });
    saveButton.disabled = !enable;
    resetConfigButton.disabled = !enable;

    const key = enable ? 'buttons.editMode.exit' : 'buttons.editMode.enter';
    const translation = i18next.t(key, { returnObjects: true });
    if (typeof translation === 'object') {
        toggleEditModeButton.innerHTML = `${createIcon(icons[translation.icon])}${translation.text}`;
    }
    
    if (enable) {
        toggleEditModeButton.classList.remove('btn-success');
        toggleEditModeButton.classList.add('btn-danger');
    } else {
        toggleEditModeButton.classList.remove('btn-danger');
        toggleEditModeButton.classList.add('btn-success');
    }
}

// --- 主题管理 ---
function updateTheme() {
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-mdb-theme', isDarkMode ? 'dark' : 'light');
    updateChart();
}

// --- 工具函数 ---
const scaleToSystemBrightness = (percentage) => Math.round(1 + (percentage / 100) * (maxBrightness - 1));

async function setSystemBrightness(percentage) {
    if (!BACKLIGHT_PATH) return;
    const systemValue = scaleToSystemBrightness(percentage);
    try {
        await exec(`echo ${systemValue} > ${BACKLIGHT_PATH}`);
        brightnessValue.innerText = i18next.t('status.brightnessValue', { value: systemValue, percent: percentage });
        lastKnownBrightness = systemValue;
    } catch (e) {
        toast(i18next.t('toast.brightness.setFailed', { error: e.message }), 'error');
    }
}

// --- 范围管理 ---
function applyRanges(ranges) {
    for (const color in uiElements) {
        uiElements[color].interceptSlider.min = ranges.intercept.min * FIXED_PRECISION;
        uiElements[color].interceptSlider.max = ranges.intercept.max * FIXED_PRECISION;
        uiElements[color].slopeSlider.min = ranges.slope.min * FIXED_PRECISION;
        uiElements[color].slopeSlider.max = ranges.slope.max * FIXED_PRECISION;
    }
}

function loadAndApplyRanges() {
    let ranges = { ...defaultRanges };
    try {
        const savedRanges = localStorage.getItem(RANGE_CONFIG_KEY);
        if (savedRanges) {
            const parsed = JSON.parse(savedRanges);
            if (parsed.intercept) ranges.intercept = { ...ranges.intercept, ...parsed.intercept };
            if (parsed.slope) ranges.slope = { ...ranges.slope, ...parsed.slope };
        }
    } catch (e) {
        console.error("加载范围配置失败:", e);
    }
    applyRanges(ranges);
}

function saveRanges() {
    const iMin = parseFloat(interceptRangeMin.value);
    const iMax = parseFloat(interceptRangeMax.value);
    const sMin = parseFloat(slopeRangeMin.value);
    const sMax = parseFloat(slopeRangeMax.value);

    if ([iMin, iMax, sMin, sMax].some(isNaN)) {
        toast(i18next.t('toast.rangeError.nan'), 'error'); return;
    }
    if (iMin >= iMax || sMin >= sMax) {
        toast(i18next.t('toast.rangeError.minMax'), 'error'); return;
    }

    const newRanges = {
        intercept: { min: iMin, max: iMax },
        slope: { min: sMin, max: sMax },
    };
    localStorage.setItem(RANGE_CONFIG_KEY, JSON.stringify(newRanges));
    applyRanges(newRanges);
    rangeConfigModal.hide();
    toast(i18next.t('toast.rangeSaved'), 'success');
}

// --- Chart.js 函数 ---
function calculateChartData(params) {
    const labels = [];
    const datasets = [];
    const colors = {
        red: 'rgba(255, 99, 132, 1)',
        green: 'rgba(75, 192, 192, 1)',
        blue: 'rgba(54, 162, 235, 1)',
    };

    for (const color in params) {
        const data = [];
        const { intercept, slope } = params[color];
        for (let p = 0; p <= 100; p += 2) {
            const systemBrightness = Math.max(1, scaleToSystemBrightness(p));
            const log_b = Math.log(systemBrightness);
            const final_val = intercept + (slope * log_b);
            if (p === 0) labels.push(0);
            data.push(final_val);
        }
        datasets.push({
            label: i18next.t(`params.${color}`),
            data: data,
            borderColor: colors[color],
            backgroundColor: colors[color].replace('1)', '0.2)'),
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0
        });
    }
    
    return { labels: Array.from({length: 51}, (_, i) => i * 2), datasets };
}

function initChart() {
    if (colorChart) colorChart.destroy();
    const isDarkMode = document.documentElement.dataset.mdbTheme === 'dark';
    const tickColor = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const chartData = calculateChartData(globalConfig);
    const ctx = chartCanvas.getContext('2d');
    colorChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: i18next.t('status.brightness'), color: tickColor }, ticks: { color: tickColor }, grid: { color: gridColor } },
                y: { title: { display: true, text: i18next.t('chart.yAxisTitle'), color: tickColor }, ticks: { color: tickColor }, grid: { color: gridColor } }
            },
            plugins: { legend: { display: true, labels: { color: tickColor } } }
        }
    });
}

function updateChart() {
    if (!chartCanvas) return;
    if (colorChart) {
        const isDarkMode = document.documentElement.dataset.mdbTheme === 'dark';
        const tickColor = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
        const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
        
        colorChart.data = calculateChartData(globalConfig);
        colorChart.options.scales.x.title.text = i18next.t('status.brightness');
        colorChart.options.scales.x.title.color = tickColor;
        colorChart.options.scales.x.ticks.color = tickColor;
        colorChart.options.scales.x.grid.color = gridColor;
        colorChart.options.scales.y.title.text = i18next.t('chart.yAxisTitle');
        colorChart.options.scales.y.title.color = tickColor;
        colorChart.options.scales.y.ticks.color = tickColor;
        colorChart.options.scales.y.grid.color = gridColor;
        colorChart.options.plugins.legend.labels.color = tickColor;
        
        colorChart.update('none');
    } else {
        initChart();
    }
}

// --- 核心逻辑 ---
async function applyKcal(params) {
    if (!params) return;
    try {
        const red_i = Math.round(params.red.intercept * FIXED_PRECISION);
        const red_s = Math.round(params.red.slope * FIXED_PRECISION);
        const green_i = Math.round(params.green.intercept * FIXED_PRECISION);
        const green_s = Math.round(params.green.slope * FIXED_PRECISION);
        const blue_i = Math.round(params.blue.intercept * FIXED_PRECISION);
        const blue_s = Math.round(params.blue.slope * FIXED_PRECISION);

        await exec(`echo "${red_i} ${red_s} ${currentRefreshRate}" > ${KCAL_RED_PATH}`);
        await exec(`echo "${green_i} ${green_s} ${currentRefreshRate}" > ${KCAL_GREEN_PATH}`);
        await exec(`echo "${blue_i} ${blue_s} ${currentRefreshRate}" > ${KCAL_BLUE_PATH}`);
    } catch (e) {
        console.warn(`应用Kcal失败: ${e.message}`);
    }
}

function parseConfig(text) {
    const content = text.trim();
    if (!content) return null;
    const parts = content.split(/\s+/);
    if (parts.length === 6) { // 新的6参数格式
        const [ri, rs, gi, gs, bi, bs] = parts.map(p => parseInt(p, 10));
        if ([ri, rs, gi, gs, bi, bs].some(isNaN)) return null;
        
        return {
            red: { intercept: ri / FIXED_PRECISION, slope: rs / FIXED_PRECISION },
            green: { intercept: gi / FIXED_PRECISION, slope: gs / FIXED_PRECISION },
            blue: { intercept: bi / FIXED_PRECISION, slope: bs / FIXED_PRECISION },
        };
    }
    return null;
}

function serializeConfig(params) {
    const ri = Math.round(params.red.intercept * FIXED_PRECISION);
    const rs = Math.round(params.red.slope * FIXED_PRECISION);
    const gi = Math.round(params.green.intercept * FIXED_PRECISION);
    const gs = Math.round(params.green.slope * FIXED_PRECISION);
    const bi = Math.round(params.blue.intercept * FIXED_PRECISION);
    const bs = Math.round(params.blue.slope * FIXED_PRECISION);
    return `${ri} ${rs} ${gi} ${gs} ${bi} ${bs}`;
}

async function readKcalNodeAsConfig() {
    try {
        const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`);
        const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`);

        const [ri, rs] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [gi, gs] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [bi, bs] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));

        if ([ri, rs, gi, gs, bi, bs].some(isNaN)) return null;

        return {
            red: { intercept: ri / FIXED_PRECISION, slope: rs / FIXED_PRECISION },
            green: { intercept: gi / FIXED_PRECISION, slope: gs / FIXED_PRECISION },
            blue: { intercept: bi / FIXED_PRECISION, slope: bs / FIXED_PRECISION },
        };
    } catch (e) {
        console.error("读取Kcal节点作为默认值失败:", e);
        return null;
    }
}

async function loadConfigAndRender() {
    let loadedConfig = null;
    const filename = currentConfigPath.split('/').pop();
    try {
        const { stdout } = await exec(`cat ${currentConfigPath}`);
        loadedConfig = parseConfig(stdout);
    } catch (e) { /* 文件不存在或读取失败，忽略错误 */ }

    if (loadedConfig) {
        globalConfig = loadedConfig;
        toast(i18next.t('toast.configLoaded', { file: filename }), 'success');
    } else {
        toast(i18next.t('toast.configLoadFailed', { file: filename }), 'info');
        const nodeConfig = await readKcalNodeAsConfig();
        if (nodeConfig) {
            globalConfig = nodeConfig;
            toast(i18next.t('toast.configLoadFromNode'), 'success');
        } else {
            globalConfig = JSON.parse(JSON.stringify(defaultConfig));
            toast(i18next.t('toast.configLoadFromNodeFailed'), 'warning');
        }
    }

    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
}

function renderUI(params) {
    for (const color in uiElements) {
        const { intercept, slope } = params[color];
        const elements = uiElements[color];
        elements.interceptInput.value = intercept.toFixed(2);
        elements.interceptSlider.value = Math.max(elements.interceptSlider.min, Math.min(intercept * FIXED_PRECISION, elements.interceptSlider.max));
        elements.slopeInput.value = slope.toFixed(2);
        elements.slopeSlider.value = Math.max(elements.slopeSlider.min, Math.min(slope * FIXED_PRECISION, elements.slopeSlider.max));
    }
    document.querySelectorAll('.form-outline').forEach((formOutline) => {
        new Input(formOutline).update();
    });
}

// --- 事件处理器 ---
async function saveConfig() {
    const configString = serializeConfig(globalConfig);
    const command = `echo '${configString}' > ${currentConfigPath}`;
    const filename = currentConfigPath.split('/').pop();
    try {
        await exec(command);
        toast(i18next.t('toast.saved', { file: filename }), 'success');
    }
    catch (e) {
        toast(i18next.t('toast.saveFailed', { error: e.message }), 'error');
    }
}

function resetGlobalConfig() {
    globalConfig = JSON.parse(JSON.stringify(defaultConfig));
    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
    toast(i18next.t('toast.reset'), 'info');
}

async function readAndShowNodeStatus() {
    const parsedOutputElem = document.getElementById('parsedNodeOutput');
    parsedOutputElem.innerHTML = i18next.t('status.reading');
    nodeStatusModal.show();
    try {
        const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`);
        const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`);

        const [ri, rs, rr] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [gi, gs, gr] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [bi, bs, br] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));

        if ([ri, rs, rr, gi, gs, gr, bi, bs, br].some(isNaN)) {
            parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeParseError')}</p>`;
            return;
        }

        parsedOutputElem.innerHTML = `
            <h6 class="text-danger">${i18next.t('params.red')}</h6>
            <ul>
                <li><strong>Intercept:</strong> ${(ri / FIXED_PRECISION).toFixed(2)} (raw: ${ri})</li>
                <li><strong>Slope:</strong> ${(rs / FIXED_PRECISION).toFixed(2)} (raw: ${rs})</li>
                <li><strong>Refresh Rate:</strong> ${rr} Hz</li>
            </ul>
            <hr/>
            <h6 class="text-success">${i18next.t('params.green')}</h6>
            <ul>
                <li><strong>Intercept:</strong> ${(gi / FIXED_PRECISION).toFixed(2)} (raw: ${gi})</li>
                <li><strong>Slope:</strong> ${(gs / FIXED_PRECISION).toFixed(2)} (raw: ${gs})</li>
                <li><strong>Refresh Rate:</strong> ${gr} Hz</li>
            </ul>
            <hr/>
            <h6 class="text-primary">${i18next.t('params.blue')}</h6>
            <ul>
                <li><strong>Intercept:</strong> ${(bi / FIXED_PRECISION).toFixed(2)} (raw: ${bi})</li>
                <li><strong>Slope:</strong> ${(bs / FIXED_PRECISION).toFixed(2)} (raw: ${bs})</li>
                <li><strong>Refresh Rate:</strong> ${br} Hz</li>
            </ul>
        `;
    } catch (e) {
        parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeReadPermission')}</p>`;
    }
}

// --- 初始化 ---
async function fetchInitialRefreshRate() {
    try {
        const { stdout } = await exec('settings get system peak_refresh_rate');
        const rate = Math.round(parseFloat(stdout.trim()));
        currentRefreshRate = rate > 0 ? rate : 60;
        refreshRateValue.innerText = `${currentRefreshRate} Hz`;
        refreshRateValue.className = 'badge bg-success';
    } catch (e) {
        currentRefreshRate = 60;
        refreshRateValue.innerText = i18next.t('status.refreshRateReadError');
        refreshRateValue.className = 'badge bg-danger';
        console.error("获取刷新率失败:", e);
    }
    lastKnownRefreshRate = currentRefreshRate;
}

async function init() {
    await i18next.ready;
    
    initMDB({ Ripple, Range, Input, Modal });
    updateUIText();
    updateTheme();
    nodeStatusModal = new Modal(document.getElementById('nodeStatusModal'));
    rangeConfigModal = new Modal(document.getElementById('rangeConfigModal'));
    
    loadAndApplyRanges();

    await fetchInitialRefreshRate();
    currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;

    try {
        const { stdout: max } = await exec(`cat ${MAX_BRIGHTNESS_PATH}`);
        maxBrightness = parseInt(max.trim());
        const { stdout: cur } = await exec(`cat ${BACKLIGHT_PATH}`);
        const currentSystemVal = parseInt(cur.trim());
        lastKnownBrightness = currentSystemVal;
        brightnessSlider.disabled = false;
        const percentage = Math.round(((currentSystemVal - 1) / (maxBrightness - 1)) * 100);
        brightnessSlider.value = percentage;
        brightnessValue.innerText = i18next.t('status.brightnessValue', { value: currentSystemVal, percent: percentage });
    } catch (e) {
        brightnessValue.innerText = i18next.t('status.brightnessReadError');
        brightnessSlider.disabled = true;
        toast(i18next.t('toast.backlightPathError'), 'error');
    }
    
    await loadConfigAndRender();
    
    // --- 事件监听器 ---
    brightnessSlider.addEventListener('input', (e) => setSystemBrightness(parseInt(e.target.value)));
    saveButton.addEventListener('click', saveConfig);
    resetConfigButton.addEventListener('click', resetGlobalConfig);
    readNodeButton.addEventListener('click', readAndShowNodeStatus);
    
    toggleEditModeButton.addEventListener('click', () => {
        const willEnterEditMode = !isEditMode;
        toggleEditMode(willEnterEditMode);
        if (willEnterEditMode) {
            toast(i18next.t('toast.editMode'), 'info');
        }
    });

    customizeRangeButton.addEventListener('click', () => {
        interceptRangeMin.value = defaultRanges.intercept.min;
        interceptRangeMax.value = defaultRanges.intercept.max;
        slopeRangeMin.value = defaultRanges.slope.min;
        slopeRangeMax.value = defaultRanges.slope.max;
        initMDB({ Input });
        rangeConfigModal.show();
    });
    saveRangeButton.addEventListener('click', saveRanges);

    const handleParamChange = (color, param, value) => {
        globalConfig[color][param] = value;
        renderUI(globalConfig);
        applyKcal(globalConfig);
        updateChart();
    };
    
    for (const color in uiElements) {
        const elements = uiElements[color];
        elements.interceptSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10) / FIXED_PRECISION;
            handleParamChange(color, 'intercept', val);
        });
        elements.interceptInput.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value) || 0;
            handleParamChange(color, 'intercept', val);
        });
        elements.slopeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10) / FIXED_PRECISION;
            handleParamChange(color, 'slope', val);
        });
        elements.slopeInput.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value) || 0;
            handleParamChange(color, 'slope', val);
        });
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    i18next.on('languageChanged', () => updateUIText());

    toggleEditMode(false);

    setInterval(pollSystemStatus, 1000);
}

document.addEventListener('DOMContentLoaded', init);