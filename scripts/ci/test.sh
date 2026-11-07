#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step test
pnpm test
# The n8n flow's structure (automations/, outside the pnpm workspace; node:test, no Docker).
node --test "automations/**/*.test.mjs"
