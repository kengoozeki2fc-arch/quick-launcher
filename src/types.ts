// Work Launcher V1.0+ ローカル設定型
// メモ/タスク/セクション/アイテムは API/cache 経由（src/api/types.ts）に移管
// ここにはアプリ全体のローカル設定（カレンダー認証・テーマ・preferences）のみ残す

export interface CalendarSettings {
  tenantId: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

export type ThemeName = "cloudpower" | "pink" | "blue" | "black" | "white";

export type TabName = "calendar" | "task" | "memo" | "local";
export type StartupSize = "compact" | "normal";

export interface Preferences {
  startupSize: StartupSize;
  startupTab: TabName;
  showLocalTab: boolean;
}

export interface AppData {
  version: 2;
  calendar: CalendarSettings | null;
  theme: ThemeName;
  preferences: Preferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  startupSize: "normal",
  startupTab: "calendar",
  showLocalTab: true,
};

export const DEFAULT_APP_DATA: AppData = {
  version: 2,
  calendar: null,
  theme: "pink",
  preferences: DEFAULT_PREFERENCES,
};
