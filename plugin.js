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
    if (!result.endsWith('/')) { result += '/'; }
    return result.replace(/\/+/g, '/');
};

const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    let isSandboxOn = false;
    
    if (!text) return { redirects, hides, isSandboxOn };
    
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
            if (parts[1] === 'ON') isSandboxOn = true;
        }
    });
    
    return { redirects, hides, isSandboxOn };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    let templates = [];

    // 1. 处理全局配置
    const globalRules = parseRules(globalConfText);
    
    // 2. 收集所有用户目录下的配置
    // pkgMap: key=pkgName, value={hides:[], redirects:[], isSandboxOn:bool}
    let pkgMap = new Map();
    let globalTargetApps = new Set(); // 用于记录所有开启了该包注入的应用

    appMap.forEach((app, pkg) => {
        let allUserRulesText = "";
        let isPkgEnabled = false;
        let isPkgSandboxOn = false;

        // 遍历所有用户配置（支持 App-rules, App-rules-10, 等）
        for (const uid in app.users) {
            const uConf = app.users[uid];
            if (uConf.isEnabled) {
                isPkgEnabled = true;
                if (uConf.text) allUserRulesText += uConf.text + "\n";
            }
        }

        // 处理 injector.conf 中的内联配置 (如 com.package:10)
        // 尝试匹配 pkg 以及带 uid 的 section
        injectorRulesMap.forEach((lines, section) => {
            const basePkg = section.split(':')[0];
            if (basePkg === pkg && injectorStates.get(section) === 'ON') {
                isPkgEnabled = true;
                allUserRulesText += lines.join('\n') + "\n";
            }
        });

        if (isPkgEnabled) {
            const parsed = parseRules(allUserRulesText);
            
            // 加入全局生效目标列表
            globalTargetApps.add(pkg);

            // 存入独立模板规则
            if (parsed.hides.length > 0 || parsed.redirects.length > 0 || parsed.isSandboxOn) {
                if (!pkgMap.has(pkg)) pkgMap.set(pkg, { hides: [], redirects: [], isSandboxOn: false });
                pkgMap.get(pkg).hides.push(...parsed.hides);
                pkgMap.get(pkg).redirects.push(...parsed.redirects);
                if (parsed.isSandboxOn) pkgMap.get(pkg).isSandboxOn = true;
            }
        }
    });

    // 3. 构建统一的全局规则模板
    if ((globalRules.redirects.length > 0 || globalRules.hides.length > 0 || globalRules.isSandboxOn) && globalTargetApps.size > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            apply_to_app: Array.from(globalTargetApps),
            permitted_media_types: globalRules.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
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
            permitted_media_types: rules.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
            filter_path: uniqueHides.length > 0 ? uniqueHides : undefined,
            redirect_rules: uniqueRedirects.length > 0 ? uniqueRedirects : undefined
        });
    });

    // 5. 写入文件
    const jsonStr = JSON.stringify(templates);
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) { await exec(`chown ${ug} ${targetPath}`); }
    await exec(`chmod 644 ${targetPath}`);

    // 6. 执行重载并反馈
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：已转换 ${templates.length} 个规则模板，插件已重载`);
    } else {
        console.warn("Reload rules failed:", reloadRes.stderr);
    }
}