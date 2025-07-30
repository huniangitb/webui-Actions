// 导入 MDB-UI-Kit 组件 和 Chart.js
import Chart from 'chart.js/auto';
import { Ripple, Range, Input, Modal, initMDB } from 'mdb-ui-kit';
import { exec, toast } from 'kernelsu';
import i18next from './i18n.js';
import { mdiMagicStaff, mdiTune, mdiArrowLeft, mdiSync, mdiRestore } from '@mdi/js';

// --- 常量和全局变量 ---
const MODULE_ID = "miuicx_color_tuner";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
let currentConfigPath = '';
const KCAL_RED_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_red";
const KCAL_GREEN_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_green";
const KCAL_BLUE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_blue";

const BACKLIGHT_PATH = "/sys/class/backlight/panel0-backlight/brightness";
const MAX_BRIGHTNESS_PATH = "/sys/class/backlight/panel0-backlight/max_brightness";

const FIXED_PRECISION = 100;

const defaultConfig = {
    red: { intercept: 256.0, slope: 0.0 },
    green: { intercept: 256.0, slope: 0.0 },
    blue: { intercept: 256.0, slope: 0.0 },
};

const icons = { mdiMagicStaff, mdiTune, mdiArrowLeft, mdiSync, mdiRestore };

let globalConfig = JSON.parse(JSON.stringify(defaultConfig)); // 深拷贝
let maxBrightness = 4095;
let currentRefreshRate = 60;
let colorChart = null;
let nodeStatusModal = null;
let wizardModal = null;
let isAdvancedMode = false;
let lastKnownRefreshRate = 0;
let lastKnownBrightness = -1;
let originalConfigForWizard = null;
let brightnessBeforeWizard = -1;

// --- DOM 元素 ---
const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessValue = document.getElementById('brightnessValue');
const refreshRateValue = document.getElementById('refreshRateValue');
const saveButton = document.getElementById('saveButton');
const resetConfigButton = document.getElementById('resetConfigButton');
const readNodeButton = document.getElementById('readNodeButton');
const chartCanvas = document.getElementById('colorCurveChart');
const advancedConfigEditor = document.getElementById('advanced-config-editor');
const advancedModeButton = document.getElementById('advancedModeButton');
const wizardButton = document.getElementById('wizardButton');

const uiElements = {
    red: { interceptSlider: document.getElementById('redInterceptSlider'), interceptInput: document.getElementById('redInterceptInput'), slopeSlider: document.getElementById('redSlopeSlider'), slopeInput: document.getElementById('redSlopeInput') },
    green: { interceptSlider: document.getElementById('greenInterceptSlider'), interceptInput: document.getElementById('greenInterceptInput'), slopeSlider: document.getElementById('greenSlopeSlider'), slopeInput: document.getElementById('greenSlopeInput') },
    blue: { interceptSlider: document.getElementById('blueInterceptSlider'), interceptInput: document.getElementById('blueInterceptInput'), slopeSlider: document.getElementById('blueSlopeSlider'), slopeInput: document.getElementById('blueSlopeInput') },
};

// Wizard DOM Elements
const wizardModalElement = document.getElementById('wizardModal');
const wizardStep1 = document.getElementById('wizardStep1');
const wizardStep2 = document.getElementById('wizardStep2');
const wizardBrightness1 = document.getElementById('wizardBrightness1');
const wizardBrightness2 = document.getElementById('wizardBrightness2');
const wizardNextButton = document.getElementById('wizardNextButton');
const wizardFinishButton = document.getElementById('wizardFinishButton');
const wizardCancelButton = document.getElementById('wizardCancelButton');

// [新增] 向导中的滑块和输入框元素
const wizardControls = {
    step1: {
        red: { slider: document.getElementById('wizardColorR1'), input: document.getElementById('wizardColorR1_input') },
        green: { slider: document.getElementById('wizardColorG1'), input: document.getElementById('wizardColorG1_input') },
        blue: { slider: document.getElementById('wizardColorB1'), input: document.getElementById('wizardColorB1_input') },
    },
    step2: {
        red: { slider: document.getElementById('wizardColorR2'), input: document.getElementById('wizardColorR2_input') },
        green: { slider: document.getElementById('wizardColorG2'), input: document.getElementById('wizardColorG2_input') },
        blue: { slider: document.getElementById('wizardColorB2'), input: document.getElementById('wizardColorB2_input') },
    }
};
let wizardData = {};

