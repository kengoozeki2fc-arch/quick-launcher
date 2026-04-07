import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarSettings } from "./types";

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
  return d.toLocaleDateString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "/");
}

export type { CalendarEvent };

interface Props {
  settings: CalendarSettings | null;
  onSettingsChange: (s: CalendarSettings | null) => void;
  todayEvents: CalendarEvent[];
  tomorrowEvents: CalendarEvent[];
  loading: boolean;
  calError: string | null;
  onRefresh: () => void;
}

export default function CalendarTab({
  settings,
  onSettingsChange,
  todayEvents,
  tomorrowEvents,
  loading,
  calError,
  onRefresh,
}: Props) {
  const [tenantId, setTenantId] = useState(settings?.tenantId ?? "");
  const [clientId, setClientId] = useState(settings?.clientId ?? "");
  const [showSettings, setShowSettings] = useState(!settings?.accessToken);
  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!tenantId || !clientId) return;
    setAuthError(null);
    setConnecting(true);
    try {
      const raw = await invoke<string>("start_oauth_flow", { tenantId, clientId });
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
        onSettingsChange(newSettings);
        setShowSettings(false);
      } else {
        setAuthError("トークンの取得に失敗しました");
      }
    } catch (err) {
      setAuthError(`接続に失敗しました: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    onSettingsChange(null);
    setShowSettings(true);
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
          <button className="icon-btn" onClick={onRefresh} disabled={loading}>
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
