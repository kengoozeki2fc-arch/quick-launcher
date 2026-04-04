import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { readTextFile, writeTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { LauncherItem, Memo, Task } from "./types";
import ItemCard from "./ItemCard";
import EditModal from "./EditModal";
import MemoTab from "./MemoTab";
import TaskTab from "./TaskTab";
import CalendarTab from "./CalendarTab";

const DATA_FILE = "quick-launcher-data.json";
const MEMO_FILE = "quick-launcher-memos.json";
const TASK_FILE = "quick-launcher-tasks.json";
const PAGE_SIZE = 5;

type Tab = "launcher" | "memo" | "task" | "calendar";

async function loadJson<T>(file: string): Promise<T[]> {
  try {
    const fileExists = await exists(file, { baseDir: BaseDirectory.Desktop });
    if (!fileExists) return [];
    const raw = await readTextFile(file, { baseDir: BaseDirectory.Desktop });
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveJson<T>(file: string, data: T[]) {
  await writeTextFile(file, JSON.stringify(data, null, 2), {
    baseDir: BaseDirectory.Desktop,
  });
}

export default function App() {
  const [tab, setTab] = useState<Tab>("launcher");
  const [notification, setNotification] = useState<string | null>(null);

  // Launcher
  const [items, setItems] = useState<LauncherItem[]>([]);
  const [editingItem, setEditingItem] = useState<LauncherItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Memo
  const [memos, setMemos] = useState<Memo[]>([]);

  // Task
  const [tasks, setTasks] = useState<Task[]>([]);

  const launcherLoaded = useRef(false);
  const memoLoaded = useRef(false);
  const taskLoaded = useRef(false);

  // 初回読み込み
  useEffect(() => {
    loadJson<LauncherItem>(DATA_FILE).then((d) => {
      setItems(d);
      launcherLoaded.current = true;
    });
    loadJson<Memo>(MEMO_FILE).then((d) => {
      setMemos(d);
      memoLoaded.current = true;
    });
    loadJson<Task>(TASK_FILE).then((d) => {
      setTasks(d);
      taskLoaded.current = true;
    });
  }, []);

  // 自動保存
  useEffect(() => {
    if (launcherLoaded.current) saveJson(DATA_FILE, items);
  }, [items]);

  useEffect(() => {
    if (memoLoaded.current) saveJson(MEMO_FILE, memos);
  }, [memos]);

  useEffect(() => {
    if (taskLoaded.current) saveJson(TASK_FILE, tasks);
  }, [tasks]);

  // 検索でページリセット
  useEffect(() => {
    setPage(1);
  }, [search]);

  // タスク通知チェック（1分ごと）
  useEffect(() => {
    const check = () => {
      setTasks((prev) => {
        const now = new Date();
        const updated = prev.map((task) => {
          if (task.done || task.notified) return task;
          const deadline = new Date(`${task.date}T${task.time}:00`);
          const diffMs = deadline.getTime() - now.getTime();
          if (diffMs > 0 && diffMs <= 60 * 60 * 1000) {
            setNotification(`⏰ 「${task.title}」の期限まであと1時間以内です`);
            return { ...task, notified: true };
          }
          return task;
        });
        return updated;
      });
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

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
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

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

  // Memo
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

  const handleMemoDelete = (id: string) => {
    setMemos((prev) => prev.filter((m) => m.id !== id));
  };

  // Task
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

  const handleTaskToggle = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const handleTaskDelete = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="app">
      {notification && (
        <div className="notification-banner" onClick={() => setNotification(null)}>
          {notification}
          <span className="notif-close">✕</span>
        </div>
      )}

      <div className="header">
        <h1>Work Launcher</h1>
        {tab === "launcher" && (
          <button className="add-btn" onClick={handleAdd}>+ 追加</button>
        )}
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
          className={`tab-btn ${tab === "launcher" ? "active" : ""}`}
          onClick={() => setTab("launcher")}
        >
          🚀 ランチャー
        </button>
        <button
          className={`tab-btn ${tab === "memo" ? "active" : ""}`}
          onClick={() => setTab("memo")}
        >
          📝 メモ
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
          className={`tab-btn ${tab === "calendar" ? "active" : ""}`}
          onClick={() => setTab("calendar")}
        >
          📅 カレンダー
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

      {tab === "calendar" && <CalendarTab />}

      {showModal && (
        <EditModal
          item={editingItem}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