// --- SVG 图标创建函数 (无修改) ---
function createIcon(path) { if (!path) return ''; return `<svg class="svg-icon me-2" viewBox="0 0 24 24"><path d="${path}" /></svg>`; }

// --- 轮询函数 (无修改) ---
async function pollSystemStatus() {
    try {
        const { stdout } = await exec('settings get system peak_refresh_rate');
        const newRate = Math.round(parseFloat(stdout.trim())) || 60;
        if (newRate !== lastKnownRefreshRate) {
            lastKnownRefreshRate = newRate; currentRefreshRate = newRate; refreshRateValue.innerText = `${currentRefreshRate} Hz`;
            currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
            toast(i18next.t('toast.refreshRateChanged', { rate: newRate }), 'info');
            await loadConfigAndRender();
        }
    } catch (e) { /* 忽略错误 */ }
    try {
        if (wizardModal && wizardModal._isShown) return;
        const { stdout } = await exec(`cat ${BACKLIGHT_PATH}`);
        const newBrightness = parseInt(stdout.trim());
        if (newBrightness !== lastKnownBrightness) {
            lastKnownBrightness = newBrightness;
            const percentage = Math.round(((newBrightness - 1) / (maxBrightness - 1)) * 100);
            brightnessValue.innerText = i18next.t('status.brightnessValue', { value: newBrightness, percent: percentage });
            brightnessSlider.value = percentage;
        }
    } catch (e) { /* 忽略错误 */ }
}

// --- 多语言UI更新 (无修改) ---
function updateUIText() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = i18next.t(key, { returnObjects: true });
        if (typeof translation === 'object' && translation.icon && translation.text) {
            el.innerHTML = `${createIcon(icons[translation.icon])}${translation.text}`;
        } else { el.innerHTML = translation; }
    });
    document.documentElement.lang = i18next.language; document.title = i18next.t('title');
    document.querySelectorAll('.form-outline').forEach(formOutline => new Input(formOutline).update());
    updateChart(); toggleAdvancedMode(isAdvancedMode, false);
}

// --- UI模式切换 (无修改) ---
function toggleAdvancedMode(enable, showToast = true) {
    isAdvancedMode = enable; advancedConfigEditor.style.display = enable ? 'block' : 'none';
    const key = enable ? 'buttons.advancedMode.exit' : 'buttons.advancedMode.enter';
    const translation = i18next.t(key, { returnObjects: true });
    if (typeof translation === 'object') { advancedModeButton.innerHTML = `${createIcon(icons[translation.icon])}${translation.text}`; }
    if (enable) {
        advancedModeButton.classList.remove('btn-secondary'); advancedModeButton.classList.add('btn-primary');
        if (showToast) toast(i18next.t('toast.advancedMode.on'), 'info');
    } else {
        advancedModeButton.classList.remove('btn-primary'); advancedModeButton.classList.add('btn-secondary');
        if (showToast) toast(i18next.t('toast.advancedMode.off'), 'info');
    }
}

// --- 主题管理 (无修改) ---
function updateTheme() {
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-mdb-theme', isDarkMode ? 'dark' : 'light');
    updateChart();
}

// --- 工具函数 (无修改) ---
const scaleToSystemBrightness = (percentage) => Math.max(1, Math.round(1 + (percentage / 100) * (maxBrightness - 1)));
async function setSystemBrightness(percentage) {
    if (!BACKLIGHT_PATH) return;
    const systemValue = scaleToSystemBrightness(percentage);
    try {
        await exec(`echo ${systemValue} > ${BACKLIGHT_PATH}`);
        if (!wizardModal || !wizardModal._isShown) {
             brightnessValue.innerText = i18next.t('status.brightnessValue', { value: systemValue, percent: percentage });
             lastKnownBrightness = systemValue;
        }
    } catch (e) { toast(i18next.t('toast.saveFailed', { error: `Brightness: ${e.message}` }), 'error'); }
}

