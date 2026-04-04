import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { readTextFile, writeTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { LauncherItem } from "./types";
import ItemCard from "./ItemCard";
import EditModal from "./EditModal";

const DATA_FILE = "quick-launcher-data.json";
const PAGE_SIZE = 5;

async function loadItemsFromFile(): Promise<LauncherItem[]> {
  try {
    const fileExists = await exists(DATA_FILE, { baseDir: BaseDirectory.Desktop });
    if (!fileExists) return [];
    const raw = await readTextFile(DATA_FILE, { baseDir: BaseDirectory.Desktop });
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveItemsToFile(items: LauncherItem[]) {
  await writeTextFile(DATA_FILE, JSON.stringify(items, null, 2), {
    baseDir: BaseDirectory.Desktop,
  });
}

export default function App() {
  const [items, setItems] = useState<LauncherItem[]>([]);
  const [editingItem, setEditingItem] = useState<LauncherItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const loaded = useRef(false);

  // 起動時にデスクトップのJSONを読み込み
  useEffect(() => {
    loadItemsFromFile().then((data) => {
      setItems(data);
      loaded.current = true;
    });
  }, []);

  // データ変更時にデスクトップに自動保存
  useEffect(() => {
    if (loaded.current) {
      saveItemsToFile(items);
    }
  }, [items]);

  // 検索でページをリセット
  useEffect(() => {
    setPage(1);
  }, [search]);

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

  return (
    <div className="app">
      <div className="header">
        <h1>Quick Launcher</h1>
        <button className="add-btn" onClick={handleAdd}>
          + 追加
        </button>
      </div>

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
              <button disabled={currentPage === 1} onClick={() => setPage(1)}>
                最初
              </button>
              <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                前へ
              </button>
              <span className="page-info">
                {currentPage} / {totalPages}
              </span>
              <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                次へ
              </button>
              <button disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>
                最後
              </button>
            </div>
          )}
        </>
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
