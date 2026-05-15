# ════ 阶段 1：安装依赖 ════════════════════
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ════ 阶段 2：构建 ════════════════════
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ════ 阶段 3：运行（最小体积）══════
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/src/storage/migrations ./src/storage/migrations

USER appuser

EXPOSE 3400
ENV NODE_ENV=production
ENV PORT=3400

CMD ["node", "dist/index.js"]
