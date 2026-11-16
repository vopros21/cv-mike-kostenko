#!/usr/bin/env bash
# Refreshes the homepage's live figures from the Raspberry Pi and pushes them.
# Run by systemd (stats/systemd/singledev-stats.{service,timer}); see README, "Live figures".
#
#   1. git pull --rebase on $BRANCH (default main) in $REPO (default ~/cv-site)
#   2. node stats/collect.mjs  (sources that fail give null; nothing is invented)
#   3. commit docs/data/live.json + docs/index.html only if a value or status changed,
#      or the last data commit is older than 24 h; then push
# Exits non-zero on any failure; the two files are restored so nothing partial is committed.
set -Eeuo pipefail

BEFORE=""
trap '[[ -n "$BEFORE" ]] && rm -f "$BEFORE"' EXIT

main() {
  local repo="${REPO:-$HOME/cv-site}"
  local branch="${BRANCH:-main}"
  local env_file="${ENV_FILE:-$HOME/.config/singledev-stats/env}"
  local max_age=$((24 * 60 * 60))
  local files=(docs/data/live.json docs/index.html)
  local message='data: refresh live figures'

  cd "$repo"
  if [[ -r "$env_file" ]]; then set -a; . "$env_file"; set +a; fi

  BEFORE="$(mktemp)"
  trap 'echo "run-on-pi: failed (line $LINENO); restoring ${files[*]}" >&2; git checkout -q -- "${files[@]}" 2>/dev/null || true' ERR

  git fetch -q origin "$branch"
  git checkout -q "$branch"
  git pull -q --rebase origin "$branch"
  cp docs/data/live.json "$BEFORE"

  node stats/collect.mjs

  local reason
  if node stats/changed.mjs "$BEFORE" docs/data/live.json; then
    reason='figures or statuses changed'
  else
    local last age
    last="$(git log -1 --format=%ct --grep="^${message}\$" -- docs/data/live.json)"
    age=$(( $(date +%s) - ${last:-0} ))
    if (( age > max_age )); then
      reason="last data commit is $(( age / 3600 )) h old"
    else
      echo "run-on-pi: no change, last data commit $(( age / 60 )) min ago; nothing to commit"
      git checkout -q -- "${files[@]}"
      return 0
    fi
  fi

  git add -- "${files[@]}"
  local extra
  extra="$(git diff --cached --name-only | grep -vxF -e docs/data/live.json -e docs/index.html || true)"
  if [[ -n "$extra" ]]; then
    echo "run-on-pi: refusing to commit unexpected files: $extra" >&2
    return 1
  fi
  git commit -q -m "$message"
  git push -q origin "HEAD:$branch"
  echo "run-on-pi: committed and pushed to $branch ($reason)"
}

main "$@"
