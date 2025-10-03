import Chart from 'chart.js/auto';
import { Ripple, Range, Input, Modal, initMDB } from 'mdb-ui-kit';
import { exec, toast } from 'kernelsu';
import i18next from './i18n.js';
import { mdiMagicStaff, mdiTune, mdiArrowLeft, mdiSync, mdiRestore } from '@mdi/js';

const MODULE_ID = "miuicx_color_tuner";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
let currentConfigPath = '';

// Kcal节点路径
const KCAL_RED_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_red";
const KCAL_GREEN_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_green";
const KCAL_BLUE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_blue";
const KCAL_SAT_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_sat";
const KCAL_HUE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_hue";
const KCAL_CONT_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_cont";
const KCAL_VAL_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_val";
const KCAL_ENABLE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_enable";
const BACKLIGHT_PATH = "/sys/class/backlight/panel0-backlight/brightness";
const MAX_BRIGHTNESS_PATH = "/sys/class/backlight/panel0-backlight/max_brightness";

const SLOPE_PRECISION = 100;
const HUE_NODE_MAX = 1536;
const HUE_UI_MAX = 360;

// 默认配置 (现在包含所有参数)
const defaultConfig = {
    red: { intercept: 256.0, slope: 0.0 },
    green: { intercept: 256.0, slope: 0.0 },
    blue: { intercept: 256.0, slope: 0.0 },
    sat: 255,
    hue: 0,
    cont: 255,
    val: 255,
};

const icons = { mdiMagicStaff, mdiTune, mdiArrowLeft, mdiSync, mdiRestore };

const refreshRateColorStops = [
    { rate: 30, color: [57, 192, 237] },
    { rate: 60, color: [0, 183, 74] },
    { rate: 90, color: [255, 153, 51] },
    { rate: 144, color: [249, 49, 84] }
];

// 全局状态变量
let globalConfig = JSON.parse(JSON.stringify(defaultConfig));
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
let isKcalEnabled = true;

// DOM元素引用
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
const configContentContainer = document.getElementById('configContentContainer');
const configDescription = document.getElementById('configDescription');
const satSlider = document.getElementById('satSlider');
const satInput = document.getElementById('satInput');
const hueSlider = document.getElementById('hueSlider');
const hueInput = document.getElementById('hueInput');
const contSlider = document.getElementById('contSlider');
const contInput = document.getElementById('contInput');
const valSlider = document.getElementById('valSlider');
const valInput = document.getElementById('valInput');
const saveAdvColorButton = document.getElementById('saveAdvColorButton');
const resetAdvColorButton = document.getElementById('resetAdvColorButton');

const uiElements = {
    red: { interceptSlider: document.getElementById('redInterceptSlider'), interceptInput: document.getElementById('redInterceptInput'), slopeSlider: document.getElementById('redSlopeSlider'), slopeInput: document.getElementById('redSlopeInput') },
    green: { interceptSlider: document.getElementById('greenInterceptSlider'), interceptInput: document.getElementById('greenInterceptInput'), slopeSlider: document.getElementById('greenSlopeSlider'), slopeInput: document.getElementById('greenSlopeInput') },
    blue: { interceptSlider: document.getElementById('blueInterceptSlider'), interceptInput: document.getElementById('blueInterceptInput'), slopeSlider: document.getElementById('blueSlopeSlider'), slopeInput: document.getElementById('blueSlopeInput') },
};

const wizardModalElement = document.getElementById('wizardModal');
const wizardStep1 = document.getElementById('wizardStep1');
const wizardStep2 = document.getElementById('wizardStep2');
const wizardBrightness1 = document.getElementById('wizardBrightness1');
const wizardBrightness2 = document.getElementById('wizardBrightness2');
const wizardNextButton = document.getElementById('wizardNextButton');
const wizardFinishButton = document.getElementById('wizardFinishButton');
const wizardCancelButton = document.getElementById('wizardCancelButton');

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

function createIcon(path) { if (!path) return ''; return `<svg class="svg-icon me-2" viewBox="0 0 24 24"><path d="${path}" /></svg>`; }
function interpolateColor(color1, color2, factor) { const result = color1.slice(); for (let i = 0; i < 3; i++) { result[i] = Math.round(color1[i] + factor * (color2[i] - color1[i])); } return result; }
const uiToNodeHue = (uiValue) => Math.round(uiValue * (HUE_NODE_MAX / HUE_UI_MAX));
const nodeToUiHue = (nodeValue) => Math.round(nodeValue * (HUE_UI_MAX / HUE_NODE_MAX));

