import { useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { LauncherItem } from "./types";
import ItemCard from "./ItemCard";
import EditModal from "./EditModal";

const STORAGE_KEY = "quick-launcher-items";

function loadItems(): LauncherItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveItems(items: LauncherItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function App() {
  const [items, setItems] = useState<LauncherItem[]>(loadItems);
  const [editingItem, setEditingItem] = useState<LauncherItem | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    saveItems(items);
  }, [items]);

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

  return (
    <div className="app">
      <div className="header">
        <h1>Quick Launcher</h1>
        <button className="add-btn" onClick={handleAdd}>
          + 追加
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>🚀</p>
          <p>「+ 追加」からサービスを登録しよう</p>
        </div>
      ) : (
        <div className="item-list">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onOpen={handleOpen}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

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
