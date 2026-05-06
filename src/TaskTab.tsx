// TaskTab — Phase 2.5 で API/キャッシュベースに書き換え
// 完了タスクは「期限が今日以降」のものだけ「完了」セクションに表示（v0.6.2 仕様継続）

import { useState } from "react";
import type { LauncherTask } from "./api/types";

type Props = {
  tasks: LauncherTask[];
  onCreate: (input: {
    title: string;
    dueDate?: string | null;
    isAllDay?: boolean;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      title?: string;
      dueDate?: string | null;
      isAllDay?: boolean;
      completedAt?: string | null;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function TaskTab({ tasks, onCreate, onUpdate, onDelete }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const today0 = startOfDay(now);

  // 未完了：期限昇順（超過→近い未来→遠い未来）
  const pending = tasks
    .filter((t) => !t.completedAt)
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  // 完了：期限が今日以降のものだけ表示（翌日になったら自動非表示）
  const completed = tasks
    .filter((t) => {
      if (!t.completedAt) return false;
      if (!t.dueDate) return false;
      return startOfDay(new Date(t.dueDate)) >= today0;
    })
    .sort(
      (a, b) =>
        new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime(),
    );

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      let dueDate: string | null = null;
      let isAllDay = true;
      if (newDate) {
        const time = newTime || "00:00";
        dueDate = new Date(`${newDate}T${time}:00`).toISOString();
        isAllDay = !newTime;
      }
      await onCreate({ title: newTitle, dueDate, isAllDay });
      setNewTitle("");
      setNewDate("");
      setNewTime("");
    } finally {
      setBusy(false);
    }
  }

  async function toggleComplete(t: LauncherTask) {
    setBusy(true);
    try {
      await onUpdate(t.id, {
        completedAt: t.completedAt ? null : new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await onDelete(id);
    } finally {
      setBusy(false);
    }
  }

  function isOverdue(t: LauncherTask): boolean {
    if (!t.dueDate || t.completedAt) return false;
    return new Date(t.dueDate).getTime() < now.getTime();
  }

  function formatDue(t: LauncherTask): string {
    if (!t.dueDate) return "期限なし";
    const d = new Date(t.dueDate);
    if (t.isAllDay) return d.toLocaleDateString("ja-JP");
    return d.toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="task-tab">
      <div className="task-add">
        <input
          type="text"
          placeholder="やること"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          disabled={busy}
        />
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          disabled={busy}
        />
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          disabled={busy}
        />
        <button onClick={handleCreate} disabled={busy || !newTitle.trim()}>
          ＋
        </button>
      </div>

      {pending.length === 0 && completed.length === 0 && (
        <p className="empty">タスクはまだありません</p>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="task-section-title">📌 未完了</h3>
          <ul className="task-list">
            {pending.map((t) => (
              <li
                key={t.id}
                className={`task-item ${isOverdue(t) ? "overdue" : ""}`}
              >
                <button
                  className="task-check"
                  onClick={() => toggleComplete(t)}
                  disabled={busy}
                  aria-label="完了にする"
                >
                  ⬜
                </button>
                <div className="task-body">
                  <div className="task-title">{t.title}</div>
                  <div className="task-due">
                    {formatDue(t)}
                    {isOverdue(t) && (
                      <span className="overdue-badge">超過</span>
                    )}
                  </div>
                </div>
                <button
                  className="task-delete"
                  onClick={() => handleDelete(t.id)}
                  disabled={busy}
                  aria-label="削除"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {completed.length > 0 && (
        <>
          <h3 className="task-section-title">✅ 完了</h3>
          <ul className="task-list">
            {completed.map((t) => (
              <li key={t.id} className="task-item completed">
                <button
                  className="task-check"
                  onClick={() => toggleComplete(t)}
                  disabled={busy}
                  aria-label="未完了に戻す"
                >
                  ✅
                </button>
                <div className="task-body">
                  <div className="task-title">{t.title}</div>
                  <div className="task-due">{formatDue(t)}</div>
                </div>
                <button
                  className="task-delete"
                  onClick={() => handleDelete(t.id)}
                  disabled={busy}
                  aria-label="削除"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
