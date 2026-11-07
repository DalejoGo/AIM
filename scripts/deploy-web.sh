#!/usr/bin/env bash
# Builds the static site for production and publishes it to Cloudflare Pages (docs/DESPLIEGUE.md).
source "$(dirname "$0")/ci/lib.sh"
: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL to the public URL, e.g. https://aimweb-9hc.pages.dev}"
# Turnstile site keys are public; this is the "aimweb" widget (docs/DESPLIEGUE.md).
export PUBLIC_TURNSTILE_SITE_KEY="${PUBLIC_TURNSTILE_SITE_KEY:-0x4AAAAAAF2jeRuzru0bOovf}"
# The Lab's API Playground (NestJS on Render); the CSP adds it to connect-src.
export PUBLIC_PLAYGROUND_API_URL="${PUBLIC_PLAYGROUND_API_URL:-https://aimweb-api.onrender.com}"
# The data migrator's Python engine (services/py-lab, FastAPI on Render); the CSP adds it to connect-src too.
export PUBLIC_PYLAB_API_URL="${PUBLIC_PYLAB_API_URL:-https://aimweb-pylab.onrender.com}"
# Cloudflare Web Analytics site "aimweb-9hc.pages.dev" (public token, cookieless; DEC-020).
export PUBLIC_CF_ANALYTICS_TOKEN="${PUBLIC_CF_ANALYTICS_TOKEN:-0848b3c188e6423b9a9bd9cf0b0fb68e}"
step "build (production) for ${PUBLIC_BASE_URL}"
APP_ENV=production pnpm --filter @aim/web build
step "deploy to Cloudflare Pages"
pnpm --filter @aim/web exec wrangler pages deploy --project-name aimweb --branch main
