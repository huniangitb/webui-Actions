/**
 * log_ctl API wrapper — all interactions with the log_ctl CLI tool.
 *
 * When `state.currentSettings.useLogCtl` is true, the web app uses these
 * functions instead of directly reading/writing config files.
 *
 * Design reference: Fuse-Proxy/src/log/log_ctl.c
 *
 * API response format (C code's json_api_finish):
 *   {"status":"ok","command":"<cmd>","data":<json_data>,"timestamp":<ts>}
 *   {"status":"error","command":"<cmd>","error":"<msg>","timestamp":<ts>}
 *
 * Where <json_data> is either:
 *   - A JSON object (for structured commands: parse-rules, validate-rules, etc.)
 *   - A JSON string (for raw-text commands: get-config --static)
 *   - {"raw":"<escaped_text>"} (for IPC raw-text: list-injected, search-*, clear-*)
 */

import { state, CONST } from "./state.js";
import { run } from "./utils.js";

// ── Response Types ──

export interface LogCtlResponse {
  status: "ok" | "error";
  command: string;
  data: Record<string, unknown> | string | null;
  error?: string;
  timestamp: number;
}

export interface ParsedAppRule {
  pkg: string;
  user_id: number;
  inject_enable: boolean;
  monitor: boolean;
  sandbox: boolean;
  fuse_direct: boolean;
  hide_count: number;
  ro_count: number;
  redir_count: number;
}

export interface ParsedRulesData {
  global: {
    sandbox: boolean;
    global_inject: boolean;
    fuse_direct: boolean;
    monitor: boolean;
    inject_enable: boolean;
    hide_count: number;
    ro_count: number;
    redir_count: number;
  };
  apps: ParsedAppRule[];
}

export interface ValidateRulesData {
  valid: boolean;
  app_count: number;
  global_hide_rules: number;
  global_ro_rules: number;
  global_redir_rules: number;
}

export interface SetRuleData {
  file: string;
  line: string;
  pkg: string;
  type: string;
  value: string;
}

export interface RemoveRuleData {
  file: string;
  pkg: string;
  type: string;
  index: number;
}

export interface ReloadConfigData {
  pid: number;
  signal: string;
}

// ── get-config --static response types ──

export interface StaticConfigGlobalSwitches {
  global_inject: string;
  monitor: string;
  sandbox: string;
  fuse_direct: string;
}

export interface StaticConfigGlobal {
  switches: StaticConfigGlobalSwitches;
  ro_rules: string[];
  hide_rules: string[];
  redirect_rules: string[];
  allow_rules: string[];
}

export interface StaticConfigAppEntry {
  pkg: string;
  user_id: number;
  inject_enable: string;
}

export interface StaticConfigAppRuleFile {
  file: string;
  user_dir: string;
  content: string;
}

export interface StaticConfigData {
  global: StaticConfigGlobal;
  apps: StaticConfigAppEntry[];
  app_rules: StaticConfigAppRuleFile[];
}

// ── get-global-rules response types ──

export interface GlobalRulesSwitches {
  global_inject: boolean | string;
  monitor: boolean | string;
  sandbox: boolean | string;
  fuse_direct: boolean | string;
}

export interface GlobalRulesCounts {
  hide: number;
  ro: number;
  redirect: number;
  allow: number;
}

export interface RedirectRuleItem {
  virtual_prefix: string;
  real_target: string;
}

export interface GlobalRulesData {
  switches: GlobalRulesSwitches;
  hide_rules: string[];
  ro_rules: string[];
  redirect_rules: RedirectRuleItem[];
  allow_rules?: string[];
  fuse_extra_args: string;
  counts: GlobalRulesCounts;
}

export interface InjectedAppInfo {
  pkg: string;
  pid: string;
  uid: string;
  redirect: string;
  hide: string;
  ro: string;
}

export interface UserInfo {
  uid: number;
  app_count: number;
}

export interface ListUsersData {
  count: number;
  users: UserInfo[];
}

export interface LogCountData {
  io: number;
  sys: number;
  logcat: number;
}

/** Result from searchLog — data lines (with DONE| stripped) plus pagination info. */
export interface SearchLogResult {
  /** Log data lines (APP|...), with DONE| and OK markers stripped. */
  lines: string[];
  /** Total matching records (from DONE|<total>|<remaining>). */
  total: number;
  /** Whether there are more records to fetch. */
  hasMore: boolean;
}

