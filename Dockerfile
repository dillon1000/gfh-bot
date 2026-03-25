FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

FROM deps AS build

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
RUN pnpm build

FROM base AS runtime

ENV NODE_ENV=production

RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=deps /app/package.json /app/pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist

RUN pnpm prune --prod

USER app

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/src/app/index.js"]
