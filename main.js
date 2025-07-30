import Chart from 'chart.js/auto';
import { Ripple, Range, Input, Modal, initMDB } from 'mdb-ui-kit';
import { exec, toast } from 'kernelsu';
import i18next from './i18n.js';
import { mdiFileEdit, mdiLock, mdiTune, mdiSync, mdiRestore } from '@mdi/js';

const MODULE_ID = "miuicx_color_tuner";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
let currentConfigPath = ''; 
const KCAL_RED_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_red";
const KCAL_GREEN_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_green";
const KCAL_BLUE_PATH = "/sys/devices/platform/kcal_ctrl.0/kcal_blue";
const RANGE_CONFIG_KEY = 'kcalWebUIRanges';

const BACKLIGHT_PATH = "/sys/class/backlight/panel0-backlight/brightness";
const MAX_BRIGHTNESS_PATH = "/sys/class/backlight/panel0-backlight/max_brightness";

const FIXED_PRECISION = 100;
const defaultConfig = { intercept: 256.0, slope: 0.0 }; // 默认的 intercept 和 slope

const defaultRanges = {
    intercept: { min: 0, max: 256 },
    slope: { min: -50, max: 50 },
};

const icons = { mdiFileEdit, mdiLock, mdiTune, mdiSync, mdiRestore };

let globalConfig = JSON.parse(JSON.stringify(defaultConfig)); // 当前生效的 intercept 和 slope
let maxBrightness = 4095;
let currentRefreshRate = 60;
let colorChart = null;
let calibrationModal = null; // 校准模态框实例

let calibrationPoints = {
    low: null, // { brightness: number, offset: number }
    high: null, // { brightness: number, offset: number }
};
let currentCalibrationMode = null; // 'low' or 'high'

let lastKnownRefreshRate = 0;
let lastKnownBrightness = -1;

const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessValue = document.getElementById('brightnessValue');
const refreshRateValue = document.getElementById('refreshRateValue');
const saveButton = document.getElementById('saveButton');
const resetButton = document.getElementById('resetButton'); // 重命名为 resetButton
const setLowPointButton = document.getElementById('setLowPointButton');
const setHighPointButton = document.getElementById('setHighPointButton');
const lowPointStatus = document.getElementById('lowPointStatus');
const highPointStatus = document.getElementById('highPointStatus');
const colorOffsetSlider = document.getElementById('colorOffsetSlider');
const colorOffsetValue = document.getElementById('colorOffsetValue');
const confirmCalibrationButton = document.getElementById('confirmCalibrationButton');
const chartCanvas = document.getElementById('colorCurveChart');

function createIcon(path) {
  if (!path) return '';
  return `<svg class="svg-icon me-2" viewBox="0 0 24 24"><path d="${path}" /></svg>`;
}

async function pollSystemStatus() {
    try {
        const { stdout } = await exec('settings get system peak_refresh_rate');
        const newRate = Math.round(parseFloat(stdout.trim())) || 60;
        if (newRate !== lastKnownRefreshRate) {
            lastKnownRefreshRate = newRate;
            currentRefreshRate = newRate;
            refreshRateValue.innerText = `${currentRefreshRate} Hz`;
            currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;
            toast(i18next.t('toast.refreshRateChanged', { rate: newRate }), 'info');
            await loadConfigAndRender();
        }
    } catch (e) { /* ignore */ }

    try {
        const { stdout } = await exec(`cat ${BACKLIGHT_PATH}`);
        const newBrightness = parseInt(stdout.trim());
        if (newBrightness !== lastKnownBrightness) {
            lastKnownBrightness = newBrightness;
            const percentage = Math.round((newBrightness / maxBrightness) * 100); // 亮度百分比计算
            brightnessValue.innerText = i18next.t('status.brightnessValue', { value: newBrightness, percent: percentage });
            brightnessSlider.value = percentage;
        }
    } catch (e) { /* ignore */ }
}

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
    updateCalibrationStatusUI(); // 更新校准点状态显示
}

