// Work Launcher V2 ローカルキャッシュ
// 設計書: MyBrain/20_Projects/Work Launcher/設計書 v0.4 §4-3
//
// 動作:
//   - 起動時: loadCache() でディスクから前回キャッシュ復元
//   - 起動直後: syncWithServer() で最新を fetch（差分は ETag）
//   - 5分おき: syncWithServer() を再実行（304 ならキャッシュ流用）
//   - 編集操作後: 楽観的UI更新 → API送信 → 成功なら updateCache()
//   - ログアウト時: clearCache()

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { apiGetWithEtag } from "../api/client";
import type { LauncherConfig } from "../api/types";

const CACHE_DIR = "work-launcher";
const CACHE_FILE = `${CACHE_DIR}/cache.json`;
const FS_OPTS = { baseDir: BaseDirectory.AppLocalData } as const;

export type CachedConfig = LauncherConfig & {
  fetchedAt: number; // 取得時刻 (unix ms)
};

// ============================================================
// I/O
// ============================================================

/**
 * 起動時にディスクから前回キャッシュを読む。
 * 無い・壊れてる場合は null（呼び出し側でサーバ取得 fallback）。
 */
export async function loadCache(): Promise<CachedConfig | null> {
  try {
    if (!(await exists(CACHE_FILE, FS_OPTS))) return null;
    const text = await readTextFile(CACHE_FILE, FS_OPTS);
    const parsed = JSON.parse(text) as CachedConfig;
    if (typeof parsed.etag !== "string" || !Array.isArray(parsed.sections)) {
      // 壊れた構造
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn("[cache] loadCache failed:", e);
    return null;
  }
}

async function ensureDir(): Promise<void> {
  if (!(await exists(CACHE_DIR, FS_OPTS))) {
    await mkdir(CACHE_DIR, { ...FS_OPTS, recursive: true });
  }
}

/**
 * config を丸ごと保存（API 200受領時）。
 */
export async function saveCache(config: LauncherConfig): Promise<CachedConfig> {
  await ensureDir();
  const data: CachedConfig = { ...config, fetchedAt: Date.now() };
  await writeTextFile(CACHE_FILE, JSON.stringify(data), FS_OPTS);
  return data;
}

/**
 * ログアウト時のキャッシュ削除。
 */
export async function clearCache(): Promise<void> {
  try {
    if (await exists(CACHE_FILE, FS_OPTS)) {
      await remove(CACHE_FILE, FS_OPTS);
    }
  } catch (e) {
    console.warn("[cache] clearCache failed:", e);
  }
}

// ============================================================
// 同期
// ============================================================

export type SyncResult =
  | { kind: "unchanged"; cached: CachedConfig | null }
  | { kind: "updated"; cached: CachedConfig }
  | { kind: "error"; error: Error };

/**
 * サーバから差分取得（If-None-Match 付き）。
 *  - 304: キャッシュ無更新（unchanged）
 *  - 200: 新版を保存（updated）
 *  - 例外: error 包んで返す（呼び出し側でログ・通知）
 */
export async function syncWithServer(
  currentEtag: string | null,
): Promise<SyncResult> {
  try {
    const res = await apiGetWithEtag(
      "/api/work-launcher/config",
      currentEtag,
    );
    if (res.status === 304) {
      const cached = await loadCache();
      return { kind: "unchanged", cached };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        kind: "error",
        error: new Error(`config sync ${res.status}: ${body.slice(0, 200)}`),
      };
    }
    const config = (await res.json()) as LauncherConfig;
    const saved = await saveCache(config);
    return { kind: "updated", cached: saved };
  } catch (e) {
    return {
      kind: "error",
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

/**
 * 既存キャッシュに対して部分更新（編集操作の楽観的反映に使う）。
 * etag は変えない（次回 sync で取り直す）。
 */
export async function updateCache(
  patch: (current: LauncherConfig) => LauncherConfig,
): Promise<CachedConfig | null> {
  const current = await loadCache();
  if (!current) return null;
  const next = patch(current);
  return saveCache(next);
}
