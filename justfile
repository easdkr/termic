set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Run termic in dev mode (live reload).
dev:
    @npm run tauri dev

# Refresh src-tauri/vendor/ from current system (Ghostty).
fetch-deps:
    @./scripts/fetch-deps.sh

# Build a release .app bundle. `prebuild` populates src-tauri/vendor/ first.
build:
    @npm run tauri build

# Type-check the Rust backend only.
check:
    @cd src-tauri && cargo check
