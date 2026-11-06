#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
step lint
pnpm lint
