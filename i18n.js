// i18n.js
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      // Header
      title: "MiuiCX Color Tuner",
      subtitle: " ",
      // Status Card
      "status.cardTitle": "Live Status",
      "status.refreshRate": "Refresh Rate:",
      "status.brightness": "Brightness (%)",
      "status.reading": "Reading...",
      "status.brightnessValue": "{{value}} ({{percent}}%)",
      "status.brightnessReadError": "Failed to read brightness",
      "status.brightnessPathError": "Backlight path not set",
      "status.refreshRateReadError": "Unavailable",
      // Config Card
      "config.cardTitle": "Settings",
      "config.description": "Click 'Edit' to adjust parameters.",
      // Buttons
      "buttons.editMode.enter": '<i class="fas fa-edit me-2"></i>Edit',
      "buttons.editMode.exit": '<i class="fas fa-lock me-2"></i>Lock',
      "buttons.customizeRanges": '<i class="fas fa-sliders-h me-2"></i>Set Ranges',
      "buttons.readNode": '<i class="fas fa-sync-alt me-2"></i>Read Node',
      "buttons.reset": '<i class="fas fa-undo me-2"></i>Reset',
      "buttons.save": "Save",
      // Params & Chart
      "params.intercept": "Intercept",
      "params.slope": "Slope",
      "params.offset": "Offset",
      "params.red": "Red",
      "params.green": "Green",
      "chart.yAxisTitle": "Calculated Value",
      // Footer
      "footer.author": "Author: 囫碾 | WebUI by Gemini Pro",
      // Node Status Modal
      "modals.nodeStatus.title": "Node Status",
      "modals.nodeStatus.raw": "Raw Data",
      "modals.nodeStatus.parsed": "Parsed Values",
      "modals.nodeStatus.refreshRate": "Refresh Rate:",
      "modals.nodeStatus.close": "Close",
      // Range Config Modal
      "modals.range.title": "Set Slider Ranges",
      "modals.range.description": "Define the min/max for each slider. This only changes the adjustment range.",
      "modals.range.intercept": "Intercept Range",
      "modals.range.slope": "Slope Range",
      "modals.range.offset": "Offset Range",
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
      "toast.refreshRateChanged": "Refresh rate changed to {{rate}}Hz. Switched profile.", // [新增]
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
      subtitle: " ",
      // Status Card
      "status.cardTitle": "实时状态",
      "status.refreshRate": "刷新率:",
      "status.brightness": "亮度 (%)",
      "status.reading": "读取中",
      "status.brightnessValue": "{{value}} ({{percent}}%)",
      "status.brightnessReadError": "无法读取亮度文件",
      "status.brightnessPathError": "未配置背光路径",
      "status.refreshRateReadError": "不可用",
      // Config Card
      "config.cardTitle": "参数设置",
      "config.description": "点击编辑调整参数",
      // Buttons
      "buttons.editMode.enter": '<i class="fas fa-edit me-2"></i>编辑',
      "buttons.editMode.exit": '<i class="fas fa-lock me-2"></i>锁定',
      "buttons.customizeRanges": '<i class="fas fa-sliders-h me-2"></i>范围设置',
      "buttons.readNode": '<i class="fas fa-sync-alt me-2"></i>读取节点',
      "buttons.reset": '<i class="fas fa-undo me-2"></i>重置',
      "buttons.save": "保存",
      // Params & Chart
      "params.intercept": "截距",
      "params.slope": "斜率",
      "params.offset": "偏移",
      "params.red": "红色",
      "params.green": "绿色",
      "chart.yAxisTitle": "计算值",
      // Footer
      "footer.author": "作者: 囫碾 | WebUI by Gemini2.5 Pro",
      // Node Status Modal
      "modals.nodeStatus.title": "节点状态",
      "modals.nodeStatus.raw": "原始数据",
      "modals.nodeStatus.parsed": "解析值",
      "modals.nodeStatus.refreshRate": "刷新率:",
      "modals.nodeStatus.close": "关闭",
      // Range Config Modal
      "modals.range.title": "设置滑块范围",
      "modals.range.description": "定义各滑块的最小/最大值（仅影响调节范围）",
      "modals.range.intercept": "截距范围",
      "modals.range.slope": "斜率范围",
      "modals.range.offset": "偏移范围",
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
      "toast.refreshRateChanged": "刷新率变为 {{rate}}Hz，已切换配置文件。", // [新增]
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