// --- Chart.js 函数 (无修改) ---
function calculateChartData(params) {
    const labels = []; const colorData = { red: [], green: [], blue: [] };
    for (let p = 1; p <= 100; p++) {
        labels.push(p); const systemBrightness = scaleToSystemBrightness(p); const log_b = Math.log(systemBrightness);
        for (const color in params) {
            const { intercept, slope } = params[color];
            colorData[color].push(intercept + (slope * log_b));
        }
    }
    const datasets = [
        { label: i18next.t('params.red'), data: colorData.red, borderColor: 'rgba(255, 99, 132, 1)', backgroundColor: 'rgba(255, 99, 132, 0.2)', tension: 0.1, borderWidth: 2, pointRadius: 0 },
        { label: i18next.t('params.green'), data: colorData.green, borderColor: 'rgba(75, 192, 192, 1)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.1, borderWidth: 2, pointRadius: 0 },
        { label: i18next.t('params.blue'), data: colorData.blue, borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: 'rgba(54, 162, 235, 0.2)', tension: 0.1, borderWidth: 2, pointRadius: 0 }
    ];
    return { labels, datasets };
}
function initChart() {
    if (colorChart) colorChart.destroy();
    const isDarkMode = document.documentElement.dataset.mdbTheme === 'dark';
    const tickColor = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const chartData = calculateChartData(globalConfig);
    colorChart = new Chart(chartCanvas.getContext('2d'), {
        type: 'line', data: chartData, options: {
            responsive: true, maintainAspectRatio: false, scales: {
                x: {
                    type: 'logarithmic', title: { display: true, text: i18next.t('status.brightness'), color: tickColor }, min: 1, max: 100,
                    ticks: {
                        color: tickColor,
                        callback: function (value) { const shown_ticks = [1, 2, 5, 10, 20, 50, 100]; if (shown_ticks.includes(Number(value))) return value + '%'; },
                        generateTicks: function () { return [{ value: 1 }, { value: 2 }, { value: 5 }, { value: 10 }, { value: 20 }, { value: 50 }, { value: 100 }]; }
                    }, grid: { color: gridColor }
                },
                y: { title: { display: true, text: i18next.t('chart.yAxisTitle'), color: tickColor }, ticks: { color: tickColor }, grid: { color: gridColor } }
            }, plugins: { legend: { display: true, labels: { color: tickColor } } }
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
        colorChart.options.scales.x.title.text = i18next.t('status.brightness'); colorChart.options.scales.x.title.color = tickColor;
        colorChart.options.scales.x.ticks.color = tickColor; colorChart.options.scales.x.grid.color = gridColor;
        colorChart.options.scales.y.title.text = i18next.t('chart.yAxisTitle'); colorChart.options.scales.y.title.color = tickColor;
        colorChart.options.scales.y.ticks.color = tickColor; colorChart.options.scales.y.grid.color = gridColor;
        colorChart.options.plugins.legend.labels.color = tickColor;
        colorChart.update();
    } else { initChart(); }
}

// --- 核心逻辑 (无修改) ---
async function applyKcal(params, useRefreshRate = currentRefreshRate) { if (!params) return; try { const cmds = Object.entries(params).map(([color, { intercept, slope }]) => { const i = Math.round(intercept * FIXED_PRECISION); const s = Math.round(slope * FIXED_PRECISION); const path = color === 'red' ? KCAL_RED_PATH : color === 'green' ? KCAL_GREEN_PATH : KCAL_BLUE_PATH; return `echo "${i} ${s} ${useRefreshRate}" > ${path}`; }); await exec(cmds.join(' && ')); } catch (e) { console.warn(`应用Kcal失败: ${e.message}`); } }
function parseConfig(text) { const parts = text.trim().split(/\s+/); if (parts.length !== 6) return null; const [ri, rs, gi, gs, bi, bs] = parts.map(p => parseInt(p, 10)); if ([ri, rs, gi, gs, bi, bs].some(isNaN)) return null; return { red: { intercept: ri / FIXED_PRECISION, slope: rs / FIXED_PRECISION }, green: { intercept: gi / FIXED_PRECISION, slope: gs / FIXED_PRECISION }, blue: { intercept: bi / FIXED_PRECISION, slope: bs / FIXED_PRECISION } }; }
function serializeConfig(params) { const ri = Math.round(params.red.intercept * FIXED_PRECISION); const rs = Math.round(params.red.slope * FIXED_PRECISION); const gi = Math.round(params.green.intercept * FIXED_PRECISION); const gs = Math.round(params.green.slope * FIXED_PRECISION); const bi = Math.round(params.blue.intercept * FIXED_PRECISION); const bs = Math.round(params.blue.slope * FIXED_PRECISION); return `${ri} ${rs} ${gi} ${gs} ${bi} ${bs}`; }
async function readKcalNodeAsConfig() { try { const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`); const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`); const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`); const [ri, rs] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); const [gi, gs] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); const [bi, bs] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); if ([ri, rs, gi, gs, bi, bs].some(isNaN)) return null; return { red: { intercept: ri / FIXED_PRECISION, slope: rs / FIXED_PRECISION }, green: { intercept: gi / FIXED_PRECISION, slope: gs / FIXED_PRECISION }, blue: { intercept: bi / FIXED_PRECISION, slope: bs / FIXED_PRECISION } }; } catch (e) { return null; } }
async function loadConfigAndRender() { let loadedConfig = null; const filename = currentConfigPath.split('/').pop(); try { const { stdout } = await exec(`cat ${currentConfigPath}`); loadedConfig = parseConfig(stdout); } catch (e) { /* 文件不存在或读取失败 */ } if (loadedConfig) { globalConfig = loadedConfig; toast(i18next.t('toast.configLoaded', { file: filename }), 'success'); } else { toast(i18next.t('toast.configLoadFailed', { file: filename }), 'info'); const nodeConfig = await readKcalNodeAsConfig(); if (nodeConfig) { globalConfig = nodeConfig; toast(i18next.t('toast.configLoadFromNode'), 'success'); } else { globalConfig = JSON.parse(JSON.stringify(defaultConfig)); toast(i18next.t('toast.configLoadFromNodeFailed'), 'warning'); } } renderUI(globalConfig); applyKcal(globalConfig); updateChart(); }
function renderUI(params) { for (const color in uiElements) { const { intercept, slope } = params[color]; uiElements[color].interceptInput.value = intercept.toFixed(2); uiElements[color].interceptSlider.value = intercept * FIXED_PRECISION; uiElements[color].slopeInput.value = slope.toFixed(2); uiElements[color].slopeSlider.value = slope * FIXED_PRECISION; } document.querySelectorAll('.form-outline').forEach(formOutline => new Input(formOutline).update()); }

// --- 事件处理器 (无修改) ---
async function saveConfig() { const configString = serializeConfig(globalConfig); const filename = currentConfigPath.split('/').pop(); try { await exec(`echo '${configString}' > ${currentConfigPath}`); toast(i18next.t('toast.saved', { file: filename }), 'success'); } catch (e) { toast(i18next.t('toast.saveFailed', { error: e.message }), 'error'); } }
function resetGlobalConfig() { globalConfig = JSON.parse(JSON.stringify(defaultConfig)); renderUI(globalConfig); applyKcal(globalConfig); updateChart(); toast(i18next.t('toast.reset'), 'info'); }
async function readAndShowNodeStatus() { const parsedOutputElem = document.getElementById('parsedNodeOutput'); parsedOutputElem.innerHTML = i18next.t('status.reading'); nodeStatusModal.show(); try { const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`); const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`); const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`); const [ri, rs, rr] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); const [gi, gs, gr] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); const [bi, bs, br] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10)); if ([ri, rs, rr, gi, gs, gr, bi, bs, br].some(isNaN)) { parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeParseError')}</p>`; return; } parsedOutputElem.innerHTML = `<h6 class="text-danger">${i18next.t('params.red')}</h6><ul><li>I: ${(ri / FIXED_PRECISION).toFixed(2)} (${ri})</li><li>S: ${(rs / FIXED_PRECISION).toFixed(2)} (${rs})</li><li>Hz: ${rr}</li></ul><hr/><h6 class="text-success">${i18next.t('params.green')}</h6><ul><li>I: ${(gi / FIXED_PRECISION).toFixed(2)} (${gi})</li><li>S: ${(gs / FIXED_PRECISION).toFixed(2)} (${gs})</li><li>Hz: ${gr}</li></ul><hr/><h6 class="text-primary">${i18next.t('params.blue')}</h6><ul><li>I: ${(bi / FIXED_PRECISION).toFixed(2)} (${bi})</li><li>S: ${(bs / FIXED_PRECISION).toFixed(2)} (${bs})</li><li>Hz: ${br}</li></ul>`; } catch (e) { parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeReadPermission')}</p>`; } }

// --- 向导逻辑 (已更新) ---
function calculateFit(point1, point2) {
    const x1 = Math.log(point1.brightness); const x2 = Math.log(point2.brightness);
    const y1 = point1.value; const y2 = point2.value;
    if (Math.abs(x1 - x2) < 1e-6) { return { intercept: y1, slope: 0 }; }
    const slope = (y2 - y1) / (x2 - x1);
    const intercept = y1 - slope * x1;
    return { intercept, slope };
}

function startWizard() {
    originalConfigForWizard = JSON.parse(JSON.stringify(globalConfig));
    brightnessBeforeWizard = lastKnownBrightness;
    wizardData = {
        step1: { brightnessPercent: 10, red: 256, green: 256, blue: 256 },
        step2: { brightnessPercent: 80, red: 256, green: 256, blue: 256 }
    };
    
    // 初始化步骤1和步骤2的滑块和输入框
    for (const stepKey in wizardControls) {
        const step = wizardControls[stepKey];
        const data = wizardData[stepKey];
        for (const colorKey in step) {
            const control = step[colorKey];
            const value = data[colorKey];
            control.slider.value = value * FIXED_PRECISION;
            control.input.value = value.toFixed(2);
        }
    }
    
    wizardBrightness1.value = wizardData.step1.brightnessPercent;
    wizardBrightness2.value = wizardData.step2.brightnessPercent;
    
    // [新增] 初始化 MDB 输入框的浮动标签
    document.querySelectorAll('#wizardModal .form-outline').forEach(formOutline => {
        new Input(formOutline).update();
    });

    wizardStep1.style.display = 'block';
    wizardStep2.style.display = 'none';
    wizardNextButton.style.display = 'block';
    wizardFinishButton.style.display = 'none';
    
    wizardModal.show();
    setSystemBrightness(wizardData.step1.brightnessPercent);
}

function handleWizardNext() {
    // 从输入框读取数据，因为它是最准确的
    wizardData.step1.brightnessPercent = parseInt(wizardBrightness1.value);
    wizardData.step1.red = parseFloat(wizardControls.step1.red.input.value);
    wizardData.step1.green = parseFloat(wizardControls.step1.green.input.value);
    wizardData.step1.blue = parseFloat(wizardControls.step1.blue.input.value);

    wizardStep1.style.display = 'none';
    wizardStep2.style.display = 'block';
    wizardNextButton.style.display = 'none';
    wizardFinishButton.style.display = 'block';
    
    setSystemBrightness(wizardData.step2.brightnessPercent);
    handleWizardColorPreview(2);
}

function handleWizardFinish() {
    wizardData.step2.brightnessPercent = parseInt(wizardBrightness2.value);
    wizardData.step2.red = parseFloat(wizardControls.step2.red.input.value);
    wizardData.step2.green = parseFloat(wizardControls.step2.green.input.value);
    wizardData.step2.blue = parseFloat(wizardControls.step2.blue.input.value);

    const b1 = scaleToSystemBrightness(wizardData.step1.brightnessPercent);
    const b2 = scaleToSystemBrightness(wizardData.step2.brightnessPercent);

    globalConfig = {
        red: calculateFit({ brightness: b1, value: wizardData.step1.red }, { brightness: b2, value: wizardData.step2.red }),
        green: calculateFit({ brightness: b1, value: wizardData.step1.green }, { brightness: b2, value: wizardData.step2.green }),
        blue: calculateFit({ brightness: b1, value: wizardData.step1.blue }, { brightness: b2, value: wizardData.step2.blue }),
    };

    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
    wizardModal.hide();
    toast(i18next.t('toast.wizardComplete'), 'success');
}

function handleWizardCancel() {
    applyKcal(originalConfigForWizard); 
    wizardModal.hide();
    toast(i18next.t('toast.wizardCancelled'), 'info');
}

function handleWizardColorPreview(stepNum) {
    const brightnessPercent = parseInt(stepNum === 1 ? wizardBrightness1.value : wizardBrightness2.value);
    setSystemBrightness(brightnessPercent);
    
    const controls = wizardControls[`step${stepNum}`];
    const r = parseFloat(controls.red.input.value);
    const g = parseFloat(controls.green.input.value);
    const b = parseFloat(controls.blue.input.value);

    applyKcal({ red: { intercept: r, slope: 0 }, green: { intercept: g, slope: 0 }, blue: { intercept: b, slope: 0 } });
}

// --- 初始化 ---
async function fetchInitialSystemState() { try { const { stdout } = await exec('settings get system peak_refresh_rate'); const rate = Math.round(parseFloat(stdout.trim())); currentRefreshRate = rate > 0 ? rate : 60; refreshRateValue.innerText = `${currentRefreshRate} Hz`; } catch (e) { currentRefreshRate = 60; refreshRateValue.innerText = i18next.t('status.refreshRateReadError'); } lastKnownRefreshRate = currentRefreshRate; try { const { stdout: max } = await exec(`cat ${MAX_BRIGHTNESS_PATH}`); maxBrightness = parseInt(max.trim()); const { stdout: cur } = await exec(`cat ${BACKLIGHT_PATH}`); const currentSystemVal = parseInt(cur.trim()); lastKnownBrightness = currentSystemVal; const percentage = Math.round(((currentSystemVal - 1) / (maxBrightness - 1)) * 100); brightnessSlider.value = percentage; brightnessValue.innerText = i18next.t('status.brightnessValue', { value: currentSystemVal, percent: percentage }); brightnessSlider.disabled = false; } catch (e) { brightnessValue.innerText = i18next.t('status.brightnessReadError'); brightnessSlider.disabled = true; toast(i18next.t('toast.backlightPathError'), 'error'); } }

async function init() {
    await i18next.ready;
    initMDB({ Ripple, Range, Input, Modal });
    
    updateUIText();
    updateTheme();
    nodeStatusModal = new Modal(document.getElementById('nodeStatusModal'));
    wizardModal = new Modal(wizardModalElement);
    
    await fetchInitialSystemState();
    currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
    await loadConfigAndRender();
    
    // --- 事件监听器 ---
    brightnessSlider.addEventListener('input', (e) => setSystemBrightness(parseInt(e.target.value)));
    saveButton.addEventListener('click', saveConfig);
    resetConfigButton.addEventListener('click', resetGlobalConfig);
    readNodeButton.addEventListener('click', readAndShowNodeStatus);
    wizardButton.addEventListener('click', startWizard);
    advancedModeButton.addEventListener('click', () => toggleAdvancedMode(!isAdvancedMode));

    for (const color in uiElements) {
        const elements = uiElements[color];
        const handleParamChange = (param, value) => { globalConfig[color][param] = value; renderUI(globalConfig); applyKcal(globalConfig); updateChart(); };
        elements.interceptSlider.addEventListener('input', (e) => handleParamChange('intercept', parseInt(e.target.value, 10) / FIXED_PRECISION));
        elements.interceptInput.addEventListener('change', (e) => { const val = parseFloat(e.target.value) || 0; const clampedVal = Math.max(0, Math.min(val, 256)); handleParamChange('intercept', clampedVal); });
        elements.slopeSlider.addEventListener('input', (e) => handleParamChange('slope', parseInt(e.target.value, 10) / FIXED_PRECISION));
        elements.slopeInput.addEventListener('change', (e) => handleParamChange('slope', parseFloat(e.target.value) || 0));
    }

    // [新增] 向导控件的双向绑定
    for (const stepNum of [1, 2]) {
        const stepKey = `step${stepNum}`;
        for (const colorKey in wizardControls[stepKey]) {
            const { slider, input } = wizardControls[stepKey][colorKey];

            // 滑块 -> 输入框
            slider.addEventListener('input', () => {
                const value = parseInt(slider.value) / FIXED_PRECISION;
                input.value = value.toFixed(2);
                handleWizardColorPreview(stepNum);
            });

            // 输入框 -> 滑块
            input.addEventListener('change', () => {
                const value = parseFloat(input.value) || 0;
                const clampedValue = Math.max(0, Math.min(value, 256));
                if (value !== clampedValue) {
                    input.value = clampedValue.toFixed(2);
                }
                slider.value = clampedValue * FIXED_PRECISION;
                handleWizardColorPreview(stepNum);
            });
        }
    }

    wizardNextButton.addEventListener('click', handleWizardNext);
    wizardFinishButton.addEventListener('click', handleWizardFinish);
    wizardCancelButton.addEventListener('click', handleWizardCancel);
    wizardModalElement.addEventListener('hidden.mdb.modal', () => {
        if (brightnessBeforeWizard !== -1) {
            const originalPercentage = Math.round(((brightnessBeforeWizard - 1) / (maxBrightness - 1)) * 100);
            setSystemBrightness(originalPercentage);
            brightnessBeforeWizard = -1;
        }
    });
    
    wizardBrightness1.addEventListener('input', () => setSystemBrightness(parseInt(wizardBrightness1.value)));
    wizardBrightness2.addEventListener('input', () => setSystemBrightness(parseInt(wizardBrightness2.value)));

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    i18next.on('languageChanged', () => updateUIText());

    toggleAdvancedMode(false, false);
    setInterval(pollSystemStatus, 1000);
}

document.addEventListener('DOMContentLoaded', init);