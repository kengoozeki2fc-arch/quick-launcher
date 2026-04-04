import { useState } from "react";
import type { LauncherItem } from "./types";

interface Props {
  item: LauncherItem | null;
  onSave: (item: LauncherItem) => void;
  onCancel: () => void;
}

export default function EditModal({ item, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [loginId, setLoginId] = useState(item?.loginId ?? "");
  const [password, setPassword] = useState(item?.password ?? "");
  const [otp, setOtp] = useState(item?.otp ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: item?.id ?? crypto.randomUUID(),
      title,
      url,
      loginId,
      password,
      otp,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{item ? "編集" : "新規追加"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>タイトル</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="GitHub"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com"
              required
            />
          </div>
          <div className="form-group">
            <label>ログインID</label>
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label>パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <div className="form-group form-checkbox">
            <label>
              <input
                type="checkbox"
                checked={otp}
                onChange={(e) => setOtp(e.target.checked)}
              />
              OTP（ワンタイムパスワード）
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onCancel}>
              キャンセル
            </button>
            <button type="submit" className="btn-save">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
