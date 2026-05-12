// Work Launcher V2 サイトタブ（v0.7.4 互換 UI）
// - URL系セクション配下のアイテムをフラット表示
// - 検索バー＋「全N件」＋ページング
// - カード型: タイトル赤 / URL・ID・PW 3行 / 各行コピー / PW行 OTPバッジ / 編集・削除

import { useState, useMemo, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { LauncherSection, LauncherItem } from "./api/types";

const PAGE_SIZE = 5;

interface Props {
  sections: LauncherSection[];
  showAddModal: boolean;
  onCloseAddModal: () => void;
  onCreateSection: (input: {
    name: string;
    type?: string;
    color?: string;
  }) => Promise<void>;
  onCreateItem: (input: {
    sectionId: string;
    name: string;
    target: string;
    targetType?: "URL" | "FILE_LOCAL";
    icon?: string;
    loginId?: string | null;
    password?: string | null;
    hasOtp?: boolean;
  }) => Promise<void>;
  onUpdateItem: (
    id: string,
    patch: Partial<{
      name: string;
      target: string;
      loginId: string | null;
      password: string | null;
      hasOtp: boolean;
    }>,
  ) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onTouchItem: (id: string) => Promise<void>;
}

type SiteRow = LauncherItem & { sectionId: string };

export default function SitesTab({
  sections,
  showAddModal,
  onCloseAddModal,
  onCreateSection,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onTouchItem,
}: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // URL系セクションのアイテムを flat化（複数 URL section がある場合は全部結合）
  const allItems: SiteRow[] = useMemo(() => {
    const out: SiteRow[] = [];
    for (const s of sections) {
      if (s.type !== "URL") continue;
      for (const it of s.items) {
        out.push({ ...it, sectionId: s.id });
      }
    }
    return out;
  }, [sections]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.target.toLowerCase().includes(q) ||
        (i.loginId ?? "").toLowerCase().includes(q),
    );
  }, [allItems, search]);

  // 検索でページリセット
  useEffect(() => {
    setPage(1);
  }, [search]);

  // 親からの「+ 追加」モーダル開閉
  useEffect(() => {
    if (showAddModal) setShowCreateModal(true);
  }, [showAddModal]);
  useEffect(() => {
    if (!showCreateModal) onCloseAddModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreateModal]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const urlSection = sections.find((s) => s.type === "URL");

  const handleOpen = async (url: string, id: string) => {
    try {
      await open(url);
      onTouchItem(id).catch(() => {});
    } catch (e) {
      console.error("open failed", e);
      window.open(url, "_blank");
    }
  };

  const handleCreate = async (data: ItemFormData) => {
    let sectionId = urlSection?.id;
    if (!sectionId) {
      // 初回：URL系セクションが無ければ自動作成（"サイト"）
      await onCreateSection({ name: "サイト", type: "URL", color: "pink" });
      // 楽観反映後の sections は次回 render で来るので、ここでは create を即発火できない
      // → ユーザーには「セクションを作成しました。再度＋追加してください」と通知でOK
      setShowCreateModal(false);
      return;
    }
    await onCreateItem({
      sectionId,
      name: data.name,
      target: data.target,
      targetType: "URL",
      loginId: data.loginId || null,
      password: data.password || null,
      hasOtp: data.hasOtp,
    });
    setShowCreateModal(false);
  };

  const handleUpdate = async (data: ItemFormData) => {
    if (!editing) return;
    await onUpdateItem(editing.id, {
      name: data.name,
      target: data.target,
      loginId: data.loginId || null,
      password: data.password || null,
      hasOtp: data.hasOtp,
    });
    setEditing(null);
  };

  return (
    <>
      {/* 検索バー */}
      <div className="search-bar">
        <input
          type="text"
          placeholder="検索（タイトル・URL・ID）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")}>
            ✕
          </button>
        )}
      </div>

      <div className="status-bar">
        全 {filtered.length} 件
        {search && ` （${allItems.length} 件中）`}
      </div>

      {pageItems.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>🚀</p>
          <p>
            {search
              ? "該当するサービスがありません"
              : "「＋ 追加」からサイトを登録しよう"}
          </p>
        </div>
      ) : (
        <>
          <div className="item-list">
            {pageItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onOpen={() => handleOpen(item.target, item.id)}
                onEdit={() => setEditing(item)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                disabled={currentPage === 1}
                onClick={() => setPage(1)}
              >
                最初
              </button>
              <button
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                前へ
              </button>
              <span className="page-info">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                次へ
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage(totalPages)}
              >
                最後
              </button>
            </div>
          )}
        </>
      )}

      {showCreateModal && (
        <ItemEditModal
          item={null}
          onSave={handleCreate}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
      {editing && (
        <ItemEditModal
          item={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ============================================================
// ItemCard
// ============================================================
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
  };
  return (
    <button
      className={`copy-btn ${copied ? "copied" : ""}`}
      onClick={handleCopy}
      title="コピー"
      disabled={!text}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

interface ItemCardProps {
  item: SiteRow;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ItemCard({ item, onOpen, onEdit, onDelete }: ItemCardProps) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="item-card">
      <div className="item-header">
        <a className="item-title" onClick={onOpen} title={item.target}>
          {item.name}
        </a>
        <div className="item-actions">
          <button className="icon-btn" onClick={onEdit} title="編集">
            ✏️
          </button>
          <button
            className="icon-btn danger"
            onClick={() => {
              if (confirm(`「${item.name}」を削除しますか？`)) onDelete();
            }}
            title="削除"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="item-row">
        <span className="item-label">URL</span>
        <span className="item-value">{item.target}</span>
        <CopyButton text={item.target} />
      </div>

      {/* ID 行：常に表示。値があれば値、なければ薄字で「（未設定）」 */}
      <div className="item-row">
        <span className="item-label">ID</span>
        <span
          className="item-value"
          style={!item.loginId ? { opacity: 0.4 } : undefined}
        >
          {item.loginId || "（未設定）"}
        </span>
        <CopyButton text={item.loginId ?? ""} />
      </div>

      {/* PW 行：常に表示。値があればマスク表示＋表示切替、なければ薄字で「（未設定）」 */}
      <div className="item-row">
        <span className="item-label">PW</span>
        <span
          className="item-value"
          style={!item.password ? { opacity: 0.4 } : undefined}
        >
          {item.password
            ? showPw
              ? item.password
              : "••••••••"
            : "（未設定）"}
          {item.password && (
            <button
              onClick={() => setShowPw((v) => !v)}
              className="pw-toggle"
              title={showPw ? "隠す" : "表示"}
            >
              {showPw ? "🙈" : "👁"}
            </button>
          )}
        </span>
        <CopyButton text={item.password ?? ""} />
        <label className="otp-badge">
          <input
            type="checkbox"
            checked={!!item.hasOtp}
            disabled
            readOnly
          />
          OTP
        </label>
      </div>
    </div>
  );
}

// ============================================================
// 追加・編集モーダル
// ============================================================
type ItemFormData = {
  name: string;
  target: string;
  loginId: string;
  password: string;
  hasOtp: boolean;
};

interface ItemEditModalProps {
  item: SiteRow | null;
  onSave: (data: ItemFormData) => Promise<void>;
  onCancel: () => void;
}

function ItemEditModal({ item, onSave, onCancel }: ItemEditModalProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [target, setTarget] = useState(item?.target ?? "");
  const [loginId, setLoginId] = useState(item?.loginId ?? "");
  const [password, setPassword] = useState(item?.password ?? "");
  const [hasOtp, setHasOtp] = useState(item?.hasOtp ?? false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !target.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        target: target.trim(),
        loginId,
        password,
        hasOtp,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{item ? "サイトを編集" : "サイトを追加"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>タイトル *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>URL *</label>
            <input
              type="url"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label>ログインID</label>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} />
          </div>
          <div className="form-group">
            <label>パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="otp-row">
              <input
                type="checkbox"
                checked={hasOtp}
                onChange={(e) => setHasOtp(e.target.checked)}
              />
              OTPワンタイムパスワード併用
            </label>
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
