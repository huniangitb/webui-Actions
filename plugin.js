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
 * 路径转换：处理相对路径并补全存储前缀与斜杠
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
 * 解析规则文本
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
            if (p[1] === 'OFF') isSandboxExplicitOff = true;
        }
    });
    return { redirects, hides, isSandboxOn, isSandboxExplicitOff };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;
    if (!(await checkPluginInstalled())) return;

    let templates = [];
    const globalRules = parseRules(globalConfText);

    // 存储每个包名最终合并的规则集
    const mergedData = new Map();

    // 辅助函数：合并规则到包名
    const mergeToPkg = (pkg, ruleText) => {
        const parsed = parseRules(ruleText);
        if (!mergedData.has(pkg)) {
            mergedData.set(pkg, { 
                hides: new Set(), 
                redirects: new Map(), 
                isSandboxOn: false 
            });
        }
        const target = mergedData.get(pkg);
        parsed.hides.forEach(h => target.hides.add(h));
        parsed.redirects.forEach(r => target.redirects.set(r.source, r.target));
        
        // 沙盒逻辑：如果解析到 ON 且未被显式 OFF 覆盖，则开启
        if (parsed.isSandboxOn && !parsed.isSandboxExplicitOff) {
            target.isSandboxOn = true;
        }
    };

    // 1. 遍历 appMap 收集所有状态为 ON 的应用
    appMap.forEach((app, pkg) => {
        // 检查该应用在任何一个用户下是否开启了注入
        let isAnyUserOn = false;
        Object.keys(app.users).forEach(uid => {
            const userConf = app.users[uid];
            // 检查 injectorStates 里的状态
            const state = injectorStates.get(`${pkg}:${uid}`) || injectorStates.get(pkg) || "ON";
            if (state === 'ON') {
                isAnyUserOn = true;
                // 合并该用户的独立规则文件
                if (userConf.text) mergeToPkg(pkg, userConf.text);
            }
        });

        // 如果开启了注入，则必须合并全局规则
        if (isAnyUserOn) {
            mergeToPkg(pkg, globalConfText);
        }
    });

    // 2. 兼容处理 injector.conf 里的内联规则 [pkg] 或 [pkg:uid]
    if (injectorRulesMap) {
        injectorRulesMap.forEach((lines, section) => {
            if (section === 'GLOBAL') return;
            const state = injectorStates.get(section) || "ON";
            if (state === 'OFF') return;

            const pkg = section.split(':')[0];
            if (appMap.has(pkg)) {
                mergeToPkg(pkg, lines.join('\n'));
            }
        });
    }

    // 3. 构建最终模板
    mergedData.forEach((data, pkg) => {
        const appInfo = appMap.get(pkg);
        const displayName = (appInfo && appInfo.appLabel) ? appInfo.appLabel : pkg;

        // 仅在有实际规则或开启沙盒时生成模板
        if (data.hides.size > 0 || data.redirect_rules || data.isSandboxOn) {
            const redirectArray = [];
            data.redirects.forEach((target, source) => {
                redirectArray.push({ source, target });
            });

            templates.push({
                template_name: displayName,
                hook_operation: ["query", "insert"],
                apply_to_app: [pkg],
                permitted_media_types: data.isSandboxOn ? [0] : [0, 1, 2, 3, 4, 5, 6],
                filter_path: data.hides.size > 0 ? Array.from(data.hides) : undefined,
                redirect_rules: redirectArray.length > 0 ? redirectArray : undefined
            });
        }
    });

    // 4. 写入文件
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
    if (ug) await exec(`chown ${ug} ${targetPath}`);
    await exec(`chmod 644 ${targetPath}`);

    // 5. 执行重载并反馈
    const reloadRes = await exec("/data/Namespace-Proxy/reload_rules");
    if (reloadRes.stdout && reloadRes.stdout.trim().includes("SUCCESS")) {
        toast(`同步成功：已转换 ${templates.length} 个应用规则`);
    } else {
        toast(`同步完成，但插件重载失败`);
    }
}