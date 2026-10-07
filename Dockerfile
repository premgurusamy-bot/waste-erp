# ---- dependencies ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ---- build ----
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl postgresql-client && rm -rf /var/lib/apt/lists/* \
  && groupadd -r erp && useradd -r -g erp erp && mkdir -p /app/storage/uploads && chown -R erp:erp /app/storage
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Full node_modules: runtime deps (pdfkit fonts, exceljs) + Prisma CLI for migrate/seed
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
USER erp
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
