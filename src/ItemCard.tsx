import { useState } from "react";
import type { LauncherItem } from "./types";


interface Props {
  item: LauncherItem;
  onOpen: (url: string) => void;
  onEdit: (item: LauncherItem) => void;
  onDelete: (id: string) => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      className={`copy-btn ${copied ? "copied" : ""}`}
      onClick={handleCopy}
      title="コピー"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

export default function ItemCard({ item, onOpen, onEdit, onDelete }: Props) {
  return (
    <div className="item-card">
      <div className="item-header">
        <a className="item-title" onClick={() => onOpen(item.url)} title={item.url}>
          {item.title}
        </a>
        <div className="item-actions">
          <button className="icon-btn" onClick={() => onEdit(item)} title="編集">
            ✏️
          </button>
          <button
            className="icon-btn danger"
            onClick={() => onDelete(item.id)}
            title="削除"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="item-row">
        <span className="item-label">URL</span>
        <span className="item-value">{item.url}</span>
        <CopyButton text={item.url} />
      </div>

      <div className="item-row">
        <span className="item-label">ID</span>
        <span className="item-value">{item.loginId}</span>
        <CopyButton text={item.loginId} />
      </div>

      <div className="item-row">
        <span className="item-label">PW</span>
        <span className="item-value">{item.password}</span>
        <CopyButton text={item.password} />
        <label className="otp-badge">
          <input type="checkbox" checked={item.otp} disabled />
          OTP
        </label>
      </div>
    </div>
  );
}
