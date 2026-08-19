#!/usr/bin/env bash
# Second Brain fork: deploy the built server to the VPS user service, verify, auto-rollback.
#
#   scripts/second-brain/deploy-vps.sh [--cutover-root] [--report <file>] [--task-file <file>]
#
# - Rewrites the t3code.service drop-in so ExecStart runs this checkout's
#   apps/server/dist/bin.mjs (backup kept next to it), restarts the unit and
#   waits for 127.0.0.1:3773 to answer. If it does not, the previous drop-in is
#   restored and the unit restarted again (rollback), exit 1.
# - --cutover-root additionally points Tailscale Serve :443 at T3 with the
#   gateway path routes (/tasks, /docs, /AGENTS.md, /strategy.md) kept on 8765,
#   verifies over the tailnet, and re-points / to the gateway if that fails.
# - --report appends a markdown result block; --task-file replaces the
#   "Cutover result: _pending_" line in the task Activity with the outcome.
#
# Run it detached from any T3 agent session (the restart kills those):
#   systemd-run --user --collect --unit sbt3-deploy-$(date +%s) \
#     /bin/bash /home/fred/code/second-brain-t3/scripts/second-brain/deploy-vps.sh --cutover-root ...
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DROPIN="$HOME/.config/systemd/user/t3code.service.d/override.conf"
HOST="codex-dev-01.tail7b2876.ts.net"
GATEWAY="http://127.0.0.1:8765"
T3_LOCAL="http://127.0.0.1:3773"
CUTOVER=0
REPORT=""
TASK_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cutover-root) CUTOVER=1 ;;
    --report) REPORT="$2"; shift ;;
    --task-file) TASK_FILE="$2"; shift ;;
    --delay) sleep "$2"; shift ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA="$(git -C "$REPO" rev-parse --short HEAD)"
NOTES=()
note() { echo "[$(date -u +%H:%M:%S)] $*"; NOTES+=("$*"); }
OUTCOME="FAILED"

finish() {
  local status="$1"
  if [ -n "$REPORT" ]; then
    {
      echo
      echo "## Deploy $STAMP — fork $SHA — $OUTCOME"
      echo
      for n in "${NOTES[@]}"; do echo "- $n"; done
    } >> "$REPORT"
  fi
  if [ -n "$TASK_FILE" ] && [ -f "$TASK_FILE" ]; then
    python3 - "$TASK_FILE" "$OUTCOME" "$SHA" "$STAMP" <<'PY'
import sys, pathlib
path, outcome, sha, stamp = sys.argv[1:5]
p = pathlib.Path(path)
text = p.read_text(encoding="utf-8")
marker = "Cutover result: _pending — see the cutover artifact_"
if marker in text:
    text = text.replace(marker, f"Cutover result ({stamp}, fork `{sha}`): **{outcome}** — details in the cutover artifact")
    p.write_text(text, encoding="utf-8")
PY
  fi
  exit "$status"
}

wait_for_t3() {
  local tries=0
  while [ $tries -lt 45 ]; do
    if systemctl --user is-active --quiet t3code.service \
      && curl -fsS -o /dev/null --max-time 3 "$T3_LOCAL/.well-known/t3/environment"; then
      return 0
    fi
    sleep 2; tries=$((tries+1))
  done
  return 1
}

# 1. preconditions
if [ ! -f "$REPO/apps/server/dist/bin.mjs" ] || [ ! -f "$REPO/apps/server/dist/client/index.html" ]; then
  note "build missing under $REPO/apps/server/dist — run scripts/second-brain/build.sh first"
  finish 1
fi
if [ ! -f "$DROPIN" ]; then note "drop-in $DROPIN missing"; finish 1; fi
BACKUP="$DROPIN.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp "$DROPIN" "$BACKUP"
note "backed up drop-in to $BACKUP"

