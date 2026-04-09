import { useState } from "react";
import type { Task } from "./types";

interface Props {
  tasks: Task[];
  onSave: (task: Task) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function TaskTab({ tasks, onSave, onToggleDone, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const openNew = () => {
    setEditing(null);
    setTitle("");
    const now = new Date();
    setDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    setTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    setShowForm(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setTitle(task.title);
    setDate(task.date);
    setTime(task.time);
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: editing?.id ?? crypto.randomUUID(),
      title,
      date,
      time,
      done: editing?.done ?? false,
      notified: editing?.notified ?? false,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    });
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("このタスクを削除しますか？")) {
      onDelete(id);
    }
  };

  const getDeadline = (task: Task): Date => {
    return new Date(`${task.date}T${task.time}:00`);
  };

  const isOverdue = (task: Task): boolean => {
    if (task.done) return false;
    return getDeadline(task) < new Date();
  };

  const isNearDeadline = (task: Task): boolean => {
    if (task.done) return false;
    const deadline = getDeadline(task);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    return diffMs > 0 && diffMs <= 60 * 60 * 1000;
  };

  const formatDeadline = (task: Task) => {
    const d = getDeadline(task);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const activeTasks = tasks.filter((t) => !t.done);
  // 完了タスクの翌日自動削除はApp.tsxの起動時プルーンで実施。ここでは全て表示。
  const doneTasks = tasks.filter((t) => t.done);

  const renderTask = (task: Task) => (
    <div
      key={task.id}
      className={`task-card ${task.done ? "task-done" : ""} ${isOverdue(task) ? "task-overdue" : ""} ${isNearDeadline(task) ? "task-near" : ""}`}
    >
      <div className="task-header">
        <label className="task-check-label">
          <input
            type="checkbox"
            checked={task.done}
            onChange={() => onToggleDone(task.id)}
          />
          <span className="task-title">{task.title}</span>
        </label>
        <div className="item-actions">
          {!task.done && (
            <button className="icon-btn" onClick={() => openEdit(task)}>編集</button>
          )}
          <button className="icon-btn danger" onClick={() => handleDelete(task.id)}>削除</button>
        </div>
      </div>
      <div className="task-deadline">
        {isOverdue(task) && <span className="badge badge-overdue">⚠ 時間超過</span>}
        {isNearDeadline(task) && <span className="badge badge-near">⏰ まもなく</span>}
        <span className="task-time-label">期限: {formatDeadline(task)}</span>
      </div>
    </div>
  );

  return (
    <div className="tab-content">
      <div className="tab-toolbar">
        <button className="add-btn" onClick={openNew}>+ 新規タスク</button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>✅</p>
          <p>「+ 新規タスク」からタスクを作成しよう</p>
        </div>
      ) : (
        <>
          {activeTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-label">未完了 ({activeTasks.length})</div>
              <div className="task-list">{activeTasks.map(renderTask)}</div>
            </div>
          )}
          {doneTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-label">完了 ({doneTasks.length})</div>
              <div className="task-list">{doneTasks.map(renderTask)}</div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "タスクを編集" : "新規タスク"}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>やること</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="タスクの内容"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>日付</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>時間</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowForm(false)}>キャンセル</button>
                <button type="submit" className="btn-save">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
