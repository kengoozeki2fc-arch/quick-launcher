// Keycloak Pattern D 認証クライアント（Frontend）
// 設計書: MyBrain/20_Projects/Work Launcher/設計書 v0.4
// ガイドライン: 統合認証組込みガイドライン v1.3 §6-1

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix秒
  id_token?: string | null;
  email?: string | null;
};

/**
 * ブラウザを開いてログイン flow を開始。
 * 完了は onLoginSuccess() で受領（deep-link 経由）。
 */
export async function kcLogin(): Promise<void> {
  await invoke("kc_login");
}

/**
 * アプリ起動時に呼ぶ：Keychain の refresh_token で無音再認証。
 * - 成功: TokenSet 返却
 * - 失敗（rt無し or revoke済）: null
 */
export async function kcSilentLogin(): Promise<TokenSet | null> {
  return await invoke<TokenSet | null>("kc_silent_login");
}

/**
 * 有効な access_token を取得。期限切れなら自動で refresh。
 */
export async function kcToken(): Promise<TokenSet | null> {
  return await invoke<TokenSet | null>("kc_token");
}

/**
 * ログアウト：サーバ通知 + Keychain削除 + メモリクリア
 */
export async function kcLogout(): Promise<void> {
  await invoke("kc_logout");
}

/**
 * deep-link callback で認証完了したときの通知を受ける。
 * 戻り値は unlisten 関数。
 */
export function onLoginSuccess(
  cb: (ts: TokenSet) => void,
): () => void {
  let unlisten: UnlistenFn | null = null;
  listen<TokenSet>("kc-login-success", (event) => cb(event.payload)).then(
    (fn) => {
      unlisten = fn;
    },
  );
  return () => {
    unlisten?.();
  };
}
