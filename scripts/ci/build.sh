#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step build
# The E2E fake the API Playground at this host, so its console tests always run in CI (DEC-019 allows it in connect-src).
export PUBLIC_PLAYGROUND_API_URL="${PUBLIC_PLAYGROUND_API_URL:-https://playground.test}"
# Same for the data migrator's Python engine (e2e/migrator-server.e2e.ts fakes it at this host).
export PUBLIC_PYLAB_API_URL="${PUBLIC_PYLAB_API_URL:-https://pylab.test}"
pnpm build
