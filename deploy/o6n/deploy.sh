#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
state="$HOME/.local/state/o6n-smart-chat"
agent_state="$HOME/.local/state/orion-agent"
unit_dir="$HOME/.config/systemd/user"
release="$HOME/.local/share/orion-lab/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
units=(o6n-smart-chat.service orion-agent.service model-benchmark-dashboard.service)

[[ $# == 0 ]] || { echo 'Usage: bash deploy/o6n/deploy.sh' >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == aarch64 && $EUID != 0 ]] || {
  echo 'Run as the deployment user on the ARM64 Linux device.' >&2; exit 2;
}
for cmd in node npm python3 curl systemctl flock bwrap prlimit; do command -v "$cmd" >/dev/null; done
node -e 'const [m,n]=process.versions.node.split(".").map(Number); if(m<22||(m===22&&n<19))throw Error("Node.js >=22.19 is required")'
python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ is required"'
node_bin=$(command -v node)
systemctl --user show-environment >/dev/null
mkdir -p "$unit_dir" "$agent_state" "$(dirname -- "$release")"
exec 9>"$HOME/.local/share/orion-lab/deploy.lock"
flock -n 9 || { echo 'An Orion Lab deployment is in progress.' >&2; exit 1; }

for unit in "${units[@]}"; do
  [[ $(systemctl --user show "$unit" --property=LoadState --value) == not-found && ! -e "$unit_dir/$unit" && ! -L "$unit_dir/$unit" ]] || {
    printf 'Existing unit %s detected. Use the existing-device instructions in README.md.\n' "$unit" >&2; exit 1;
  }
done
python3 - "$state/settings.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
values = json.loads(p.read_text(encoding='utf-8'))
for name in ('controlled_workspace', 'controlled_gateway_key', 'webhook_token'):
    value = values.get(name)
    if not isinstance(value, str) or not value.strip() or value.startswith(('YOUR_', 'REPLACE_')):
        raise SystemExit(f'Configure {name} in the device-private settings.json before deployment')
PY
for cert in "$state/tls/server.crt" "$state/tls/server.key"; do test -s "$cert"; done
for endpoint in http://127.0.0.1:13000/health http://127.0.0.1:17792/health http://127.0.0.1:17777/health; do
  curl -fsS --max-time 8 "$endpoint" >/dev/null || { printf 'Dependency unavailable: %s\n' "$endpoint" >&2; exit 1; }
done

cd -- "$root"
npm ci --no-audit --no-fund
# The public build is independent of historical measurements and developer proxy configuration.
unset O6N_DATA_DIR O6N_BUILD_DIR O6N_DEV_API_TARGET O6N_DEV_STATUS_TARGET O6N_DEV_RESOURCES_TARGET
O6N_RUNTIME_MODE=live npm run build
npm run package:release
npm run package:agent

mkdir -p "$release"/{chat,resources,units}
cp services/o6n-bridge/*.py "$release/chat/"
cp services/dashboard/{server,resource_probe}.py "$release/resources/"
cp -R .runtime/release/chat "$release/chat/web-v3"
cp -R .runtime/release/dashboard "$release/resources/current"
cp -R .runtime/agent-release "$release/agent"
(cd "$release/agent" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
python3 -m venv "$release/python"
"$release/python/bin/python" -m pip install -r services/o6n-bridge/requirements-documents.txt

cat > "$release/units/${units[0]}" <<EOF
[Unit]
Description=Orion Lab controlled chat and HTTPS proxy
[Service]
Type=simple
ExecStart="$release/python/bin/python" "$release/chat/controlled_bridge.py"
Restart=on-failure
UMask=0077
[Install]
WantedBy=default.target
EOF
cat > "$release/units/${units[1]}" <<EOF
[Unit]
Description=Orion Lab Pi Agent
After=o6n-smart-chat.service
Requires=o6n-smart-chat.service
[Service]
Type=simple
WorkingDirectory=$release/agent
Environment="ORION_AGENT_STATE=$agent_state"
Environment=NODE_ENV=production
ExecStart="$node_bin" "$release/agent/server.mjs"
Restart=on-failure
NoNewPrivileges=true
UMask=0077
MemoryMax=1G
TasksMax=128
KillMode=control-group
TimeoutStopSec=10
[Install]
WantedBy=default.target
EOF
cat > "$release/units/${units[2]}" <<EOF
[Unit]
Description=Orion Lab resource dashboard
[Service]
Type=simple
ExecStart="$release/python/bin/python" "$release/resources/server.py" --port 17780
Restart=on-failure
UMask=0077
[Install]
WantedBy=default.target
EOF

installed=()
rollback() {
  local status=$?
  if [[ $status != 0 && ${#installed[@]} != 0 ]]; then
    set +e
    systemctl --user disable --now "${installed[@]}"
    for unit in "${installed[@]}"; do rm -f -- "$unit_dir/$unit"; done
    systemctl --user daemon-reload
    printf 'Deployment failed. Staged release retained at %s\n' "$release" >&2
  fi
}
trap rollback EXIT
for unit in "${units[@]}"; do
  (set -o noclobber; cat "$release/units/$unit" > "$unit_dir/$unit")
  installed+=("$unit")
done
systemctl --user daemon-reload
systemctl --user start "${units[@]}"
for endpoint in http://127.0.0.1:17790/api/health http://127.0.0.1:17780/api/health; do
  curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 8 "$endpoint" >/dev/null
done
for unit in "${units[@]}"; do systemctl --user is-active --quiet "$unit"; done
systemctl --user enable "${units[@]}"
printf 'Orion Lab deployed at %s\n' "$release"