async function pollSystemStatus() {
    try {
        const { stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const newRate = parseInt(stdout.trim().split(/\s+/)[2]) || 60;
        if (newRate !== lastKnownRefreshRate) {
            lastKnownRefreshRate = newRate; currentRefreshRate = newRate; updateRefreshRateUI(newRate);
            currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
            toast(i18next.t('toast.refreshRateChanged', { rate: newRate }), 'info');
            await loadConfigAndRender();
        }
    } catch (e) {}
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
    } catch (e) {}
    try {
        const { stdout } = await exec(`cat ${KCAL_ENABLE_PATH}`);
        const newEnabledState = stdout.trim() === '1';
        if (newEnabledState !== isKcalEnabled) {
            isKcalEnabled = newEnabledState;
            updateKcalEnableUI(isKcalEnabled);
        }
    } catch (e) {}
}

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

function toggleAdvancedMode(enable, showToast = true) {
    isAdvancedMode = enable; 
    advancedConfigEditor.style.display = enable ? 'block' : 'none';
    wizardButton.style.display = enable ? 'none' : 'block';
    configDescription.classList.toggle('hidden', enable);
    const key = enable ? 'buttons.advancedMode.exit' : 'buttons.advancedMode.enter';
    const translation = i18next.t(key, { returnObjects: true });
    if (typeof translation === 'object') { advancedModeButton.innerHTML = `${createIcon(icons[translation.icon])}${translation.text}`; }
    if (enable) {
        advancedModeButton.classList.remove('btn-secondary'); advancedModeButton.classList.add('btn-primary');
        if (showToast) toast(i18next.t('toast.advancedMode.on'), 'info');
    } else {
        advancedModeButton.classList.remove('btn-primary'); advancedModeButton.classList.add('btn-secondary');
        if (showToast) toast(i18next.t('toast.advancedMode.off'), 'info');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function updateTheme() {
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-mdb-theme', isDarkMode ? 'dark' : 'light');
    updateChart();
}

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

function updateKcalEnableUI(enabled) {
    isKcalEnabled = enabled;
    configContentContainer.classList.toggle('content-hidden', !enabled);
}

function updateRefreshRateUI(rate) {
    refreshRateValue.innerText = `${rate} Hz`;
    let color;
    if (rate <= refreshRateColorStops[0].rate) {
        color = refreshRateColorStops[0].color;
    } else if (rate >= refreshRateColorStops[refreshRateColorStops.length - 1].rate) {
        color = refreshRateColorStops[refreshRateColorStops.length - 1].color;
    } else {
        let lowerStop, upperStop;
        for (let i = 0; i < refreshRateColorStops.length - 1; i++) {
            if (rate >= refreshRateColorStops[i].rate && rate < refreshRateColorStops[i + 1].rate) {
                lowerStop = refreshRateColorStops[i];
                upperStop = refreshRateColorStops[i + 1];
                break;
            }
        }
        const range = upperStop.rate - lowerStop.rate;
        const factor = (rate - lowerStop.rate) / range;
        color = interpolateColor(lowerStop.color, upperStop.color, factor);
    }
    refreshRateValue.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function calculateChartData(params) {
    const labels = []; const colorData = { red: [], green: [], blue: [] };
    for (let p = 1; p <= 100; p++) {
        labels.push(p); const systemBrightness = scaleToSystemBrightness(p); const log_b = Math.log(systemBrightness);
        for (const color of ['red', 'green', 'blue']) {
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
        colorChart.options.scales.x.title.text = i18next.t('status.brightness');
        colorChart.options.scales.x.title.color = tickColor;
        colorChart.options.scales.x.ticks.color = tickColor;
        colorChart.options.scales.x.grid.color = gridColor;
        colorChart.options.scales.y.title.text = i18next.t('chart.yAxisTitle');
        colorChart.options.scales.y.title.color = tickColor;
        colorChart.options.scales.y.ticks.color = tickColor;
        colorChart.options.scales.y.grid.color = gridColor;
        colorChart.options.plugins.legend.labels.color = tickColor;
        colorChart.update();
    } else { 
        initChart();
    }
}

// 新的统一应用函数
async function applyAllKcalSettings(config, useRefreshRate = currentRefreshRate) {
    if (!config) return;
    try {
        const cmds = [
            `echo "${Math.round(config.red.intercept * 100)} ${Math.round(config.red.slope * SLOPE_PRECISION)} ${useRefreshRate}" > ${KCAL_RED_PATH}`,
            `echo "${Math.round(config.green.intercept * 100)} ${Math.round(config.green.slope * SLOPE_PRECISION)} ${useRefreshRate}" > ${KCAL_GREEN_PATH}`,
            `echo "${Math.round(config.blue.intercept * 100)} ${Math.round(config.blue.slope * SLOPE_PRECISION)} ${useRefreshRate}" > ${KCAL_BLUE_PATH}`,
            `echo "${config.sat} ${useRefreshRate}" > ${KCAL_SAT_PATH}`,
            `echo "${config.hue} ${useRefreshRate}" > ${KCAL_HUE_PATH}`,
            `echo "${config.cont} ${useRefreshRate}" > ${KCAL_CONT_PATH}`,
            `echo "${config.val} ${useRefreshRate}" > ${KCAL_VAL_PATH}`
        ];
        await exec(cmds.join(' && '));
    } catch (e) { console.warn(`Kcal apply failed: ${e.message}`); }
}

// 更新的解析函数，支持新旧格式
function parseConfig(text) {
    const parts = text.trim().split(/\s+/).map(p => parseInt(p, 10));
    if (parts.length < 6 || parts.slice(0, 6).some(isNaN)) return null;

    const [ri, rs, gi, gs, bi, bs] = parts;
    const newConfig = {
        red: { intercept: ri / 100, slope: rs / SLOPE_PRECISION },
        green: { intercept: gi / 100, slope: gs / SLOPE_PRECISION },
        blue: { intercept: bi / 100, slope: bs / SLOPE_PRECISION },
        // 向后兼容：如果旧配置文件只有6个值，则使用默认值
        sat: (parts.length > 6 && !isNaN(parts[6])) ? parts[6] : defaultConfig.sat,
        hue: (parts.length > 7 && !isNaN(parts[7])) ? parts[7] : defaultConfig.hue,
        cont: (parts.length > 8 && !isNaN(parts[8])) ? parts[8] : defaultConfig.cont,
        val: (parts.length > 9 && !isNaN(parts[9])) ? parts[9] : defaultConfig.val,
    };
    return newConfig;
}

// 更新的序列化函数
function serializeConfig(params) {
    const ri = Math.round(params.red.intercept * 100);
    const rs = Math.round(params.red.slope * SLOPE_PRECISION);
    const gi = Math.round(params.green.intercept * 100);
    const gs = Math.round(params.green.slope * SLOPE_PRECISION);
    const bi = Math.round(params.blue.intercept * 100);
    const bs = Math.round(params.blue.slope * SLOPE_PRECISION);
    return `${ri} ${rs} ${gi} ${gs} ${bi} ${bs} ${params.sat} ${params.hue} ${params.cont} ${params.val}`;
}

async function readKcalNodeAsConfig() {
    try {
        const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`);
        const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`);
        const { stdout: sat_out } = await exec(`cat ${KCAL_SAT_PATH}`);
        const { stdout: hue_out } = await exec(`cat ${KCAL_HUE_PATH}`);
        const { stdout: cont_out } = await exec(`cat ${KCAL_CONT_PATH}`);
        const { stdout: val_out } = await exec(`cat ${KCAL_VAL_PATH}`);
        
        const [ri, rs] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [gi, gs] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [bi, bs] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));

        if ([ri, rs, gi, gs, bi, bs].some(isNaN)) return null;

        return {
            red: { intercept: ri / 100, slope: rs / SLOPE_PRECISION },
            green: { intercept: gi / 100, slope: gs / SLOPE_PRECISION },
            blue: { intercept: bi / 100, slope: bs / SLOPE_PRECISION },
            sat: parseInt(sat_out.trim().split(/\s+/)[0]) || defaultConfig.sat,
            hue: parseInt(hue_out.trim().split(/\s+/)[0]) || defaultConfig.hue,
            cont: parseInt(cont_out.trim().split(/\s+/)[0]) || defaultConfig.cont,
            val: parseInt(val_out.trim().split(/\s+/)[0]) || defaultConfig.val,
        };
    } catch (e) { return null; }
}

async function loadConfigAndRender() {
    let loadedConfig = null;
    const filename = currentConfigPath.split('/').pop();
    try {
        const { stdout } = await exec(`cat ${currentConfigPath}`);
        loadedConfig = parseConfig(stdout);
    } catch (e) {}
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
    renderAdvColorUI(globalConfig);
    applyAllKcalSettings(globalConfig);
    updateChart();
}

function renderUI(params) {
    for (const color of ['red', 'green', 'blue']) {
        const { intercept, slope } = params[color];
        uiElements[color].interceptInput.value = intercept.toFixed(2);
        uiElements[color].interceptSlider.value = intercept;
        uiElements[color].slopeInput.value = slope.toFixed(2);
        uiElements[color].slopeSlider.value = slope;
    }
    document.querySelectorAll('.form-outline').forEach(formOutline => new Input(formOutline).update());
}

async function saveConfig() { const configString = serializeConfig(globalConfig); const filename = currentConfigPath.split('/').pop(); try { await exec(`echo '${configString}' > ${currentConfigPath}`); toast(i18next.t('toast.saved', { file: filename }), 'success'); } catch (e) { toast(i18next.t('toast.saveFailed', { error: e.message }), 'error'); } }
function resetGlobalConfig() { globalConfig = JSON.parse(JSON.stringify(defaultConfig)); renderUI(globalConfig); renderAdvColorUI(globalConfig); applyAllKcalSettings(globalConfig); updateChart(); toast(i18next.t('toast.reset'), 'info'); }

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
    for (const stepKey in wizardControls) {
        const step = wizardControls[stepKey];
        const data = wizardData[stepKey];
        for (const colorKey in step) {
            const control = step[colorKey];
            const value = data[colorKey];
            control.slider.value = value;
            control.input.value = value;
        }
    }
    wizardBrightness1.value = wizardData.step1.brightnessPercent;
    wizardBrightness2.value = wizardData.step2.brightnessPercent;
    document.querySelectorAll('#wizardModal .form-outline').forEach(formOutline => { new Input(formOutline).update(); });
    wizardStep1.style.display = 'block';
    wizardStep2.style.display = 'none';
    wizardNextButton.style.display = 'block';
    wizardFinishButton.style.display = 'none';
    wizardModal.show();
    setSystemBrightness(wizardData.step1.brightnessPercent);
}
function handleWizardNext() {
    wizardData.step1.brightnessPercent = parseInt(wizardBrightness1.value);
    wizardData.step1.red = parseInt(wizardControls.step1.red.input.value);
    wizardData.step1.green = parseInt(wizardControls.step1.green.input.value);
    wizardData.step1.blue = parseInt(wizardControls.step1.blue.input.value);
    wizardStep1.style.display = 'none';
    wizardStep2.style.display = 'block';
    wizardNextButton.style.display = 'none';
    wizardFinishButton.style.display = 'block';
    setSystemBrightness(wizardData.step2.brightnessPercent);
    handleWizardColorPreview(2);
}
async function handleWizardFinish() {
    wizardData.step2.brightnessPercent = parseInt(wizardBrightness2.value);
    wizardData.step2.red = parseInt(wizardControls.step2.red.input.value);
    wizardData.step2.green = parseInt(wizardControls.step2.green.input.value);
    wizardData.step2.blue = parseInt(wizardControls.step2.blue.input.value);
    const b1 = scaleToSystemBrightness(wizardData.step1.brightnessPercent);
    const b2 = scaleToSystemBrightness(wizardData.step2.brightnessPercent);
    
    // 更新 globalConfig 的 RGB 部分
    globalConfig.red = calculateFit({ brightness: b1, value: wizardData.step1.red }, { brightness: b2, value: wizardData.step2.red });
    globalConfig.green = calculateFit({ brightness: b1, value: wizardData.step1.green }, { brightness: b2, value: wizardData.step2.green });
    globalConfig.blue = calculateFit({ brightness: b1, value: wizardData.step1.blue }, { brightness: b2, value: wizardData.step2.blue });

    renderUI(globalConfig);
    await applyAllKcalSettings(globalConfig);
    updateChart();
    await saveConfig();
    wizardModal.hide();
    toast(i18next.t('toast.wizardComplete'), 'success');
}
function handleWizardCancel() {
    applyAllKcalSettings(originalConfigForWizard); 
    wizardModal.hide();
    toast(i18next.t('toast.wizardCancelled'), 'info');
}
function handleWizardColorPreview(stepNum) {
    const brightnessPercent = parseInt(stepNum === 1 ? wizardBrightness1.value : wizardBrightness2.value);
    setSystemBrightness(brightnessPercent);
    const controls = wizardControls[`step${stepNum}`];
    const r = parseInt(controls.red.input.value);
    const g = parseInt(controls.green.input.value);
    const b = parseInt(controls.blue.input.value);
    // 临时应用，只改变RGB截距
    const tempConfig = {
        red: { intercept: r, slope: 0 },
        green: { intercept: g, slope: 0 },
        blue: { intercept: b, slope: 0 },
        ...globalConfig // 保持现有的高级设置不变
    };
    applyAllKcalSettings(tempConfig);
}

