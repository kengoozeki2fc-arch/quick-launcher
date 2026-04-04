import { useState } from "react";
import type { Memo } from "./types";

interface Props {
  memos: Memo[];
  onSave: (memo: Memo) => void;
  onDelete: (id: string) => void;
}

export default function MemoTab({ memos, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState<Memo | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setShowForm(true);
  };

  const openEdit = (memo: Memo) => {
    setEditing(memo);
    setTitle(memo.title);
    setBody(memo.body);
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    onSave({
      id: editing?.id ?? crypto.randomUUID(),
      title,
      body,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    });
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("このメモを削除しますか？")) {
      onDelete(id);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="tab-content">
      <div className="tab-toolbar">
        <button className="add-btn" onClick={openNew}>+ 新規メモ</button>
      </div>

      {memos.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>📝</p>
          <p>「+ 新規メモ」からメモを作成しよう</p>
        </div>
      ) : (
        <div className="memo-list">
          {memos.map((memo) => (
            <div key={memo.id} className="memo-card">
              <div className="memo-header">
                <span className="memo-title">{memo.title}</span>
                <div className="item-actions">
                  <button className="icon-btn" onClick={() => openEdit(memo)}>編集</button>
                  <button className="icon-btn danger" onClick={() => handleDelete(memo.id)}>削除</button>
                </div>
              </div>
              <div className="memo-body">{memo.body}</div>
              <div className="memo-date">更新: {formatDate(memo.updatedAt)}</div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal memo-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "メモを編集" : "新規メモ"}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>タイトル</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="メモのタイトル"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>内容</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="メモの内容を入力..."
                  rows={8}
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
