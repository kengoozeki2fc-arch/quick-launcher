// LocalTab — Phase 2.5 で API/キャッシュベースに全面書き換え
// 旧 HTMLインポート機能・LocalSection/LocalLink 構造はすべて廃止
// データソース: useLauncherData の sections（LauncherSection[]・items 内包）

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  LauncherSection,
  LauncherItem,
  ItemTargetType,
} from "./api/types";

const COLORS = [
  "pink",
  "sky",
  "green",
  "orange",
  "violet",
  "yellow",
  "cyan",
  "rose",
] as const;

type Props = {
  sections: LauncherSection[];
  onCreateSection: (input: {
    name: string;
    type?: string;
    color?: string;
  }) => Promise<void>;
  onUpdateSection: (
    id: string,
    patch: Partial<{ name: string; color: string; type: string }>,
  ) => Promise<void>;
  onDeleteSection: (id: string) => Promise<void>;
  onCreateItem: (input: {
    sectionId: string;
    name: string;
    target: string;
    targetType?: ItemTargetType;
    icon?: string;
  }) => Promise<void>;
  onUpdateItem: (
    id: string,
    patch: Partial<{
      name: string;
      target: string;
      targetType: ItemTargetType;
      icon: string | null;
    }>,
  ) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onTouchItem: (id: string) => Promise<void>;
};

export default function LocalTab({
  sections,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onTouchItem,
}: Props) {
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionColor, setNewSectionColor] =
    useState<(typeof COLORS)[number]>("pink");
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleOpenItem(item: LauncherItem) {
    try {
      if (item.targetType === "URL") {
        await open(item.target);
      } else {
        await invoke("open_path", { path: item.target });
      }
      onTouchItem(item.id).catch(() => {});
    } catch (e) {
      console.error("open failed:", e);
    }
  }

  async function handleAddSection() {
    if (!newSectionName.trim()) return;
    setBusy(true);
    try {
      await onCreateSection({
        name: newSectionName.trim(),
        color: newSectionColor,
      });
      setNewSectionName("");
      setNewSectionColor("pink");
      setShowAddSection(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="local-tab">
      <div className="local-toolbar">
        {showAddSection ? null : (
          <button onClick={() => setShowAddSection(true)} className="add-btn">
            ＋ セクション追加
          </button>
        )}
      </div>

      {showAddSection && (
        <div className="local-add-section">
          <input
            type="text"
            placeholder="セクション名"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            disabled={busy}
          />
          <select
            value={newSectionColor}
            onChange={(e) =>
              setNewSectionColor(e.target.value as (typeof COLORS)[number])
            }
            disabled={busy}
          >
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddSection}
            disabled={busy || !newSectionName.trim()}
          >
            追加
          </button>
          <button
            onClick={() => {
              setShowAddSection(false);
              setNewSectionName("");
            }}
            disabled={busy}
          >
            キャンセル
          </button>
        </div>
      )}

      {sections.length === 0 ? (
        <p className="empty">
          セクションがまだありません。Web画面（admin-console）またはここから追加してください。
        </p>
      ) : (
        sections.map((sec) => (
          <SectionCard
            key={sec.id}
            section={sec}
            adding={adding === sec.id}
            onSetAdding={(b) => setAdding(b ? sec.id : null)}
            onUpdateSection={(patch) => onUpdateSection(sec.id, patch)}
            onDeleteSection={() => onDeleteSection(sec.id)}
            onCreateItem={(input) =>
              onCreateItem({ sectionId: sec.id, ...input })
            }
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            onOpenItem={handleOpenItem}
          />
        ))
      )}
    </div>
  );
}

// ============================================================
// SectionCard
// ============================================================
type SectionCardProps = {
  section: LauncherSection;
  adding: boolean;
  onSetAdding: (b: boolean) => void;
  onUpdateSection: (
    patch: Partial<{ name: string; color: string; type: string }>,
  ) => Promise<void>;
  onDeleteSection: () => Promise<void>;
  onCreateItem: (input: {
    name: string;
    target: string;
    targetType?: ItemTargetType;
    icon?: string;
  }) => Promise<void>;
  onUpdateItem: (
    id: string,
    patch: Partial<{
      name: string;
      target: string;
      targetType: ItemTargetType;
      icon: string | null;
    }>,
  ) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onOpenItem: (item: LauncherItem) => void;
};

