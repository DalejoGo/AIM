#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step build
pnpm build
