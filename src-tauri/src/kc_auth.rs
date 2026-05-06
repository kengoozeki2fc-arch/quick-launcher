// Keycloak Pattern D 認証（OAuth2 Authorization Code + PKCE + Custom URL Scheme）
//
// 設計書: MyBrain/20_Projects/Work Launcher/設計書/Work_Launcher_V2_設計書 v0.4
// ガイドライン: 統合認証組込みガイドライン v1.3 §6-1
//
// flow:
//   1. kc_login        : PKCE生成 → ブラウザで Keycloak 認可URLを開く
//   2. (deep-link受信) : work-launcher://oauth/callback?code=...&state=... を OS 経由で受領
//   3. handle_callback : code+verifier で /token 交換 → Keychain 保管 → "kc-login-success" emit
//   4. kc_token        : 期限内 access_token を返却（必要なら refresh 自動実行）
//   5. kc_logout       : Keychain 削除 + サーバ側 logout
//
// trust boundary:
//   - access_token: メモリのみ・5分寿命
//   - refresh_token: OS Keychain 暗号化保管（mac=Keychain / win=CredManager / linux=SecretService）

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

const REALM_BASE: &str = "https://id.kensetsu-total.support/realms/kensetsu-total";
const CLIENT_ID: &str = "work-launcher";
const REDIRECT_URI: &str = "work-launcher://oauth/callback";
const KEYRING_SERVICE: &str = "work-launcher-kc";
const KEYRING_USER: &str = "refresh_token";

// ============================================================================
// 共有 State
// ============================================================================
#[derive(Default)]
pub struct AuthState {
    pub pending: Mutex<Option<PendingLogin>>,
    pub current: Mutex<Option<TokenSet>>,
}

#[derive(Clone)]
pub struct PendingLogin {
    pub code_verifier: String,
    pub state: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64, // unix秒
    pub id_token: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize, Debug)]
struct TokenResp {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    id_token: Option<String>,
}

// ============================================================================
// ヘルパー
// ============================================================================
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(&bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn random_state() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(&b)
}

fn save_refresh_token(rt: &str) -> Result<(), String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?
        .set_password(rt)
        .map_err(|e| e.to_string())
}

fn load_refresh_token() -> Result<String, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| e.to_string())
}

fn delete_refresh_token() -> Result<(), String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?
        .delete_credential()
        .map_err(|e| e.to_string())
}

fn extract_email_from_id_token(id_token: &str) -> Option<String> {
    // 簡易JWT decode（payload base64url のみ）
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    json.get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

async fn token_request(form: &[(&str, &str)]) -> Result<TokenResp, String> {
    let resp = reqwest::Client::new()
        .post(format!("{REALM_BASE}/protocol/openid-connect/token"))
        .form(form)
        .send()
        .await
        .map_err(|e| format!("token request error: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token endpoint {status}: {body}"));
    }
    resp.json::<TokenResp>()
        .await
        .map_err(|e| format!("token json parse: {e}"))
}

fn build_token_set(t: TokenResp) -> TokenSet {
    let email = t
        .id_token
        .as_deref()
        .and_then(extract_email_from_id_token);
    TokenSet {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: now_secs() + t.expires_in,
        id_token: t.id_token,
        email,
    }
}

// ============================================================================
// Tauri コマンド
// ============================================================================

/// ログイン開始：PKCE生成 → ブラウザで認可URLを開く。
/// 続きは deep-link callback (`handle_callback`) で完結。
#[tauri::command]
pub async fn kc_login(state: State<'_, AuthState>) -> Result<(), String> {
    let (verifier, challenge) = generate_pkce();
    let s = random_state();

    {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        *pending = Some(PendingLogin {
            code_verifier: verifier,
            state: s.clone(),
        });
    }

    let url = format!(
        "{REALM_BASE}/protocol/openid-connect/auth\
         ?client_id={CLIENT_ID}\
         &response_type=code\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &redirect_uri={redirect}\
         &scope=openid+profile+email+offline_access\
         &state={s}",
        challenge = challenge,
        redirect = urlencoding::encode(REDIRECT_URI),
        s = s,
    );

    open::that(&url).map_err(|e| format!("browser open: {e}"))?;
    Ok(())
}

