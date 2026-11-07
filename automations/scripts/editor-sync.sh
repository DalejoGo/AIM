#!/usr/bin/env bash
# Moves the flow between the repo and the local n8n editor (docker compose service n8n-editor).
#   bash automations/scripts/editor-sync.sh export   # editor → automations/workflows/lead-demo.json
#   bash automations/scripts/editor-sync.sh import   # repo → editor (replaces the editor's copy)
# Details: automations/README.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

file=automations/workflows/lead-demo.json
id=$(node -p "require('./$file').id")
compose=(docker compose --profile n8n-editor)

case "${1:-}" in
  export)
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    "${compose[@]}" exec -T n8n-editor n8n export:workflow --id="$id" --output=/tmp/lead-demo.json
    "${compose[@]}" cp n8n-editor:/tmp/lead-demo.json "$tmp"
    node automations/scripts/normalize-workflow.mjs "$tmp" "$file"
    pnpm exec biome format --write "$file" >/dev/null
    # What a real n8n answers for the test leads, then the edge's flow against it (docs/AUTOMATIZACION.md §3).
    pnpm --filter @aim/automations record:n8n
    pnpm exec biome format --write automations/test/fixtures/n8n-runs.json >/dev/null
    pnpm --filter @aim/automations test
    echo "Listo: $file (revisa el diff y haz commit)."
    ;;
  import)
    "${compose[@]}" cp "$file" n8n-editor:/tmp/lead-demo.json
    "${compose[@]}" exec -T n8n-editor n8n import:workflow --input=/tmp/lead-demo.json
    "${compose[@]}" exec -T n8n-editor n8n publish:workflow --id="$id"
    # A published version only takes effect after a restart.
    "${compose[@]}" restart n8n-editor
    echo "Listo: el editor tiene la versión del repo."
    ;;
  *)
    echo "Uso: bash automations/scripts/editor-sync.sh export|import" >&2
    exit 1
    ;;
esac
