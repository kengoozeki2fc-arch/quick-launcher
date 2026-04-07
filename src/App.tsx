import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { LauncherItem, Memo, Task, AppData, ThemeName, CalendarSettings } from "./types";
import { DEFAULT_APP_DATA } from "./types";
import ItemCard from "./ItemCard";
import EditModal from "./EditModal";
import MemoTab from "./MemoTab";
import TaskTab from "./TaskTab";
import CalendarTab, { toUtcDate, formatDateLabel, formatTime } from "./CalendarTab";
import type { CalendarEvent } from "./CalendarTab";

const PAGE_SIZE = 5;
const PATH_KEY = "wl_data_path";
const LEGACY_DATA = "quick-launcher-data.json";
const LEGACY_MEMO = "quick-launcher-memos.json";
const LEGACY_TASK = "quick-launcher-tasks.json";
const LEGACY_CAL = "quick-launcher-calendar.json";

type Tab = "calendar" | "task" | "launcher" | "memo";

const THEMES: { name: ThemeName; label: string; emoji: string }[] = [
  { name: "pink", label: "ピンク", emoji: "🌸" },
  { name: "blue", label: "空色", emoji: "🌤" },
  { name: "black", label: "ブラック", emoji: "🖤" },
  { name: "white", label: "ホワイト", emoji: "🤍" },
];

async function loadAppData(path: string): Promise<{ data: AppData; migrated: boolean }> {
  // 既存ファイルを試す
  try {
    const raw = await invoke<string>("read_file_abs", { path });
    if (raw && raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      return {
        data: { ...DEFAULT_APP_DATA, ...parsed },
        migrated: false,
      };
    }
  } catch {
    // fall through to migration
  }

  // マイグレーション: 旧4ファイルをDesktopから読み込み
  const data: AppData = { ...DEFAULT_APP_DATA };
  let didMigrate = false;
  for (const [file, key] of [
    [LEGACY_DATA, "items"],
    [LEGACY_MEMO, "memos"],
    [LEGACY_TASK, "tasks"],
  ] as const) {
    try {
      if (await exists(file, { baseDir: BaseDirectory.Desktop })) {
        const raw = await readTextFile(file, { baseDir: BaseDirectory.Desktop });
        (data as unknown as Record<string, unknown>)[key] = JSON.parse(raw);
        didMigrate = true;
      }
    } catch {
      // ignore
    }
  }
  try {
    if (await exists(LEGACY_CAL, { baseDir: BaseDirectory.Desktop })) {
      const raw = await readTextFile(LEGACY_CAL, { baseDir: BaseDirectory.Desktop });
      const cal = JSON.parse(raw);
      if (cal?.accessToken) {
        data.calendar = cal;
        didMigrate = true;
      }
    }
  } catch {
    // ignore
  }

  return { data, migrated: didMigrate };
}

async function saveAppData(path: string, data: AppData) {
  await invoke("write_file_abs", { path, content: JSON.stringify(data, null, 2) });
}

async function msGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_get", { url, accessToken });
  return JSON.parse(raw);
}

async function msPost(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_post", { url, params });
  return JSON.parse(raw);
}

function useCompactMode(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && (window.innerWidth < 420 || window.innerHeight < 560)
  );
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 420 || window.innerHeight < 560);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return compact;
}

