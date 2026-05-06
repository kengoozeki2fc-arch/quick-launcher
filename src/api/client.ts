// Work Launcher V2 API クライアント（Tauri Frontend）
// 設計書: MyBrain/20_Projects/Work Launcher/設計書 v0.4 §4
//
// 設計:
//   - admin-console の /api/work-launcher/* を Bearer JWT で叩く
//   - Tauri webview から直 fetch すると CORS で弾かれるため tauri-plugin-http 経由
//   - 401 受領時は kc_token() で自動 refresh して 1回だけリトライ
//   - エラーは ApiError として投げる（status / body 同梱）

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { kcToken } from "../auth/keycloak";

const BASE_URL = "https://admin.id.kensetsu-total.support";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string,
  ) {
    super(message ?? `API ${status}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

export class NotLoggedInError extends Error {
  constructor() {
    super("not logged in");
    this.name = "NotLoggedInError";
  }
}

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function authFetch(path: string, init: FetchInit = {}): Promise<Response> {
  const token = await kcToken();
  if (!token) throw new NotLoggedInError();

  const headers: Record<string, string> = {
    ...(init.headers ?? {}),
    Authorization: `Bearer ${token.access_token}`,
  };
  if (init.body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }

  let res = await tauriFetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  // 401: refresh で再取得して 1回だけリトライ
  if (res.status === 401) {
    const fresh = await kcToken();
    if (fresh && fresh.access_token !== token.access_token) {
      headers.Authorization = `Bearer ${fresh.access_token}`;
      res = await tauriFetch(`${BASE_URL}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      });
    }
  }
  return res;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  // 204 No Content / 304 Not Modified
  if (res.status === 204 || res.status === 304) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ============================================================
// Public API
// ============================================================
export async function apiGet<T>(
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await authFetch(path, { method: "GET", headers: extraHeaders });
  return jsonOrThrow<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return jsonOrThrow<T>(res);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return jsonOrThrow<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await authFetch(path, { method: "DELETE" });
  return jsonOrThrow<T>(res);
}

/**
 * GET /api/work-launcher/config の差分取得用：If-None-Match ヘッダ付与で 304 を期待。
 * 戻り値は Response 直返し（caller 側で status 判定して 304 ならキャッシュ流用）。
 */
export async function apiGetWithEtag(
  path: string,
  etag: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (etag) headers["if-none-match"] = etag;
  return authFetch(path, { method: "GET", headers });
}