function updateCalibrationStatusUI() {
    if (calibrationPoints.low) {
        const brightnessPercent = Math.round((calibrationPoints.low.brightness / maxBrightness) * 100);
        lowPointStatus.innerText = i18next.t('calibration.step1.statusSet', { offset: calibrationPoints.low.offset, brightness: brightnessPercent });
    } else {
        lowPointStatus.innerText = i18next.t('calibration.step1.status');
    }
    if (calibrationPoints.high) {
        const brightnessPercent = Math.round((calibrationPoints.high.brightness / maxBrightness) * 100);
        highPointStatus.innerText = i18next.t('calibration.step2.statusSet', { offset: calibrationPoints.high.offset, brightness: brightnessPercent });
    } else {
        highPointStatus.innerText = i18next.t('calibration.step2.status');
    }
}

function updateTheme() {
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-mdb-theme', isDarkMode ? 'dark' : 'light');
    updateChart();
}

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

function calculateFit() {
    const { low, high } = calibrationPoints;
    if (!low || !high) {
        return { intercept: 256.0, slope: 0.0 };
    }

    const x1 = Math.log(Math.max(1, low.brightness)); // 确保亮度至少为1，避免log(0)
    const y1 = low.offset;
    const x2 = Math.log(Math.max(1, high.brightness)); // 确保亮度至少为1，避免log(0)
    const y2 = high.offset;

    if (x1 === x2) { // 避免除以零，如果亮度相同，则斜率为0
        return { intercept: y1, slope: 0.0 };
    }

    const slope = (y2 - y1) / (x2 - x1);
    const intercept = y1 - slope * x1;

    return { intercept, slope };
}

async function applyKcal(params) {
    const { intercept, slope } = params;
    const int_intercept = Math.round(intercept * FIXED_PRECISION);
    const int_slope = Math.round(slope * FIXED_PRECISION);
    
    const command = `${int_intercept} ${int_slope} ${currentRefreshRate}`;
    
    try {
        await exec(`echo "${command}" > ${KCAL_RED_PATH}`);
        await exec(`echo "${command}" > ${KCAL_GREEN_PATH}`);
        await exec(`echo "${command}" > ${KCAL_BLUE_PATH}`);
    } catch (e) {
        console.warn(`应用Kcal失败: ${e.message}`);
    }
}

function serializeConfig(params) {
    const { intercept, slope } = params;
    const int_intercept = Math.round(intercept * FIXED_PRECISION);
    const int_slope = Math.round(slope * FIXED_PRECISION);
    return `${int_intercept} ${int_slope}`;
}

function parseConfig(text) {
    const parts = text.trim().split(/\s+/);
    if (parts.length === 2) { // 新的2参数格式
        const [i, s] = parts.map(p => parseInt(p, 10));
        if ([i, s].some(isNaN)) return null;
        return { intercept: i / FIXED_PRECISION, slope: s / FIXED_PRECISION };
    }
    // 兼容旧的6参数格式，只取green通道的值
    if (parts.length === 6) {
        const [ri, rs, gi, gs, bi, bs] = parts.map(p => parseInt(p, 10));
        if ([gi, gs].some(isNaN)) return null;
        return { intercept: gi / FIXED_PRECISION, slope: gs / FIXED_PRECISION };
    }
    return null;
}

async function readKcalNodeAsConfig() {
    try {
        const { stdout: red_stdout } = await exec(`cat ${KCAL_RED_PATH}`);
        const [ri, rs] = red_stdout.trim().split(/\s+/).map(p => parseInt(p, 10));
        if ([ri, rs].some(isNaN)) return null;
        return { intercept: ri / FIXED_PRECISION, slope: rs / FIXED_PRECISION };
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
    } catch (e) { /* ignore */ }

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
    // 根据加载的 globalConfig 重新计算校准点
    // 这部分需要根据实际情况调整，如果配置文件只存最终参数，则无法反推校准点
    // 简单起见，这里不反推，只更新UI
    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
}

function renderUI(params) {
    // 在简化模式下，UI不再直接显示intercept和slope的输入框和滑块
    // 而是通过图表反映最终效果
    // 这里只需要确保图表更新
    updateChart();
}

