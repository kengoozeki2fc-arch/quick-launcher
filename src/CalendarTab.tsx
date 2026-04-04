import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";

const CAL_FILE = "quick-launcher-calendar.json";
const GRAPH_SCOPE = "Calendars.Read offline_access";

async function msPost(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_post", { url, params });
  return JSON.parse(raw);
}

async function msGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const raw = await invoke<string>("http_get", { url, accessToken });
  return JSON.parse(raw);
}

async function loadCalSettings(): Promise<CalendarSettings | null> {
  try {
    const fileExists = await exists(CAL_FILE, { baseDir: BaseDirectory.Desktop });
    if (!fileExists) return null;
    const raw = await readTextFile(CAL_FILE, { baseDir: BaseDirectory.Desktop });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCalSettings(s: CalendarSettings) {
  await writeTextFile(CAL_FILE, JSON.stringify(s, null, 2), {
    baseDir: BaseDirectory.Desktop,
  });
}

async function deleteCalSettings() {
  await writeTextFile(CAL_FILE, "{}", { baseDir: BaseDirectory.Desktop });
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateLabel(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarTab() {
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [deviceCode, setDeviceCode] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
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
        if (s?.tenantId) setTenantId(s.tenantId);
        if (s?.clientId) setClientId(s.clientId);
        setShowSettings(true);
      }
      setLoaded(true);
    });
  }, []);

  const updateSettings = useCallback(async (s: CalendarSettings) => {
    await saveCalSettings(s);
    setSettings(s);
  }, []);

  const refreshAccessToken = useCallback(async (s: CalendarSettings): Promise<CalendarSettings | null> => {
    try {
      const data = await msPost(
        `https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`,
        {
          client_id: s.clientId,
          grant_type: "refresh_token",
          refresh_token: s.refreshToken,
          scope: GRAPH_SCOPE,
        }
      );
      if (data.access_token) {
        const updated: CalendarSettings = {
          ...s,
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) ?? s.refreshToken,
          tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
        };
        await updateSettings(updated);
        return updated;
      }
      return null;
    } catch {
      return null;
    }
  }, [updateSettings]);

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
        const errObj = data.error as Record<string, unknown>;
        setCalError(`取得エラー: ${errObj.message ?? JSON.stringify(data.error)}`);
        setLoading(false);
        return;
      }

      const events = (data.value as CalendarEvent[]) ?? [];
      const todayStr = formatDateLabel(today);
      const tomorrowDate = new Date(today);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = formatDateLabel(tomorrowDate);

      setTodayEvents(events.filter((e) => formatDateLabel(new Date(e.start.dateTime)) === todayStr));
      setTomorrowEvents(events.filter((e) => formatDateLabel(new Date(e.start.dateTime)) === tomorrowStr));
    } catch (err) {
      setCalError(`カレンダーの取得に失敗しました: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [refreshAccessToken]);

  // 認証済みで読込完了後に自動取得
  useEffect(() => {
    if (loaded && settings?.accessToken && !showSettings) {
      fetchEvents(settings);
    }
  }, [loaded, settings, showSettings, fetchEvents]);

  const startDeviceCodeFlow = async () => {
    if (!tenantId || !clientId) return;
    setAuthError(null);
    setDeviceCode(null);

    try {
      const data = await msPost(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`,
        { client_id: clientId, scope: GRAPH_SCOPE }
      );

      if (data.error) {
        setAuthError((data.error_description as string) ?? (data.error as string));
        return;
      }

      setDeviceCode({
        userCode: data.user_code as string,
        verificationUri: data.verification_uri as string,
        deviceCode: data.device_code as string,
      });
      pollForToken(tenantId, clientId, data.device_code as string, (data.interval as number) ?? 5);
    } catch (err) {
      setAuthError(`接続に失敗しました: ${err}`);
    }
  };

  const pollForToken = (tid: string, cid: string, dc: string, interval: number) => {
    setPolling(true);
    const poll = setInterval(async () => {
      try {
        const data = await msPost(
          `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
          {
            client_id: cid,
            grant_type: "urn:ietf:params:oauth2:grant-type:device_code",
            device_code: dc,
          }
        );

        if (data.access_token) {
          clearInterval(poll);
          const newSettings: CalendarSettings = {
            tenantId: tid,
            clientId: cid,
            accessToken: data.access_token as string,
            refreshToken: (data.refresh_token as string) ?? "",
            tokenExpiry: Date.now() + (data.expires_in as number) * 1000,
          };
          // UIを先に更新してから保存
          setSettings(newSettings);
          setShowSettings(false);
          setPolling(false);
          setDeviceCode(null);
          saveCalSettings(newSettings).catch(() => {}); // 非同期保存
        } else if (data.error === "expired_token" || data.error === "code_already_used") {
          clearInterval(poll);
          setPolling(false);
          setDeviceCode(null);
          setAuthError("コードが期限切れです。再度お試しください。");
        }
      } catch {
        // 一時的なエラーは無視
      }
    }, interval * 1000);
  };

  const handleDisconnect = async () => {
    await deleteCalSettings();
    setSettings(null);
    setTodayEvents([]);
    setTomorrowEvents([]);
    setShowSettings(true);
    setDeviceCode(null);
    setPolling(false);
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

        <div className="cal-info-box">
          <p><strong>事前準備:</strong> Azure Portal でアプリ登録が必要です。</p>
          <ol>
            <li>Azure Portal → Microsoft Entra ID → アプリの登録</li>
            <li>認証 → パブリック クライアント フローを有効化</li>
            <li>APIのアクセス許可: <code>Calendars.Read</code>（委任）</li>
          </ol>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="cal-form">
          <div className="form-group">
            <label>テナントID（Directory ID）</label>
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
          </div>
          <div className="form-group">
            <label>クライアントID（Application ID）</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
          </div>

          {authError && <div className="cal-error">{authError}</div>}

          {!deviceCode && !polling && (
            <button
              type="button"
              className="btn-save cal-connect-btn"
              onClick={startDeviceCodeFlow}
              disabled={!tenantId || !clientId}
            >
              Outlookに接続
            </button>
          )}
        </form>

        {deviceCode && (
          <div className="device-code-box">
            <p className="device-code-title">以下の手順で認証してください</p>
            <ol>
              <li>
                <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer" className="device-code-link">
                  {deviceCode.verificationUri}
                </a>
                を開く
              </li>
              <li>このコードを入力:</li>
            </ol>
            <div className="device-code-value">{deviceCode.userCode}</div>
            {polling && <p className="device-code-waiting">✓ 認証を待機中...</p>}
            <button
              type="button"
              className="icon-btn"
              style={{ marginTop: 10, width: "100%" }}
              onClick={() => {
                setDeviceCode(null);
                setPolling(false);
                setTimeout(() => startDeviceCodeFlow(), 100);
              }}
            >
              🔄 コードを再発行
            </button>
          </div>
        )}

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
