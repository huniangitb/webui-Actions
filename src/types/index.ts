export interface PackageInfo {
  packageName: string;
  appLabel: string;
  isSystem: boolean;
}

export interface AppUserConfig {
  isEnabled: boolean;
  text: string;
  hasRules: boolean;
}

export interface InjectorAppState {
  pid: string;
  uid: string;
  redirect: string;
  hide: string;
  ro: string;
}

export interface AppEntry extends PackageInfo {
  isConfigured: boolean;
  users: Record<number, AppUserConfig>;
}

export interface IoLogEntry {
  text: string;
  timeStr: string;
  appName: string;
  op: string;
  details: string;
}

export interface SysLogEntry {
  text: string;
  timeStr: string | null;
  tag: string | null;
  msg: string;
}

export interface Suggestion {
  t: string;
  i: string;
}

export interface Settings {
  autoTheme: boolean;
  syncPlugin: boolean;
  colorProfile: string;
}

export interface PaginationState {
  offset: number;
  loading: boolean;
  hasMore: boolean;
  term: string;
}

export interface SysPaginationState extends PaginationState {
  level: number;
}

export interface AppState {
  appMap: Map<string, AppEntry>;
  globalConfText: string;
  injectorStates: Map<string, string>;
  injectorRulesMap: Map<string, string[]>;
  currentSettings: Settings;
  activeUsers: number[];
  activeMounts: Set<string>;
  injectedApps: Map<string, InjectorAppState>;
  currentAppFilter: string;
  usingFallback: boolean;
  currentPid: string | null;
  currentBindingPkg: string | null;
  currentBindingUser: number;
  ioState: PaginationState;
  sysState: SysPaginationState;
  isDarkMode: boolean;
  currentSuggestions: Suggestion[];
  suggestionBoxHeight: number;
  cachedModalHeight: number | null;
  lastActiveModal: string | null;
  isViewportResizing: boolean;
  isUserTouching: boolean;
  isInitialLoad?: boolean;
  isAppListReady?: boolean;
  resumePolling: (() => void) | null;
  suspendPolling: (() => void) | null;
}

export interface VirtualLogEntry {
  height: number;
  prepared: object | null;
  data: IoLogEntry | SysLogEntry;
}

export interface VirtualLogOptions<E = IoLogEntry | SysLogEntry> {
  buffer?: number;
  estimatedLineHeight?: number;
  font?: string;
  lineHeight?: number;
  gap?: number;
  padding?: number;
  chromeHeight?: number | ((entry: E) => number);
  textWidthOffset?: number;
  prepareFn?: ((entry: E) => string) | null;
  onEmpty?: string;
}
