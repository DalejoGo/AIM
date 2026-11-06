#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step build
# The E2E fake the API Playground at this host, so its console tests always run in CI (DEC-019 allows it in connect-src).
export PUBLIC_PLAYGROUND_API_URL="${PUBLIC_PLAYGROUND_API_URL:-https://playground.test}"
pnpm build
