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
    if (!result.endsWith('/')) { result += '/'; }
    return result.replace(/\/+/g, '/');
};

const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    let ros = []; // 存储 RO (read_only_path) 规则
    let sandboxState = undefined; 
    
    if (!text) return { redirects, hides, ros, sandboxState };
    
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
        } else if (parts[0] === 'SANDBOX' && parts.length >= 2) {
            if (parts[1] === 'ON') sandboxState = 'ON';
            else if (parts[1] === 'OFF') sandboxState = 'OFF';
        }
    });
    return { redirects, hides, ros, sandboxState };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    // 是否开启了全局注入大开关
    const isGlobalInjectOn = (globalConfText || "").includes('GLOBAL_INJECT ON');

    let allEnabledApps = new Set(); // 所有被启用的目标包名
    let pkgRules = new Map();

    // 1. 收集 App-rules 中的启用状态与配置 (支持多用户目录)
    appMap.forEach((app, pkg) => {
        let combinedText = "";
        let isPkgEnabled = false;

        for (const uid in app.users) {
            if (app.users[uid].isEnabled) {
                isPkgEnabled = true;
                if (app.users[uid].text) combinedText += app.users[uid].text + "\n";
            }
        }
        
        // 如果开启了全局注入，且没有被单独禁用，则默认将其视为启用目标
        if (isGlobalInjectOn) {
            const state = injectorStates.get(pkg);
            const state0 = injectorStates.get(`${pkg}:0`);
            if (state !== 'OFF' && state0 !== 'OFF') {
                isPkgEnabled = true;
            }
        }
        
        if (isPkgEnabled) {
            allEnabledApps.add(pkg);
            if (combinedText.trim()) {
                const parsed = parseRules(combinedText);
                pkgRules.set(pkg, { ...parsed, enabled: true });
            }
        }
    });

    // 2. 收集 injector.conf 的内联配置
    injectorRulesMap.forEach((lines, section) => {
        if (section === 'GLOBAL') return;
        const pkg = section.split(':')[0];
        
        const state = injectorStates.get(section);
        const isPkgEnabled = isGlobalInjectOn ? state !== 'OFF' : state === 'ON';
        
        if (isPkgEnabled) {
            allEnabledApps.add(pkg);
            const parsed = parseRules(lines.join('\n'));
            const existing = pkgRules.get(pkg) || { hides: [], redirects: [], ros: [], sandboxState: undefined, enabled: true };
            
            existing.hides.push(...parsed.hides);
            existing.ros.push(...parsed.ros);
            existing.redirects.push(...parsed.redirects);
            if (parsed.sandboxState) existing.sandboxState = parsed.sandboxState;
            
            pkgRules.set(pkg, existing);
        }
    });

    let templates = [];

    // 3. 构建统一通用全局模板：显式下发目标应用名单
    const globalRules = parseRules(globalConfText);
    if ((globalRules.redirects.length > 0 || globalRules.hides.length > 0 || globalRules.ros.length > 0 || globalRules.sandboxState === 'ON') && allEnabledApps.size > 0) {
        templates.push({
            template_name: "NS-Proxy-Global",
            hook_operation: ["query", "insert"],
            apply_to_app: Array.from(allEnabledApps), // 核心要求：显式添加需要注入的应用包名
            permitted_media_types: globalRules.sandboxState === 'ON' ? [0] : undefined, // null 不限制
            filter_path: globalRules.hides.length > 0 ? globalRules.hides : undefined,
            read_only_path: globalRules.ros.length > 0 ? globalRules.ros : undefined, // 新增 RO
            redirect_rules: globalRules.redirects.length > 0 ? globalRules.redirects : undefined
        });
    }

    // 4. 构建独立的专属规则模板（针对特殊修改了隔离规则的应用）
    pkgRules.forEach((data, pkg) => {
        if (data.sandboxState === 'ON' || data.hides.length > 0 || data.redirects.length > 0 || data.ros.length > 0) {
            const appInfo = appMap.get(pkg);
            const displayName = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;

            templates.push({
                template_name: displayName,
                hook_operation: ["query", "insert"],
                apply_to_app: [pkg],
                permitted_media_types: data.sandboxState === 'ON' ? [0] : undefined,
                filter_path: data.hides.length > 0 ? [...new Set(data.hides)] : undefined,
                read_only_path: data.ros.length > 0 ? [...new Set(data.ros)] : undefined, // 新增 RO
                redirect_rules: data.redirects.length > 0 ? [...new Map(data.redirects.map(r => [r.source, r])).values()] : undefined
            });
        }
    });

    // 5. 写入 JSON 配置到插件数据目录
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

    // 6. 运行重启回调并带上模板数量进行反馈
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：已转换 ${templates.length} 个规则模板，插件已重载`);
    } else {
        console.warn("Reload rules failed:", reloadRes.stderr);
    }
}