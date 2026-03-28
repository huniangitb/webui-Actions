import { exec } from 'kernelsu';

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

const parseRules = (text) => {
    let redirects = [];
    let hides = [];
    if (!text) return { redirects, hides };
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'REDIRECT' && parts.length >= 3) {
            redirects.push({ source: parts[1], target: parts.slice(2).join(' ') });
        } else if (parts[0] === 'HIDE' && parts.length >= 2) {
            hides.push(parts[1]);
        }
        // 注意：清理插件当前JSON结构仅支持 filter_path(HIDE) 与 redirect_rules(REDIRECT)。
        // 遇到 RO 和 ALLOW 规则不应将其放入插件配置以免发生异常。
    });
    return { redirects, hides };
};

export async function syncToPlugin(appMap, globalConfText, injectorRulesMap, injectorStates) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    let templates = [];

    // 处理全局配置 (省略 apply_to_app)
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

    // 1. 合并 App-rules 中的规则
    appMap.forEach((app, pkg) => {
        const u0 = app.users[0];
        if (u0 && u0.isEnabled) {
            addRulesToPkg(pkg, u0.text);
        }
    });

    // 2. 合并 injector.conf 中的内联规则（兼容类似 [bin.mt.plus] 下属有直接规则的情况）
    if (injectorRulesMap) {
        injectorRulesMap.forEach((lines, section) => {
            if (section === 'GLOBAL') return;
            const state = injectorStates.get(section);
            if (state === 'OFF') return;

            const pkg = section.split(':')[0];
            addRulesToPkg(pkg, lines.join('\n'));
        });
    }

    // 将有规则集的包注入到模板中，避免无规则的 OFF 拦截器成为垃圾信息干扰
    pkgMap.forEach((rules, pkg) => {
        const uniqueHides = [...new Set(rules.hides)];
        const rMap = new Map();
        rules.redirects.forEach(r => rMap.set(r.source, r));
        const uniqueRedirects = Array.from(rMap.values());

        templates.push({
            template_name: pkg,
            hook_operation: ["query", "insert"],
            apply_to_app: [pkg],
            permitted_media_types: [0, 1, 2, 3, 4, 5, 6],
            filter_path: uniqueHides.length ? uniqueHides : undefined,
            redirect_rules: uniqueRedirects.length ? uniqueRedirects : undefined
        });
    });

    const jsonStr = JSON.stringify(templates);
    
    // 动态获取媒体提供者的包名
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = res.stdout ? res.stdout.trim() : "";
    if (!mpPkg) mpPkg = "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    
    // 同步父级目录的用户与用户组权限（防止插件无权读取我们用 Root 写入的配置）
    const statRes = await exec(`stat -c '%u:%g' ${targetDir} 2>/dev/null`);
    const ug = statRes.stdout ? statRes.stdout.trim() : "";
    if (ug) {
        await exec(`chown ${ug} ${targetPath}`);
    }
    await exec(`chmod 644 ${targetPath}`);
}