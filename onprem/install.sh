#!/usr/bin/env bash
# Ituti AI Assurance: on-premises installer.
#
#   ./install.sh install    --config ituti.conf   Install, or upgrade an existing installation (backs up first)
#   ./install.sh check      --config ituti.conf   Check the server, settings, database, storage, email and AI
#   ./install.sh status | verify | admin-link | backup | doctor [--ai] | restart | stop | logs | rollback | uninstall
#
# Options: --yes (no questions), --local (ignore DEPLOY_HOST and act on this machine), --force (continue past failed
# checks), --with-files (backup: also archive the document storage), --email ADDRESS (admin-link: for another user).
#
# The deployment agent (installer/agent.cjs) does the database, settings and verification work; this script handles
# the server: copying itself over SSH, containers or the system service, folders and permissions.
set -Eeuo pipefail
umask 027

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(cat "$BUNDLE/VERSION" 2>/dev/null || echo dev)"
PROJECT=ituti-assurance

CMD=install; CONFIG=""; YES=false; LOCAL=false; FORCE=false; WITH_FILES=false; EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --yes|-y) YES=true; shift ;;
    --local) LOCAL=true; shift ;;
    --force) FORCE=true; shift ;;
    --with-files) WITH_FILES=true; shift ;;
    --ai) EXTRA+=(--ai); shift ;;
    --email) EXTRA+=(--email "$2"); shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "Unknown option $1" >&2; exit 2 ;;
    *) CMD="$1"; shift ;;
  esac
done

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '  \033[36m›\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Stopped at line $LINENO: $BASH_COMMAND"' ERR

# ---------- Settings ----------
if [[ -z "$CONFIG" ]]; then
  for c in ./ituti.conf "$BUNDLE/ituti.conf" "$BUNDLE/../ituti.conf" /opt/ituti-assurance/ituti.conf; do [[ -f "$c" ]] && CONFIG="$c" && break; done
fi
[[ -n "$CONFIG" && -f "$CONFIG" ]] || die "No settings file. Copy ituti.conf.example to ituti.conf, fill it in, and pass --config ituti.conf"
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

