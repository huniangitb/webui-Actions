import { exec, toast } from 'kernelsu';

const SETTINGS_FILE = "/data/Namespace-Proxy/webui_settings.json";

export async function getSettings() {
    try {
        const res = await exec(`cat ${SETTINGS_FILE} 2>/dev/null`);
        if (res.stdout) return JSON.parse(res.stdout);
    } catch(e) {}
    return { syncPlugin: false };
}

export async function saveSettings(settings) {
    await exec(`echo '${JSON.stringify(settings)}' > ${SETTINGS_FILE}`);
}

export async function checkPluginInstalled() {
    const res = await exec("pm path me.gm.cleaner.plugin 2>/dev/null");
    return !!(res.stdout && res.stdout.trim());
}

/**
 * 核心转换逻辑：
 * 1. 处理真实路径 /data/media/0 -> /storage/emulated/0
 * 2. 处理相对根路径 /123云盘 -> /storage/emulated/0/123云盘
 * 3. 确保以 / 结尾
 */
const convertToStoragePath = (p) => {
    if (!p) return p;
    let result = p.trim();
    
    if (result.startsWith('/data/media/0')) {
        result = '/storage/emulated/0' + result.substring(13);
    } 
    else if (result.startsWith('/') && !result.startsWith('/storage/emulated/0')) {
        result = '/storage/emulated/0' + result;
    }
    else if (!result.startsWith('/')) {
        result = '/storage/emulated/0/' + result;
    }

    if (!result.endsWith('/')) {
        result += '/';
    }

    return result.replace(/\/+/g, '/');
};

const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    let sandboxState = undefined; // 提取沙盒的显式状态 'ON' 或 'OFF'
    
    if (!text) return { redirects, hides, sandboxState };
    
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) {
            redirects.push({ 
                source: convertToStoragePath(parts[1]), 
                target: convertToStoragePath(parts.slice(2).join(' ')) 
            });
        } else if (parts[0] === 'HIDE' && parts.length >= 2) {
            hides.push(convertToStoragePath(parts[1]));
        } else if (parts[0] === 'SANDBOX' && parts.length >= 2) {
            if (parts[1] === 'ON') sandboxState = 'ON';
            else if (parts[1] === 'OFF') sandboxState = 'OFF';
        }
    });
    
    return { redirects, hides, sandboxState };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    let templates = [];

    // 1. 收集所有处于开启 (ON) 状态的包名
    let targetPkgs = new Set();
    
    appMap.forEach((app, pkg) => {
        if (app.users[0] && app.users[0].isEnabled) {
            targetPkgs.add(pkg);
        }
    });
    
    injectorStates.forEach((state, section) => {
        if (section !== 'GLOBAL' && state === 'ON') {
            targetPkgs.add(section.split(':')[0]); // 剔除可能存在的 :uid
        }
    });

    // 2. 梳理应用的具体配置与提取全局可继承列表
    let pkgMap = new Map();
    let globalTargetApps = new Set();

    targetPkgs.forEach(pkg => {
        let combinedText = "";
        
        // 提取 App-rules
        const app = appMap.get(pkg);
        if (app && app.users[0] && app.users[0].text) {
            combinedText += app.users[0].text + "\n";
        }
        
        // 提取 内联 rules
        const inline1 = injectorRulesMap.get(pkg);
        if (inline1) combinedText += inline1.join('\n') + "\n";
        const inline2 = injectorRulesMap.get(`${pkg}:0`);
        if (inline2) combinedText += inline2.join('\n') + "\n";

        const parsed = parseRules(combinedText);

        // 如果该应用没有显式设置 SANDBOX OFF，则加入全局模板控制列表
        if (parsed.sandboxState !== 'OFF') {
            globalTargetApps.add(pkg);
        }

        // 仅当该应用存在专属的 隐藏、重定向 或 强开沙盒 时，才为其生成独立的专属模板
        if (parsed.hides.length > 0 || parsed.redirects.length > 0 || parsed.sandboxState === 'ON') {
            pkgMap.set(pkg, parsed);
        }
    });

    // 3. 构建统一的全局规则模板
    const globalRules = parseRules(globalConfText);
    if ((globalRules.redirects.length > 0 || globalRules.hides.length > 0 || globalRules.sandboxState === 'ON') && globalTargetApps.size > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            apply_to_app: Array.from(globalTargetApps), // 指定下发给所有 ON 且未豁免沙盒的包
            permitted_media_types: globalRules.sandboxState === 'ON' ? [0] : [0, 1, 2, 3, 4, 5, 6],
            filter_path: globalRules.hides.length > 0 ? globalRules.hides : undefined,
            redirect_rules: globalRules.redirects.length > 0 ? globalRules.redirects : undefined
        });
    }

    // 4. 构建独立的专属规则模板
    pkgMap.forEach((rules, pkg) => {
        const uniqueHides = [...new Set(rules.hides)];
        const rMap = new Map();
        rules.redirects.forEach(r => rMap.set(r.source, r));
        const uniqueRedirects = Array.from(rMap.values());

        const appInfo = appMap.get(pkg);
        const displayName = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;

        templates.push({
            template_name: displayName,
            hook_operation: ["query", "insert"],
            apply_to_app: [pkg],
            permitted_media_types: rules.sandboxState === 'ON' ? [0] : [0, 1, 2, 3, 4, 5, 6],
            filter_path: uniqueHides.length > 0 ? uniqueHides : undefined,
            redirect_rules: uniqueRedirects.length > 0 ? uniqueRedirects : undefined
        });
    });

    // 写入 JSON 模板到清理插件媒体存储目录
    const jsonStr = JSON.stringify(templates);
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    // 同步权限
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) { await exec(`chown ${ug} ${targetPath}`); }
    await exec(`chmod 644 ${targetPath}`);

    // 5. 执行重载并进行 Toast 反馈
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：已转换 ${templates.length} 个规则模板，插件已重载`);
    } else {
        console.warn("Reload rules failed:", reloadRes.stderr);
    }
}