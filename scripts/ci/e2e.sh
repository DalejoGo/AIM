#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step "e2e + accessibility (Playwright + axe)"
pnpm --filter @aim/web test:e2e