function SectionCard({
  section,
  adding,
  onSetAdding,
  onUpdateSection,
  onDeleteSection,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onOpenItem,
}: SectionCardProps) {
  const [editingSection, setEditingSection] = useState(false);
  const [secName, setSecName] = useState(section.name);
  const [secColor, setSecColor] = useState<string>(section.color);
  const [busy, setBusy] = useState(false);

  // 新規アイテム入力
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newTargetType, setNewTargetType] = useState<ItemTargetType>("URL");
  const [newIcon, setNewIcon] = useState("");

  async function handleSelectFile() {
    try {
      const result = await openDialog({ multiple: false });
      if (result && typeof result === "string") {
        setNewTarget(result);
        setNewTargetType("FILE_LOCAL");
        if (!newName) {
          const base = result.split(/[/\\]/).pop() ?? result;
          setNewName(base);
        }
      }
    } catch (e) {
      console.error("file pick:", e);
    }
  }

  async function handleSaveSection() {
    setBusy(true);
    try {
      await onUpdateSection({ name: secName, color: secColor });
      setEditingSection(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddItem() {
    if (!newName.trim() || !newTarget.trim()) return;
    setBusy(true);
    try {
      await onCreateItem({
        name: newName.trim(),
        target: newTarget.trim(),
        targetType: newTargetType,
        icon: newIcon.trim() || undefined,
      });
      setNewName("");
      setNewTarget("");
      setNewIcon("");
      setNewTargetType("URL");
      onSetAdding(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSection() {
    if (
      !confirm(
        `セクション「${section.name}」と配下アイテム ${section.items.length}件 を削除しますか？`,
      )
    )
      return;
    setBusy(true);
    try {
      await onDeleteSection();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`local-section local-color-${section.color}`}>
      <div className="local-section-header">
        {editingSection ? (
          <>
            <input
              value={secName}
              onChange={(e) => setSecName(e.target.value)}
              disabled={busy}
            />
            <select
              value={secColor}
              onChange={(e) => setSecColor(e.target.value)}
              disabled={busy}
            >
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button onClick={handleSaveSection} disabled={busy}>
              保存
            </button>
            <button
              onClick={() => {
                setSecName(section.name);
                setSecColor(section.color);
                setEditingSection(false);
              }}
              disabled={busy}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <span className={`local-section-dot dot-${section.color}`} />
            <h3>{section.name}</h3>
            {section.isFromTemplate && (
              <span className="badge-template">テンプレ由来</span>
            )}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => setEditingSection(true)}
              title="セクション編集"
              className="icon-btn-slim"
            >
              ✎
            </button>
            <button
              onClick={() => onSetAdding(!adding)}
              title={adding ? "閉じる" : "アイテム追加"}
              className="icon-btn-slim"
            >
              {adding ? "✕" : "＋"}
            </button>
            <button
              onClick={handleDeleteSection}
              title="セクション削除"
              className="icon-btn-slim"
              disabled={busy}
            >
              🗑
            </button>
          </>
        )}
      </div>

      {section.items.length === 0 && !adding ? (
        <p className="empty-small">アイテムはまだありません</p>
      ) : (
        <ul className="local-items">
          {section.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onOpen={() => onOpenItem(item)}
              onUpdate={(patch) => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
            />
          ))}
        </ul>
      )}

      {adding && (
        <div className="local-add-item">
          <input
            placeholder="🔗"
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            maxLength={4}
            style={{ width: 40 }}
          />
          <input
            placeholder="名前"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            placeholder="URL or パス"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
          />
          <select
            value={newTargetType}
            onChange={(e) =>
              setNewTargetType(e.target.value as ItemTargetType)
            }
          >
            <option value="URL">URL</option>
            <option value="FILE_LOCAL">ファイル</option>
          </select>
          <button onClick={handleSelectFile} title="ファイル選択">
            📂
          </button>
          <button
            onClick={handleAddItem}
            disabled={busy || !newName.trim() || !newTarget.trim()}
          >
            追加
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ItemRow（インライン編集）
// ============================================================
function ItemRow({
  item,
  onOpen,
  onUpdate,
  onDelete,
}: {
  item: LauncherItem;
  onOpen: () => void;
  onUpdate: (
    patch: Partial<{
      name: string;
      target: string;
      targetType: ItemTargetType;
      icon: string | null;
    }>,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [target, setTarget] = useState(item.target);
  const [icon, setIcon] = useState(item.icon ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onUpdate({
        name: name.trim(),
        target: target.trim(),
        icon: icon.trim() || null,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`「${item.name}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="local-item editing">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          maxLength={4}
          style={{ width: 40 }}
        />
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <input value={target} onChange={(e) => setTarget(e.target.value)} />
        <button onClick={handleSave} disabled={busy}>
          保存
        </button>
        <button onClick={() => setEditing(false)} disabled={busy}>
          取消
        </button>
      </li>
    );
  }

  return (
    <li className="local-item">
      <button
        className="local-item-link"
        onClick={onOpen}
        title={item.target}
      >
        <span className="icon">
          {item.icon ?? (item.targetType === "URL" ? "🔗" : "📄")}
        </span>
        <span className="name">{item.name}</span>
      </button>
      <button
        onClick={() => setEditing(true)}
        className="icon-btn-slim"
        title="編集"
      >
        ✎
      </button>
      <button
        onClick={handleDelete}
        className="icon-btn-slim"
        title="削除"
        disabled={busy}
      >
        🗑
      </button>
    </li>
  );
}