# Reads KEY=value lines into CONF_KEY variables without executing anything in the file.
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ ${#val} -ge 2 && ( ( "$val" == \"*\" ) || ( "$val" == \'*\' ) ) ]]; then val="${val:1:${#val}-2}"; fi
    printf -v "CONF_$key" '%s' "$val"
  fi
done < "$CONFIG"
conf() { local v="CONF_$1"; printf '%s' "${!v:-${2:-}}"; }

DEPLOY_DIR="$(conf DEPLOY_DIR /opt/ituti-assurance)"
RUNTIME="$(conf RUNTIME docker)"
STORAGE="$(conf STORAGE_PATH /srv/ituti-assurance/data)"
BACKUPS="$(conf BACKUP_PATH "$DEPLOY_DIR/backups")"
DB_MODE="$(conf DB_MODE external)"
APP_PORT="$(conf APP_PORT 3000)"

# ---------- Remote installation over SSH ----------
if [[ -n "$(conf DEPLOY_HOST)" && "$LOCAL" == false ]]; then
  HOST="$(conf DEPLOY_HOST)"; USER_AT="${CONF_DEPLOY_SSH_USER:+$CONF_DEPLOY_SSH_USER@}$HOST"
  SSH=(ssh -p "$(conf DEPLOY_SSH_PORT 22)" -o BatchMode=yes -o ConnectTimeout=15)
  [[ -n "$(conf DEPLOY_SSH_KEY)" ]] && SSH+=(-i "$(conf DEPLOY_SSH_KEY)")
  REMOTE="ituti-install-$VERSION"
  bold "Ituti AI Assurance $VERSION → $USER_AT"
  "${SSH[@]}" "$USER_AT" true 2>/dev/null || die "Cannot connect to $USER_AT over SSH. Check DEPLOY_HOST, DEPLOY_SSH_USER, DEPLOY_SSH_KEY and that key-based login works."
  ok "Connected to $USER_AT"
  info "Copying the installer ($(du -sh "$BUNDLE" | cut -f1))"
  tar -C "$BUNDLE" --exclude=./ituti.conf -czf - . | "${SSH[@]}" "$USER_AT" "rm -rf ~/$REMOTE && mkdir -p ~/$REMOTE && tar -xzf - -C ~/$REMOTE"
  "${SSH[@]}" "$USER_AT" "umask 077; cat > ~/$REMOTE/ituti.conf" < "$CONFIG"
  ok "Copied to ~/$REMOTE on the server"
  SUDO=""; [[ "$(conf DEPLOY_SUDO true)" == "true" ]] && SUDO="sudo"
  ARGS=("$CMD" --config "\$HOME/$REMOTE/ituti.conf" --local --yes)
  $FORCE && ARGS+=(--force); $WITH_FILES && ARGS+=(--with-files); ARGS+=("${EXTRA[@]}")
  set +e; trap - ERR
  TTY=(); [[ -t 0 ]] && TTY=(-t)
  "${SSH[@]}" "${TTY[@]}" "$USER_AT" "cd ~/$REMOTE && $SUDO bash ./install.sh ${ARGS[*]}"
  rc=$?
  # The installer keeps its own copy in DEPLOY_DIR/installer on the server; remove the transfer copy and settings
  "${SSH[@]}" "$USER_AT" "rm -rf ~/$REMOTE" >/dev/null 2>&1
  [[ $rc -eq 0 ]] && info "Later commands can be run on the server: sudo $DEPLOY_DIR/installer/install.sh status"
  exit $rc
fi

# ---------- Local: privileges ----------
if [[ $EUID -ne 0 && "$(conf DEPLOY_SUDO true)" == "true" && "$CMD" != "check" ]]; then
  command -v sudo >/dev/null || die "Run as root, or install sudo, or set DEPLOY_SUDO=false and own DEPLOY_DIR and STORAGE_PATH."
  exec sudo -E bash "$0" "$CMD" --config "$CONFIG" --local $($YES && echo --yes) $($FORCE && echo --force) $($WITH_FILES && echo --with-files) "${EXTRA[@]}"
fi

STATE="$DEPLOY_DIR/state.json"
state() { [[ -f "$STATE" ]] && sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$STATE" | head -1 || true; }
IMAGE_TAG="$(conf IMAGE)"; [[ -z "$IMAGE_TAG" ]] && IMAGE_TAG="ituti-ai-assurance:$VERSION"
compose() { docker compose -f "$DEPLOY_DIR/docker-compose.yml" -p "$PROJECT" "$@"; }
SERVICE_USER=ituti

# Runs the deployment agent: inside the application image (docker runtime) or with this server's Node.js.
agent() {
  local sub="$1"; shift
  if [[ "$RUNTIME" == "docker" ]]; then
    local net=(--network host) mounts=(-v "$DEPLOY_DIR:$DEPLOY_DIR" -v "$CONFIG:/run/ituti/ituti.conf:ro" -v "$STORAGE:/data")
    [[ "$DB_MODE" == "bundled" ]] && docker network inspect "${PROJECT}_default" >/dev/null 2>&1 && net=(--network "${PROJECT}_default")
    [[ -n "$(conf DB_SSL_CA)" ]] && mounts+=(-v "$(conf DB_SSL_CA):$(conf DB_SSL_CA):ro")
    [[ "$sub" == "backup" ]] && mounts+=(-v "$BACKUPS:$BACKUPS")
    docker run --rm "${net[@]}" "${mounts[@]}" --user 0 -e APP_VERSION="$VERSION" "$IMAGE_TAG" \
      node /app/installer/agent.cjs "$sub" --config /run/ituti/ituti.conf --deploy-dir "$DEPLOY_DIR" --storage /data --image "$IMAGE_TAG" "$@"
  else
    APP_VERSION="$VERSION" node "$BUNDLE/installer/agent.cjs" "$sub" --config "$CONFIG" --deploy-dir "$DEPLOY_DIR" "$@"
  fi
}

confirm() { $YES && return 0; read -r -p "  $1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]; }

# ---------- Server checks ----------
preflight() {
  bold "Server"
  [[ "$(uname -s)" == "Linux" ]] || die "This installer supports Linux servers."
  ok "$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr ), $(uname -m), $(nproc 2>/dev/null || echo ?) CPUs, $(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo) memory"
  local mem; mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  (( mem >= 1800 )) || warn "Less than 2 GB of memory: assessments may be slow."
  if [[ "$RUNTIME" == "docker" ]]; then
    command -v docker >/dev/null || die "Docker is not installed. Install Docker Engine 24+ with the compose plugin, or set RUNTIME=node."
    docker info >/dev/null 2>&1 || die "Docker is installed but not running (or this account cannot use it)."
    docker compose version >/dev/null 2>&1 || die "The Docker compose plugin is missing (docker compose version)."
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"
  else
    command -v node >/dev/null || die "Node.js 22 or later is needed for RUNTIME=node."
    local nv; nv=$(node -p 'process.versions.node.split(".")[0]')
    (( nv >= 22 )) || die "Node.js $(node -v) is too old: install Node.js 22 or later."
    ok "Node.js $(node -v)"
  fi
  local parent="$DEPLOY_DIR"; while [[ ! -d "$parent" ]]; do parent="$(dirname "$parent")"; done
  local free; free=$(df -Pk "$parent" | awk 'NR==2 {print int($4/1048576)}')
  (( free >= 2 )) || die "Less than 2 GB free under $parent for the application."
  ok "$free GB free for the application under $parent"
  if [[ -z "$(state version)" ]] && command -v ss >/dev/null; then
    if ss -ltnH "sport = :$APP_PORT" 2>/dev/null | grep -q .; then die "Port $APP_PORT is already in use. Choose another APP_PORT."; fi
    ok "Port $APP_PORT is free"
  fi
}

# ---------- Application image or files ----------
prepare_runtime() {
  bold "Application $VERSION"
  if [[ "$RUNTIME" == "docker" ]]; then
    if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then ok "Image $IMAGE_TAG is present"
    elif [[ -n "$(conf IMAGE)" ]]; then info "Pulling $IMAGE_TAG"; docker pull "$IMAGE_TAG" >/dev/null && ok "Pulled $IMAGE_TAG"
    elif compgen -G "$BUNDLE/images/*.tar.gz" >/dev/null; then
      for f in "$BUNDLE"/images/*.tar.gz; do info "Loading $(basename "$f")"; docker load -i "$f" >/dev/null; done
      ok "Loaded the bundled images"
    else
      info "Building $IMAGE_TAG from the bundled application (base image $(conf BASE_IMAGE node:22-bookworm-slim))"
      docker build -q -t "$IMAGE_TAG" --build-arg BASE_IMAGE="$(conf BASE_IMAGE node:22-bookworm-slim)" -f "$BUNDLE/Dockerfile" "$BUNDLE" >/dev/null \
        || die "Could not build the image. The server must reach the base image registry, or use a bundle that includes images/."
      ok "Built $IMAGE_TAG"
    fi
  else
    local rel="$DEPLOY_DIR/releases/$VERSION"
    if [[ ! -f "$rel/server.js" ]]; then
      mkdir -p "$DEPLOY_DIR/releases"
      cp -a "$BUNDLE/app" "$rel.tmp" && mv "$rel.tmp" "$rel"
    fi
    # The service account reads the application files but cannot change them
    if [[ $EUID -eq 0 ]]; then id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DEPLOY_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"; chgrp -R "$SERVICE_USER" "$DEPLOY_DIR/releases"; chmod -R g+rX,o-rwx "$DEPLOY_DIR/releases"; fi
    ok "Application files in $rel"
  fi
}

folders() {
  bold "Folders"
  # Parent folders must stay traversable by the service account; the folders themselves are locked down below
  ( umask 022; mkdir -p "$DEPLOY_DIR/logs" "$STORAGE" "$BACKUPS" )
  chmod 750 "$DEPLOY_DIR" "$STORAGE"; chmod 700 "$BACKUPS"
  if [[ "$RUNTIME" == "docker" ]]; then
    chown -R 10001:10001 "$STORAGE" 2>/dev/null || warn "Could not give $STORAGE to user id 10001; make it writable by the container user."
  elif [[ $EUID -eq 0 ]]; then
    id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DEPLOY_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$STORAGE" "$DEPLOY_DIR/logs"
    chgrp "$SERVICE_USER" "$DEPLOY_DIR"
  fi
  ok "$DEPLOY_DIR (application), $STORAGE (documents), $BACKUPS (backups)"
}

# ---------- Start and stop ----------
has_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null; }

start_node() {
  ln -sfn "$DEPLOY_DIR/releases/$VERSION" "$DEPLOY_DIR/current"
  [[ $EUID -eq 0 ]] && { chgrp "$SERVICE_USER" "$DEPLOY_DIR/app.env"; chmod 640 "$DEPLOY_DIR/app.env"; }
  local node_bin; node_bin="$(command -v node)"
  if has_systemd && [[ $EUID -eq 0 ]]; then
    cat > /etc/systemd/system/ituti-assurance.service <<UNIT
[Unit]
Description=Ituti AI Assurance
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$DEPLOY_DIR/current
ExecStart=$node_bin --env-file=$DEPLOY_DIR/app.env server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$STORAGE $DEPLOY_DIR/logs
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable ituti-assurance >/dev/null 2>&1
    systemctl restart ituti-assurance
    ok "Service ituti-assurance (systemd) started"
  else
    stop_node
    local run=(nohup "$node_bin" --env-file="$DEPLOY_DIR/app.env" server.js)
    if [[ $EUID -eq 0 ]] && command -v runuser >/dev/null; then run=(runuser -u "$SERVICE_USER" -- "${run[@]}"); fi
    ( trap - ERR; cd "$DEPLOY_DIR/current" || exit 1; exec setsid "${run[@]}" >>"$DEPLOY_DIR/logs/app.log" 2>&1 </dev/null ) &
    echo $! > "$DEPLOY_DIR/app.pid"
    warn "No systemd here: started in the background (pid $(cat "$DEPLOY_DIR/app.pid")); it will not restart after a reboot."
  fi
}
stop_node() {
  if has_systemd && systemctl list-unit-files ituti-assurance.service >/dev/null 2>&1; then systemctl stop ituti-assurance 2>/dev/null || true; fi
  if [[ -f "$DEPLOY_DIR/app.pid" ]]; then
    local pid; pid=$(cat "$DEPLOY_DIR/app.pid")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    rm -f "$DEPLOY_DIR/app.pid"
  fi
}

save_state() {
  local prev; prev="$(state version)"
  [[ "$prev" == "$VERSION" ]] && prev="$(state previous)"
  cat > "$STATE" <<JSON
{
  "version": "$VERSION",
  "previous": "$prev",
  "runtime": "$RUNTIME",
  "image": "$([[ "$RUNTIME" == docker ]] && echo "$IMAGE_TAG")",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  # Keep this installer and the settings on the server for later commands (status, backup, upgrade, ...)
  if [[ "$BUNDLE" == "$DEPLOY_DIR/installer" ]]; then return 0; fi
  mkdir -p "$DEPLOY_DIR/installer/installer"
  cp "$BUNDLE/install.sh" "$BUNDLE/VERSION" "$BUNDLE/ituti.conf.example" "$DEPLOY_DIR/installer/"
  [[ -f "$BUNDLE/README.md" ]] && cp "$BUNDLE/README.md" "$DEPLOY_DIR/installer/"
  cp "$BUNDLE/installer/agent.cjs" "$DEPLOY_DIR/installer/installer/"
  [[ -d "$BUNDLE/app" && "$RUNTIME" == node ]] && ln -sfn "$DEPLOY_DIR/releases/$VERSION" "$DEPLOY_DIR/installer/app"
  # The server's copy of the settings acts on the server itself: no SSH target
  if [[ "$CONFIG" != "$DEPLOY_DIR/ituti.conf" ]]; then
    ( umask 077; sed 's/^DEPLOY_HOST=.*/DEPLOY_HOST=/' "$CONFIG" > "$DEPLOY_DIR/ituti.conf" )
  fi
  return 0
}

backup_now() {
  local out dir
  out="$(agent backup)"; printf '%s\n' "$out" | grep -v '^BACKUP_DIR=' || true
  dir="$(printf '%s\n' "$out" | sed -n 's/^BACKUP_DIR=//p' | tail -1)"
  [[ -n "$dir" ]] || die "The database backup failed."
  cp "$DEPLOY_DIR/secrets.env" "$DEPLOY_DIR/app.env" "$dir/" 2>/dev/null || true
  [[ -f "$DEPLOY_DIR/docker-compose.yml" ]] && cp "$DEPLOY_DIR/docker-compose.yml" "$dir/"
  if $WITH_FILES; then
    info "Archiving the documents in $STORAGE"
    tar -C "$STORAGE" -czf "$dir/documents.tar.gz" . && ok "Documents saved to $dir/documents.tar.gz ($(du -sh "$dir/documents.tar.gz" | cut -f1))"
  fi
  chmod -R go-rwx "$dir"
  ok "Backup complete: $dir"
}

# ---------- Commands ----------
summary() {
  local url; url="$(conf APP_URL)"; url="${url%/}"
  bold "Done: Ituti AI Assurance $VERSION is running"
  cat <<TXT
  Open:              $url
  Administration:    $url/admin  (Spend: $url/admin/spend, System: $url/admin/system)
  Agents (A2A):      $url/api/a2a  and one per specialist, listed at $url/api/a2a/agents
  Settings:          $DEPLOY_DIR/ituti.conf  (change, then run: $DEPLOY_DIR/installer/install.sh install)
  Logs:              $( [[ "$RUNTIME" == docker ]] && echo "docker compose -p $PROJECT logs -f app" || (has_systemd && echo "journalctl -u ituti-assurance -f" || echo "$DEPLOY_DIR/logs/app.log") )
  Backups:           $DEPLOY_DIR/installer/install.sh backup [--with-files]
TXT
}

do_install() {
  local existing; existing="$(state version)"
  bold "Ituti AI Assurance $VERSION: $([[ -n "$existing" ]] && echo "upgrade from $existing" || echo "new installation") in $DEPLOY_DIR ($RUNTIME runtime)"
  preflight
  prepare_runtime
  folders
  bold "Checks by the deployment agent"
  if ! agent check; then
    $FORCE || die "Fix the items marked ✗ above and run the installer again (or add --force to continue anyway)."
    warn "Continuing despite failed checks (--force)."
  fi
  [[ -n "$existing" ]] && { bold "Backup before upgrading"; backup_now; }
  confirm "Install now?" || die "Stopped; nothing was changed apart from folders."
  agent env
  if [[ "$RUNTIME" == "docker" ]]; then
    if [[ "$DB_MODE" == "bundled" ]]; then
      bold "Bundled database"
      compose up -d --wait db >/dev/null && ok "MariaDB is running"
    fi
    agent db
    bold "Starting"
    compose up -d --remove-orphans --wait >/dev/null 2>&1 || compose up -d --remove-orphans >/dev/null
    ok "Containers: $(compose ps --format '{{.Service}} {{.State}}' | tr '\n' ' ')"
  else
    agent db
    bold "Starting"
    start_node
  fi
  agent verify || die "The service did not start correctly. Run: $0 doctor --config $CONFIG"
  save_state
  if [[ -z "$existing" ]]; then agent admin-link; fi
  summary
}

case "$CMD" in
  install|upgrade) do_install ;;
  check) preflight; prepare_runtime; agent check ;;
  status) agent status ;;
  verify) agent verify ;;
  admin-link) agent admin-link "${EXTRA[@]}" ;;
  backup) mkdir -p "$BACKUPS"; backup_now ;;
  doctor) agent doctor "${EXTRA[@]}" || true ;;
  restart) if [[ "$RUNTIME" == docker ]]; then compose restart app; else start_node; fi; agent verify ;;
  stop) if [[ "$RUNTIME" == docker ]]; then compose stop; else stop_node; fi; ok "Stopped" ;;
  logs) if [[ "$RUNTIME" == docker ]]; then compose logs --tail 200 app; elif has_systemd; then journalctl -u ituti-assurance -n 200 --no-pager; else tail -n 200 "$DEPLOY_DIR/logs/app.log"; fi ;;
  rollback)
    prev="$(state previous)"; [[ -n "$prev" ]] || die "No earlier version is recorded."
    warn "Rolling back to $prev. Database changes made by $(state version) stay; if $prev cannot use them, restore the backup taken before the upgrade (in $BACKUPS)."
    confirm "Roll back to $prev?" || exit 1
    if [[ "$RUNTIME" == docker ]]; then sed -i "s#^\(    image: \)ituti-ai-assurance:.*#\1ituti-ai-assurance:$prev#" "$DEPLOY_DIR/docker-compose.yml"; compose up -d app
    else [[ -d "$DEPLOY_DIR/releases/$prev" ]] || die "Release $prev is no longer on this server."; VERSION="$prev"; start_node; fi
    cur="$(state version)"; agent verify
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$prev\"/; s/\"previous\": \"[^\"]*\"/\"previous\": \"$cur\"/" "$STATE"; ok "Rolled back to $prev" ;;
  uninstall)
    warn "This stops and removes the service. The database, documents ($STORAGE) and backups ($BACKUPS) are kept."
    confirm "Uninstall?" || exit 1
    if [[ "$RUNTIME" == docker ]]; then compose down; else stop_node; has_systemd && { systemctl disable ituti-assurance >/dev/null 2>&1 || true; rm -f /etc/systemd/system/ituti-assurance.service; systemctl daemon-reload; }; fi
    ok "Removed the service. To remove everything: delete $DEPLOY_DIR, $STORAGE and $BACKUPS, and drop the database $(conf DB_NAME)." ;;
  *) die "Unknown command $CMD. Run $0 --help" ;;
esac
