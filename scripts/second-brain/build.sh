#!/usr/bin/env bash
# Second Brain fork: build the `t3` server package from source for the VPS service.
#
# Produces apps/server/dist/bin.mjs (+ dist/client/, the bundled web app) using
# the upstream build (`vp run --filter t3 build`, which builds @t3tools/web first).
# Only the server/web workspaces are installed — desktop/mobile/marketing are
# not part of this deployment. The upstream build stamps the *development*
# blueprint icons into dist/client; the Second Brain icons are restored afterwards.
#
# Usage: scripts/second-brain/build.sh   (from any cwd; needs pnpm + Node 24)
# Deploy/rollback: see docs/second-brain/deploy.md
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

pnpm install --frozen-lockfile \
  --filter @t3tools/monorepo \
  --filter "t3..." \
  --filter "@t3tools/web..." \
  --filter "@t3tools/scripts"

node_modules/.bin/vp run --filter t3 build

# The upstream `cli build` stamps its development (blueprint) icons over
# dist/client; restore the Second Brain icons from apps/web/public (brain emoji,
# Noto Color Emoji artwork, Apache-2.0) so the served app keeps our branding.
for f in favicon.ico favicon-16x16.png favicon-32x32.png apple-touch-icon.png; do
  cp "apps/web/public/$f" "apps/server/dist/client/$f"
done

test -f apps/server/dist/bin.mjs
test -f apps/server/dist/client/index.html
echo "built $(git rev-parse --short HEAD) -> apps/server/dist/bin.mjs"
