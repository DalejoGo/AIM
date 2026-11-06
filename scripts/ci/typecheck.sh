#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step typecheck
pnpm typecheck