/** Result from listInjected — map of apps plus total count (from DONE|<total>). */
export interface ListInjectedResult {
  apps: Map<string, InjectedAppInfo>;
  total: number;
}

// ── Base runner ──

/**
 * Run a log_ctl command with `api` flag and parse the JSON response.
 * Returns parsed LogCtlResponse, or null on failure.
 */
async function logCtlJson(...args: string[]): Promise<LogCtlResponse | null> {
  const cmd = `${CONST.LOG_CTL} ${args.join(" ")} api`;
  try {
    const raw = await run(cmd);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // New format: C backend outputs data JSON directly (no envelope)
    if (parsed && typeof parsed === "object" && parsed.status === "ok") {
      return parsed as LogCtlResponse;
    }
    // Old format compatibility wrapper
    return { status: "ok", data: parsed, command: "", timestamp: 0 };
  } catch {
    return null;
  }
}

/**
 * Run a log_ctl command with `api` flag and return the inner payload as a string.
 *
 * Handles three shapes from the C reference:
 *   1. data = {"raw":"<escaped_text>"}  → returns <unescaped text>
 *   2. data = "<raw_string>"             → returns <raw_string>
 *   3. data = { ... object ... }         → returns JSON.stringify(object)
 */
async function logCtlData(...args: string[]): Promise<string> {
  const cmd = `${CONST.LOG_CTL} ${args.join(" ")} api`;
  const raw = await run(cmd);
  return extractApiRaw(raw);
}

/** Internal type for responses where data = {"raw":"...","done":{...}} */
interface LogCtlDataResult {
  raw: string;
  done?: {
    total: number;
    remaining?: number;
  };
}

/**
 * Extract the inner data payload from a log_ctl API JSON response.
 *
 * Reference: C code's json_api_finish outputs
 *   {"status":"ok","command":"<cmd>","data":<json_data>,"timestamp":<ts>}
 *
 * <json_data> is either a JSON object, a JSON string, or {"raw":"<escaped>"}.
 */
export function extractApiRaw(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // Support two shapes:
      //   New: data is the entire response (no status envelope)
      //   Old: {"status":"ok","data":<data>}
      const data = parsed.status === "ok" ? parsed.data : parsed;
      if (!data) return raw;
      if (typeof data.raw === "string") return data.raw;
      if (typeof data === "string") return data;
      if (typeof data === "object") return JSON.stringify(data);
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Extract the full data object (including `done` metadata) from a log_ctl
 * API JSON response.  Used by commands whose `data` is
 * `{"raw":"<lines>","done":{"total":N,"remaining":N}}`.
 *
 * Returns null if the response is not valid "ok" JSON.
 */
export function extractApiData(raw: string): LogCtlDataResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Support two shapes:
    //   New: {"raw":"...","done":{...}} at top level (no envelope)
    //   Old: {"status":"ok","data":{"raw":"...","done":{...}}}
    const data = parsed.status === "ok" ? parsed.data : parsed;
    if (!data || typeof data !== "object") return null;
    const rawText = typeof data.raw === "string" ? data.raw : "";
    const doneObj = data.done;
    const done =
      doneObj && typeof doneObj.total === "number"
        ? { total: doneObj.total, remaining: typeof doneObj.remaining === "number" ? doneObj.remaining : undefined }
        : undefined;
    return { raw: rawText, done };
  } catch {
    return null;
  }
}

// ── Config Read Commands ──

/**
 * `get-config --static` — read injector.conf raw text from disk.
 *
 * C reference: handle_get_config(api_mode, static_mode=true)
 * Sends "STATIC" to injector broadcast socket. The raw file content
 * is passed directly as `data` (a JSON string in the API response wrapper).
 */
export async function getConfigStatic(): Promise<string> {
  return logCtlData("get-config", "--static");
}

/**
 * `get-config --static` — read injector.conf as structured JSON from disk.
 *
 * Returns the full parsed config object with global switches, path rules,
 * app entries and app rule file content. Returns null on failure.
 */
export async function getConfigStaticParsed(): Promise<StaticConfigData | null> {
  const res = await logCtlJson("get-config", "--static");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as StaticConfigData;
}

/**
 * `get-global-rules` — get global rules as structured JSON.
 *
 * Returns the global switches, path rules (ro/hide/redirect), counts,
 * and fuse_extra_args. Returns null on failure.
 */
