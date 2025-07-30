// i18n.js
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      // Header
      title: "MiuiCX Color Tuner",
      subtitle: { simplified: "Simplified Two-Point Calibration" },
      // Status Card
      "status.cardTitle": "Live Status",
      "status.refreshRate": "Refresh Rate:",
      "status.brightness": "Brightness (%)",
      "status.reading": "Reading...",
      "status.brightnessValue": "{{value}} ({{percent}}%)",
      "status.brightnessReadError": "Failed to read brightness",
      "status.brightnessPathError": "Backlight path not set",
      "status.refreshRateReadError": "Unavailable",
      // Calibration Section
      "calibration.title": "Two-Point Calibration",
      "calibration.description": "Adjust color at low and high brightness. The app will calculate the curve.",
      "calibration.step1.title": "Step 1: Low Brightness Point",
      "calibration.step1.description": "Set screen to a comfortable low brightness, then click below to adjust color.",
      "calibration.step1.button": "Set Low Point",
      "calibration.step1.status": "Not set",
      "calibration.step1.statusSet": "Set: {{offset}} ({{brightness}}%)",
      "calibration.step2.title": "Step 2: High Brightness Point",
      "calibration.step2.description": "Set screen to maximum brightness, then click below to adjust color.",
      "calibration.step2.button": "Set High Point",
      "calibration.step2.status": "Not set",
      "calibration.step2.statusSet": "Set: {{offset}} ({{brightness}}%)",
      "calibration.offsetLabel": "Color Offset (Green <-> Red)",
      "calibration.confirmButton": "Confirm Point",
      // Buttons
      "buttons.reset": { "icon": "mdiRestore", "text": "Reset" },
      "buttons.save": "Save",
      // Params & Chart
      "params.intercept": "Intercept",
      "params.slope": "Slope",
      "params.red": "Red",
      "params.green": "Green",
      "params.blue": "Blue",
      "chart.yAxisTitle": "Calculated Value",
      // Footer
      "footer.author": "Author: 囫碾 | WebUI by Gemini Pro",
      // Modals
      "modals.nodeStatus.title": "Node Status",
      "modals.nodeStatus.refreshRate": "Refresh Rate:",
      "modals.nodeStatus.close": "Close",
      "modals.range.title": "Set Slider Ranges",
      "modals.range.description": "Define the min/max for each slider. This only changes the adjustment range.",
      "modals.range.min": "Min",
      "modals.range.max": "Max",
      "modals.range.cancel": "Cancel",
      "modals.range.save": "Save Ranges",
      // Toasts
      "toast.configLoaded": "Loaded config for {{file}}.",
      "toast.configLoadFailed": "Config '{{file}}' not found. Reading from node...",
      "toast.configLoadFromNode": "Loaded values from node.",
      "toast.configLoadFromNodeFailed": "Can't read node. Using defaults.",
      "toast.configLoadFromDefault": "Using default config.",
      "toast.saved": "Config saved to {{file}}.",
      "toast.saveFailed": "Save failed: {{error}}",
      "toast.reset": "Settings reset to default.",
      "toast.rangeSaved": "Slider ranges saved.",
      "toast.rangeError.nan": "Ranges must be numbers.",
      "toast.rangeError.minMax": "Min must be less than max.",
      "toast.editMode": "Edit mode enabled.",
      "toast.backlightPathError": "Backlight path error.",
      "toast.refreshRateChanged": "Refresh rate changed to {{rate}}Hz. Switched profile.",
      "toast.lowPointSet": "Low brightness point set. Now set the high point.",
      "toast.highPointSet": "High brightness point set. Calibration complete!",
      "toast.calibrationNeeded": "Please set both low and high brightness points before saving.",
      // Errors
      "errors.nodeParseError": "Invalid node format.",
      "errors.nodeReadFailed": "Read failed: {{error}}",
      "errors.nodeReadPermission": "Can't read Kcal node. Check path/permissions."
    }
  },
  'zh-CN': {
    translation: {
      // Header
      title: "MiuiCX 色彩调节",
      subtitle: { simplified: "两点简易校准" },
      // Status Card
      "status.cardTitle": "实时状态",
      "status.refreshRate": "刷新率:",
      "status.brightness": "亮度 (%)",
      "status.reading": "读取中",
      "status.brightnessValue": "{{value}} ({{percent}}%)",
      "status.brightnessReadError": "无法读取亮度文件",
      "status.brightnessPathError": "未配置背光路径",
      "status.refreshRateReadError": "不可用",
      // Calibration Section
      "calibration.title": "两点校准",
      "calibration.description": "通过调整低亮度和高亮度下的色彩偏移，应用将自动计算色彩曲线。",
      "calibration.step1.title": "第一步：校准低亮度",
      "calibration.step1.description": "将屏幕亮度调至舒适的低亮度，然后点击下方按钮进行色彩微调。",
      "calibration.step1.button": "设置低亮度点",
      "calibration.step1.status": "未设置",
      "calibration.step1.statusSet": "已设置: 偏移 {{offset}} (亮度 {{brightness}}%)",
      "calibration.step2.title": "第二步：校准高亮度",
      "calibration.step2.description": "将屏幕亮度调至最高，然后点击下方按钮进行色彩微调。",
      "calibration.step2.button": "设置高亮度点",
      "calibration.step2.status": "未设置",
      "calibration.step2.statusSet": "已设置: 偏移 {{offset}} (亮度 {{brightness}}%)",
      "calibration.offsetLabel": "色彩偏移 (偏绿 <-> 偏红)",
      "calibration.confirmButton": "确认此点",
      // Buttons
      "buttons.reset": { "icon": "mdiRestore", "text": "重置" },
      "buttons.save": "保存",
      // Params & Chart
      "params.intercept": "截距",
      "params.slope": "斜率",
      "params.red": "红色",
      "params.green": "绿色",
      "params.blue": "蓝色",
      "chart.yAxisTitle": "计算值",
      // Footer
      "footer.author": "作者: 囫碾 | WebUI by Gemini2.5 Pro",
      // Modals
      "modals.nodeStatus.title": "节点状态",
      "modals.nodeStatus.refreshRate": "刷新率:",
      "modals.nodeStatus.close": "关闭",
      "modals.range.title": "设置滑块范围",
      "modals.range.description": "定义各滑块的最小/最大值（仅影响调节范围）",
      "modals.range.min": "最小值",
      "modals.range.max": "最大值",
      "modals.range.cancel": "取消",
      "modals.range.save": "保存",
      // Toasts
      "toast.configLoaded": "已加载配置: {{file}}",
      "toast.configLoadFailed": "未找到配置 '{{file}}'，正从节点读取...",
      "toast.configLoadFromNode": "已从节点加载",
      "toast.configLoadFromNodeFailed": "节点读取失败，使用默认值",
      "toast.configLoadFromDefault": "使用默认配置",
      "toast.saved": "配置已保存至 {{file}}",
      "toast.saveFailed": "保存失败: {{error}}",
      "toast.reset": "已重置",
      "toast.rangeSaved": "范围设置已保存",
      "toast.rangeError.nan": "范围值需为数字",
      "toast.rangeError.minMax": "最小值需小于最大值",
      "toast.editMode": "进入编辑模式",
      "toast.backlightPathError": "背光路径错误",
      "toast.refreshRateChanged": "刷新率变为 {{rate}}Hz，已切换配置文件。",
      "toast.lowPointSet": "低亮度点已设置，请继续设置高亮度点。",
      "toast.highPointSet": "高亮度点已设置，校准完成！",
      "toast.calibrationNeeded": "请先设置低、高两个亮度点再保存。",
      // Errors
      "errors.nodeParseError": "节点格式无效",
      "errors.nodeReadFailed": "读取失败: {{error}}",
      "errors.nodeReadPermission": "节点读取失败，检查路径/权限"
    }
  }
};

i18next
  .use(LanguageDetector)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false,
    detection: {
      order: ['navigator'],
      caches: []
    },
    interpolation: {
      escapeValue: false
    }
  });

export default i18next;