#!/bin/bash
# Work Launcher インストール仕上げスクリプト
# DMG内に「ここをダブルクリック.command」として同梱される
# 役割: /Applications/work-launcher.app の quarantine属性を解除して起動

set -e

APP="/Applications/work-launcher.app"

if [ ! -d "$APP" ]; then
  osascript <<'OSA'
display dialog "先に work-launcher.app を「アプリケーション」フォルダへドラッグしてから、もう一度このファイルをダブルクリックしてください。" \
  buttons {"OK"} default button 1 \
  with icon caution \
  with title "Work Launcher インストール"
OSA
  exit 1
fi

# quarantine属性を解除（これで「壊れているため開けません」警告が消える）
xattr -cr "$APP" 2>/dev/null || true

# 起動
open "$APP"

# 終了後にターミナルウィンドウを閉じる
osascript -e 'tell application "Terminal" to close (every window whose name contains "install.command")' &

exit 0