export async function getGlobalRules(): Promise<GlobalRulesData | null> {
  const res = await logCtlJson("get-global-rules");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as GlobalRulesData;
}

/**
 * `get-config` — get parsed config JSON from the injector's in-memory state.
 *
 * C reference: handle_get_config(api_mode, static_mode=false)
 * The broadcast response is embedded as `data` — could be a JSON object or
 * a string depending on the injector's broadcast format.
 */
export async function getConfig(): Promise<string | null> {
  const res = await logCtlJson("get-config");
  if (!res || res.status !== "ok") return null;
  // data may be a JSON object (from injector JSON broadcast) or a string
  if (typeof res.data === "string") return res.data;
  if (res.data && typeof res.data === "object") return JSON.stringify(res.data);
  return null;
}

// ── Rule Parsing / Validation ──

/**
 * `parse-rules` — parse all rules from disk into structured JSON.
 *
 * C reference: handle_parse_rules → build_parsed_rules_json
 * The `data` field is a direct JSON object: {"global":{...},"apps":[...]}
 */
export async function parseRules(): Promise<ParsedRulesData | null> {
  const res = await logCtlJson("parse-rules");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as ParsedRulesData;
}

/**
 * `validate-rules` — validate all rule files syntax.
 *
 * C reference: handle_validate_rules
 * data = {"valid":true,"app_count":N,"global_hide_rules":N,...}
 */
export async function validateRules(): Promise<ValidateRulesData | null> {
  const res = await logCtlJson("validate-rules");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as ValidateRulesData;
}

// ── Rule Edit Commands ──

/**
 * `set-rule` — append a rule to <pkg>.conf (or injector.conf for GLOBAL).
 *
 * C reference: handle_set_rule
 * Appends a line like "HIDE /path", "RO /path", "REDIRECT src dst" to the file.
 * For REDIRECT, `value` should be "source|target".
 */
export async function setRule(
  pkg: string,
  type: string,
  value: string,
  uid?: number,
): Promise<SetRuleData | null> {
  const args = ["set-rule", pkg, type];
  // Pass value as a single argument — if it contains spaces, shell quoting
  // is handled by the run() function (kernelsu exec).
  args.push(value);
  if (uid !== undefined && uid !== 0) {
    args.push("--uid", String(uid));
  }
  const res = await logCtlJson(...args);
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as SetRuleData;
}

/**
 * `remove-rule` — delete a rule from <pkg>.conf by type and index.
 *
 * C reference: handle_remove_rule
 * Reads the file, skips the `index`-th occurrence of `type`, writes back.
 */
export async function removeRule(
  pkg: string,
  type: string,
  index: number,
  uid?: number,
): Promise<RemoveRuleData | null> {
  const args = ["remove-rule", pkg, type, String(index)];
  if (uid !== undefined && uid !== 0) {
    args.push("--uid", String(uid));
  }
  const res = await logCtlJson(...args);
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as RemoveRuleData;
}

// ── Config Reload ──

/**
 * `reload-config` — send SIGHUP to the injector process.
 *
 * C reference: handle_reload_config
 * data = {"pid":<pid>,"signal":"SIGHUP"}
 */
export async function reloadConfig(): Promise<ReloadConfigData | null> {
  const res = await logCtlJson("reload-config");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as ReloadConfigData;
}

// ── Injection Status ──

/**
 * Parse a raw list-injected response into a structured result.
 *
 * C reference: handle_list_injected
 * Raw format:
 *   APP|<pkg>|<pid>|<uid>|<redirect>|<hide>|<ro>
 *   DONE|<total_count>
 */
function parseInjectedLines(raw: string): Map<string, InjectedAppInfo> {
  const apps = new Map<string, InjectedAppInfo>();
  for (const line of raw.split("\n")) {
    if (line.startsWith("APP|")) {
      const p = line.split("|");
      if (p.length >= 7) {
        apps.set(p[1], {
          pkg: p[1],
          pid: p[2],
          uid: p[3],
          redirect: p[4],
          hide: p[5],
          ro: p[6],
        });
      }
    }
  }
  return apps;
}

/**
 * `list-injected` — get list of injected apps.
 *
 * C reference: handle_list_injected
 * API mode wraps raw IPC response in {"raw":"...","done":{"total":N}}.
 * Returns apps map plus total count from done.total.
 */
export async function listInjected(): Promise<ListInjectedResult> {
  const data = extractApiData(await logCtlData("list-injected"));
  const raw = data?.raw ?? "";
  const total = data?.done?.total ?? 0;
  const apps = parseInjectedLines(raw);
  return { apps, total };
}

