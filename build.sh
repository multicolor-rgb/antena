#!/usr/bin/env bash
# Buduje Antenę w wersji release.
#   ./build.sh          -> tylko binarka (src-tauri/target/release/antena)
#   ./build.sh bundle   -> dodatkowo paczki .deb / AppImage (wymaga tauri-cli)
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "bundle" ]; then
  if ! command -v cargo-tauri >/dev/null 2>&1; then
    echo "Brak tauri-cli. Instaluję (jednorazowo)..."
    cargo install tauri-cli --version "^2" --locked
  fi
  exec cargo tauri build
fi

exec cargo build --release --manifest-path src-tauri/Cargo.toml
