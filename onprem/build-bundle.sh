#!/usr/bin/env bash
# Builds the on-premises release bundle: dist/onprem/ituti-ai-assurance-onprem-<version>.tar.gz
#
#   onprem/build-bundle.sh                 Application, deployment agent and installer (the server builds or pulls the image)
#   onprem/build-bundle.sh --image         Also the container image, saved into the bundle (for servers without registry access)
#   onprem/build-bundle.sh --image --deps  Also the MariaDB and Caddy images (fully offline / air-gapped installs)
#
# VERSION defaults to package.json's version plus the git commit.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
IMAGE=false; DEPS=false
for a in "$@"; do case "$a" in --image) IMAGE=true ;; --deps) DEPS=true ;; *) echo "Unknown option $a" >&2; exit 2 ;; esac; done
VERSION="${VERSION:-$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
NAME="ituti-ai-assurance-onprem-$VERSION"
OUT="dist/onprem"; STAGE="$OUT/$NAME"
echo "Building $NAME"

[[ -d node_modules ]] || npm ci --no-audit --no-fund
NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null

rm -rf "$STAGE"; mkdir -p "$STAGE/installer" "$STAGE/images"
cp -a .next/standalone "$STAGE/app"
mkdir -p "$STAGE/app/.next" && cp -a .next/static "$STAGE/app/.next/static"
cp -a public "$STAGE/app/public"
# Never ship local settings or source files the build tracer may have picked up
find "$STAGE/app" -maxdepth 1 -name '.env*' -delete
rm -rf "$STAGE/app/src" "$STAGE/app/data"
npx esbuild onprem/installer/agent.ts --bundle --platform=node --target=node22 --minify-syntax --legal-comments=none \
  --outfile="$STAGE/installer/agent.cjs" --log-level=warning
cp onprem/install.sh onprem/ituti.conf.example onprem/README.md onprem/Dockerfile "$STAGE/"
chmod +x "$STAGE/install.sh"
echo "$VERSION" > "$STAGE/VERSION"
cp "$STAGE/VERSION" "$STAGE/app/VERSION"

if $IMAGE; then
  docker build -q -t "ituti-ai-assurance:$VERSION" -f "$STAGE/Dockerfile" "$STAGE" >/dev/null
  docker save "ituti-ai-assurance:$VERSION" | gzip > "$STAGE/images/ituti-ai-assurance-$VERSION.tar.gz"
  if $DEPS; then
    for img in mariadb:11.4 caddy:2.8; do docker pull -q "$img" >/dev/null; docker save "$img" | gzip > "$STAGE/images/${img/:/-}.tar.gz"; done
  fi
fi
rmdir "$STAGE/images" 2>/dev/null || true

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
echo "Wrote $OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
