declare module "kernelsu" {
  interface ExecResult {
    errno: number;
    stdout: string;
    stderr: string;
  }

  export function exec(cmd: string): Promise<ExecResult>;
  export function toast(msg: string): void;
  export function listPackages(type: "user" | "system"): Promise<string[]>;
  export function getPackagesInfo(pkgs: string[]): Promise<PackageInfo[]>;
  export function enableEdgeToEdge(enabled: boolean): void;
}

declare module "@chenglou/pretext" {
  interface PreparedText {
    // internal
  }

  interface LayoutResult {
    height: number;
  }

  export function prepare(text: string, font: string): PreparedText;
  export function layout(
    prepared: PreparedText,
    maxWidth: number,
    lineHeight: number,
  ): LayoutResult;
}

declare module "@mdi/js" {
  export const mdiMathLog: string;
  export const mdiViewGridOutline: string;
  export const mdiMonitorDashboard: string;
  export const mdiWrench: string;
  export const mdiMagnify: string;
  export const mdiCog: string;
  export const mdiClose: string;
  export const mdiPlus: string;
  export const mdiDeleteOutline: string;
  export const mdiWeatherNight: string;
  export const mdiWhiteBalanceSunny: string;
  export const mdiStopCircleOutline: string;
  export const mdiPlayCircleOutline: string;
  export const mdiFolderOutline: string;
  export const mdiFileOutline: string;
  export const mdiEyeOffOutline: string;
  export const mdiDeleteSweepOutline: string;
  export const mdiClockOutline: string;
  export const mdiBackupRestore: string;
}

// Parcel supports CSS imports
declare module "*.css" {
  const content: string;
  export default content;
}

// Extend HTMLElement for animation frame id tracking
interface HTMLElement {
  _scrollAnimId: number | null;
  _themeTransitionTimer: ReturnType<typeof setTimeout>;
}
