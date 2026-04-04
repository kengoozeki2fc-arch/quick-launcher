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
}
