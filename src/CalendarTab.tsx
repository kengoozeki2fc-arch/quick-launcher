import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";

const CAL_FILE = "quick-launcher-calendar.json";

async function msGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_get", { url, accessToken });
  return JSON.parse(raw);
}

async function msPost(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_post", { url, params });
  return JSON.parse(raw);
}

async function loadCalSettings(): Promise<CalendarSettings | null> {
  try {
    const fileExists = await exists(CAL_FILE, { baseDir: BaseDirectory.Desktop });
    if (!fileExists) return null;
    const raw = await readTextFile(CAL_FILE, { baseDir: BaseDirectory.Desktop });
    const data = JSON.parse(raw);
    return data.accessToken ? data : null;
  } catch {
    return null;
  }
}

async function saveCalSettings(s: CalendarSettings) {
  await writeTextFile(CAL_FILE, JSON.stringify(s, null, 2), {
    baseDir: BaseDirectory.Desktop,
  });
}

interface CalendarSettings {
  tenantId: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName: string };
}

const JST = "Asia/Tokyo";

// Graph API の dateTime は UTC だが 'Z' サフィックスなしで返るため付与して正しくパースする
function toUtcDate(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function formatTime(iso: string): string {
  return toUtcDate(iso).toLocaleTimeString("ja-JP", {
    timeZone: JST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "/");
}

export default function CalendarTab() {
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  // 起動時にファイルから読み込み
  useEffect(() => {
    loadCalSettings().then((s) => {
      if (s?.accessToken) {
        setSettings(s);
        setTenantId(s.tenantId);
        setClientId(s.clientId);
        setShowSettings(false);
      } else {
        setShowSettings(true);
      }
      setLoaded(true);
    });
  }, []);

  const refreshAccessToken = useCallback(async (s: CalendarSettings): Promise<CalendarSettings | null> => {
    try {
      const data = await msPost(
        `https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`,
        {
          client_id: s.clientId,
          grant_type: "refresh_token",
          refresh_token: s.refreshToken,
          scope: "Calendars.Read offline_access",
        }
      );
      if (data.access_token) {
        const updated: CalendarSettings = {
          ...s,
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) ?? s.refreshToken,
          tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
        };
        saveCalSettings(updated).catch(() => {});
        setSettings(updated);
        return updated;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const fetchEvents = useCallback(async (s: CalendarSettings) => {
    setLoading(true);
    setCalError(null);

    let cur = s;
    if (Date.now() > s.tokenExpiry - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(s);
      if (!refreshed) {
        setCalError("トークンの更新に失敗しました。再接続してください。");
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
        cur.accessToken
      );

      if (data.error) {
        const err = data.error as Record<string, unknown>;
        setCalError(`取得エラー: ${err.message ?? JSON.stringify(data.error)}`);
        setLoading(false);
        return;
      }

      const events = (data.value as CalendarEvent[]) ?? [];
      const todayStr = formatDateLabel(today);
      const tomorrowDate = new Date(today);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = formatDateLabel(tomorrowDate);

      setTodayEvents(events.filter((e) => formatDateLabel(toUtcDate(e.start.dateTime)) === todayStr));
      setTomorrowEvents(events.filter((e) => formatDateLabel(toUtcDate(e.start.dateTime)) === tomorrowStr));
    } catch (err) {
      setCalError(`カレンダーの取得に失敗しました: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [refreshAccessToken]);

  useEffect(() => {
    if (loaded && settings?.accessToken && !showSettings) {
      fetchEvents(settings);
    }
  }, [loaded, settings, showSettings, fetchEvents]);

  const handleConnect = async () => {
    if (!tenantId || !clientId) return;
    setAuthError(null);
    setConnecting(true);

    try {
      // Rustのstart_oauth_flowを呼ぶ（PKCEフロー）
      const raw = await invoke<string>("start_oauth_flow", {
        tenantId,
        clientId,
      });
      const data = JSON.parse(raw);

      if (data.error) {
        setAuthError(`認証エラー: ${data.error_description ?? data.error}`);
        return;
      }

      if (data.access_token) {
        const newSettings: CalendarSettings = {
          tenantId,
          clientId,
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) ?? "",
          tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
        };
        setSettings(newSettings);
        setShowSettings(false);
        saveCalSettings(newSettings).catch(() => {});
      } else {
        setAuthError("トークンの取得に失敗しました");
      }
    } catch (err) {
      setAuthError(`接続に失敗しました: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await saveCalSettings({ tenantId: "", clientId: "", accessToken: "", refreshToken: "", tokenExpiry: 0 });
    setSettings(null);
    setTodayEvents([]);
    setTomorrowEvents([]);
    setShowSettings(true);
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (!loaded) {
    return <div className="tab-content"><div className="cal-empty">読み込み中...</div></div>;
  }

  if (showSettings) {
    return (
      <div className="tab-content">
        <div className="cal-settings-header">
          <h3 className="cal-section-title">Outlookカレンダー接続設定</h3>
          {settings?.accessToken && (
            <button className="icon-btn" onClick={() => setShowSettings(false)}>← 戻る</button>
          )}
        </div>

        <div className="form-group">
          <label>テナントID（Directory ID）</label>
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <div className="form-group">
          <label>クライアントID（Application ID）</label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>

        {authError && <div className="cal-error">{authError}</div>}

        <button
          className="btn-save cal-connect-btn"
          onClick={handleConnect}
          disabled={!tenantId || !clientId || connecting}
        >
          {connecting ? "ブラウザで認証中... （完了するとアプリに戻ります）" : "Outlookに接続"}
        </button>

        {settings?.accessToken && (
          <button className="icon-btn danger cal-disconnect-btn" onClick={handleDisconnect}>
            接続を切断
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="cal-header">
        <span className="cal-connected-label">📅 Outlook 接続済み</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="icon-btn" onClick={() => settings && fetchEvents(settings)} disabled={loading}>
            {loading ? "…" : "更新"}
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)}>設定</button>
        </div>
      </div>

      {calError && <div className="cal-error">{calError}</div>}

      <div className="cal-section">
        <div className="cal-day-label">今日 {formatDateLabel(today)}</div>
        {todayEvents.length === 0 ? (
          <div className="cal-empty">予定なし</div>
        ) : (
          todayEvents.map((ev) => <EventCard key={ev.id} event={ev} />)
        )}
      </div>

      <div className="cal-section">
        <div className="cal-day-label">明日 {formatDateLabel(tomorrow)}</div>
        {tomorrowEvents.length === 0 ? (
          <div className="cal-empty">予定なし</div>
        ) : (
          tomorrowEvents.map((ev) => <EventCard key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: CalendarEvent }) {
  const timeStr = event.isAllDay
    ? "終日"
    : `${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}`;

  return (
    <div className="cal-event-card">
      <div className="cal-event-time">{timeStr}</div>
      <div className="cal-event-title">{event.subject}</div>
      {event.location?.displayName && (
        <div className="cal-event-location">📍 {event.location.displayName}</div>
      )}
    </div>
  );
}
