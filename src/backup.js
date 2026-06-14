import { state, CONST } from "./state.js";
import { run, showToast, ICONS } from "./utils.js";
import { loadData } from "./apps.js";
import { exec } from "kernelsu";

const BACKUP_ZIP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 22V4c0-.5.2-1 .6-1.4C5 2.2 5.5 2 6 2h8l6 6v14c0 .5-.2 1-.6 1.4-.4.4-.9.6-1.4.6H6c-.5 0-1-.2-1.4-.6C4 23 4 22.5 4 22z" fill="none"/><path d="M14 2v6h6M10 12h4M10 15h4M10 18h4" stroke="currentColor"/></svg>`;

let currentPath = "/storage/emulated/0";
let selectedFile = "";

export function openBackupModal() {
  history.pushState({ modalOpen: true }, "");
  document.querySelector(".mx-app").classList.add("frozen");
  document.getElementById("backupModal")?.classList.add("open");
  updateDefaultBackupName();
  listDirectory("/storage/emulated/0");
}

export function updateDefaultBackupName() {
  const date = new Date();
  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const DD = String(date.getDate()).padStart(2, "0");
  const input = document.getElementById("backupFileNameInput");
  if (input) input.value = `nsproxy_config_${YYYY}${MM}${DD}.tar`;
}

export async function listDirectory(path) {
  currentPath = path;
  selectedFile = "";
  const btnImport = document.getElementById("btnImportConfig");
  if (btnImport) btnImport.disabled = true;

  const breadcrumbsEl = document.getElementById("backupBreadcrumbs");
  if (breadcrumbsEl) breadcrumbsEl.textContent = path;

  const fileListEl = document.getElementById("backupFileList");
  if (!fileListEl) return;
  fileListEl.innerHTML = `<div class="text-center text-muted p-4">读取中...</div>`;

  try {
    const res = await exec(`ls -1p "${path}" 2>/dev/null`);
    const files = [];
    if (path !== "/storage/emulated/0") {
      files.push({ name: "..", isDir: true });
    }
    if (res.stdout) {
      const lines = res.stdout.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const isDir = line.endsWith("/");
        const name = isDir ? line.slice(0, -1) : line;
        if (isDir || name.endsWith(".tar")) {
          files.push({ name, isDir });
        }
      }
    }
    if (files.length === 0 || (files.length === 1 && files[0].name === "..")) {
      fileListEl.innerHTML = `
        ${files.map(f => renderFileRow(f)).join("")}
        <div class="text-center text-muted p-4" style="font-size:12px;">文件夹为空 (仅显示子目录与 .tar 文件)</div>`;
    } else {
      fileListEl.innerHTML = files.map(f => renderFileRow(f)).join("");
    }

    fileListEl.querySelectorAll(".backup-file-row").forEach(row => {
      row.onclick = () => {
        const name = row.dataset.name;
        const isDir = row.dataset.isdir === "true";
        if (isDir) {
          if (name === "..") {
            const parts = currentPath.split("/");
            parts.pop();
            listDirectory(parts.join("/"));
          } else {
            listDirectory(`${currentPath}/${name}`);
          }
        } else {
          fileListEl.querySelectorAll(".backup-file-row").forEach(r => r.classList.remove("selected"));
          row.classList.add("selected");
          selectedFile = `${currentPath}/${name}`;
          if (btnImport) btnImport.disabled = false;
          const nameInput = document.getElementById("backupFileNameInput");
          if (nameInput) nameInput.value = name;
        }
      };
    });
  } catch (e) {
    fileListEl.innerHTML = `<div class="text-center text-muted p-4" style="color:var(--mx-red);">读取失败: ${e.message}</div>`;
  }
}

function renderFileRow(file) {
  const icon = file.isDir ? ICONS.FOLDER : BACKUP_ZIP_SVG;
  return `
    <div class="backup-file-row" data-name="${file.name}" data-isdir="${file.isDir}">
      <span class="backup-file-icon">${icon}</span>
      <span class="backup-file-name text-truncate">${file.name}</span>
    </div>`;
}

export async function exportAllLogs() {
  try {
    const timestamp = new Date().toISOString().replace(/[-T:]/g, "").split(".")[0];
    const targetPath = `/storage/emulated/0/nsproxy_logs_${timestamp}.tar`;

    const script = `
      mkdir -p ${CONST.BASE_DIR}/.temp_logs
      logcat -d -s Zygisk_NSProxy NamespaceProxy_Injector > ${CONST.BASE_DIR}/.temp_logs/zygisk_logcat.log 2>/dev/null
      ${CONST.LOG_CTL} search-sys "" 100000 0 raw > ${CONST.BASE_DIR}/.temp_logs/sys_log_ctl.log 2>/dev/null
      if [ -d "${CONST.BASE_DIR}/log" ]; then
        cp -r ${CONST.BASE_DIR}/log/* ${CONST.BASE_DIR}/.temp_logs/ 2>/dev/null
      fi
      find ${CONST.BASE_DIR}/.temp_logs/ -type f -iname "*io*" -delete 2>/dev/null
      cd ${CONST.BASE_DIR}/.temp_logs
      tar -cvf "${targetPath}" . 2>/dev/null
      cd ${CONST.BASE_DIR}
      rm -rf ${CONST.BASE_DIR}/.temp_logs
    `;

    const res = await exec(script);
    if (res.errno === 0) {
      showToast(`日志打包成功: ${targetPath}`);
    } else {
      showToast("日志导出失败");
    }
  } catch (e) {
    showToast(`导出日志发生异常: ${e.message}`);
  }
}

export async function backupConfig() {
  const nameInput = document.getElementById("backupFileNameInput");
  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) {
    showToast("请输入备份文件名");
    return;
  }
  const targetTar = `${currentPath}/${name.endsWith(".tar") ? name : name + ".tar"}`;
  try {
    const cmd = `cd ${CONST.BASE_DIR} && tar -cvf "${targetTar}" injector.conf monitor_ignore.conf list.config webui_settings.json App-rules App-rules-* 2>/dev/null`;
    const res = await exec(cmd);
    if (res.errno === 0) {
      showToast(`备份成功: ${targetTar}`);
      listDirectory(currentPath);
    } else {
      showToast("备份配置失败");
    }
  } catch (e) {
    showToast(`备份发生异常: ${e.message}`);
  }
}

export async function restoreConfig() {
  if (!selectedFile) {
    showToast("请先选择备份文件 (.tar)");
    return;
  }
  if (!confirm(`确定要恢复该配置吗? 这将覆盖当前所有配置。`)) return;
  try {
    const cmd = `tar -xvf "${selectedFile}" -C ${CONST.BASE_DIR}/ && chmod -R 755 ${CONST.BASE_DIR}`;
    const res = await exec(cmd);
    if (res.errno === 0) {
      showToast("配置恢复成功");
      await loadData();
      document.querySelector(".mx-modal-overlay.open")?.classList.remove("open");
      document.querySelector(".mx-app").classList.remove("frozen");
    } else {
      showToast("恢复配置失败");
    }
  } catch (e) {
    showToast(`恢复配置异常: ${e.message}`);
  }
}

export async function createNewFolder() {
  const folderName = prompt("请输入新文件夹名称:");
  if (!folderName || !folderName.trim()) return;
  try {
    const res = await exec(`mkdir -p "${currentPath}/${folderName.trim()}"`);
    if (res.errno === 0) {
      showToast("新建文件夹成功");
      listDirectory(currentPath);
    } else {
      showToast("创建文件夹失败");
    }
  } catch (e) {
    showToast(`新建文件夹异常: ${e.message}`);
  }
}