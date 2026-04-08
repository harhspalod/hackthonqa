#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Running backend tests"
cd "$ROOT_DIR/backend"
if [[ -f "venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "venv/bin/activate"
fi
python -m pytest -q

echo "==> Running VS Code extension tests"
cd "$ROOT_DIR/vscode-extension"
if ! npm test; then
  echo "Extension tests failed. If you're on a headless environment, run this on a desktop machine with VS Code runtime support."
  exit 1
fi

echo "==> All tests passed"
