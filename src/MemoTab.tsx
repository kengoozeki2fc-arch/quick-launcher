// MemoTab — Phase 2.5 で API/キャッシュベースに書き換え
// データソース: useLauncherData の memos（LauncherMemo[]）
// 編集: launcher-api 経由で apiCreateMemo / apiUpdateMemo / apiDeleteMemo

import { useState } from "react";
import type { LauncherMemo } from "./api/types";

type Props = {
  memos: LauncherMemo[];
  onCreate: (input: { title?: string; content: string }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: { title?: string | null; content?: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function MemoTab({ memos, onCreate, onUpdate, onDelete }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  async function handleCreate() {
    if (!newContent.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        title: newTitle.trim() || undefined,
        content: newContent,
      });
      setNewTitle("");
      setNewContent("");
      setShowAdd(false);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m: LauncherMemo) {
    setEditing(m.id);
    setEditTitle(m.title ?? "");
    setEditContent(m.content);
  }

  async function saveEdit(id: string) {
    setBusy(true);
    try {
      await onUpdate(id, {
        title: editTitle.trim() || null,
        content: editContent,
      });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("このメモを削除しますか？")) return;
    setBusy(true);
    try {
      await onDelete(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="memo-tab">
      <div className="memo-toolbar">
        {showAdd ? null : (
          <button className="add-btn" onClick={() => setShowAdd(true)}>
            ＋ 新規メモ
          </button>
        )}
      </div>

      {showAdd && (
        <div className="memo-add">
          <input
            type="text"
            placeholder="タイトル（省略可）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={busy}
          />
          <textarea
            placeholder="本文"
            rows={4}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            disabled={busy}
          />
          <div className="memo-add-actions">
            <button
              onClick={handleCreate}
              disabled={busy || !newContent.trim()}
            >
              保存
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setNewTitle("");
                setNewContent("");
              }}
              disabled={busy}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {memos.length === 0 ? (
        <p className="empty">メモはまだありません</p>
      ) : (
        <ul className="memo-list">
          {memos.map((m) =>
            editing === m.id ? (
              <li key={m.id} className="memo-item editing">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="タイトル"
                />
                <textarea
                  rows={4}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
                <div className="memo-actions">
                  <button onClick={() => saveEdit(m.id)} disabled={busy}>
                    保存
                  </button>
                  <button onClick={() => setEditing(null)} disabled={busy}>
                    キャンセル
                  </button>
                </div>
              </li>
            ) : (
              <li key={m.id} className="memo-item">
                {m.title && <div className="memo-title">{m.title}</div>}
                <div className="memo-content">{m.content}</div>
                <div className="memo-meta">
                  {new Date(m.updatedAt).toLocaleString("ja-JP")}
                  <span className="memo-actions">
                    <button onClick={() => startEdit(m)} title="編集">
                      ✎
                    </button>
                    <button onClick={() => handleDelete(m.id)} title="削除">
                      🗑
                    </button>
                  </span>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
