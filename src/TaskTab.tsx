// TaskTab — v0.7.4 互換UI（カード型 + 「+新規タスク」ボタン + 「未完了 (N)」見出し）
// データソース: useLauncherData の tasks（API/cache）
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

type TaskFormData = {
  title: string;
  date: string;
  time: string;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDue(t: LauncherTask): string {
  if (!t.dueDate) return "期限なし";
  const d = new Date(t.dueDate);
  if (t.isAllDay) {
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskTab({ tasks, onCreate, onUpdate, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LauncherTask | null>(null);

  const now = new Date();
  const today0 = startOfDay(now);

  const pending = tasks
    .filter((t) => !t.completedAt)
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

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

  function isOverdue(t: LauncherTask): boolean {
    if (!t.dueDate || t.completedAt) return false;
    return new Date(t.dueDate).getTime() < now.getTime();
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

  async function handleCreate(data: TaskFormData) {
    setBusy(true);
    try {
      let dueDate: string | null = null;
      let isAllDay = true;
      if (data.date) {
        const time = data.time || "00:00";
        dueDate = new Date(`${data.date}T${time}:00`).toISOString();
        isAllDay = !data.time;
      }
      await onCreate({ title: data.title, dueDate, isAllDay });
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(data: TaskFormData) {
    if (!editing) return;
    setBusy(true);
    try {
      let dueDate: string | null = null;
      let isAllDay = true;
      if (data.date) {
        const time = data.time || "00:00";
        dueDate = new Date(`${data.date}T${time}:00`).toISOString();
        isAllDay = !data.time;
      }
      await onUpdate(editing.id, { title: data.title, dueDate, isAllDay });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("このタスクを削除しますか？")) return;
    setBusy(true);
    try {
      await onDelete(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="task-toolbar">
        <button
          className="add-btn"
          onClick={() => setCreating(true)}
          disabled={busy}
        >
          ＋ 新規タスク
        </button>
      </div>

      {pending.length === 0 && completed.length === 0 && (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>✅</p>
          <p>タスクはまだありません</p>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="task-section-title">未完了 ({pending.length})</h3>
          <div className="task-list">
            {pending.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                overdue={isOverdue(t)}
                onToggle={() => toggleComplete(t)}
                onEdit={() => setEditing(t)}
                onDelete={() => handleDelete(t.id)}
                disabled={busy}
              />
            ))}
          </div>
        </>
      )}

      {completed.length > 0 && (
        <>
          <h3 className="task-section-title">完了 ({completed.length})</h3>
          <div className="task-list">
            {completed.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                overdue={false}
                completed
                onToggle={() => toggleComplete(t)}
                onEdit={() => setEditing(t)}
                onDelete={() => handleDelete(t.id)}
                disabled={busy}
              />
            ))}
          </div>
        </>
      )}

      {creating && (
        <TaskEditModal
          task={null}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <TaskEditModal
          task={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ============================================================
// TaskCard
// ============================================================
interface TaskCardProps {
  task: LauncherTask;
  overdue: boolean;
  completed?: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}

function TaskCard({
  task,
  overdue,
  completed,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: TaskCardProps) {
  return (
    <div className={`task-card ${completed ? "completed" : ""}`}>
      <button
        className="task-check"
        onClick={onToggle}
        disabled={disabled}
        aria-label={completed ? "未完了に戻す" : "完了にする"}
      >
        {completed ? "✅" : "☐"}
      </button>
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-due-row">
          {overdue && <span className="overdue-badge">⚠ 時間超過</span>}
          <span className="task-due">期限: {formatDue(task)}</span>
        </div>
      </div>
      <div className="task-actions">
        <button onClick={onEdit} disabled={disabled}>
          編集
        </button>
        <button onClick={onDelete} disabled={disabled} className="danger">
          削除
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 追加・編集モーダル
// ============================================================
interface TaskEditModalProps {
  task: LauncherTask | null;
  onSave: (data: TaskFormData) => Promise<void>;
  onCancel: () => void;
}

function TaskEditModal({ task, onSave, onCancel }: TaskEditModalProps) {
  const init = task?.dueDate ? new Date(task.dueDate) : null;
  const initDate = init
    ? `${init.getFullYear()}-${String(init.getMonth() + 1).padStart(2, "0")}-${String(init.getDate()).padStart(2, "0")}`
    : "";
  const initTime =
    init && !task?.isAllDay
      ? `${String(init.getHours()).padStart(2, "0")}:${String(init.getMinutes()).padStart(2, "0")}`
      : "";

  const [title, setTitle] = useState(task?.title ?? "");
  const [date, setDate] = useState(initDate);
  const [time, setTime] = useState(initTime);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), date, time });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{task ? "タスクを編集" : "新規タスク"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>タイトル *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>期限</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{ flex: 1 }}
                disabled={!date}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} disabled={saving}>
              キャンセル
            </button>
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
