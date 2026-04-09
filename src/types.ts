export interface LauncherItem {
  id: string;
  title: string;
  url: string;
  loginId: string;
  password: string;
  otp: boolean;
}

export interface Memo {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM
  done: boolean;
  notified: boolean;
  createdAt: string;
  completedAt?: string; // YYYY-MM-DD（完了日）
}

export interface CalendarSettings {
  tenantId: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

export type ThemeName = "pink" | "blue" | "black" | "white";

export interface AppData {
  version: 1;
  items: LauncherItem[];
  memos: Memo[];
  tasks: Task[];
  calendar: CalendarSettings | null;
  theme: ThemeName;
}

export const DEFAULT_APP_DATA: AppData = {
  version: 1,
  items: [],
  memos: [],
  tasks: [],
  calendar: null,
  theme: "pink",
};
