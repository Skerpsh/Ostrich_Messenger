#!/usr/bin/env bash
# Deploys Ostrich on the server: pulls the code, backs up the database,
# builds and migrates the backend, restarts it, checks it answers,
# publishes the web app, and releases the apps (the next version's tag).
#
#   deploy/deploy.sh                 # backend and web
#   deploy/deploy.sh --backend-only
#   deploy/deploy.sh --web-only
#   deploy/deploy.sh --no-backup     # skip the database backup
#   deploy/deploy.sh --no-release    # no new version of the apps
#
# Paths and names can be changed with the variables below.
set -euo pipefail

# Everything runs inside main(), which bash reads completely before running
# it: `git pull` below may replace this file, and bash would otherwise go on
# reading the new version from the old position.
main() {

REPO="${REPO:-/opt/ostrich}"
SERVICE="${SERVICE:-ostrich}"
# Several backend processes (ostrich@3001 ostrich@3002 ..., see
# deploy/README.md): restarted one after another, each checked on its port,
# so the others keep serving meanwhile.
SERVICES="${SERVICES:-$SERVICE}"
WEB_ROOT="${WEB_ROOT:-/var/www/ostrich-web}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
# The release of the apps (below): a fine-grained GitHub token of the
# repository with "Contents: Read and write", in a file only root reads.
RELEASE_TOKEN_FILE="${RELEASE_TOKEN_FILE:-/etc/ostrich/release-token}"
GITHUB_REPO="${GITHUB_REPO:-Skerpsh/Ostrich_Messenger}"

backend=1
web=1
backup=1
release=1

for arg in "$@"; do
  case "$arg" in
    --backend-only) web=0 ;;
    --web-only) backend=0 ;;
    --no-backup) backup=0 ;;
    --no-release) release=0 ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "deploy: unknown option $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }

# The version of what is deployed: the commit's tag; else the next one
# (v1.5.5 → 1.5.6), which the end of the script tags, or, without a
# release, the last one and the commit ("1.5.5+c23b2c2").
release_version() {
  local commit last major minor patch
  commit=$(git -C "$REPO" rev-parse HEAD)
  git -C "$REPO" fetch --tags --quiet origin 2>/dev/null || true
  last=$(git -C "$REPO" tag --points-at "$commit" -l 'v*' | head -1)

  if [ -n "$last" ]; then
    echo "${last#v}"
    return
  fi

  last=$(git -C "$REPO" tag -l 'v*' --sort=-v:refname | head -1)
  last="${last:-v0.0.0}"

  if [ "$release" = 1 ] && [ -r "$RELEASE_TOKEN_FILE" ]; then
    IFS=. read -r major minor patch <<<"${last#v}"
    echo "$major.$minor.$((patch + 1))"
  else
    echo "${last#v}+$(git -C "$REPO" rev-parse --short HEAD)"
  fi
}

cd "$REPO"

step "Pulling the code"
git pull --ff-only

