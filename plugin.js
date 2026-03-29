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
    if (!text) return { redirects, hides };
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) {
            redirects.push({ 
                source: convertToStoragePath(parts[1]), 
                target: convertToStoragePath(parts.slice(2).join(' ')) 
            });
        } else if (parts[0] === 'HIDE' && parts.length >= 2) {
            hides.push(convertToStoragePath(parts[1]));
        }
    });
    return { redirects, hides };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    let templates = [];

    // 1. 处理全局配置
    const globalRules = parseRules(globalConfText);
    if (globalRules.redirects.length > 0 || globalRules.hides.length > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            permitted_media_types: [0, 1, 2, 3, 4, 5, 6],
            filter_path: globalRules.hides.length ? globalRules.hides : undefined,
            redirect_rules: globalRules.redirects.length ? globalRules.redirects : undefined
        });
    }

    let pkgMap = new Map();
    const addRulesToPkg = (pkg, text) => {
        if (!text) return;
        const r = parseRules(text);
        if (r.hides.length || r.redirects.length) {
            if (!pkgMap.has(pkg)) pkgMap.set(pkg, { hides: [], redirects: [] });
            pkgMap.get(pkg).hides.push(...r.hides);
            pkgMap.get(pkg).redirects.push(...r.redirects);
        }
    };

    // 2. 收集 App-rules 配置
    appMap.forEach((app, pkg) => {
        const u0 = app.users[0];
        if (u0 && u0.isEnabled) {
            addRulesToPkg(pkg, u0.text);
        }
    });

    // 3. 收集 injector.conf 内联配置
    if (injectorRulesMap) {
        injectorRulesMap.forEach((lines, section) => {
            if (section === 'GLOBAL') return;
            const state = injectorStates.get(section);
            if (state === 'OFF') return;
            const pkg = section.split(':')[0];
            addRulesToPkg(pkg, lines.join('\n'));
        });
    }

    // 4. 生成模板 JSON，使用应用名称作为 template_name
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
            permitted_media_types: [0, 1, 2, 3, 4, 5, 6],
            filter_path: uniqueHides.length ? uniqueHides : undefined,
            redirect_rules: uniqueRedirects.length ? uniqueRedirects : undefined
        });
    });

    const jsonStr = JSON.stringify(templates);
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    // 设置权限
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) { await exec(`chown ${ug} ${targetPath}`); }
    await exec(`chmod 644 ${targetPath}`);

    // 5. 执行重载命令通知插件
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast("同步成功：插件规则已重载");
    } else {
        console.warn("Reload rules failed:", reloadRes.stderr);
    }
}