#!/bin/sh
# Launchers (PortDeck, a reboot) only run `npm start`; the rail is its own app, so open it here.
app="desktop/src-tauri/target/release/bundle/macos/Agent Board Rail.app"
if [ "$(uname)" = Darwin ] && [ -d "$app" ]; then
  open -g "$app"
fi
exec npm --prefix server run serve