export default function App() {
  const [dataPath, setDataPath] = useState<string>("");
  const [tab, setTab] = useState<Tab>("calendar");
  const [notification, setNotification] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const compact = useCompactMode();

  const [items, setItems] = useState<LauncherItem[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendar, setCalendar] = useState<CalendarSettings | null>(null);
  const [theme, setTheme] = useState<ThemeName>("pink");

  const [editingItem, setEditingItem] = useState<LauncherItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Calendar events (App.tsxで管理してコンパクト表示にも使う)
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<CalendarEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const loaded = useRef(false);

  // 初回ロード
  useEffect(() => {
    (async () => {
      let path = localStorage.getItem(PATH_KEY) ?? "";
      if (!path) {
        try {
          path = await invoke<string>("default_data_path");
        } catch {
          path = "";
        }
      }
      setDataPath(path);
      const { data, migrated } = await loadAppData(path);
      setItems(data.items);
      setMemos(data.memos);
      setTasks(data.tasks);
      setCalendar(data.calendar);
      setTheme(data.theme ?? "pink");
      loaded.current = true;
      if (migrated) {
        // 即保存して統合JSONを生成
        try {
          await saveAppData(path, data);
          setNotification("既存データを統合JSONに移行しました");
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }, []);

  // テーマ反映
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 自動保存
  useEffect(() => {
    if (!loaded.current || !dataPath) return;
    const data: AppData = { version: 1, items, memos, tasks, calendar, theme };
    saveAppData(dataPath, data).catch((e) => console.error("save failed", e));
  }, [items, memos, tasks, calendar, theme, dataPath]);

  // 検索でページリセット
  useEffect(() => {
    setPage(1);
  }, [search]);

  // タスク通知チェック（1分ごと）
  useEffect(() => {
    const check = () => {
      setTasks((prev) => {
        const now = new Date();
        return prev.map((task) => {
          if (task.done || task.notified) return task;
          const deadline = new Date(`${task.date}T${task.time}:00`);
          const diffMs = deadline.getTime() - now.getTime();
          if (diffMs > 0 && diffMs <= 60 * 60 * 1000) {
            setNotification(`⏰ 「${task.title}」の期限まであと1時間以内です`);
            return { ...task, notified: true };
          }
          return task;
        });
      });
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Calendar fetch
  const refreshAccessToken = useCallback(async (s: CalendarSettings): Promise<CalendarSettings | null> => {
    try {
      const data = await msPost(
        `https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`,
        {
          client_id: s.clientId,
          grant_type: "refresh_token",
          refresh_token: s.refreshToken,
          scope: "Calendars.Read offline_access",
        }
      );
      if (data.access_token) {
        const updated: CalendarSettings = {
          ...s,
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) ?? s.refreshToken,
          tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
        };
        setCalendar(updated);
        return updated;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const fetchEvents = useCallback(async (s: CalendarSettings) => {
    setCalLoading(true);
    setCalError(null);
    let cur = s;
    if (Date.now() > s.tokenExpiry - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(s);
      if (!refreshed) {
        setCalError("トークンの更新に失敗しました。再接続してください。");
        setCalLoading(false);
        return;
      }
      cur = refreshed;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const afterTomorrow = new Date(today);
    afterTomorrow.setDate(afterTomorrow.getDate() + 2);
    try {
      const data = await msGet(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${today.toISOString()}&endDateTime=${afterTomorrow.toISOString()}&$select=subject,start,end,isAllDay,location&$orderby=start/dateTime&$top=50`,
        cur.accessToken
      );
      if (data.error) {
        const err = data.error as Record<string, unknown>;
        setCalError(`取得エラー: ${err.message ?? JSON.stringify(data.error)}`);
        setCalLoading(false);
        return;
      }
      const events = (data.value as CalendarEvent[]) ?? [];
      const todayStr = formatDateLabel(today);
      const tomorrowDate = new Date(today);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = formatDateLabel(tomorrowDate);
      setTodayEvents(events.filter((e) => formatDateLabel(toUtcDate(e.start.dateTime)) === todayStr));
      setTomorrowEvents(events.filter((e) => formatDateLabel(toUtcDate(e.start.dateTime)) === tomorrowStr));
    } catch (err) {
      setCalError(`カレンダーの取得に失敗しました: ${err}`);
    } finally {
      setCalLoading(false);
    }
  }, [refreshAccessToken]);

  // calendar settings ロード後 / 変更後にfetch
  useEffect(() => {
    if (loaded.current && calendar?.accessToken) {
      fetchEvents(calendar);
    } else {
      setTodayEvents([]);
      setTomorrowEvents([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar?.accessToken, calendar?.tenantId, calendar?.clientId]);

  // Launcher
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.url.toLowerCase().includes(q) ||
        i.loginId.toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleAdd = () => {
    setEditingItem(null);
    setShowModal(true);
  };
  const handleEdit = (item: LauncherItem) => {
    setEditingItem(item);
    setShowModal(true);
  };
  const handleSave = (item: LauncherItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = item;
        return updated;
      }
      return [...prev, item];
    });
    setShowModal(false);
  };
  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };
  const handleOpen = useCallback(async (url: string) => {
    try {
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  }, []);

  const handleMemoSave = (memo: Memo) => {
    setMemos((prev) => {
      const idx = prev.findIndex((m) => m.id === memo.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = memo;
        return updated;
      }
      return [memo, ...prev];
    });
  };
  const handleMemoDelete = (id: string) => setMemos((prev) => prev.filter((m) => m.id !== id));

  const handleTaskSave = (task: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = task;
        return updated;
      }
      return [task, ...prev];
    });
  };
  const handleTaskToggle = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const handleTaskDelete = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));

  const handleCalendarChange = (s: CalendarSettings | null) => setCalendar(s);

  // ---------- コンパクト表示 ----------
  if (compact) {
    const upcomingEvents = todayEvents.slice(0, 2);
    const upcomingTasks = tasks.filter((t) => !t.done).slice(0, 3);
    return (
      <div className="app compact" data-theme={theme}>
        {notification && (
          <div className="notification-banner" onClick={() => setNotification(null)}>
            {notification}
            <span className="notif-close">✕</span>
          </div>
        )}
        <div className="compact-header">
          <h1>Work Launcher</h1>
          <button
            className="icon-btn"
            onClick={() => setShowSettingsModal(true)}
            title="設定"
          >⚙</button>
        </div>

        <div className="compact-section">
          <div className="compact-section-title">📅 今日の予定</div>
          {upcomingEvents.length === 0 ? (
            <div className="compact-empty">予定なし</div>
          ) : (
            upcomingEvents.map((ev) => (
              <div key={ev.id} className="compact-event">
                <span className="compact-event-time">
                  {ev.isAllDay ? "終日" : formatTime(ev.start.dateTime)}
                </span>
                <span className="compact-event-title">{ev.subject}</span>
              </div>
            ))
          )}
        </div>

        <div className="compact-section">
          <div className="compact-section-title">✅ タスク</div>
          {upcomingTasks.length === 0 ? (
            <div className="compact-empty">タスクなし</div>
          ) : (
            upcomingTasks.map((t) => (
              <div key={t.id} className="compact-task">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => handleTaskToggle(t.id)}
                />
                <span className="compact-task-title">{t.title}</span>
                <span className="compact-task-time">{t.time}</span>
              </div>
            ))
          )}
        </div>

        {showSettingsModal && (
          <SettingsModal
            dataPath={dataPath}
            theme={theme}
            onPathChange={(p) => {
              setDataPath(p);
              localStorage.setItem(PATH_KEY, p);
            }}
            onThemeChange={setTheme}
            onClose={() => setShowSettingsModal(false)}
          />
        )}
      </div>
    );
  }

  // ---------- 通常表示 ----------
  return (
    <div className="app" data-theme={theme}>
      {notification && (
        <div className="notification-banner" onClick={() => setNotification(null)}>
          {notification}
          <span className="notif-close">✕</span>
        </div>
      )}

      <div className="header">
        <h1>Work Launcher</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {tab === "launcher" && (
            <button className="add-btn" onClick={handleAdd}>+ 追加</button>
          )}
          <button className="icon-btn" onClick={() => setShowSettingsModal(true)} title="設定">⚙</button>
        </div>
      </div>

      {tab === "launcher" && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="検索（タイトル・URL・ID）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>
      )}

      <div className="tabs">
        <button
          className={`tab-btn ${tab === "calendar" ? "active" : ""}`}
          onClick={() => setTab("calendar")}
        >
          📅 カレンダー
        </button>
        <button
          className={`tab-btn ${tab === "task" ? "active" : ""}`}
          onClick={() => setTab("task")}
        >
          ✅ タスク
          {tasks.filter((t) => !t.done).length > 0 && (
            <span className="tab-badge">{tasks.filter((t) => !t.done).length}</span>
          )}
        </button>
        <button
          className={`tab-btn ${tab === "launcher" ? "active" : ""}`}
          onClick={() => setTab("launcher")}
        >
          🚀 サイト
        </button>
        <button
          className={`tab-btn ${tab === "memo" ? "active" : ""}`}
          onClick={() => setTab("memo")}
        >
          📝 メモ
        </button>
      </div>

      {tab === "launcher" && (
        <>
          <div className="status-bar">
            全 {filtered.length} 件
            {search && ` （${items.length} 件中）`}
          </div>

          {pageItems.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontSize: 32 }}>🚀</p>
              <p>{search ? "該当するサービスがありません" : "「+ 追加」からサービスを登録しよう"}</p>
            </div>
          ) : (
            <>
              <div className="item-list">
                {pageItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onOpen={handleOpen}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="pagination">
                  <button disabled={currentPage === 1} onClick={() => setPage(1)}>最初</button>
                  <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>前へ</button>
                  <span className="page-info">{currentPage} / {totalPages}</span>
                  <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>次へ</button>
                  <button disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>最後</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "memo" && (
        <MemoTab memos={memos} onSave={handleMemoSave} onDelete={handleMemoDelete} />
      )}

      {tab === "task" && (
        <TaskTab
          tasks={tasks}
          onSave={handleTaskSave}
          onToggleDone={handleTaskToggle}
          onDelete={handleTaskDelete}
        />
      )}

      {tab === "calendar" && (
        <CalendarTab
          settings={calendar}
          onSettingsChange={handleCalendarChange}
          todayEvents={todayEvents}
          tomorrowEvents={tomorrowEvents}
          loading={calLoading}
          calError={calError}
          onRefresh={() => calendar && fetchEvents(calendar)}
        />
      )}

      {showModal && (
        <EditModal
          item={editingItem}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          dataPath={dataPath}
          theme={theme}
          onPathChange={(p) => {
            setDataPath(p);
            localStorage.setItem(PATH_KEY, p);
          }}
          onThemeChange={setTheme}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}

interface SettingsModalProps {
  dataPath: string;
  theme: ThemeName;
  onPathChange: (p: string) => void;
  onThemeChange: (t: ThemeName) => void;
  onClose: () => void;
}

function SettingsModal({ dataPath, theme, onPathChange, onThemeChange, onClose }: SettingsModalProps) {
  const [path, setPath] = useState(dataPath);
  const [reloadStatus, setReloadStatus] = useState<string | null>(null);

  const handleApplyPath = async () => {
    if (!path.trim()) return;
    onPathChange(path.trim());
    setReloadStatus("保存先を変更しました。アプリを再起動すると新しいパスから読み込みます。");
  };

  const handleResetDefault = async () => {
    try {
      const def = await invoke<string>("default_data_path");
      setPath(def);
    } catch {
      // ignore
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ 設定</h2>

        <div className="form-group">
          <label>テーマ（背景色）</label>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.name}
                type="button"
                className={`theme-btn theme-${t.name} ${theme === t.name ? "active" : ""}`}
                onClick={() => onThemeChange(t.name)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>データ保存先（絶対パス）</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/xxx/Desktop/work-launcher.json"
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button type="button" className="icon-btn" onClick={handleApplyPath}>
              保存先を適用
            </button>
            <button type="button" className="icon-btn" onClick={handleResetDefault}>
              デフォルトに戻す
            </button>
          </div>
          {reloadStatus && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent)" }}>{reloadStatus}</div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-save" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