# 2. point the unit at the fork build
cat > "$DROPIN" <<INI
# Second Brain fork (2026-08-19): run the source build of fredn3y/second-brain-t3
# instead of the launcher-managed npm runtime. Same env as before: doppler project
# secrets, repo cwd so the Doppler-wrapped codex resolves from any cwd, user bins
# on PATH. Rollback = restore the .bak file next to this one (ExecStart back to
# /home/fred/.t3/runtime/service-launcher.mjs) and restart.
[Service]
WorkingDirectory=/home/fred/code/second-brain
Environment=PATH=/home/fred/.local/bin:/home/fred/.local/npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=T3CODE_CONTROL_CENTER_GATEWAY_URL=$GATEWAY
ExecStart=
ExecStart=/usr/bin/doppler run --project second-brain --config dev -- /usr/bin/node $REPO/apps/server/dist/bin.mjs serve
INI
systemctl --user daemon-reload
note "restarting t3code.service on fork $SHA"
systemctl --user restart t3code.service
if wait_for_t3; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$T3_LOCAL/api/control-center/models")"
  note "t3code.service active; $T3_LOCAL answers; /api/control-center/models unauthenticated -> HTTP $code"
  if [ "$code" != "401" ]; then note "unexpected relay status $code (expected 401)"; fi
else
  note "fork server did not come up within 90s — rolling back to $BACKUP"
  cp "$BACKUP" "$DROPIN"; systemctl --user daemon-reload; systemctl --user restart t3code.service
  if wait_for_t3; then note "rollback OK: previous runtime is serving again"; OUTCOME="ROLLED BACK"; else note "rollback did NOT come up — manual attention needed"; OUTCOME="FAILED (rollback also down)"; fi
  finish 1
fi

# 3. tailnet routing
if [ "$CUTOVER" = 1 ]; then
  for p in /tasks /docs /AGENTS.md /strategy.md; do
    tailscale serve --bg --https=443 --set-path="$p" "$GATEWAY$p" >/dev/null 2>&1 || note "serve path $p failed"
  done
  tailscale serve --bg --https=443 "$T3_LOCAL" >/dev/null 2>&1 || note "serve root failed"
  root_ok=0; paths_ok=1
  root_title="$(curl -s --max-time 10 "https://$HOST/" | grep -o '<title>[^<]*</title>' | head -1)"
  [ "$root_title" = "<title>Second Brain</title>" ] && root_ok=1
  for p in /tasks/active/second-brain-t3-chat-pilot.md /docs/guidance/t3-bridge.md /AGENTS.md /strategy.md /tasks/_artifacts/previews/control-center-settings-2026-08-19.png; do
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST$p")"
    [ "$c" = "200" ] || { paths_ok=0; note "path $p -> HTTP $c"; }
  done
  relay="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/api/control-center/models")"
  if [ $root_ok = 1 ] && [ $paths_ok = 1 ]; then
    note "tailnet root https://$HOST/ now serves T3 ($root_title); gateway paths /tasks /docs /AGENTS.md /strategy.md still 200; relay unauthenticated -> $relay; :9443 untouched"
  else
    note "tailnet verification failed (root_ok=$root_ok paths_ok=$paths_ok) — re-pointing / to the gateway"
    tailscale serve --bg --https=443 "$GATEWAY" >/dev/null 2>&1
    OUTCOME="DEPLOYED, ROOT CUTOVER REVERTED"
    finish 1
  fi
fi

# 4. post checks
for u in control-center.service daybrief.timer mail-brief.timer comms-sweep.timer drift-scan.timer; do
  note "$u: $(systemctl --user is-active "$u" 2>/dev/null)"
done
if (cd /home/fred/code/second-brain && timeout 60 python3 scripts/tasks/cc/t3/cli.py config >/tmp/sbt3-deploy-config.json 2>/tmp/sbt3-deploy-config.err); then
  note "bridge auth + server config OK (providers: $(python3 -c 'import json;d=json.load(open("/tmp/sbt3-deploy-config.json"));print(",".join(p["instanceId"]+":"+p["status"] for p in d.get("providers",[])))' 2>/dev/null))"
else
  note "bridge cli config FAILED: $(head -c 200 /tmp/sbt3-deploy-config.err)"
fi
if (cd /home/fred/code/second-brain && timeout 60 python3 scripts/tasks/cc/t3/cli.py threads >/tmp/sbt3-deploy-threads.json 2>/dev/null); then
  note "thread shells visible: $(python3 -c 'import json;d=json.load(open("/tmp/sbt3-deploy-threads.json"));t=d if isinstance(d,list) else d.get("threads",[]);print(len(t))' 2>/dev/null)"
fi
note "pairing for new devices: node $REPO/apps/server/dist/bin.mjs pair (startup admin URL in ~/.t3/userdata/logs/boot-service.log)"
OUTCOME="OK"
finish 0
