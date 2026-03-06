#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../tools/mc-extract"
exec bun run src/cli.ts "$@"
