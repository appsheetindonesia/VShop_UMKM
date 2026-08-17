# ============================================================
# V Shop — Dockerfile (Next.js 14 standalone)
# Dipakai Easypanel / VPS Docker. Database TETAP Supabase cloud
# (tidak ada service DB di dalam container).
# ============================================================

# ---------- 1. Dependencies ----------
# Install SEMUA dependensi (builder butuh devDeps: typescript/tailwind).
# Runner tidak menyalin node_modules ini — memakai .next/standalone (pruned).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. Build ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build produksi; Supabase env dibaca saat RUNTIME, jadi tidak wajib di sini.
RUN npm run build

# ---------- 3. Runner (standalone) ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# .next/standalone berisi server.js + node_modules + public (bila ada)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
USER node
CMD ["node", "server.js"]