function renderAdvColorUI(config) {
    satSlider.value = config.sat;
    satInput.value = config.sat;
    hueSlider.value = nodeToUiHue(config.hue);
    hueInput.value = nodeToUiHue(config.hue);
    contSlider.value = config.cont;
    contInput.value = config.cont;
    valSlider.value = config.val;
    valInput.value = config.val;
    document.querySelectorAll('.form-outline').forEach(formOutline => new Input(formOutline).update());
}

function resetAdvColor() {
    globalConfig.sat = defaultConfig.sat;
    globalConfig.hue = defaultConfig.hue;
    globalConfig.cont = defaultConfig.cont;
    globalConfig.val = defaultConfig.val;
    renderAdvColorUI(globalConfig);
    applyAllKcalSettings(globalConfig);
    toast(i18next.t('toast.advColor.reset'), 'info');
}

async function readAndShowNodeStatus() {
    const parsedOutputElem = document.getElementById('parsedNodeOutput');
    parsedOutputElem.innerHTML = i18next.t('status.reading');
    nodeStatusModal.show();
    try {
        const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const { stdout: green_stdout } = await exec(`cat ${KCAL_GREEN_PATH}`);
        const { stdout: blue_stdout } = await exec(`cat ${KCAL_BLUE_PATH}`);
        const { stdout: sat_stdout } = await exec(`cat ${KCAL_SAT_PATH}`);
        const { stdout: hue_stdout } = await exec(`cat ${KCAL_HUE_PATH}`);
        const { stdout: cont_stdout } = await exec(`cat ${KCAL_CONT_PATH}`);
        const { stdout: val_stdout } = await exec(`cat ${KCAL_VAL_PATH}`);

        const [ri, rs, rr] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [gi, gs, gr] = green_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [bi, bs, br] = blue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [sat_val, sat_rr] = sat_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [hue_val, hue_rr] = hue_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [cont_val, cont_rr] = cont_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        const [val_val, val_rr] = val_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));

        if ([ri, rs, rr, gi, gs, gr, bi, bs, br, sat_val, sat_rr, hue_val, hue_rr, cont_val, cont_rr, val_val, val_rr].some(isNaN)) {
            parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeParseError')}</p>`; return;
        }
        parsedOutputElem.innerHTML = `<h6><strong>Kcal Status:</strong> ${isKcalEnabled ? 'Enabled' : 'Disabled'}</h6><hr/>` +
            `<h6 class="text-danger">${i18next.t('params.red')}</h6><ul><li>I: ${(ri / 100).toFixed(2)} (${ri})</li><li>S: ${(rs / SLOPE_PRECISION).toFixed(2)} (${rs})</li><li>Hz: ${rr}</li></ul><hr/>` +
            `<h6 class="text-success">${i18next.t('params.green')}</h6><ul><li>I: ${(gi / 100).toFixed(2)} (${gi})</li><li>S: ${(gs / SLOPE_PRECISION).toFixed(2)} (${gs})</li><li>Hz: ${gr}</li></ul><hr/>` +
            `<h6 class="text-primary">${i18next.t('params.blue')}</h6><ul><li>I: ${(bi / 100).toFixed(2)} (${bi})</li><li>S: ${(bs / SLOPE_PRECISION).toFixed(2)} (${bs})</li><li>Hz: ${br}</li></ul><hr/>` +
            `<h6>${i18next.t('params.saturation')}</h6><ul><li>Value: ${sat_val}</li><li>Hz: ${sat_rr}</li></ul>` +
            `<h6>${i18next.t('params.hue')}</h6><ul><li>Value: ${hue_val} (${nodeToUiHue(hue_val)}°)</li><li>Hz: ${hue_rr}</li></ul>` +
            `<h6>${i18next.t('params.contrast')}</h6><ul><li>Value: ${cont_val}</li><li>Hz: ${cont_rr}</li></ul>` +
            `<h6>${i18next.t('params.whiteValue')}</h6><ul><li>Value: ${val_val}</li><li>Hz: ${val_rr}</li></ul>`;
    } catch (e) { parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeReadPermission')}</p>`; }
}

