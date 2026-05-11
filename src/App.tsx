// Work Launcher V1.0 メイン
// データソース: useLauncherData（API+cache）/ ローカル設定: work-launcher.json
// 認証: Keycloak Pattern D（Custom URL Scheme）
// 設計書: MyBrain/20_Projects/Work Launcher/設計書 v0.4

import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  readTextFile,
  exists,
  writeTextFile,
  mkdir,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import type {
  AppData,
  ThemeName,
  CalendarSettings,
  Preferences,
  TabName,
} from "./types";
import { DEFAULT_PREFERENCES } from "./types";

import MemoTab from "./MemoTab";
import TaskTab from "./TaskTab";
import LocalTab from "./LocalTab";
import SitesTab from "./SitesTab";
import CalendarTab from "./CalendarTab";
import type { ItemTargetType } from "./api/types";
import {
  kcLogin,
  kcLogout,
  kcSilentLogin,
  onLoginSuccess,
  type TokenSet,
} from "./auth/keycloak";
import { useLauncherData } from "./hooks/useLauncherData";
import {
  apiCreateSection,
  apiUpdateSection,
  apiDeleteSection,
  apiCreateItem,
  apiUpdateItem,
  apiDeleteItem,
  apiTouchItem,
  apiCreateMemo,
  apiUpdateMemo,
  apiDeleteMemo,
  apiCreateTask,
  apiUpdateTask,
  apiDeleteTask,
  apiCloneShared,
} from "./api/launcher-api";
import { clearCache } from "./cache/launcher-cache";

const ADMIN_CONSOLE_URL = "https://admin.id.kensetsu-total.support";
const APP_DATA_FILE = "work-launcher/app.json";
const APP_DATA_DIR = "work-launcher";
const FS_OPTS = { baseDir: BaseDirectory.AppLocalData } as const;

// semver比較（latest > current で true）
// "1.0.0-beta.3" vs "0.7.4" 等の prerelease 込み比較に対応
// 仕様: 数字部分(major.minor.patch)で大小判定 → 同値なら正式版 > prerelease版
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const [main, pre = ""] = v.replace(/^v/, "").split("-", 2);
    const nums = main.split(".").map((n) => parseInt(n, 10) || 0);
    return { nums, pre };
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const ai = a.nums[i] || 0;
    const bi = b.nums[i] || 0;
    if (ai !== bi) return ai > bi;
  }
  // major.minor.patch 同値: pre無し(正式) > pre有り
  if (a.pre === "" && b.pre !== "") return true;
  if (a.pre !== "" && b.pre === "") return false;
  return a.pre > b.pre; // 文字列比較フォールバック
}

