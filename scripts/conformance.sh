#!/usr/bin/env bash
# Runs the OFFICIAL ARD conformance tool (vendored verbatim from ards-project/ard-spec — see
# spec/ard/README.md) over every generated fixture catalog. This is the same tool registry
# operators and publishers are told to use, so passing here means passing in the wild — no metric
# drift between "passes our tests" and "conformant per the spec".
#
# The tool's strict JSON Schema check needs the Python `jsonschema` package; without it, it still
# runs its semantic checks (URN format, value-or-reference, representativeQueries sizing) and only
# skips the schema layer with a warning. CI installs jsonschema; locally: pip install jsonschema.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
catalogs=(fixtures/*/public/.well-known/ai-catalog.json fixtures/monorepo/apps/*/public/.well-known/ai-catalog.json)

if [ ${#catalogs[@]} -eq 0 ]; then
  echo "No fixture catalogs found — run the fixture builds first (pnpm fixtures:build)." >&2
  exit 1
fi

status=0
for catalog in "${catalogs[@]}"; do
  ./spec/ard/conformance/bin/conformance-test manifest "$catalog" || status=1
done
exit $status
