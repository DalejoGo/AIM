#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
bash scripts/ci/lint.sh
bash scripts/ci/typecheck.sh
bash scripts/ci/test.sh
bash scripts/ci/build.sh
bash scripts/ci/e2e.sh
