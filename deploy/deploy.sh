#!/usr/bin/env bash
# Deploys Ostrich on the server: pulls the code, backs up the database,
# builds and migrates the backend, restarts it, checks it answers, and
# publishes the web app.
#
#   deploy/deploy.sh                 # backend and web
#   deploy/deploy.sh --backend-only
#   deploy/deploy.sh --web-only
#   deploy/deploy.sh --no-backup     # skip the database backup
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

backend=1
web=1
backup=1

for arg in "$@"; do
  case "$arg" in
    --backend-only) web=0 ;;
    --web-only) backend=0 ;;
    --no-backup) backup=0 ;;
    -h | --help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "deploy: unknown option $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }

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
  npm run build:web

  step "Publishing to $WEB_ROOT"
  mkdir -p "$WEB_ROOT"
  # New files first, old ones removed after: the site never goes blank.
  rsync -a --delete-after dist/ "$WEB_ROOT/"
fi

step "Done"

}

main "$@"
