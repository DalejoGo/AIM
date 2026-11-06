#!/usr/bin/env bash
# Builds the static site for production and publishes it to Cloudflare Pages (docs/DESPLIEGUE.md).
source "$(dirname "$0")/ci/lib.sh"
: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL to the public URL, e.g. https://aimweb-9hc.pages.dev}"
# Turnstile site keys are public; this is the "aimweb" widget (docs/DESPLIEGUE.md).
export PUBLIC_TURNSTILE_SITE_KEY="${PUBLIC_TURNSTILE_SITE_KEY:-0x4AAAAAAF2jeRuzru0bOovf}"
step "build (production) for ${PUBLIC_BASE_URL}"
APP_ENV=production pnpm --filter @aim/web build
step "deploy to Cloudflare Pages"
pnpm --filter @aim/web exec wrangler pages deploy --project-name aimweb --branch main