function setupIncrementer(minusBtn, plusBtn, input, slider, step, min, max, isInt) {
    const updateValue = (newValue) => {
        const clampedValue = Math.max(min, Math.min(newValue, max));
        if (isInt) {
            input.value = Math.round(clampedValue);
        } else {
            input.value = clampedValue.toFixed(2);
        }
        slider.value = clampedValue;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    minusBtn.addEventListener('click', () => {
        const currentValue = isInt ? parseInt(input.value) : parseFloat(input.value);
        updateValue(currentValue - step);
    });
    plusBtn.addEventListener('click', () => {
        const currentValue = isInt ? parseInt(input.value) : parseFloat(input.value);
        updateValue(currentValue + step);
    });
}

async function fetchInitialSystemState() {
    try {
        const { stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        currentRefreshRate = parseInt(stdout.trim().split(/\s+/)[2]) || 60;
    } catch (e) {
        try {
            const { stdout } = await exec('settings get system peak_refresh_rate');
            currentRefreshRate = Math.round(parseFloat(stdout.trim())) || 60;
        } catch (e2) {
            currentRefreshRate = 60;
        }
    }
    updateRefreshRateUI(currentRefreshRate);
    lastKnownRefreshRate = currentRefreshRate;
    try {
        const { stdout } = await exec(`cat ${KCAL_ENABLE_PATH}`);
        updateKcalEnableUI(stdout.trim() === '1');
    } catch (e) {
        updateKcalEnableUI(false);
    }
    try {
        const { stdout: max } = await exec(`cat ${MAX_BRIGHTNESS_PATH}`); maxBrightness = parseInt(max.trim());
        const { stdout: cur } = await exec(`cat ${BACKLIGHT_PATH}`); const currentSystemVal = parseInt(cur.trim());
        lastKnownBrightness = currentSystemVal;
        const percentage = Math.round(((currentSystemVal - 1) / (maxBrightness - 1)) * 100);
        brightnessSlider.value = percentage;
        brightnessValue.innerText = i18next.t('status.brightnessValue', { value: currentSystemVal, percent: percentage });
        brightnessSlider.disabled = false;
    } catch (e) {
        brightnessValue.innerText = i18next.t('status.brightnessReadError');
        brightnessSlider.disabled = true;
        toast(i18next.t('toast.backlightPathError'), 'error');
    }
}

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

    brightnessSlider.addEventListener('input', (e) => setSystemBrightness(parseInt(e.target.value)));
    saveButton.addEventListener('click', saveConfig);
    resetConfigButton.addEventListener('click', resetGlobalConfig);
    readNodeButton.addEventListener('click', readAndShowNodeStatus);
    wizardButton.addEventListener('click', startWizard);
    advancedModeButton.addEventListener('click', () => toggleAdvancedMode(!isAdvancedMode));
    // 高级设置的保存按钮现在也调用主保存函数
    saveAdvColorButton.addEventListener('click', saveConfig);
    resetAdvColorButton.addEventListener('click', resetAdvColor);

    for (const color of ['red', 'green', 'blue']) {
        const elements = uiElements[color];
        const handleParamChange = (param, value) => {
            globalConfig[color][param] = value;
            renderUI(globalConfig);
            applyAllKcalSettings(globalConfig);
            updateChart();
        };
        elements.interceptSlider.addEventListener('input', (e) => handleParamChange('intercept', parseFloat(e.target.value)));
        elements.interceptInput.addEventListener('change', (e) => { const val = parseFloat(e.target.value) || 0; const clampedVal = Math.max(0, Math.min(val, 256)); handleParamChange('intercept', clampedVal); });
        elements.slopeSlider.addEventListener('input', (e) => handleParamChange('slope', parseFloat(e.target.value)));
        elements.slopeInput.addEventListener('change', (e) => { const val = parseFloat(e.target.value) || 0; const clampedVal = Math.max(-50, Math.min(val, 50)); handleParamChange('slope', clampedVal); });
        setupIncrementer(document.getElementById(`${color}Intercept_minus`), document.getElementById(`${color}Intercept_plus`), elements.interceptInput, elements.interceptSlider, 1, 0, 256, false);
        setupIncrementer(document.getElementById(`${color}Slope_minus`), document.getElementById(`${color}Slope_plus`), elements.slopeInput, elements.slopeSlider, 0.1, -50, 50, false);
    }
    
    const handleAdvChange = () => {
        renderAdvColorUI(globalConfig);
        applyAllKcalSettings(globalConfig);
    };

    satSlider.addEventListener('input', (e) => { globalConfig.sat = parseInt(e.target.value); handleAdvChange(); });
    satInput.addEventListener('change', (e) => { const val = parseInt(e.target.value) || 200; globalConfig.sat = Math.max(200, Math.min(val, 360)); handleAdvChange(); });
    hueSlider.addEventListener('input', (e) => { globalConfig.hue = uiToNodeHue(parseInt(e.target.value)); handleAdvChange(); });
    hueInput.addEventListener('change', (e) => { const val = parseInt(e.target.value) || 0; const clampedVal = Math.max(0, Math.min(val, HUE_UI_MAX)); globalConfig.hue = uiToNodeHue(clampedVal); handleAdvChange(); });
    contSlider.addEventListener('input', (e) => { globalConfig.cont = parseInt(e.target.value); handleAdvChange(); });
    contInput.addEventListener('change', (e) => { const val = parseInt(e.target.value) || 128; globalConfig.cont = Math.max(128, Math.min(val, 383)); handleAdvChange(); });
    valSlider.addEventListener('input', (e) => { globalConfig.val = parseInt(e.target.value); handleAdvChange(); });
    valInput.addEventListener('change', (e) => { const val = parseInt(e.target.value) || 128; globalConfig.val = Math.max(128, Math.min(val, 383)); handleAdvChange(); });

    setupIncrementer(document.getElementById('sat_minus'), document.getElementById('sat_plus'), satInput, satSlider, 1, 200, 360, true);
    setupIncrementer(document.getElementById('hue_minus'), document.getElementById('hue_plus'), hueInput, hueSlider, 1, 0, HUE_UI_MAX, true);
    setupIncrementer(document.getElementById('cont_minus'), document.getElementById('cont_plus'), contInput, contSlider, 1, 128, 383, true);
    setupIncrementer(document.getElementById('val_minus'), document.getElementById('val_plus'), valInput, valSlider, 1, 128, 383, true);

    for (const stepNum of [1, 2]) {
        const stepKey = `step${stepNum}`;
        for (const colorKey in wizardControls[stepKey]) {
            const { slider, input } = wizardControls[stepKey][colorKey];
            slider.addEventListener('input', () => { input.value = slider.value; handleWizardColorPreview(stepNum); });
            input.addEventListener('change', () => { const val = parseInt(input.value) || 0; const clampedValue = Math.max(0, Math.min(val, 256)); if (val !== clampedValue) { input.value = clampedValue; } slider.value = clampedValue; handleWizardColorPreview(stepNum); });
            setupIncrementer(document.getElementById(`wizardColor${colorKey.charAt(0).toUpperCase()}${stepNum}_minus`), document.getElementById(`wizardColor${colorKey.charAt(0).toUpperCase()}${stepNum}_plus`), input, slider, 1, 0, 256, true);
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

document。addEventListener('DOMContentLoaded', init);
