#!/usr/bin/env bash
# Uruchamia Antenę w trybie deweloperskim (szybki start, kod bez optymalizacji).
set -euo pipefail
cd "$(dirname "$0")"
exec cargo run --manifest-path src-tauri/Cargo.toml "$@"