// ============================================================
// メイン
// ============================================================
export default function App() {
  // ローカル設定
  const [theme, setTheme] = useState<ThemeName>("pink");
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [calendar, setCalendar] = useState<CalendarSettings | null>(null);
  const dataLoadedRef = useRef(false);

  // UI 状態
  const [tab, setTab] = useState<TabName>("calendar");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // バージョン情報
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // 認証
  const [kcUser, setKcUser] = useState<TokenSet | null>(null);

  // データ供給（ログイン中のみ実行）
  const {
    state: launcher,
    sync,
    setSections,
    setMemos,
    setTasks,
  } = useLauncherData(!!kcUser);

  // ============================================================
  // 認証
  // ============================================================
  useEffect(() => {
    kcSilentLogin()
      .then((ts) => {
        if (ts) setKcUser(ts);
      })
      .catch((e) => console.warn("kcSilentLogin failed:", e));
    const off = onLoginSuccess((ts) => setKcUser(ts));
    return off;
  }, []);

  const handleKcLogin = useCallback(async () => {
    try {
      await kcLogin();
    } catch (e) {
      console.error("kcLogin:", e);
      setNotification(`ログイン失敗: ${e}`);
    }
  }, []);

  const handleKcLogout = useCallback(async () => {
    try {
      await kcLogout();
    } catch (e) {
      console.warn("kcLogout:", e);
    }
    await clearCache();
    setKcUser(null);
  }, []);

  // ============================================================
  // ローカル設定 ロード/保存
  // ============================================================
  useEffect(() => {
    (async () => {
      try {
        if (!(await exists(APP_DATA_DIR, FS_OPTS))) {
          await mkdir(APP_DATA_DIR, { ...FS_OPTS, recursive: true });
        }
        if (await exists(APP_DATA_FILE, FS_OPTS)) {
          const text = await readTextFile(APP_DATA_FILE, FS_OPTS);
          const data = JSON.parse(text) as Partial<AppData>;
          if (data.calendar) setCalendar(data.calendar);
          if (data.theme) setTheme(data.theme);
          if (data.preferences) {
            setPreferences({ ...DEFAULT_PREFERENCES, ...data.preferences });
            setTab(
              data.preferences.startupTab ?? DEFAULT_PREFERENCES.startupTab,
            );
          }
        }
      } catch (e) {
        console.warn("local data load:", e);
      } finally {
        dataLoadedRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!dataLoadedRef.current) return;
    (async () => {
      try {
        const data: AppData = {
          version: 2,
          calendar,
          theme,
          preferences,
        };
        await writeTextFile(APP_DATA_FILE, JSON.stringify(data), FS_OPTS);
      } catch (e) {
        console.warn("local data save:", e);
      }
    })();
  }, [calendar, theme, preferences]);

  // ============================================================
  // ウィンドウサイズ切替
  // ============================================================
  const handleMinimize = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(400, 520));
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(540, 800));
  }, []);

  // ============================================================
  // アップデートチェック
  // ============================================================
  useEffect(() => {
    (async () => {
      try {
        const v = await getVersion();
        setCurrentVersion(v);
      } catch {}
    })();
    const checkLatest = async () => {
      try {
        const res = await fetch(
          "https://api.github.com/repos/kengoozeki2fc-arch/quick-launcher/releases/latest",
        );
        if (!res.ok) return;
        const json = (await res.json()) as { tag_name?: string };
        if (json.tag_name) {
          setLatestVersion(json.tag_name.replace(/^v/, ""));
        }
      } catch {}
    };
    checkLatest();
    const id = window.setInterval(checkLatest, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const hasUpdate =
    !!latestVersion &&
    !!currentVersion &&
    isNewerVersion(latestVersion, currentVersion) &&
    !updateDismissed;

  // ============================================================
  // Mutators（楽観的UI + API送信 + 失敗時 sync）
  // ============================================================
  function reportError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setNotification(`エラー: ${msg}`);
    sync().catch(() => {});
  }

  // Sections
  const onCreateSection = useCallback(
    async (input: { name: string; type?: string; color?: string }) => {
      try {
        const sec = await apiCreateSection(input);
        setSections((prev) => [...prev, { ...sec, items: [] }]);
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );
  const onUpdateSection = useCallback(
    async (
      id: string,
      patch: Partial<{ name: string; color: string; type: string }>,
    ) => {
      try {
        const sec = await apiUpdateSection(id, patch);
        setSections((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, ...sec, items: s.items } : s,
          ),
        );
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );
  const onDeleteSection = useCallback(
    async (id: string) => {
      try {
        await apiDeleteSection(id);
        setSections((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );

  // Items
  const onCreateItem = useCallback(
    async (input: {
      sectionId: string;
      name: string;
      target: string;
      targetType?: ItemTargetType;
      icon?: string;
      loginId?: string | null;
      password?: string | null;
      hasOtp?: boolean;
    }) => {
      try {
        const item = await apiCreateItem(input);
        setSections((prev) =>
          prev.map((s) =>
            s.id === input.sectionId
              ? { ...s, items: [...s.items, item] }
              : s,
          ),
        );
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );
  const onUpdateItem = useCallback(
    async (
      id: string,
      patch: Partial<{
        name: string;
        target: string;
        targetType: ItemTargetType;
        icon: string | null;
        loginId: string | null;
        password: string | null;
        hasOtp: boolean;
      }>,
    ) => {
      try {
        const item = await apiUpdateItem(id, patch);
        setSections((prev) =>
          prev.map((s) => ({
            ...s,
            items: s.items.map((i) => (i.id === id ? { ...i, ...item } : i)),
          })),
        );
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );
  const onDeleteItem = useCallback(
    async (id: string) => {
      try {
        await apiDeleteItem(id);
        setSections((prev) =>
          prev.map((s) => ({
            ...s,
            items: s.items.filter((i) => i.id !== id),
          })),
        );
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );
  const onTouchItem = useCallback(async (id: string) => {
    try {
      await apiTouchItem(id);
    } catch (e) {
      console.warn("touch failed:", e);
    }
  }, []);

  // Memos
  const onCreateMemo = useCallback(
    async (input: { title?: string; content: string }) => {
      try {
        const memo = await apiCreateMemo(input);
        setMemos((prev) => [...prev, memo]);
      } catch (e) {
        reportError(e);
      }
    },
    [setMemos, sync],
  );
  const onUpdateMemo = useCallback(
    async (
      id: string,
      patch: { title?: string | null; content?: string },
    ) => {
      try {
        const memo = await apiUpdateMemo(id, patch);
        setMemos((prev) => prev.map((m) => (m.id === id ? memo : m)));
      } catch (e) {
        reportError(e);
      }
    },
    [setMemos, sync],
  );
  const onDeleteMemo = useCallback(
    async (id: string) => {
      try {
        await apiDeleteMemo(id);
        setMemos((prev) => prev.filter((m) => m.id !== id));
      } catch (e) {
        reportError(e);
      }
    },
    [setMemos, sync],
  );

  // Tasks
  const onCreateTask = useCallback(
    async (input: {
      title: string;
      dueDate?: string | null;
      isAllDay?: boolean;
    }) => {
      try {
        const task = await apiCreateTask(input);
        setTasks((prev) => [...prev, task]);
      } catch (e) {
        reportError(e);
      }
    },
    [setTasks, sync],
  );
  const onUpdateTask = useCallback(
    async (
      id: string,
      patch: {
        title?: string;
        dueDate?: string | null;
        isAllDay?: boolean;
        completedAt?: string | null;
      },
    ) => {
      try {
        const task = await apiUpdateTask(id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
      } catch (e) {
        reportError(e);
      }
    },
    [setTasks, sync],
  );
  const onDeleteTask = useCallback(
    async (id: string) => {
      try {
        await apiDeleteTask(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
      } catch (e) {
        reportError(e);
      }
    },
    [setTasks, sync],
  );

  // Shared / Templates
  const onCloneShared = useCallback(
    async (shareId: string) => {
      try {
        const sec = await apiCloneShared(shareId);
        setSections((prev) => [...prev, { ...sec, items: sec.items ?? [] }]);
        setNotification(`📋 「${sec.name}」を複製しました`);
        setTimeout(() => setNotification(null), 1500);
      } catch (e) {
        reportError(e);
      }
    },
    [setSections, sync],
  );

  // ============================================================
  // 同期ボタン
  // ============================================================
  const handleSync = useCallback(async () => {
    setNotification("同期中…");
    await sync();
    setNotification(null);
  }, [sync]);

  // ============================================================
  // オフライン検知（Phase 2.7 最小実装）
  // - offline時: notification 表示・mutator は API失敗でエラー通知
  // - online復帰時: 自動 sync
  // 完全な queue+replay 機構は v1.5 以降で検討
  // ============================================================
  useEffect(() => {
    const handleOnline = () => {
      setNotification("オンライン復帰：再同期中…");
      sync()
        .catch(() => {})
        .finally(() => {
          setTimeout(() => setNotification(null), 1500);
        });
    };
    const handleOffline = () => {
      setNotification("⚠ オフライン: 再接続後に自動同期します");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      handleOffline();
    }
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sync]);

  // ============================================================
  // 設定モーダル: Web で編集
  // ============================================================
  const handleOpenAdminConsole = useCallback(() => {
    open(`${ADMIN_CONSOLE_URL}/admin/work-launcher`).catch((e) =>
      console.error(e),
    );
  }, []);

  // ============================================================
  // Render
  // ============================================================
  const openTaskCount = launcher.tasks.filter((t) => !t.completedAt).length;
  const tabs: { key: TabName; label: string; badge?: number }[] = [
    { key: "calendar", label: "📅 カレンダー" },
    { key: "task", label: "✅ タスク", badge: openTaskCount },
    { key: "launcher", label: "🚀 サイト" },
    { key: "memo", label: "📝 メモ" },
    { key: "local", label: "📁 ローカル" },
  ];


  return (
    <div className="app" data-theme={theme}>
      {hasUpdate && (
        <div
          className="update-banner"
          onClick={() =>
            open(
              `https://github.com/kengoozeki2fc-arch/quick-launcher/releases/tag/v${latestVersion}`,
            )
          }
        >
          新しいバージョン v{latestVersion} が利用可能です（現在 v
          {currentVersion}）
          <span
            className="notif-close"
            onClick={(e) => {
              e.stopPropagation();
              setUpdateDismissed(true);
            }}
          >
            ✕
          </span>
        </div>
      )}
      {notification && (
        <div className="notification-banner" onClick={() => setNotification(null)}>
          {notification}
          <span className="notif-close">✕</span>
        </div>
      )}

      {/* ヘッダ */}
      <div className="header">
        <h1>Work Launcher</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {kcUser && tab === "launcher" && (
            <button
              className="add-btn"
              onClick={() => setShowAddItemModal(true)}
            >
              ＋ 追加
            </button>
          )}
          {kcUser ? (
            <>
              <button
                className="icon-btn icon-btn-slim"
                onClick={handleSync}
                title="同期"
                disabled={launcher.loading}
              >
                {launcher.loading ? "⏳" : "🔄"}
              </button>
              <button
                className="icon-btn icon-btn-slim"
                onClick={handleKcLogout}
                title={`ログイン中: ${kcUser.email ?? "認証済"}（クリックでログアウト）`}
              >
                🔓
              </button>
            </>
          ) : (
            <button
              className="icon-btn icon-btn-slim"
              onClick={handleKcLogin}
              title="統合認証ログイン"
            >
              🔐
            </button>
          )}
          <button
            className="icon-btn icon-btn-slim"
            onClick={handleMinimize}
            title="最小化"
          >
            −
          </button>
          <button
            className="icon-btn icon-btn-slim"
            onClick={handleToggleMaximize}
            title="最大化"
          >
            □
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettingsModal(true)}
            title="設定"
          >
            ⚙
          </button>
        </div>
      </div>

      {!kcUser ? (
        <NotLoggedInPanel onLogin={handleKcLogin} />
      ) : (
        <>
          {/* タブ */}
          <div className="tabs">
            {tabs.map((t) => {
              if (t.key === "local" && !preferences.showLocalTab) return null;
              return (
                <button
                  key={t.key}
                  className={`tab-btn ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {typeof t.badge === "number" && t.badge > 0 && (
                    <span className="tab-badge">{t.badge}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* タブ本体 */}
          <div className="tab-content">
            {tab === "calendar" && (
              <CalendarTab
                calendar={calendar}
                onCalendarChange={setCalendar}
              />
            )}
            {tab === "task" && (
              <TaskTab
                tasks={launcher.tasks}
                onCreate={onCreateTask}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
              />
            )}
            {tab === "memo" && (
              <MemoTab
                memos={launcher.memos}
                onCreate={onCreateMemo}
                onUpdate={onUpdateMemo}
                onDelete={onDeleteMemo}
              />
            )}
            {tab === "launcher" && (
              <SitesTab
                sections={launcher.sections}
                showAddModal={showAddItemModal}
                onCloseAddModal={() => setShowAddItemModal(false)}
                onCreateSection={onCreateSection}
                onCreateItem={onCreateItem}
                onUpdateItem={onUpdateItem}
                onDeleteItem={onDeleteItem}
                onTouchItem={onTouchItem}
              />
            )}
            {tab === "local" && (
              <LocalTab
                sections={launcher.sections}
                shared={launcher.shared}
                onCloneShared={onCloneShared}
                onCreateSection={onCreateSection}
                onUpdateSection={onUpdateSection}
                onDeleteSection={onDeleteSection}
                onCreateItem={onCreateItem}
                onUpdateItem={onUpdateItem}
                onDeleteItem={onDeleteItem}
                onTouchItem={onTouchItem}
              />
            )}
          </div>

          {launcher.error && (
            <div className="sync-error">⚠ 同期エラー: {launcher.error}</div>
          )}
        </>
      )}

      {/* 設定モーダル */}
      {showSettingsModal && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          loggedIn={!!kcUser}
          email={kcUser?.email ?? null}
          lastSyncAt={launcher.lastSyncAt}
          onClose={() => setShowSettingsModal(false)}
          onOpenAdminConsole={handleOpenAdminConsole}
          onLogin={handleKcLogin}
          onLogout={handleKcLogout}
        />
      )}
    </div>
  );
}

// ============================================================
// 未ログインパネル
// ============================================================
function NotLoggedInPanel({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="not-logged-in">
      <h2>ようこそ Work Launcher へ</h2>
      <p>
        統合認証でログインすると、
        マルチデバイスで同期されたサイト・メモ・タスクを使えます。
      </p>
      <button className="primary-btn" onClick={onLogin}>
        🔐 統合認証ログイン
      </button>
      <p className="hint">
        ブラウザが開いてメアド入力 → Entra認証 → 自動でアプリに戻ります
      </p>
    </div>
  );
}

// ============================================================
// 設定モーダル
// ============================================================
function SettingsModal({
  theme,
  onThemeChange,
  preferences,
  onPreferencesChange,
  loggedIn,
  email,
  lastSyncAt,
  onClose,
  onOpenAdminConsole,
  onLogin,
  onLogout,
}: {
  theme: ThemeName;
  onThemeChange: (t: ThemeName) => void;
  preferences: Preferences;
  onPreferencesChange: (p: Preferences) => void;
  loggedIn: boolean;
  email: string | null;
  lastSyncAt: number | null;
  onClose: () => void;
  onOpenAdminConsole: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ 設定</h2>

        <section>
          <h3>テーマ</h3>
          <div className="theme-row">
            {(["pink", "blue", "black", "white"] as ThemeName[]).map((t) => (
              <button
                key={t}
                className={`theme-btn theme-${t} ${theme === t ? "active" : ""}`}
                onClick={() => onThemeChange(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>起動時の表示</h3>
          <label>
            起動タブ:
            <select
              value={preferences.startupTab}
              onChange={(e) =>
                onPreferencesChange({
                  ...preferences,
                  startupTab: e.target.value as TabName,
                })
              }
            >
              <option value="calendar">カレンダー</option>
              <option value="task">タスク</option>
              <option value="memo">メモ</option>
              <option value="local">ローカル</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.showLocalTab}
              onChange={(e) =>
                onPreferencesChange({
                  ...preferences,
                  showLocalTab: e.target.checked,
                })
              }
            />
            ローカル/サイトタブを表示
          </label>
        </section>

        <section>
          <h3>統合認証</h3>
          {loggedIn ? (
            <>
              <p>ログイン中: {email ?? "認証済"}</p>
              {lastSyncAt && (
                <p className="hint">
                  最終同期: {new Date(lastSyncAt).toLocaleString("ja-JP")}
                </p>
              )}
              <button onClick={onOpenAdminConsole} className="link-btn">
                📝 Web で編集する（admin-console を開く）
              </button>
              <button onClick={onLogout} className="warn-btn">
                🔓 ログアウト
              </button>
            </>
          ) : (
            <>
              <p>未ログイン</p>
              <button onClick={onLogin} className="primary-btn">
                🔐 統合認証ログイン
              </button>
            </>
          )}
        </section>

        <div className="modal-footer">
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
