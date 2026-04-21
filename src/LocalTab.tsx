import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LocalSection, LocalLink, LocalImportSource } from "./types";

const SECTION_COLORS = [
  { bg: "#fde4ec", border: "#f48fb1", label: "#880e4f" }, // pink
  { bg: "#e1f5fe", border: "#81d4fa", label: "#01579b" }, // sky
  { bg: "#e8f5e9", border: "#a5d6a7", label: "#1b5e20" }, // green
  { bg: "#fff4e6", border: "#ffcc80", label: "#e65100" }, // orange
  { bg: "#ede7f6", border: "#b39ddb", label: "#311b92" }, // violet
  { bg: "#fff9c4", border: "#fff176", label: "#827717" }, // yellow
  { bg: "#e0f7fa", border: "#80deea", label: "#006064" }, // cyan
  { bg: "#fce4ec", border: "#f8bbd0", label: "#ad1457" }, // rose
];

const DEFAULT_WIN_BASE = "C:/Users/y-takahashi/MyBrain/";
const DEFAULT_MAC_BASE =
  "/Users/kengoozeki/Library/CloudStorage/OneDrive-クラウドパワー株式会社/MyBrain/";

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function percentDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function fileUrlToPath(href: string): string {
  if (!href.startsWith("file://")) return href;
  let p = href.replace(/^file:\/\//, "");
  // file:///C:/... の先頭スラッシュを外す
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return percentDecode(p);
}

function applyBaseReplace(path: string, from: string, to: string): string {
  if (!from) return path;
  if (path.startsWith(from)) return to + path.slice(from.length);
  return path;
}

function parseHtmlImport(
  html: string,
  winBase: string,
  macBase: string
): LocalSection[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections: LocalSection[] = [];
  doc.querySelectorAll("div.section, .section").forEach((sec) => {
    const h2 = sec.querySelector("h2");
    const title = (h2?.textContent ?? "無題").trim();
    const links: LocalLink[] = [];
    sec.querySelectorAll("a[href]").forEach((a) => {
      const href = (a.getAttribute("href") ?? "").trim();
      if (!href) return;
      const rawPath = fileUrlToPath(href);
      const path = applyBaseReplace(rawPath, winBase, macBase);
      const label = (a.textContent ?? path).trim() || path;
      links.push({ id: newId(), label, path });
    });
    if (links.length > 0) {
      sections.push({ id: newId(), title, links });
    }
  });
  return sections;
}

interface Props {
  sections: LocalSection[];
  onSectionsChange: (next: LocalSection[]) => void;
  importSource: LocalImportSource | undefined;
  onImportSourceChange: (next: LocalImportSource | undefined) => void;
}

export default function LocalTab({
  sections,
  onSectionsChange,
  importSource,
  onImportSourceChange,
}: Props) {
  const [showImport, setShowImport] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [adding, setAdding] = useState<{ sectionId: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const handleOpen = async (path: string) => {
    try {
      await invoke("open_path", { path });
    } catch (e) {
      alert(`開けませんでした: ${e}`);
    }
  };

  const handleDeleteLink = (sectionId: string, linkId: string) => {
    onSectionsChange(
      sections.map((s) =>
        s.id === sectionId
          ? { ...s, links: s.links.filter((l) => l.id !== linkId) }
          : s
      )
    );
  };

  const handleDeleteSection = (sectionId: string) => {
    if (!confirm("このセクションを削除しますか？")) return;
    onSectionsChange(sections.filter((s) => s.id !== sectionId));
  };

  const handleImport = (
    imported: LocalSection[],
    source: LocalImportSource | null,
    mode: "append" | "replace"
  ) => {
    if (mode === "replace") {
      onSectionsChange(imported);
    } else {
      onSectionsChange([...sections, ...imported]);
    }
    if (source) onImportSourceChange(source);
  };

  const handleRefresh = async () => {
    if (!importSource?.htmlPath) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const raw = await invoke<string>("read_file_abs", { path: importSource.htmlPath });
      if (!raw) {
        setRefreshMsg(`ファイルが空です: ${importSource.htmlPath}`);
        return;
      }
      const parsed = parseHtmlImport(raw, importSource.winBase, importSource.macBase);
      if (parsed.length === 0) {
        setRefreshMsg("セクションが見つかりませんでした");
        return;
      }
      onSectionsChange(parsed);
      setRefreshMsg(`✅ 更新しました（${parsed.length} セクション）`);
      setTimeout(() => setRefreshMsg(null), 3000);
    } catch (e) {
      setRefreshMsg(`更新失敗: ${e}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddSection = (title: string) => {
    onSectionsChange([...sections, { id: newId(), title, links: [] }]);
  };

  const handleAddLink = (sectionId: string, label: string, path: string) => {
    onSectionsChange(
      sections.map((s) =>
        s.id === sectionId
          ? { ...s, links: [...s.links, { id: newId(), label, path }] }
          : s
      )
    );
  };

  return (
    <div className="local-tab">
      <div className="local-toolbar">
        <button className="icon-btn" onClick={() => setShowImport(true)}>
          📥 HTMLインポート
        </button>
        <button
          className="icon-btn"
          onClick={handleRefresh}
          disabled={!importSource?.htmlPath || refreshing}
          title={
            importSource?.htmlPath
              ? `${importSource.htmlPath} から再読み込み（既存セクションを上書き）`
              : "インポート時にHTMLファイルパスを指定すると更新できます"
          }
        >
          {refreshing ? "⏳ 更新中…" : "🔄 ファイル更新"}
        </button>
        <button className="icon-btn" onClick={() => setShowAddSection(true)}>
          ＋ セクション追加
        </button>
      </div>
      {refreshMsg && (
        <div style={{ fontSize: 11, opacity: 0.8 }}>{refreshMsg}</div>
      )}
      {importSource?.htmlPath && (
        <div style={{ fontSize: 10, opacity: 0.6 }}>
          参照: {importSource.htmlPath}
        </div>
      )}

      {sections.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32 }}>📁</p>
          <p>ローカルファイル/フォルダを登録できます</p>
          <p style={{ fontSize: 11, opacity: 0.7 }}>
            「📥 HTMLインポート」でMyBrain_ナビ.html風のHTMLを取り込めます
          </p>
        </div>
      ) : (
        sections.map((section, idx) => {
          const palette = SECTION_COLORS[idx % SECTION_COLORS.length];
          return (
            <div
              key={section.id}
              className="local-section"
              style={{
                background: palette.bg,
                borderLeft: `4px solid ${palette.border}`,
              }}
            >
              <div className="local-section-head">
                <div
                  className="local-section-title"
                  style={{ color: palette.label }}
                >
                  {section.title}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    className="icon-btn icon-btn-slim"
                    onClick={() => setAdding({ sectionId: section.id })}
                    title="ボタンを追加"
                  >
                    ＋
                  </button>
                  <button
                    className="icon-btn icon-btn-slim"
                    onClick={() => handleDeleteSection(section.id)}
                    title="セクション削除"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="local-grid">
                {section.links.length === 0 ? (
                  <span className="local-empty">（空）</span>
                ) : (
                  section.links.map((link) => (
                    <div
                      key={link.id}
                      className="local-btn"
                      style={{
                        background: "#ffffff",
                        border: `1px solid ${palette.border}`,
                      }}
                    >
                      <button
                        className="local-btn-label"
                        onClick={() => handleOpen(link.path)}
                        title={link.path}
                      >
                        {link.label}
                      </button>
                      <button
                        className="local-btn-del"
                        onClick={() =>
                          handleDeleteLink(section.id, link.id)
                        }
                        title="削除"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })
      )}

      {showImport && (
        <ImportModal
          initial={importSource}
          onClose={() => setShowImport(false)}
          onImport={(s, source, mode) => {
            handleImport(s, source, mode);
            setShowImport(false);
          }}
        />
      )}

      {showAddSection && (
        <AddSectionModal
          onClose={() => setShowAddSection(false)}
          onAdd={(title) => {
            handleAddSection(title);
            setShowAddSection(false);
          }}
        />
      )}

      {adding && (
        <AddLinkModal
          onClose={() => setAdding(null)}
          onAdd={(label, path) => {
            handleAddLink(adding.sectionId, label, path);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  initial,
  onClose,
  onImport,
}: {
  initial: LocalImportSource | undefined;
  onClose: () => void;
  onImport: (
    s: LocalSection[],
    source: LocalImportSource | null,
    mode: "append" | "replace"
  ) => void;
}) {
  const [html, setHtml] = useState("");
  const [htmlPath, setHtmlPath] = useState(initial?.htmlPath ?? "");
  const [winBase, setWinBase] = useState(initial?.winBase ?? DEFAULT_WIN_BASE);
  const [macBase, setMacBase] = useState(initial?.macBase ?? DEFAULT_MAC_BASE);
  const [mode, setMode] = useState<"append" | "replace">("replace");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoadFile = async () => {
    if (!htmlPath.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const raw = await invoke<string>("read_file_abs", { path: htmlPath.trim() });
      if (!raw) {
        setError("ファイルが空または見つかりません");
        return;
      }
      setHtml(raw);
    } catch (e) {
      setError(`読み込み失敗: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    try {
      const parsed = parseHtmlImport(html, winBase, macBase);
      if (parsed.length === 0) {
        setError("セクションが見つかりませんでした（div.section > h2 + a）");
        return;
      }
      const source: LocalImportSource | null = htmlPath.trim()
        ? { htmlPath: htmlPath.trim(), winBase, macBase }
        : null;
      onImport(parsed, source, mode);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>📥 HTMLインポート</h2>

        <div className="form-group">
          <label>HTMLファイルパス（任意・指定すると「🔄 ファイル更新」で再読み込み可）</label>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={htmlPath}
              onChange={(e) => setHtmlPath(e.target.value)}
              placeholder="/Users/.../MyBrain_ナビ.html"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={handleLoadFile}
              disabled={!htmlPath.trim() || loading}
            >
              {loading ? "⏳" : "読込"}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>HTMLソース（貼り付けでもOK）</label>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={6}
            placeholder={"<div class=\"section\">...</div>"}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }}
          />
        </div>

        <div className="form-group">
          <label>パス置換（Windows → Mac）</label>
          <input
            value={winBase}
            onChange={(e) => setWinBase(e.target.value)}
            placeholder="From (Windows base)"
          />
          <input
            value={macBase}
            onChange={(e) => setMacBase(e.target.value)}
            placeholder="To (Mac base)"
            style={{ marginTop: 4 }}
          />
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
            空欄なら置換なし。From で始まるパスだけ To に書き換えます
          </div>
        </div>

        <div className="form-group">
          <label>取り込み方法</label>
          <div className="theme-grid">
            <button
              type="button"
              className={`theme-btn ${mode === "append" ? "active" : ""}`}
              onClick={() => setMode("append")}
            >
              既存に追加
            </button>
            <button
              type="button"
              className={`theme-btn ${mode === "replace" ? "active" : ""}`}
              onClick={() => setMode("replace")}
            >
              既存を置換
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: "#c00", fontSize: 11, marginTop: 8 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-save" onClick={handleImport}>
            インポート
          </button>
          <button type="button" className="btn-cancel" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

function AddSectionModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>＋ セクション追加</h2>
        <div className="form-group">
          <label>セクションタイトル</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 🗂 フォルダを開く"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-save"
            disabled={!title.trim()}
            onClick={() => onAdd(title.trim())}
          >
            追加
          </button>
          <button type="button" className="btn-cancel" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

function AddLinkModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (label: string, path: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>＋ ボタン追加</h2>
        <div className="form-group">
          <label>ラベル</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: CP カルテ一覧"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>パス（ファイル or フォルダの絶対パス）</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/.../MyBrain/..."
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-save"
            disabled={!label.trim() || !path.trim()}
            onClick={() => onAdd(label.trim(), path.trim())}
          >
            追加
          </button>
          <button type="button" className="btn-cancel" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
