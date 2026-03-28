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
    });
    return { redirects, hides };
};

export async function syncToPlugin(appMap, globalConfText) {
    const settings = await getSettings();
    if (!settings.syncPlugin) return;

    const isInstalled = await checkPluginInstalled();
    if (!isInstalled) return;

    let templates = [];

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

    appMap.forEach((app, pkg) => {
        const u0 = app.users[0];
        if (u0 && u0.isEnabled) {
            const rules = parseRules(u0.text);
            if (rules.redirects.length > 0 || rules.hides.length > 0) {
                templates.push({
                    template_name: app.appLabel || pkg,
                    hook_operation: ["query", "insert"],
                    apply_to_app: [pkg],
                    permitted_media_types: [0, 1, 2, 3, 4, 5, 6],
                    filter_path: rules.hides.length ? rules.hides : undefined,
                    redirect_rules: rules.redirects.length ? rules.redirects : undefined
                });
            }
        }
    });

    const jsonStr = JSON.stringify(templates);
    
    // Resolve MediaProvider path dynamically
    const findCmd = `pm list packages | grep providers.media.module | cut -d: -f2 | head -n 1`;
    const res = await exec(findCmd);
    let mpPkg = res.stdout ? res.stdout.trim() : "";
    if (!mpPkg) mpPkg = "com.android.providers.media.module";
    
    const targetDir = `/data/data/${mpPkg}/files`;
    const targetPath = `${targetDir}/rule`;
    
    await exec(`mkdir -p ${targetDir}`);
    await exec(`echo '${jsonStr.replace(/'/g, "'\\''")}' > ${targetPath}`);
    await exec(`chmod 600 ${targetPath} && chown system:system ${targetPath}`);
}