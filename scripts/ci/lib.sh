#!/usr/bin/env bash
# Shared helpers. The CI YAML only calls the scripts in this folder, so moving
# to another CI platform means rewriting a thin YAML, not the logic.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
step() { printf '\n== %s\n' "$*"; }
