import { CONST, closeModalCleanup } from "./state.js";
import { showToast, ICONS } from "./utils.js";
import { loadData } from "./apps.js";
import { exec } from "kernelsu";

const BACKUP_ZIP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 22V4c0-.5.2-1 .6-1.4C5 2.2 5.5 2 6 2h8l6 6v14c0 .5-.2 1-.6 1.4-.4.4-.9.6-1.4.6H6c-.5 0-1-.2-1.4-.6C4 23 4 22.5 4 22z" fill="none"/><path d="M14 2v6h6M10 12h4M10 15h4M10 18h4" stroke="currentColor"/></svg>`;

let currentPath = "/storage/emulated/0";
let selectedFile = "";
let pickerMode = "";

interface FileEntry {
  name: string;
  isDir: boolean;
}

// ── Helpers ──

function catchToast(prefix: string): (e: unknown) => void {
  return (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    showToast.error(`${prefix}${msg}`);
  };
}

function formatDateCompact(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function showExportActionRow(): void {
  const actionRow = document.getElementById("backupFileActionRow")!;
  actionRow.innerHTML = `
    <input type="text" id="backupFileNameInput" class="mx-input" style="flex:1; background:var(--mx-s3); border-radius:8px; font-size:12px; padding:6px 10px;" placeholder="备份文件名 (如: config.tar)" />
    <button class="mx-btn mx-btn-primary" id="btnActionExport" style="font-size:12px; padding:6px 12px; flex-shrink:0;">导出配置</button>
  `;
  updateDefaultBackupName();
  document.getElementById("btnBackupNewFolder")!.style.display = "block";
  document.getElementById("btnActionExport")!.onclick = backupConfig;
}

function showImportActionRow(): void {
  const actionRow = document.getElementById("backupFileActionRow")!;
  actionRow.innerHTML = `
    <div style="flex:1; font-size:12px; color:var(--mx-t2); display:flex; align-items:center;">请在上方选择 .tar 备份文件</div>
    <button class="mx-btn mx-btn-secondary" id="btnActionImport" style="font-size:12px; padding:6px 12px; flex-shrink:0;" disabled>恢复选定配置</button>
  `;
  document.getElementById("btnBackupNewFolder")!.style.display = "none";
  document.getElementById("btnActionImport")!.onclick = restoreConfig;
}

// ── Public API ──

export function openBackupModal(): void {
  history.pushState({ modalOpen: true }, "");
  document.querySelector(".mx-app")!.classList.add("frozen");
  document.getElementById("backupModal")?.classList.add("open");

  document.getElementById("backupMainMenu")!.classList.remove("hidden");
  document.getElementById("backupPickerPanel")!.classList.add("hidden");
  document.getElementById("backupModalTitle")!.textContent = "数据备份与恢复";
}

export function showPicker(mode: string): void {
  pickerMode = mode;
  document.getElementById("backupMainMenu")!.classList.add("hidden");
  document.getElementById("backupPickerPanel")!.classList.remove("hidden");
  document.getElementById("backupModalTitle")!.textContent =
    mode === "export" ? "选择导出目录" : "选择恢复文件";

  if (mode === "export") {
    showExportActionRow();
  } else {
    showImportActionRow();
  }

  listDirectory("/storage/emulated/0");
}

export function updateDefaultBackupName(): void {
  const input = document.getElementById("backupFileNameInput") as HTMLInputElement | null;
  if (input) input.value = `nsproxy_config_${formatDateCompact(new Date())}.tar`;
}

function bindFileRowClick(fileListEl: HTMLElement, btnImport: HTMLButtonElement | null): void {
  fileListEl.querySelectorAll<HTMLElement>(".backup-file-row").forEach((row) => {
    row.onclick = () => {
      const name = row.dataset.name!;
      const isDir = row.dataset.isdir === "true";
      if (isDir) {
        if (name === "..") {
          const parts = currentPath.split("/");
          parts.pop();
          listDirectory(parts.join("/"));
        } else {
          listDirectory(`${currentPath}/${name}`);
        }
        return;
      }
      fileListEl.querySelectorAll(".backup-file-row").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      selectedFile = `${currentPath}/${name}`;
      if (btnImport) btnImport.disabled = false;
      const nameInput = document.getElementById("backupFileNameInput") as HTMLInputElement | null;
      if (nameInput) nameInput.value = name;
    };
  });
}

export async function listDirectory(path: string): Promise<void> {
  currentPath = path;
  selectedFile = "";
  const btnImport = document.getElementById("btnActionImport") as HTMLButtonElement | null;
  if (btnImport) btnImport.disabled = true;

  const breadcrumbsEl = document.getElementById("backupBreadcrumbs");
  if (breadcrumbsEl) breadcrumbsEl.textContent = path;

  const fileListEl = document.getElementById("backupFileList");
  if (!fileListEl) return;
  fileListEl.innerHTML = `<div class="text-center text-muted p-4">读取中...</div>`;

  const res = await exec(`ls -1p "${path}" 2>/dev/null`).catch(catchToast("读取目录失败: "));
  if (!res) return;

  const files: FileEntry[] = [];
  if (path !== "/storage/emulated/0") {
    files.push({ name: "..", isDir: true });
  }
  if (res.stdout) {
    for (const line of res.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const isDir = trimmed.endsWith("/");
      const name = isDir ? trimmed.slice(0, -1) : trimmed;
      if (isDir || name.endsWith(".tar")) {
        files.push({ name, isDir });
      }
    }
  }

  const isEmpty = files.length === 0 || (files.length === 1 && files[0].name === "..");
  fileListEl.innerHTML = files.map((f) => renderFileRow(f)).join("");
  if (isEmpty) {
    fileListEl.innerHTML += '<div class="text-center text-muted p-4" style="font-size:12px;">文件夹为空 (仅显示子目录与 .tar 文件)</div>';
  }

  bindFileRowClick(fileListEl, btnImport);
}

function renderFileRow(file: FileEntry): string {
  const icon = file.isDir ? ICONS.FOLDER : BACKUP_ZIP_SVG;
  return `
    <div class="backup-file-row" data-name="${file.name}" data-isdir="${file.isDir}">
      <span class="backup-file-icon">${icon}</span>
      <span class="backup-file-name text-truncate">${file.name}</span>
    </div>`;
}

export async function exportAllLogs(): Promise<void> {
  showToast.info("正在打包日志...");
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
    test -f "${targetPath}" && echo "SUCCESS"
  `;

  await exec(script)
    .then((res) => {
      if (res.stdout.includes("SUCCESS")) {
        showToast.success(`日志打包成功: ${targetPath}`);
      } else {
        showToast.error("日志导出失败");
      }
    })
    .catch(catchToast("导出日志发生异常: "));
}

export async function backupConfig(): Promise<void> {
  const nameInput = document.getElementById("backupFileNameInput") as HTMLInputElement | null;
  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) {
    showToast.warning("请输入备份文件名");
    return;
  }
  const targetTar = `${currentPath}/${name.endsWith(".tar") ? name : name + ".tar"}`;

  const cmd =
    `cd ${CONST.BASE_DIR} && tar -cvf "${targetTar}" injector.conf monitor_ignore.conf list.config webui_settings.json App-rules App-rules-* 2>/dev/null; test -f "${targetTar}" && echo "SUCCESS"`;

  const ok = await exec(cmd).then(
    (res) => res.stdout.includes("SUCCESS"),
    catchToast("备份发生异常: "),
  );
  if (!ok) {
    showToast.error("备份配置失败");
    return;
  }
  showToast.success(`备份成功: ${targetTar}`);
  document.getElementById("backupPickerPanel")!.classList.add("hidden");
  document.getElementById("backupMainMenu")!.classList.remove("hidden");
  document.getElementById("backupModalTitle")!.textContent = "数据备份与恢复";
}

export async function restoreConfig(): Promise<void> {
  if (!selectedFile) {
    showToast.warning("请先选择备份文件 (.tar)");
    return;
  }
  if (!confirm("确定要恢复该配置吗? 这将覆盖当前所有配置。")) return;

  const cmd =
    `tar -xvf "${selectedFile}" -C ${CONST.BASE_DIR}/ && chmod -R 755 ${CONST.BASE_DIR}; echo "SUCCESS"`;

  const ok = await exec(cmd).then(
    (res) => res.stdout.includes("SUCCESS"),
    catchToast("恢复配置异常: "),
  );
  if (!ok) {
    showToast.error("恢复配置失败");
    return;
  }
  showToast.success("配置恢复成功");
  await loadData();
  closeModalCleanup();
}

export async function createNewFolder(): Promise<void> {
  const folderName = prompt("请输入新文件夹名称:");
  if (!folderName || !folderName.trim()) return;

  await exec(`mkdir -p "${currentPath}/${folderName.trim()}"`)
    .then((res) => {
      if (res.errno === 0) {
        showToast.success("新建文件夹成功");
        listDirectory(currentPath);
      } else {
        showToast.error("创建文件夹失败");
      }
    })
    .catch(catchToast("新建文件夹异常: "));
}
