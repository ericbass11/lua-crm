#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'This helper is restricted to CI runners.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && ${VERSION_CODENAME:-} =~ ^[a-z]+$ ]] || { echo 'An Ubuntu runner is required.' >&2; exit 1; }
base=$(cd -- "$(dirname -- "$0")" && pwd)
for tool in curl timeout sudo python3 pnpm; do command -v "$tool" >/dev/null; done
# Probe the official signed archive before changing runner package sources.
curl --fail --silent --show-error --head --connect-timeout 5 --max-time 15 \
  "https://archive.ubuntu.com/ubuntu/dists/$VERSION_CODENAME/InRelease" >/dev/null
sudo -n timeout --kill-after=5s 10s python3 "$base/prepare-e2e-apt.py"
# Root timeout owns the APT process group; killing an unprivileged parent alone
# would leave sudo/APT alive. Keep Chromium AND all OS dependencies installed.
sudo -n timeout --kill-after=10s 160s env "PATH=$PATH" pnpm exec playwright install-deps chromium
timeout --kill-after=10s 80s pnpm exec playwright install chromium
