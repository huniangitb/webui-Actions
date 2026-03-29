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
 * 路径转换：处理简化路径并确保以 / 结尾
 */
const convertToStoragePath = (p) => {
    if (!p) return p;
    let result = p.trim();
    if (result.startsWith('/data/media/0')) {
        result = '/storage/emulated/0' + result.substring(13);
    } else if (result.startsWith('/') && !result.startsWith('/storage/emulated/0')) {
        result = '/storage/emulated/0' + result;
    } else if (!result.startsWith('/')) {
        result = '/storage/emulated/0/' + result;
    }
    if (!result.endsWith('/')) { result += '/'; }
    return result.replace(/\/+/g, '/');
};

/**
 * 解析配置文本
 */
const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    let isSandboxOn = false;
    let isSandboxOffExplicitly = false;
    
    if (!text) return { redirects, hides, isSandboxOn, isSandboxOffExplicitly };
    
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        const cmd = parts[0];
        if (cmd === 'REDIRECT' && parts.length >= 3) {
            redirects.push({ 
                source: convertToStoragePath(parts[1]), 
                target: convertToStoragePath(parts.slice(2).join(' ')) 
            });
        } else if (cmd === 'HIDE' && parts.length >= 2) {
            hides.push(convertToStoragePath(parts[1]));
        } else if (cmd === 'SANDBOX' && parts.length >= 2) {
            if (parts[1] === 'ON') isSandboxOn = true;
            if (parts[1] === 'OFF') isSandboxOffExplicitly = true;
        }
    });
    
    return { redirects, hides, isSandboxOn, isSandboxOffExplicitly };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    if (!(await checkPluginInstalled())) return;

    let templates = [];
    const globalRules = parseRules(globalConfText);
    const globalApplyPkgs = [];

    // 1. 预处理所有应用，确定哪些应用需要专属模板，哪些应用应用全局规则
    let pkgSpecificRules = new Map();

    appMap.forEach((app, pkg) => {
        const u0 = app.users[0];
        if (!u0 || !u0.isEnabled) return; // 仅处理已启用的应用

        const appRules = parseRules(u0.text);
        
        // 判定是否加入全局模板的 apply_to_app 列表
        // 条件：应用开启，且没有显式设置 SANDBOX OFF
        if (!appRules.isSandboxOffExplicitly) {
            globalApplyPkgs.push(pkg);
        }

        // 判定应用是否有专属规则（非全局）
        if (appRules.hides.length || appRules.redirects.length || appRules.isSandboxOn) {
            pkgSpecificRules.set(pkg, appRules);
        }
    });

    // 2. 生成统一的全局模板 (NS-Proxy-Global)
    // 只有当全局规则存在或 apply 列表不为空时生成
    if ((globalRules.redirects.length > 0 || globalRules.hides.length > 0 || globalRules.isSandboxOn) && globalApplyPkgs.length > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            apply_to_app: globalApplyPkgs,
            permitted_media_types: globalRules.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
            filter_path: globalRules.hides.length ? globalRules.hides : undefined,
            redirect_rules: globalRules.redirects.length ? globalRules.redirects : undefined
        });
    }

    // 3. 生成应用专属模板
    pkgSpecificRules.forEach((rules, pkg) => {
        const appInfo = appMap.get(pkg);
        const displayName = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;

        templates.push({
            template_name: displayName,
            hook_operation: ["query", "insert"],
            apply_to_app: [pkg],
            permitted_media_types: rules.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
            filter_path: rules.hides.length ? rules.hides : undefined,
            redirect_rules: rules.redirects.length ? rules.redirects : undefined
        });
    });

    // 4. 写入文件
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${JSON.stringify(templates).replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) { await exec(`chown ${ug} ${targetPath}`); }
    await exec(`chmod 644 ${targetPath}`);

    // 5. 通知插件重载
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast("同步成功：插件规则已重载");
    }
}