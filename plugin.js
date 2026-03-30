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
 * 核心路径转换
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
    if (!result.endsWith('/')) result += '/';
    return result.replace(/\/+/g, '/');
};

/**
 * 解析规则，支持获取沙盒状态
 */
const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    let isSandboxOn = false;
    let isSandboxExplicitOff = false;

    if (!text) return { redirects, hides, isSandboxOn, isSandboxExplicitOff };

    text.split('\n').forEach(line => {
        const p = line.trim().split(/\s+/);
        if (p[0] === 'REDIRECT' && p.length >= 3) {
            redirects.push({ source: convertToStoragePath(p[1]), target: convertToStoragePath(p.slice(2).join(' ')) });
        } else if (p[0] === 'HIDE' && p.length >= 2) {
            hides.push(convertToStoragePath(p[1]));
        } else if (p[0] === 'SANDBOX' && p.length >= 2) {
            if (p[1] === 'ON') isSandboxOn = true;
            else if (p[1] === 'OFF') isSandboxExplicitOff = true;
        }
    });
    return { redirects, hides, isSandboxOn, isSandboxExplicitOff };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;
    if (!(await checkPluginInstalled())) return;

    const globalRules = parseRules(globalConfText);
    const mergedData = new Map();

    // 辅助合并函数
    const mergeData = (pkg, ruleText, forceOn = false) => {
        const p = parseRules(ruleText);
        if (!mergedData.has(pkg)) {
            mergedData.set(pkg, { hides: new Set(), redirects: new Map(), isSandboxOn: false });
        }
        const m = mergedData.get(pkg);
        p.hides.forEach(h => m.hides.add(h));
        p.redirects.forEach(r => m.redirects.set(r.source, r.target));
        if (p.isSandboxOn && !p.isSandboxExplicitOff) m.isSandboxOn = true;
        // 如果显式标记了 OFF，则沙盒关闭
        if (p.isSandboxExplicitOff) m.isSandboxOn = false;
    };

    // 1. 扫描所有状态，找出需要同步的应用
    // 逻辑：只有显式为 ON 或者没有显式 OFF 的配置块才同步
    const activePackages = new Set();
    
    // 从 injectorStates 收集活跃包名并截断 UID
    injectorStates.forEach((status, sectionKey) => {
        const pkg = sectionKey.split(':')[0];
        if (status === 'ON') {
            activePackages.add(pkg);
        }
    });

    // 从 injectorRulesMap 中补充已存在规则但未显式 OFF 的包
    injectorRulesMap.forEach((lines, sectionKey) => {
        if (sectionKey === 'GLOBAL') return;
        const pkg = sectionKey.split(':')[0];
        const status = injectorStates.get(sectionKey);
        if (status !== 'OFF') {
            activePackages.add(pkg);
        }
    });

    // 2. 对活跃应用合并规则
    activePackages.forEach(pkg => {
        // 合并全局规则
        mergeData(pkg, globalConfText);

        // 合并应用专属规则文件 (来自 App-rules)
        const app = appMap.get(pkg);
        if (app && app.users) {
            Object.keys(app.users).forEach(uid => {
                const userConf = app.users[uid];
                const status = injectorStates.get(`${pkg}:${uid}`) || injectorStates.get(pkg);
                if (status !== 'OFF' && userConf.text) {
                    mergeData(pkg, userConf.text);
                }
            });
        }

        // 合并 injector.conf 里的内联规则
        injectorRulesMap.forEach((lines, sectionKey) => {
            if (sectionKey.split(':')[0] === pkg) {
                const status = injectorStates.get(sectionKey);
                if (status !== 'OFF') {
                    mergeData(pkg, lines.join('\n'));
                }
            }
        });
    });

    // 3. 构建模板数组
    let templates = [];
    mergedData.forEach((data, pkg) => {
        const redirectArray = [];
        data.redirects.forEach((target, source) => redirectArray.push({ source, target }));

        // 仅在有实际意义时添加（有规则或开启沙盒）
        if (data.hides.size > 0 || redirectArray.length > 0 || data.isSandboxOn) {
            const appInfo = appMap.get(pkg);
            const displayName = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;

            templates.push({
                template_name: displayName,
                hook_operation: ["query", "insert"],
                apply_to_app: [pkg],
                // 沙盒开启则设为 0
                permitted_media_types: data.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
                filter_path: data.hides.size > 0 ? Array.from(data.hides) : undefined,
                redirect_rules: redirectArray.length > 0 ? redirectArray : undefined
            });
        }
    });

    // 4. 写入规则文件
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = (res.stdout ? res.stdout.trim() : "") || "com.android.providers.media.module";
    const targetPath = `/data/data/${mpPkg}/files/rule`;
    
    await exec(`mkdir -p /data/data/${mpPkg}/files`);
    await exec(`echo '${JSON.stringify(templates).replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    // 设置权限
    const statRes = await exec(`stat -c '%u:%g' /data/data/${mpPkg}/files 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) await exec(`chown ${ug} ${targetPath}`);
    await exec(`chmod 644 ${targetPath}`);

    // 5. 重载通知
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：转换了 ${templates.length} 个规则`);
    } else {
        toast(`配置已更新，但插件重载返回异常`);
    }
}