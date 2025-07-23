// 导入 MDB-UI-Kit 组件 和 Chart.js
import Chart from 'chart.js/auto';
import { Ripple, Range, Input, Modal, initMDB } from 'mdb-ui-kit';
import { exec, toast } from 'kernelsu';
import i18next from './i18n.js';

// [新增] 直接在 JavaScript 中导入 Material Design Icons 的 CSS
import '@mdi/font/css/materialdesignicons.min.css';

// --- 常量和全局变量 ---
const MODULE_ID = "miuicx_color_tuner";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
let currentConfigPath = ''; 
const KCAL_CONTROL_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal";
const RANGE_CONFIG_KEY = 'kcalWebUIRanges';

const BACKLIGHT_PATH = "/sys/class/backlight/panel0-backlight/brightness";
const MAX_BRIGHTNESS_PATH = "/sys/class/backlight/panel0-backlight/max_brightness";

const FIXED_PRECISION = 100;
const defaultConfig = { "intercept": 255.0, "slope": 0.0, "offset": 0 };

const defaultRanges = {
    intercept: { min: 100, max: 255 },
    slope: { min: -50, max: 50 },
    offset: { min: -100, max: 100 }
};

let globalConfig = {};
let maxBrightness = 4095;
let currentRefreshRate = 60;
let colorChart = null;
let nodeStatusModal = null;
let rangeConfigModal = null;
let isEditMode = false;

// [新增] 用于轮询的状态变量
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

const interceptSlider = document.getElementById('interceptSlider');
const interceptInput = document.getElementById('interceptInput');
const slopeSlider = document.getElementById('slopeSlider');
const slopeInput = document.getElementById('slopeInput');
const offsetSlider = document.getElementById('offsetSlider');
const offsetInput = document.getElementById('offsetInput');

const interceptRangeMin = document.getElementById('interceptRangeMin');
const interceptRangeMax = document.getElementById('interceptRangeMax');
const slopeRangeMin = document.getElementById('slopeRangeMin');
const slopeRangeMax = document.getElementById('slopeRangeMax');
const offsetRangeMin = document.getElementById('offsetRangeMin');
const offsetRangeMax = document.getElementById('offsetRangeMax');
const saveRangeButton = document.getElementById('saveRangeButton');

// --- [新增] 轮询函数 ---
async function pollSystemStatus() {
    // 检查刷新率
    try {
        const { stdout } = await exec('settings get system peak_refresh_rate');
        const newRate = Math.round(parseFloat(stdout.trim())) || 60;
        if (newRate !== lastKnownRefreshRate) {
            console.log(`Refresh rate changed: ${lastKnownRefreshRate} -> ${newRate}`);
            lastKnownRefreshRate = newRate;
            currentRefreshRate = newRate;
            
            // 更新UI和配置文件路径
            refreshRateValue.innerText = `${currentRefreshRate} Hz`;
            currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
            
            // 提示用户并重新加载配置
            toast(i18next.t('toast.refreshRateChanged', { rate: newRate }), 'info');
            await loadConfigAndRender();
        }
    } catch (e) {
        // 忽略读取错误，避免频繁报错
    }

    // 检查亮度
    try {
        const { stdout } = await exec(`cat ${BACKLIGHT_PATH}`);
        const newBrightness = parseInt(stdout.trim());
        if (newBrightness !== lastKnownBrightness) {
            console.log(`Brightness changed: ${lastKnownBrightness} -> ${newBrightness}`);
            lastKnownBrightness = newBrightness;
            
            // 更新UI
            const percentage = Math.round(((newBrightness - 1) / (maxBrightness - 1)) * 100);
            brightnessValue.innerText = i18next.t('status.brightnessValue', { value: newBrightness, percent: percentage });
            brightnessSlider.value = percentage;
        }
    } catch (e) {
        // 忽略读取错误
    }
}


// --- 多语言UI更新 ---
function updateUIText() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerHTML = i18next.t(key);
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

    if (enable) {
        toggleEditModeButton.innerHTML = i18next.t('buttons.editMode.exit');
        toggleEditModeButton.classList.remove('btn-success');
        toggleEditModeButton.classList.add('btn-danger');
    } else {
        toggleEditModeButton.innerHTML = i18next.t('buttons.editMode.enter');
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
    interceptSlider.min = ranges.intercept.min * FIXED_PRECISION;
    interceptSlider.max = ranges.intercept.max * FIXED_PRECISION;
    slopeSlider.min = ranges.slope.min * FIXED_PRECISION;
    slopeSlider.max = ranges.slope.max * FIXED_PRECISION;
    offsetSlider.min = ranges.offset.min;
    offsetSlider.max = ranges.offset.max;
}