/// アプリ起動時に呼ぶ：Keychain の refresh_token で無音再認証を試みる。
/// 成功なら TokenSet を返す。失敗（rt無し or 期限切れ）なら None。
#[tauri::command]
pub async fn kc_silent_login(state: State<'_, AuthState>) -> Result<Option<TokenSet>, String> {
    let rt = match load_refresh_token() {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    match refresh_with(&rt).await {
        Ok(ts) => {
            let mut current = state.current.lock().map_err(|e| e.to_string())?;
            *current = Some(ts.clone());
            Ok(Some(ts))
        }
        Err(_) => {
            let _ = delete_refresh_token();
            Ok(None)
        }
    }
}

/// 現在の有効な access_token を返す。期限切れなら自動で refresh。
#[tauri::command]
pub async fn kc_token(state: State<'_, AuthState>) -> Result<Option<TokenSet>, String> {
    {
        let current = state.current.lock().map_err(|e| e.to_string())?;
        if let Some(t) = current.as_ref() {
            if t.expires_at > now_secs() + 60 {
                return Ok(Some(t.clone()));
            }
        }
    }
    // 期限切れ or 未保持 → refresh
    let rt = match load_refresh_token() {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let ts = refresh_with(&rt).await?;
    let mut current = state.current.lock().map_err(|e| e.to_string())?;
    *current = Some(ts.clone());
    Ok(Some(ts))
}

/// ログアウト：サーバ側 logout 通知 → Keychain 削除 → メモリ State クリア。
#[tauri::command]
pub async fn kc_logout(state: State<'_, AuthState>) -> Result<(), String> {
    if let Ok(rt) = load_refresh_token() {
        let _ = reqwest::Client::new()
            .post(format!("{REALM_BASE}/protocol/openid-connect/logout"))
            .form(&[("client_id", CLIENT_ID), ("refresh_token", rt.as_str())])
            .send()
            .await;
    }
    let _ = delete_refresh_token();
    if let Ok(mut current) = state.current.lock() {
        *current = None;
    }
    Ok(())
}

// ============================================================================
// 内部関数
// ============================================================================

async fn refresh_with(refresh_token: &str) -> Result<TokenSet, String> {
    let token = token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", CLIENT_ID),
        ("refresh_token", refresh_token),
    ])
    .await?;
    save_refresh_token(&token.refresh_token)?;
    Ok(build_token_set(token))
}

/// deep-link 受信時に lib.rs から呼ばれる（state 検証 → token交換 → 保管 → emit）。
pub async fn handle_callback(app: &AppHandle, callback_url: &str) -> Result<(), String> {
    let url = url::Url::parse(callback_url).map_err(|e| format!("url parse: {e}"))?;
    if url.host_str() != Some("oauth") || url.path() != "/callback" {
        return Err(format!("unexpected callback path: {}", url));
    }
    let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

    if let Some(err) = params.get("error") {
        let desc = params.get("error_description").cloned().unwrap_or_default();
        return Err(format!("auth error: {err} ({desc})"));
    }

    let code = params.get("code").ok_or("no code in callback")?.to_string();
    let returned_state = params
        .get("state")
        .ok_or("no state in callback")?
        .to_string();

    let state: State<AuthState> = app.state();
    let pending = {
        let mut g = state.pending.lock().map_err(|e| e.to_string())?;
        g.take().ok_or("no pending login (race or replay)")?
    };
    if pending.state != returned_state {
        return Err("state mismatch".to_string());
    }

    let token = token_request(&[
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("client_id", CLIENT_ID),
        ("redirect_uri", REDIRECT_URI),
        ("code_verifier", pending.code_verifier.as_str()),
    ])
    .await?;

    save_refresh_token(&token.refresh_token)?;
    let ts = build_token_set(token);

    {
        let mut current = state.current.lock().map_err(|e| e.to_string())?;
        *current = Some(ts.clone());
    }

    app.emit("kc-login-success", &ts).ok();
    Ok(())
}
