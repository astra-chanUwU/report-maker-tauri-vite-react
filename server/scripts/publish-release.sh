#!/usr/bin/env bash
set -euo pipefail; cd "$(dirname "$0")/.."; go run ./cmd/publish-release -manifest "${1:-releases.json}" -root "${2:-testdata/artifacts}" ${3:+-spec "$3"}
