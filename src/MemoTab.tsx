// MemoTab — v0.7.4 互換UI（カード型・本文改行保持・編集/削除テキストボタン・「+新規メモ」ピンクボタン）
// データソース: useLauncherData の memos（LauncherMemo[]）

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

type MemoFormData = {
  title: string;
  content: string;
};

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function MemoTab({ memos, onCreate, onUpdate, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LauncherMemo | null>(null);

  async function handleCreate(data: MemoFormData) {
    if (!data.content.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        title: data.title.trim() || undefined,
        content: data.content,
      });
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(data: MemoFormData) {
    if (!editing) return;
    setBusy(true);
    try {
      await onUpdate(editing.id, {
        title: data.title.trim() || null,
        content: data.content,
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
    <>
      <div className="memo-toolbar">
        <button
          className="add-btn"
          onClick={() => setCreating(true)}
          disabled={busy}
        >
          ＋ 新規メモ
        </button>
      </div>

      {memos.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>📝</p>
          <p>メモはまだありません</p>
        </div>
      ) : (
        <div className="memo-list">
          {memos.map((m) => (
            <MemoCard
              key={m.id}
              memo={m}
              onEdit={() => setEditing(m)}
              onDelete={() => handleDelete(m.id)}
              disabled={busy}
            />
          ))}
        </div>
      )}

      {creating && (
        <MemoEditModal
          memo={null}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <MemoEditModal
          memo={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ============================================================
// MemoCard — v0.7.4 互換（タイトル赤・本文改行保持・更新日時・編集/削除）
// ============================================================
function MemoCard({
  memo,
  onEdit,
  onDelete,
  disabled,
}: {
  memo: LauncherMemo;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="memo-card">
      <div className="memo-header">
        {memo.title && <div className="memo-title">{memo.title}</div>}
        <div className="memo-header-actions">
          <button onClick={onEdit} disabled={disabled}>
            編集
          </button>
          <button onClick={onDelete} disabled={disabled} className="danger">
            削除
          </button>
        </div>
      </div>
      <div className="memo-content">{memo.content}</div>
      <div className="memo-meta">更新: {formatUpdated(memo.updatedAt)}</div>
    </div>
  );
}

// ============================================================
// 追加・編集モーダル
// ============================================================
interface MemoEditModalProps {
  memo: LauncherMemo | null;
  onSave: (data: MemoFormData) => Promise<void>;
  onCancel: () => void;
}

function MemoEditModal({ memo, onSave, onCancel }: MemoEditModalProps) {
  const [title, setTitle] = useState(memo?.title ?? "");
  const [content, setContent] = useState(memo?.content ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onSave({ title, content });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{memo ? "メモを編集" : "新規メモ"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>タイトル（省略可）</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>本文 *</label>
            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel} disabled={saving}>
              キャンセル
            </button>
            <button
              type="submit"
              className="btn-save"
              disabled={saving || !content.trim()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
