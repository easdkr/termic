#!/usr/bin/env bash
# Populate vendor/ with everything we ship inside termic.app.
# Strategy: if a system copy is installed, copy from there (fast, no network).
# Otherwise download from upstream.
#
# Run by `npm run prebuild` (before tauri build) and on demand:
#   ./scripts/fetch-deps.sh         # default: ghostty
#   ./scripts/fetch-deps.sh all     # ghostty + gh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="$here/src-tauri/vendor"
mkdir -p "$vendor"

mode="${1:-default}"   # default | all | ghostty | gh

fetch_ghostty() {
  if [[ -d "$vendor/Ghostty.app" ]]; then
    echo "  ✓ vendor/Ghostty.app already present"
    return
  fi
  if [[ -d /Applications/Ghostty.app ]]; then
    echo "  copying from /Applications/Ghostty.app …"
    cp -RP /Applications/Ghostty.app "$vendor/Ghostty.app"
    echo "  ✓ vendor/Ghostty.app ($(du -sh "$vendor/Ghostty.app" | cut -f1))"
  else
    echo "  /Applications/Ghostty.app not found — install first:"
    echo "      brew install --cask ghostty"
    echo "  (or download the dmg from https://ghostty.org and copy to /Applications)"
    exit 1
  fi
}

fetch_gh() {
  if [[ -x "$vendor/gh" ]]; then
    echo "  ✓ vendor/gh already present"
    return
  fi
  for cand in /opt/homebrew/bin/gh /usr/local/bin/gh; do
    if [[ -x "$cand" ]]; then
      cp "$cand" "$vendor/gh"
      chmod +x "$vendor/gh"
      echo "  ✓ vendor/gh ($(du -sh "$vendor/gh" | cut -f1))"
      return
    fi
  done
  echo "  gh not found in PATH — install with: brew install gh" >&2
  exit 1
}

case "$mode" in
  default|ghostty) fetch_ghostty ;;
  all)             fetch_ghostty; fetch_gh ;;
  gh)              fetch_gh ;;
  *) echo "usage: fetch-deps.sh [default|ghostty|gh|all]"; exit 2 ;;
esac
