#!/bin/sh
# Boots n8n for the Lab's "Automatización en vivo" (docs/AUTOMATIZACION.md, automations/README.md).
#   AIM_N8N_MODE=webhook (default; Render): no editor, no login, no REST API. Only /healthz and the webhook.
#   AIM_N8N_MODE=editor (local only): the n8n editor, to change the flow and export it to the repo.
# The image already holds the published workflow (scripts/prepare-image.sh): the only command here is
# `n8n start`.
set -eu

fail() {
  echo "entrypoint: $*" >&2
  exit 1
}

# $2 random characters from the set $1 (the image has no openssl).
random() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2"; }

# Where the workflow reports each step: an origin, and only from the environment, never from the request.
origin="${AIM_SITE_ORIGIN:-}"
origin="${origin%/}"
case "$origin" in
  http://*/* | https://*/* | *[[:space:]]*) fail "AIM_SITE_ORIGIN must be an origin without a path, e.g. https://aimweb-9hc.pages.dev" ;;
  http://?* | https://?*) export AIM_SITE_ORIGIN="$origin" ;;
  *) fail "AIM_SITE_ORIGIN is required, e.g. https://aimweb-9hc.pages.dev" ;;
esac

# Render sets PORT. The public URL only shows up in logs and in the editor.
export N8N_PORT="${PORT:-${N8N_PORT:-5678}}"
public_url="${N8N_WEBHOOK_URL:-${WEBHOOK_URL:-${RENDER_EXTERNAL_URL:-http://localhost:$N8N_PORT}}}"
export N8N_WEBHOOK_URL="${public_url%/}/"
unset WEBHOOK_URL # Deprecated name in n8n 2.x.

case "${AIM_N8N_MODE:-webhook}" in
  webhook)
    # Written at build time from the workflow: node types to load and whether a task runner is needed.
    . /home/node/.aim/runtime.env
    export NODES_INCLUDE
    export N8N_DISABLE_UI=true
    # Everything but /healthz and /webhook/ moves to a random prefix on every boot: the internal REST
    # API (login, owner setup, all the editor uses), the public API, test and waiting webhooks, forms
    # and MCP. Nothing outside this process knows it, so from the internet they are all a 404.
    hidden="x$(random 'a-f0-9' 32)"
    export N8N_ENDPOINT_REST="$hidden-rest"
    export N8N_PUBLIC_API_ENDPOINT="$hidden-api"
    export N8N_ENDPOINT_WEBHOOK_TEST="$hidden-webhook-test"
    export N8N_ENDPOINT_WEBHOOK_WAIT="$hidden-webhook-waiting"
    export N8N_ENDPOINT_FORM="$hidden-form"
    export N8N_ENDPOINT_FORM_TEST="$hidden-form-test"
    export N8N_ENDPOINT_FORM_WAIT="$hidden-form-waiting"
    export N8N_ENDPOINT_MCP="$hidden-mcp"
    export N8N_ENDPOINT_MCP_TEST="$hidden-mcp-test"
    # The owner exists from the first second, with a password hash that matches no password: the
    # instance can never be claimed, even through the REST API.
    export N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true
    export N8N_INSTANCE_OWNER_EMAIL=owner@aim-n8n.invalid
    export N8N_INSTANCE_OWNER_PASSWORD_HASH="\$2b\$10\$$(random './A-Za-z0-9' 53)"
    # Without a Code node no task runner process is started (saves memory and boot time).
    export N8N_RUNNERS_MODE="$AIM_RUNNERS_MODE"
    if [ "$N8N_RUNNERS_MODE" = external ]; then
      export N8N_RUNNERS_AUTH_TOKEN="$(random 'a-f0-9' 32)"
    fi
    # HTTP requests may not reach private networks (the site is public). Local runs turn it off.
    export N8N_SSRF_PROTECTION_ENABLED="${N8N_SSRF_PROTECTION_ENABLED:-true}"
    ;;
  editor)
    [ -z "${RENDER:-}" ] || fail "AIM_N8N_MODE=editor is for local use only"
    export N8N_DISABLE_UI=false
    export N8N_RUNNERS_MODE=internal
    unset N8N_DISABLED_MODULES NODES_INCLUDE
    ;;
  *) fail "AIM_N8N_MODE must be webhook or editor" ;;
esac

exec n8n start
