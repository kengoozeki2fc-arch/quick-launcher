## Work Launcher

### 🍎 macOS インストール手順

1. ダウンロードした **`.dmg` ファイル** を開く
2. **`work-launcher.app` を `Applications` フォルダへドラッグ**
3. DMG内の **「ここをダブルクリック.command」** をダブルクリック
   - 初回のみターミナルが開き、**「壊れているため開けません」警告を自動解除** → アプリが起動します
   - Mac miniやMac Airで `launcher-update` コマンドを使っている方は従来通りそちらでもOKです

### 🪟 Windows インストール手順

1. ダウンロードした **`.zip` ファイル** を展開（右クリック→「すべて展開」）
   - 同梱の **`README_win.txt`** に詳しい手順あり
2. フォルダ内の **`work-launcher_x.x.x_x64-setup.exe`** をダブルクリック
3. 「WindowsによってPCが保護されました」が出たら **「詳細情報」→「実行」** をクリック
4. インストーラーの指示に従って進める

---

### 🔒 セキュリティについて

Apple Developer ID署名・Windowsコードサイニング証明書は現在未取得のため、
初回起動時にOS標準のセキュリティ警告が出ます。
- **Mac**: DMG内の「ここをダブルクリック.command」で自動回避
- **Win**: 「詳細情報→実行」で手動回避

### 📦 ダウンロード

- **Mac（Apple Silicon / M1/M2/M3）**: `work-launcher_*_aarch64.dmg`
- **Mac（Intel）**: `work-launcher_*_x64.dmg`
- **Windows**: `work-launcher_*_x64-setup.zip`
