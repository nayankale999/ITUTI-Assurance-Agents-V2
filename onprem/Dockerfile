# Runtime image for the on-premises bundle. Built from the bundle's prebuilt application, so no source code or
# build tools are needed on the server. BASE_IMAGE can point at your internal registry mirror; any image with
# Node.js 22 and a shell works (Debian, Alpine or a hardened corporate base).
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/app/data
COPY --chown=0:0 app/ ./
COPY --chown=0:0 installer/agent.cjs ./installer/agent.cjs
COPY --chown=0:0 VERSION ./VERSION
# The app runs as an unprivileged numeric user; only its document folder and the Next.js cache are writable
RUN mkdir -p /app/data /app/.next/cache && chown 10001:10001 /app/data /app/.next/cache
USER 10001:10001
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
