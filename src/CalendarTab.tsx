import { useState, useEffect, useCallback } from "react";

interface CalendarSettings {
  tenantId: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number; // unix ms
}

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName: string };
  bodyPreview?: string;
}

const SETTINGS_KEY = "wl_calendar_settings";
const GRAPH_SCOPE = "Calendars.Read offline_access";

function loadSettings(): CalendarSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSettings(s: CalendarSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateLabel(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarTab() {
  const [settings, setSettings] = useState<CalendarSettings | null>(loadSettings);
  const [tenantId, setTenantId] = useState(loadSettings()?.tenantId ?? "");
  const [clientId, setClientId] = useState(loadSettings()?.clientId ?? "");
  const [showSettings, setShowSettings] = useState(!loadSettings()?.accessToken);

  // Device Code Flow state
  const [deviceCode, setDeviceCode] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    expiresIn: number;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Calendar events
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [tomorrowEvents, setTomorrowEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const isAuthenticated = !!settings?.accessToken;

  const refreshAccessToken = useCallback(async (s: CalendarSettings): Promise<CalendarSettings | null> => {
    try {
      const res = await fetch(
        `https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: s.clientId,
            grant_type: "refresh_token",
            refresh_token: s.refreshToken,
            scope: GRAPH_SCOPE,
          }),
        }
      );
      const data = await res.json();
      if (data.access_token) {
        const updated = {
          ...s,
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? s.refreshToken,
          tokenExpiry: Date.now() + data.expires_in * 1000,
        };
        saveSettings(updated);
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

    let currentSettings = s;
    // Refresh token if expired (with 5min buffer)
    if (Date.now() > s.tokenExpiry - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(s);
      if (!refreshed) {
        setCalError("トークンの更新に失敗しました。再接続してください。");
        setLoading(false);
        return;
      }
      currentSettings = refreshed;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const afterTomorrow = new Date(today);
    afterTomorrow.setDate(afterTomorrow.getDate() + 2);

    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${today.toISOString()}&endDateTime=${afterTomorrow.toISOString()}&$select=subject,start,end,isAllDay,location,bodyPreview&$orderby=start/dateTime&$top=50`,
        {
          headers: {
            Authorization: `Bearer ${currentSettings.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        setCalError(`取得エラー: ${res.status}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const events: CalendarEvent[] = data.value ?? [];

      const todayStr = formatDateLabel(today);
      const tomorrowDate = new Date(today);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = formatDateLabel(tomorrowDate);

      setTodayEvents(
        events.filter((e) => {
          const d = new Date(e.start.dateTime);
          return formatDateLabel(d) === todayStr;
        })
      );
      setTomorrowEvents(
        events.filter((e) => {
          const d = new Date(e.start.dateTime);
          return formatDateLabel(d) === tomorrowStr;
        })
      );
    } catch (err) {
      setCalError("カレンダーの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [refreshAccessToken]);

  // 認証済みなら自動取得
  useEffect(() => {
    if (settings?.accessToken && !showSettings) {
      fetchEvents(settings);
    }
  }, [settings, showSettings, fetchEvents]);

  const startDeviceCodeFlow = async () => {
    if (!tenantId || !clientId) return;
    setAuthError(null);
    setDeviceCode(null);

    try {
      const res = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            scope: GRAPH_SCOPE,
          }),
        }
      );
      const data = await res.json();
      if (data.error) {
        setAuthError(data.error_description ?? data.error);
        return;
      }
      setDeviceCode({
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        deviceCode: data.device_code,
        expiresIn: data.expires_in,
      });
      pollForToken(tenantId, clientId, data.device_code, data.interval ?? 5);
    } catch {
      setAuthError("接続に失敗しました。Tenant IDとClient IDを確認してください。");
    }
  };

  const pollForToken = (tid: string, cid: string, dc: string, interval: number) => {
    setPolling(true);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(
          `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: cid,
              grant_type: "urn:ietf:params:oauth2:grant-type:device_code",
              device_code: dc,
            }),
          }
        );
        const data = await res.json();
        if (data.access_token) {
          clearInterval(poll);
          setPolling(false);
          setDeviceCode(null);
          const newSettings: CalendarSettings = {
            tenantId: tid,
            clientId: cid,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? "",
            tokenExpiry: Date.now() + data.expires_in * 1000,
          };
          saveSettings(newSettings);
          setSettings(newSettings);
          setShowSettings(false);
        } else if (data.error === "expired_token" || data.error === "code_already_used") {
          clearInterval(poll);
          setPolling(false);
          setDeviceCode(null);
          setAuthError("コードが期限切れです。もう一度試してください。");
        }
        // authorization_pending は継続
      } catch {
        // 一時的なエラーは無視
      }
    }, interval * 1000);
  };

  const handleDisconnect = () => {
    localStorage.removeItem(SETTINGS_KEY);
    setSettings(null);
    setTodayEvents([]);
    setTomorrowEvents([]);
    setShowSettings(true);
    setDeviceCode(null);
    setPolling(false);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceCode(null);
    setPolling(false);
    setAuthError(null);
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 設定・接続画面
  if (showSettings) {
    return (
      <div className="tab-content">
        <div className="cal-settings-header">
          <h3 className="cal-section-title">Outlookカレンダー接続設定</h3>
          {isAuthenticated && (
            <button className="icon-btn" onClick={() => setShowSettings(false)}>← 戻る</button>
          )}
        </div>

        <div className="cal-info-box">
          <p><strong>事前準備:</strong> Azure Portal でアプリ登録が必要です。</p>
          <ol>
            <li>Azure Portal → Microsoft Entra ID → アプリの登録</li>
            <li>「モバイルアプリとデスクトップアプリ」のリダイレクトURIを有効化</li>
            <li>APIのアクセス許可: <code>Calendars.Read</code>（委任）</li>
            <li>認証 → 「パブリック クライアント フロー」を「はい」に設定</li>
          </ol>
        </div>

        <form onSubmit={handleSaveSettings} className="cal-form">
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
                <a
                  href={deviceCode.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="device-code-link"
                >
                  {deviceCode.verificationUri}
                </a>
                を開く
              </li>
              <li>このコードを入力:</li>
            </ol>
            <div className="device-code-value">{deviceCode.userCode}</div>
            {polling && <p className="device-code-waiting">✓ 認証を待機中...</p>}
          </div>
        )}

        {isAuthenticated && (
          <button className="icon-btn danger cal-disconnect-btn" onClick={handleDisconnect}>
            接続を切断
          </button>
        )}
      </div>
    );
  }

  // カレンダー表示
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
