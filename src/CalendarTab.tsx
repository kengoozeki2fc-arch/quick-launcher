// Outlook カレンダー連携タブ
// Phase 2.6+ で fetch ロジックを CalendarTab 内部に閉じる形にリファクタ
//   - 旧: App.tsx で events fetch → props で渡す
//   - 新: CalendarTab 内部で起動時+1時間ごとに events fetch・events 状態は内部で持つ
// Microsoft Graph + Authorization Code + PKCE（既存 Tauri start_oauth_flow コマンド使用）

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { CalendarSettings } from "./types";

const JST = "Asia/Tokyo";

export interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName: string };
}

// Graph API の dateTime は UTC だが 'Z' サフィックスなしで返るため付与して正しくパースする
export function toUtcDate(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

export function formatTime(iso: string): string {
  return toUtcDate(iso).toLocaleTimeString("ja-JP", {
    timeZone: JST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateLabel(d: Date): string {
  return d
    .toLocaleDateString("ja-JP", {
      timeZone: JST,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "/");
}

async function msGet(
  url: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_get", { url, accessToken });
  return JSON.parse(raw);
}

async function msPost(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_post", { url, params });
  return JSON.parse(raw);
}

type Props = {
  calendar: CalendarSettings | null;
  onCalendarChange: (s: CalendarSettings | null) => void;
};

export default function CalendarTab({ calendar, onCalendarChange }: Props) {
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(!calendar?.accessToken);
  const [tenantId, setTenantId] = useState(calendar?.tenantId ?? "");
  const [clientId, setClientId] = useState(calendar?.clientId ?? "");
  const [busy, setBusy] = useState(false);

  // 設定変更時に showSettings を自動で切替
  useEffect(() => {
    if (calendar?.accessToken) setShowSettings(false);
  }, [calendar?.accessToken]);

  // ============================================================
  // OAuth + Events fetch
  // ============================================================
  const refreshAccessToken = useCallback(
    async (s: CalendarSettings): Promise<CalendarSettings | null> => {
      try {
        const data = await msPost(
          `https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`,
          {
            client_id: s.clientId,
            grant_type: "refresh_token",
            refresh_token: s.refreshToken,
            scope: "Calendars.Read offline_access",
          },
        );
        if (data.access_token) {
          const updated: CalendarSettings = {
            ...s,
            accessToken: data.access_token as string,
            refreshToken: (data.refresh_token as string) ?? s.refreshToken,
            tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
          };
          onCalendarChange(updated);
          return updated;
        }
        return null;
      } catch {
        return null;
      }
    },
    [onCalendarChange],
  );

  const fetchEvents = useCallback(
    async (s: CalendarSettings) => {
      setLoading(true);
      setError(null);
      let cur = s;
      if (Date.now() > s.tokenExpiry - 5 * 60 * 1000) {
        const refreshed = await refreshAccessToken(s);
        if (!refreshed) {
          setError("トークンの更新に失敗しました。再接続してください。");
          setLoading(false);
          return;
        }
        cur = refreshed;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const afterTomorrow = new Date(today);
      afterTomorrow.setDate(afterTomorrow.getDate() + 2);
      try {
        const data = await msGet(
          `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${today.toISOString()}&endDateTime=${afterTomorrow.toISOString()}&$select=subject,start,end,isAllDay,location&$orderby=start/dateTime&$top=50`,
          cur.accessToken,
        );
        if (data.error) {
          const err = data.error as Record<string, unknown>;
          setError(`取得エラー: ${err.message ?? JSON.stringify(data.error)}`);
          setLoading(false);
          return;
        }
        const events = (data.value as CalendarEvent[]) ?? [];
        const todayStr = formatDateLabel(today);
        const tomorrowDate = new Date(today);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowStr = formatDateLabel(tomorrowDate);
        setTodayEvents(
          events.filter(
            (e) => formatDateLabel(toUtcDate(e.start.dateTime)) === todayStr,
          ),
        );
        setTomorrowEvents(
          events.filter(
            (e) => formatDateLabel(toUtcDate(e.start.dateTime)) === tomorrowStr,
          ),
        );
      } catch (err) {
        setError(`カレンダーの取得に失敗しました: ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [refreshAccessToken],
  );

  // 起動時 + 1時間ごとリフレッシュ
  const lastFetchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!calendar?.accessToken) {
      setTodayEvents([]);
      setTomorrowEvents([]);
      return;
    }
    // 同一トークンで重複fetchしないガード
    if (lastFetchRef.current === calendar.accessToken) return;
    lastFetchRef.current = calendar.accessToken;
    fetchEvents(calendar);
    const id = window.setInterval(() => fetchEvents(calendar), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [calendar, fetchEvents]);

  // ============================================================
  // OAuth: 接続/解除
  // ============================================================
  const handleConnect = useCallback(async () => {
    if (!tenantId.trim() || !clientId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await invoke<Record<string, unknown>>("start_oauth_flow", {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
      });
      if (!data.access_token) {
        setError("認証に失敗しました");
        return;
      }
      const s: CalendarSettings = {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
      };
      onCalendarChange(s);
      setShowSettings(false);
    } catch (e) {
      setError(`接続失敗: ${e}`);
    } finally {
      setBusy(false);
    }
  }, [tenantId, clientId, onCalendarChange]);

  const handleDisconnect = useCallback(() => {
    if (!confirm("Outlookカレンダー連携を解除しますか？")) return;
    onCalendarChange(null);
    setTodayEvents([]);
    setTomorrowEvents([]);
    lastFetchRef.current = null;
    setShowSettings(true);
  }, [onCalendarChange]);

  // ============================================================
  // 設定画面
  // ============================================================
  if (showSettings) {
    return (
      <div className="calendar-settings">
        <h3>📅 Outlookカレンダー連携</h3>
        <p className="hint">
          Microsoft Entra アプリ登録の Tenant ID と Client ID を入力して接続してください。
        </p>
        <div className="cal-form">
          <label>
            Tenant ID
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Client ID
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="cal-actions">
            <button
              onClick={handleConnect}
              disabled={busy || !tenantId.trim() || !clientId.trim()}
              className="primary-btn"
            >
              {busy ? "接続中…" : "🔐 接続（ブラウザでサインイン）"}
            </button>
            {calendar?.accessToken && (
              <>
                <button onClick={() => setShowSettings(false)}>キャンセル</button>
                <button onClick={handleDisconnect} className="warn-btn">
                  🔓 接続解除
                </button>
              </>
            )}
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  // ============================================================
  // 今日/明日 events 表示
  // ============================================================
  function renderEvent(e: CalendarEvent) {
    const loc = e.location?.displayName;
    const isLink =
      loc && /^https?:\/\//.test(loc.trim().split(/\s+/)[0] ?? "");
    return (
      <li key={e.id} className={`cal-event ${e.isAllDay ? "all-day" : ""}`}>
        <span className="cal-time">
          {e.isAllDay ? "終日" : formatTime(e.start.dateTime)}
        </span>
        <span className="cal-subject">{e.subject}</span>
        {loc && (
          <span className="cal-loc">
            📍{" "}
            {isLink ? (
              <a
                href="#"
                onClick={(ev) => {
                  ev.preventDefault();
                  shellOpen(loc.trim().split(/\s+/)[0]).catch(() => {});
                }}
              >
                {loc}
              </a>
            ) : (
              loc
            )}
          </span>
        )}
      </li>
    );
  }

  return (
    <div className="calendar-tab">
      <div className="cal-header">
        <button
          onClick={() => calendar && fetchEvents(calendar)}
          disabled={loading || !calendar}
          className="icon-btn-slim"
          title="再取得"
        >
          {loading ? "⏳" : "🔄"}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="icon-btn-slim"
          title="カレンダー設定"
        >
          ⚙
        </button>
      </div>

      {error && <div className="cal-error">⚠ {error}</div>}

      <h4>📌 今日（{formatDateLabel(new Date())}）</h4>
      <ul className="cal-list">
        {todayEvents.length === 0 ? (
          <li className="empty">予定なし</li>
        ) : (
          todayEvents.map(renderEvent)
        )}
      </ul>

      <h4>
        ➡ 明日（
        {(() => {
          const t = new Date();
          t.setDate(t.getDate() + 1);
          return formatDateLabel(t);
        })()}
        ）
      </h4>
      <ul className="cal-list">
        {tomorrowEvents.length === 0 ? (
          <li className="empty">予定なし</li>
        ) : (
          tomorrowEvents.map(renderEvent)
        )}
      </ul>
    </div>
  );
}