function loadAndApplyRanges() {
    let ranges = { ...defaultRanges };
    try {
        const savedRanges = localStorage.getItem(RANGE_CONFIG_KEY);
        if (savedRanges) {
            const parsed = JSON.parse(savedRanges);
            if (parsed.intercept) ranges.intercept = { ...ranges.intercept, ...parsed.intercept };
            if (parsed.slope) ranges.slope = { ...ranges.slope, ...parsed.slope };
            if (parsed.offset) ranges.offset = { ...ranges.offset, ...parsed.offset };
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
    const oMin = parseInt(offsetRangeMin.value, 10);
    const oMax = parseInt(offsetRangeMax.value, 10);

    if ([iMin, iMax, sMin, sMax, oMin, oMax].some(isNaN)) {
        toast(i18next.t('toast.rangeError.nan'), 'error'); return;
    }
    if (iMin >= iMax || sMin >= sMax || oMin >= oMax) {
        toast(i18next.t('toast.rangeError.minMax'), 'error'); return;
    }

    const newRanges = {
        intercept: { min: iMin, max: iMax },
        slope: { min: sMin, max: sMax },
        offset: { min: oMin, max: oMax }
    };
    localStorage.setItem(RANGE_CONFIG_KEY, JSON.stringify(newRanges));
    applyRanges(newRanges);
    rangeConfigModal.hide();
    toast(i18next.t('toast.rangeSaved'), 'success');
}

// --- Chart.js 函数 ---
function calculateChartData(params) {
    const labels = [];
    const dataR = [];
    const dataG = [];
    const { intercept, slope, offset } = params;
    for (let p = 0; p <= 100; p += 2) {
        const systemBrightness = Math.max(1, scaleToSystemBrightness(p));
        const log_b = Math.log(systemBrightness);
        const green_final = intercept + (slope * log_b);
        const red_final = 128 + offset + (green_final / 2);
        labels.push(p);
        dataG.push(green_final);
        dataR.push(red_final);
    }
    return {
        labels: labels,
        datasets: [
            { label: i18next.t('params.red'), data: dataR, borderColor: 'rgba(255, 99, 132, 1)', backgroundColor: 'rgba(255, 99, 132, 0.2)', tension: 0.4, borderWidth: 2, pointRadius: 0 },
            { label: i18next.t('params.green'), data: dataG, borderColor: 'rgba(75, 192, 192, 1)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.4, borderWidth: 2, pointRadius: 0 }
        ]
    };
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
    const int_intercept = Math.round(params.intercept * FIXED_PRECISION);
    const int_slope = Math.round(params.slope * FIXED_PRECISION);
    const int_offset = Math.round(params.offset);
    const command = `echo "${int_intercept} ${int_slope} ${int_offset} ${currentRefreshRate}" > ${KCAL_CONTROL_PATH}`;
    try {
        await exec(command);
    } catch (e) {
        console.warn(`应用Kcal失败: ${e.message}`);
    }
}

function parseConfig(text) {
    const content = text.trim();
    if (!content) return null;
    const parts = content.split(/\s+/);
    if (parts.length === 3 || parts.length === 4) {
        const [i, s, o] = parts.map(p => parseInt(p, 10));
        if ([i, s, o].some(isNaN)) return null;
        
        return {
            intercept: i / FIXED_PRECISION,
            slope: s / FIXED_PRECISION,
            offset: o
        };
    }
    return null;
}

function serializeConfig(params) {
    const int_intercept = Math.round(params.intercept * FIXED_PRECISION);
    const int_slope = Math.round(params.slope * FIXED_PRECISION);
    const int_offset = Math.round(params.offset);
    return `${int_intercept} ${int_slope} ${int_offset}`;
}

async function readKcalNodeAsConfig() {
    try {
        const { stdout } = await exec(`cat ${KCAL_CONTROL_PATH}`);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length === 4) {
            const [i, s, o] = parts.map(p => parseInt(p, 10));
            if ([i, s, o].some(isNaN)) return null;
            return {
                intercept: i / FIXED_PRECISION,
                slope: s / FIXED_PRECISION,
                offset: o
            };
        }
        return null;
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
            globalConfig = { ...defaultConfig };
            toast(i18next.t('toast.configLoadFromNodeFailed'), 'warning');
        }
    }

    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
}

function renderUI(params) {
    interceptInput.value = params.intercept.toFixed(2);
    interceptSlider.value = Math.max(interceptSlider.min, Math.min(params.intercept * FIXED_PRECISION, interceptSlider.max));
    slopeInput.value = params.slope.toFixed(2);
    slopeSlider.value = Math.max(slopeSlider.min, Math.min(params.slope * FIXED_PRECISION, slopeSlider.max));
    offsetInput.value = Math.round(params.offset).toFixed(0);
    offsetSlider.value = Math.max(offsetSlider.min, Math.min(Math.round(params.offset), offsetSlider.max));
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
    globalConfig = { ...defaultConfig };
    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
    toast(i18next.t('toast.reset'), 'info');
}

async function readAndShowNodeStatus() {
    const rawOutputElem = document.getElementById('rawNodeOutput');
    const parsedOutputElem = document.getElementById('parsedNodeOutput');
    rawOutputElem.textContent = i18next.t('status.reading');
    parsedOutputElem.innerHTML = '';
    nodeStatusModal.show();
    try {
        const { stdout } = await exec(`cat ${KCAL_CONTROL_PATH}`);
        rawOutputElem.textContent = stdout.trim();
        const parts = stdout.trim().split(/\s+/);
        if (parts.length === 4) {
            const [i, s, o, r] = parts.map(p => parseInt(p, 10));
            if (![i, s, o, r].some(isNaN)) {
                parsedOutputElem.innerHTML = `<ul>
                    <li><strong>Intercept:</strong> ${(i / FIXED_PRECISION).toFixed(2)} (raw: ${i})</li>
                    <li><strong>Slope:</strong> ${(s / FIXED_PRECISION).toFixed(2)} (raw: ${s})</li>
                    <li><strong>Offset:</strong> ${o}</li>
                    <li><strong data-i18n="modals.nodeStatus.refreshRate"></strong> ${r} Hz</li>
                </ul>`;
                const strongEl = parsedOutputElem.querySelector('strong[data-i18n]');
                if(strongEl) strongEl.innerHTML = i18next.t(strongEl.dataset.i18n);
            } else {
                 parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeParseError')}</p>`;
            }
        } else {
            parsedOutputElem.innerHTML = `<p class="text-danger">${i18next.t('errors.nodeParseError')}</p>`;
        }
    } catch (e) {
        rawOutputElem.textContent = i18next.t('errors.nodeReadFailed', { error: e.message });
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
        interceptRangeMin.value = interceptSlider.min / FIXED_PRECISION;
        interceptRangeMax.value = interceptSlider.max / FIXED_PRECISION;
        slopeRangeMin.value = slopeSlider.min / FIXED_PRECISION;
        slopeRangeMax.value = slopeSlider.max / FIXED_PRECISION;
        offsetRangeMin.value = offsetSlider.min;
        offsetRangeMax.value = offsetSlider.max;
        initMDB({ Input });
        rangeConfigModal.show();
    });
    saveRangeButton.addEventListener('click', saveRanges);

    const handleParamChange = () => {
        renderUI(globalConfig);
        applyKcal(globalConfig);
        updateChart();
    };

    interceptSlider.addEventListener('input', () => {
        const val = parseInt(interceptSlider.value, 10) / FIXED_PRECISION;
        globalConfig.intercept = val;
        handleParamChange();
    });
    interceptInput.addEventListener('change', () => {
        const val = parseFloat(interceptInput.value) || 0;
        globalConfig.intercept = val;
        handleParamChange();
    });

    slopeSlider.addEventListener('input', () => {
        const val = parseInt(slopeSlider.value, 10) / FIXED_PRECISION;
        globalConfig.slope = val;
        handleParamChange();
    });
    slopeInput.addEventListener('change', () => {
        const val = parseFloat(slopeInput.value) || 0;
        globalConfig.slope = val;
        handleParamChange();
    });

    offsetSlider.addEventListener('input', () => {
        const val = parseInt(offsetSlider.value, 10);
        globalConfig.offset = val;
        handleParamChange();
    });
    offsetInput.addEventListener('change', () => {
        const val = parseInt(offsetInput.value, 10) || 0;
        globalConfig.offset = val;
        handleParamChange();
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    i18next.on('languageChanged', () => updateUIText());

    toggleEditMode(false);

    setInterval(pollSystemStatus, 1000);
}

document.addEventListener('DOMContentLoaded', init);