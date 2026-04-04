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
    let ros = [];
    let allows = [];
    let sandboxState = undefined;
    
    if (!text) return { redirects, hides, ros, allows, sandboxState };
    
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) {
            redirects.push({ 
                source: convertToStoragePath(parts[1]), 
                target: convertToStoragePath(parts.slice(2).join(' ')) 
            });
        } else if (parts[0] === 'HIDE' && parts.length >= 2) {
            hides.push(convertToStoragePath(parts[1]));
        } else if (parts[0] === 'RO' && parts.length >= 2) {
            ros.push(convertToStoragePath(parts[1]));
        } else if (parts[0] === 'ALLOW' && parts.length >= 2) {
            allows.push(convertToStoragePath(parts[1]));
        } else if (parts[0] === 'SANDBOX' && parts.length >= 2) {
            if (parts[1] === 'ON') sandboxState = 'ON';
            else if (parts[1] === 'OFF') sandboxState = 'OFF';
        }
    });
    return { redirects, hides, ros, allows, sandboxState };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    const isGlobalInjectOn = (globalConfText || "").includes('GLOBAL_INJECT ON');
    let allEnabledApps = new Set(); 
    let pkgRules = new Map();

    // 1. 收集应用启用状态与配置
    appMap.forEach((app, pkg) => {
        let combinedText = "";
        let isPkgEnabled = false;

        for (const uid in app.users) {
            if (app.users[uid].isEnabled) {
                isPkgEnabled = true;
                if (app.users[uid].text) combinedText += app.users[uid].text + "\n";
            }
        }
        
        if (isGlobalInjectOn) {
            const state = injectorStates.get(pkg);
            const state0 = injectorStates.get(`${pkg}:0`);
            if (state !== 'OFF' && state0 !== 'OFF') { isPkgEnabled = true; }
        }
        
        if (isPkgEnabled) {
            allEnabledApps.add(pkg);
            if (combinedText.trim()) {
                pkgRules.set(pkg, parseRules(combinedText));
            }
        }
    });

    // 2. 收集内联配置
    injectorRulesMap.forEach((lines, section) => {
        if (section === 'GLOBAL') return;
        const pkg = section.split(':')[0];
        const state = injectorStates.get(section);
        const isPkgEnabled = isGlobalInjectOn ? state !== 'OFF' : state === 'ON';
        
        if (isPkgEnabled) {
            allEnabledApps.add(pkg);
            const parsed = parseRules(lines.join('\n'));
            const existing = pkgRules.get(pkg) || { hides: [], redirects: [], ros: [], allows: [], sandboxState: undefined };
            existing.hides.push(...parsed.hides);
            existing.ros.push(...parsed.ros);
            existing.allows.push(...parsed.allows);
            existing.redirects.push(...parsed.redirects);
            if (parsed.sandboxState) existing.sandboxState = parsed.sandboxState;
            pkgRules.set(pkg, existing);
        }
    });

    let templates = [];

    // 3. 全局模板
    const globalRules = parseRules(globalConfText);
    const hasGlobalRules = globalRules.redirects.length > 0 || globalRules.hides.length > 0 || globalRules.ros.length > 0 || globalRules.allows.length > 0 || globalRules.sandboxState === 'ON';
    
    if (hasGlobalRules && allEnabledApps.size > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            apply_to_app: Array.from(allEnabledApps),
            enable_sandbox: globalRules.sandboxState === 'ON',
            exempt_path: globalRules.allows.length > 0 ? [...new Set(globalRules.allows)] : undefined,
            filter_path: globalRules.hides.length > 0 ? [...new Set(globalRules.hides)] : undefined,
            read_only_path: globalRules.ros.length > 0 ? [...new Set(globalRules.ros)] : undefined,
            redirect_rules: globalRules.redirects.length > 0 ? globalRules.redirects : undefined
        });
    }

    // 4. 应用专属模板名称冲突检测与生成
    const labelCounts = {};
    pkgRules.forEach((_, pkg) => {
        const appInfo = appMap.get(pkg);
        const label = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;
        labelCounts[label] = (labelCounts[label] || 0) + 1;
    });

    pkgRules.forEach((data, pkg) => {
        const isSpecial = data.sandboxState === 'ON' || data.hides.length > 0 || data.redirects.length > 0 || data.ros.length > 0 || data.allows.length > 0;
        if (isSpecial) {
            const appInfo = appMap.get(pkg);
            const label = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;
            // 只有在名称出现重复时，才附加包名以保持辨识度和唯一性
            const finalName = (labelCounts[label] > 1 && label !== pkg) ? `${label} (${pkg})` : label;

            templates.push({
                template_name: finalName,
                hook_operation: ["query", "insert"],
                apply_to_app: [pkg],
                enable_sandbox: data.sandboxState === 'ON',
                exempt_path: data.allows.length > 0 ? [...new Set(data.allows)] : undefined,
                filter_path: data.hides.length > 0 ? [...new Set(data.hides)] : undefined,
                read_only_path: data.ros.length > 0 ? [...new Set(data.ros)] : undefined,
                redirect_rules: data.redirects.length > 0 ? [...new Map(data.redirects.map(r => [r.source, r])).values()] : undefined
            });
        }
    });

    // 5. 写入规则文件
    const jsonStr = JSON.stringify(templates);
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    
    const targetDir = `/data/user_de/0/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) { await exec(`chown ${ug} ${targetPath}`); }
    await exec(`chmod 644 ${targetPath}`);

    // 6. 重载反馈
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：已转换 ${templates.length} 个规则模板，插件已重载`);
    } else {
        console.warn("Reload rules failed:", reloadRes.stderr);
    }
}