async function saveConfig() {
    if (!calibrationPoints.low || !calibrationPoints.high) {
        toast(i18next.t('toast.calibrationNeeded'), 'warning');
        return;
    }
    const finalParams = calculateFit();
    const configString = serializeConfig(finalParams);
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
    calibrationPoints.low = null;
    calibrationPoints.high = null;
    updateCalibrationStatusUI();
    renderUI(globalConfig);
    applyKcal(globalConfig);
    updateChart();
    toast(i18next.t('toast.reset'), 'info');
}

async function readAndShowNodeStatus() {
    const parsedOutputElem = document.getElementById('parsedNodeOutput');
    parsedOutputElem.innerHTML = i18next.t('status.reading');
    calibrationModal.show(); // 使用校准模态框显示节点状态
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
    calibrationModal = new Modal(document.getElementById('calibrationModal')); // 初始化校准模态框
    
    await fetchInitialRefreshRate();
    currentConfigPath = `${MODULE_PATH}/${currentRefreshRate}hz.config`;

    try {
        const { stdout: max } = await exec(`cat ${MAX_BRIGHTNESS_PATH}`);
        maxBrightness = parseInt(max.trim());
        const { stdout: cur } = await exec(`cat ${BACKLIGHT_PATH}`);
        const currentSystemVal = parseInt(cur.trim());
        lastKnownBrightness = currentSystemVal;
        brightnessSlider.disabled = false;
        const percentage = Math.round((currentSystemVal / maxBrightness) * 100); // 亮度百分比计算
        brightnessSlider.value = percentage;
        brightnessValue.innerText = i18next.t('status.brightnessValue', { value: currentSystemVal, percent: percentage });
    } catch (e) {
        brightnessValue.innerText = i18next.t('status.brightnessReadError');
        brightnessSlider.disabled = true;
        toast(i18next.t('toast.backlightPathError'), 'error');
    }
    
    await loadConfigAndRender();
    updateCalibrationStatusUI(); // 初始加载后更新校准点状态

    // --- 事件监听器 ---
    brightnessSlider.addEventListener('input', (e) => setSystemBrightness(parseInt(e.target.value)));
    saveButton.addEventListener('click', saveConfig);
    resetButton.addEventListener('click', resetGlobalConfig); // 绑定到新的resetButton
    // readNodeButton.addEventListener('click', readAndShowNodeStatus); // 移除，因为UI上没有这个按钮了
    
    setLowPointButton.addEventListener('click', () => openCalibrationModal('low'));
    setHighPointButton.addEventListener('click', () => openCalibrationModal('high'));

    colorOffsetSlider.addEventListener('input', (e) => {
        const offset = parseInt(e.target.value, 10);
        colorOffsetValue.innerText = offset;
        // 实时预览：应用当前偏移值作为 intercept，slope 为 0
        applyKcal({ intercept: offset, slope: 0 });
    });

    confirmCalibrationButton.addEventListener('click', () => {
        const brightness = lastKnownBrightness > 0 ? lastKnownBrightness : 1;
        const offset = parseInt(colorOffsetSlider.value, 10);

        if (currentCalibrationMode === 'low') {
            calibrationPoints.low = { brightness, offset };
            toast(i18next.t('toast.lowPointSet'), 'success');
        } else {
            calibrationPoints.high = { brightness, offset };
            toast(i18next.t('toast.highPointSet'), 'success');
        }

        if (calibrationPoints.low && calibrationPoints.high) {
            const finalParams = calculateFit();
            globalConfig = {
                red: { ...finalParams },
                green: { ...finalParams },
                blue: { ...finalParams },
            };
            applyKcal(finalParams);
            updateChart();
        }
        
        calibrationModal.hide();
        updateCalibrationStatusUI(); // 更新UI显示校准点状态
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    i18next.on('languageChanged', () => updateUIText());

    setInterval(pollSystemStatus, 1000);
}

document.addEventListener('DOMContentLoaded', init);