# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps + build
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ------------------------------------------------- só dependências de produção
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --------------------------------------------------------------------- runtime
# Imagem final sem TypeScript, sem devDependencies, sem código-fonte .ts.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1
# tracing.js precisa carregar antes da app para instrumentar http/undici/ioredis.
CMD ["node", "--enable-source-maps", "--import", "./dist/infra/telemetry/tracing/tracing.js", "dist/server.js"]