# Once, after the move to apps/ (backend/ became apps/server, ops/ became
# deploy/): the server's .env and the attachments are not in git, so they
# move here, and the installed systemd units are pointed at the new paths.
# backend/data stays as a link until the running processes are restarted
# below, so that uploads meanwhile land in the same place.
if [ -f "$REPO/backend/.env" ] && [ ! -e "$REPO/apps/server/.env" ]; then
  step "Moving the server's .env and attachments to apps/server (once)"
  mv "$REPO/backend/.env" "$REPO/apps/server/.env"

  if [ -d "$REPO/backend/data" ] && [ ! -L "$REPO/backend/data" ]; then
    mv "$REPO/backend/data" "$REPO/apps/server/data"
    ln -s "$REPO/apps/server/data" "$REPO/backend/data"
  fi

  for unit in /etc/systemd/system/ostrich*.service /etc/systemd/system/ostrich*.timer /etc/systemd/system/ostrich*.d/*.conf; do
    if [ -f "$unit" ]; then
      sed -i "s#$REPO/backend#$REPO/apps/server#g; s#$REPO/ops/#$REPO/deploy/#g" "$unit"
    fi
  done

  systemctl daemon-reload
fi

# The web app's build settings (.env.local with EXPO_PUBLIC_API_URL...), the
# same way, from frontend/.
for env in .env .env.local .env.production .env.production.local; do
  if [ -f "$REPO/frontend/$env" ] && [ ! -e "$REPO/apps/mobile-web/$env" ]; then
    mv "$REPO/frontend/$env" "$REPO/apps/mobile-web/$env"
  fi
done

if [ "$backend" = 1 ]; then
  if [ "$backup" = 1 ]; then
    step "Backing up the database"
    "$REPO/deploy/backup.sh"
  fi

  step "Building the backend"
  cd "$REPO/apps/server"
  npm ci
  npm run build

  step "Migrating the database"
  npm run db:migrate:prod

  for service in $SERVICES; do
    # ostrich@3001 answers on port 3001; a single service at HEALTH_URL.
    url="$HEALTH_URL"
    port="${service#*@}"

    if [ "$port" != "$service" ]; then
      url="http://127.0.0.1:$port/api/health"
    fi

    step "Restarting $service"
    systemctl restart "$service"

    step "Checking that $service answers"
    for _ in $(seq 1 30); do
      if curl -fsS "$url" >/dev/null 2>&1; then
        echo "$service is up"
        break
      fi
      sleep 1
    done

    if ! curl -fsS "$url" >/dev/null 2>&1; then
      echo "deploy: $service does not answer at $url; last log lines:" >&2
      journalctl -u "$service" -n 30 --no-pager >&2 || true
      exit 1
    fi
  done

  # The monitoring bot runs the same build (see deploy/README.md).
  if systemctl is-enabled --quiet ostrich-monitor 2>/dev/null; then
    step "Restarting ostrich-monitor"
    systemctl restart ostrich-monitor
  fi
fi

if [ "$web" = 1 ]; then
  step "Building the web app"
  cd "$REPO/apps/mobile-web"
  npm ci
  # Shown in Settings: the version this deploy releases (see below).
  EXPO_PUBLIC_APP_VERSION="$(release_version)" npm run build:web

  step "Publishing to $WEB_ROOT"
  mkdir -p "$WEB_ROOT"
  # New files first, old ones removed after: the site never goes blank.
  rsync -a --delete-after dist/ "$WEB_ROOT/"
fi

# The apps (desktop, Android, CLI) carry their own copy of the code: the
# next version's tag on what was deployed starts their release
# (.github/workflows/release.yml), from which they update themselves. Made
# through GitHub's API, so the server needs no key to push; a failure does
# not undo the deploy.
if [ "$release" = 1 ] && [ -r "$RELEASE_TOKEN_FILE" ]; then
  step "Releasing the apps"
  cd "$REPO"
  commit=$(git rev-parse HEAD)
  git fetch --tags --quiet origin || true

  if git tag --points-at "$commit" | grep -q '^v'; then
    echo "This commit is released already ($(git tag --points-at "$commit" | grep '^v' | head -1))"
  else
    next="v$(release_version)"

    if curl -fsS -o /dev/null -X POST \
      -H "Authorization: Bearer $(cat "$RELEASE_TOKEN_FILE")" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$GITHUB_REPO/git/refs" \
      -d "{\"ref\": \"refs/tags/$next\", \"sha\": \"$commit\"}"; then
      echo "Tagged $next: GitHub Actions builds and publishes it, and the apps update to it"
    else
      echo "deploy: could not tag $next (is the token in $RELEASE_TOKEN_FILE valid?); the deploy itself is done" >&2
    fi
  fi
elif [ "$release" = 1 ]; then
  echo
  echo "No $RELEASE_TOKEN_FILE: the apps are not released (see deploy/README.md)"
fi

step "Done"

}

main "$@"