/**
 * `list-users` — get list of active users and their app config counts.
 *
 * C reference: handle_list_users
 * data = {"count":N,"users":[{"uid":N,"app_count":N},...]}
 */
export async function listUsers(): Promise<ListUsersData | null> {
  const res = await logCtlJson("list-users");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as ListUsersData;
}

// ── Log Commands ──

/**
 * `log-count` — get log buffer counts.
 *
 * C reference: log-count handler in main()
 * Sends "COUNT\n" over TCP, parses "COUNT|<io>|<sys>|<logcat>".
 * data = {"io":N,"sys":N,"logcat":N}
 */
export async function logCount(): Promise<LogCountData | null> {
  const res = await logCtlJson("log-count");
  if (!res || res.status !== "ok" || !res.data) return null;
  return res.data as unknown as LogCountData;
}

/**
 * `search-io / search-sys` — query logs with pagination.
 *
 * C reference: search handler in main()
 * API response: {"raw":"<lines>","done":{"total":N,"remaining":N}}
 * raw contains log lines WITHOUT the DONE line; pagination comes from done.
 */
export async function searchLog(
  type: "io" | "sys",
  key = "",
  limit = 500,
  offset = 0,
  level = -1,
): Promise<SearchLogResult> {
  const args =
    type === "sys"
      ? ["search-sys", "--level", String(level), key, String(limit), String(offset)]
      : ["search-io", key, String(limit), String(offset)];
  const raw = await logCtlData(...args);
  const data = extractApiData(raw);
  const lines = (data?.raw ?? (raw || "")).split("\n").filter(Boolean);
  const total = data?.done?.total ?? 0;
  const remaining = data?.done?.remaining ?? 0;
  return { lines, total, hasMore: remaining > 0 };
}

/**
 * `clear-io / clear-sys` — clear log buffers.
 *
 * C reference: clear handler in main()
 * Sends "CLEAR_<IO|SYS>" over TCP. Returns OK on success.
 */
export async function clearLog(type: "io" | "sys"): Promise<void> {
  const cmd = type === "io" ? "clear-io" : "clear-sys";
  await logCtlData(cmd);
}

// ── Convenience: build full app rules text from parse-rules data ──

/**
 * Build a raw config text block for a given package from ParsedRulesData.
 * Note: parse-rules only returns rule counts, not the actual rule content.
 * For full rule content, direct file reads are still needed.
 */
export function buildRulesTextFromParsed(
  parsed: ParsedRulesData,
  pkg: string,
  uid = 0,
): string {
  const app = parsed.apps.find((a) => a.pkg === pkg && a.user_id === uid);
  if (!app) return "";
  // Rule content is not available from parse-rules output — only counts.
  return "";
}

/**
 * Check whether log_ctl binary exists and is usable.
 */
export async function checkLogCtlAvailable(): Promise<boolean> {
  const res = await run(`${CONST.LOG_CTL} status api 2>/dev/null`);
  if (!res) return false;
  try {
    const parsed = JSON.parse(res);
    return !!(parsed && typeof parsed === "object");
  } catch {
    return false;
  }
}

// ── Cached log-count ──
//
// logCount() spawns a `log_ctl log-count api` process on EVERY call, which
// triggers IPC with the injector.  The injector's processing time scales with
// the number of rules, so calling this at high frequency (polling every 1 s +
// scroll events) causes unnecessary CPU spikes.
//
// This cache eliminates the majority of redundant calls.

const LOG_COUNT_TTL = 4_000; // ms — refresh at most once per interval
let _cachedLogCountData: LogCountData | null = null;
let _cachedLogCountTime = 0;

/**
 * Cached version of logCount() — only calls `log_ctl log-count api` at most
 * once every `LOG_COUNT_TTL` ms.  Returns the cached value for subsequent
 * calls within the TTL window.
 *
 * TTL is safe because the count only drives dynamic-limit and scrollbar sizing;
 * it does not affect log content correctness.
 */
export async function cachedLogCount(): Promise<LogCountData | null> {
  const now = Date.now();
  if (now - _cachedLogCountTime < LOG_COUNT_TTL && _cachedLogCountData !== null) {
    return _cachedLogCountData;
  }
  _cachedLogCountData = await logCount();
  _cachedLogCountTime = Date.now();
  return _cachedLogCountData;
}
