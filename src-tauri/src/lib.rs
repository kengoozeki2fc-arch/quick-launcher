use std::collections::HashMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Sha256, Digest};
use rand::RngCore;

#[tauri::command]
fn read_file_abs(path: String) -> Result<String, String> {
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_file_abs(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn default_data_path() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())?;
    let p = std::path::Path::new(&home).join("Desktop").join("work-launcher.json");
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    // file:// URL もそのまま受け付ける（Macの`open`はfile://を解釈できる）
    let target = if path.starts_with("file://") {
        // URLデコードしてローカルパスに変換
        let stripped = path.trim_start_matches("file://");
        // Windowsの file:///C:/... 形式は先頭の / を外す
        let cleaned = if stripped.starts_with('/') && stripped.len() >= 3 && stripped.chars().nth(2) == Some(':') {
            stripped[1..].to_string()
        } else {
            stripped.to_string()
        };
        // パーセントデコード（日本語など）
        percent_decode(&cleaned)
    } else {
        path.clone()
    };

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &target])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn desktop_path() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())?;
    Ok(std::path::Path::new(&home).join("Desktop").to_string_lossy().to_string())
}

#[tauri::command]
async fn http_post(url: String, params: HashMap<String, String>) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn http_get(url: String, access_token: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn http_get_public(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("User-Agent", "work-launcher")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_oauth_flow(
    app: tauri::AppHandle,
    tenant_id: String,
    client_id: String,
) -> Result<String, String> {
    // PKCE: ランダムなcode_verifierを生成
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(&verifier_bytes);

    // code_challenge = base64url(sha256(code_verifier))
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize().as_slice());

    // ランダムポートでlocalhostサーバー起動
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{}", port);

    // 認証URLを構築
    let encoded_redirect = urlencoding::encode(&redirect_uri);
    let auth_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize\
        ?client_id={}&response_type=code\
        &redirect_uri={}\
        &scope=Calendars.Read%20offline_access\
        &code_challenge={}&code_challenge_method=S256",
        tenant_id, client_id, encoded_redirect, code_challenge
    );

    // システムブラウザを開く
    use tauri_plugin_shell::ShellExt;
    app.shell().open(&auth_url, None).map_err(|e| e.to_string())?;

    // ブラウザからのリダイレクトを5分待つ
    let (mut socket, _) = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        listener.accept(),
    )
    .await
    .map_err(|_| "認証タイムアウト（5分）".to_string())?
    .map_err(|e| e.to_string())?;

    // HTTPリクエストを読み取り
    let mut buf = vec![0u8; 4096];
    use tokio::io::AsyncReadExt;
    let n = socket.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // GETリクエストからcodeを抽出: "GET /?code=...&... HTTP/1.1"
    let code = request
        .lines()
        .next()
        .and_then(|line| line.split('?').nth(1))
        .and_then(|query| query.split('&').find(|p| p.starts_with("code=")))
        .and_then(|p| p.strip_prefix("code="))
        .and_then(|c| c.split(' ').next())
        .ok_or("リダイレクトにcodeが含まれていません")?
        .to_string();

    // 成功ページをブラウザに返す
    let html = "<html><head><meta charset='utf-8'></head><body style='font-family:sans-serif;text-align:center;padding:40px'><h1>✅ 認証完了！</h1><p>アプリに戻ってください。このウィンドウは閉じてかまいません。</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(), html
    );
    use tokio::io::AsyncWriteExt;
    socket.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;

    // codeをtokenに交換
    let client = reqwest::Client::new();
    let token_resp = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        ))
        .form(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("scope", "Calendars.Read offline_access"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    Ok(token_resp)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            http_post,
            http_get,
            http_get_public,
            start_oauth_flow,
            read_file_abs,
            write_file_abs,
            default_data_path,
            desktop_path,
            open_path
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
