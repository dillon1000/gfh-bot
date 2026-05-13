# syntax=docker/dockerfile:1.7

FROM node:24.15.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm prisma generate

FROM deps AS build

COPY tsconfig.json vitest.config.ts ./
COPY assets ./assets
COPY src ./src
RUN pnpm build

FROM base AS runtime

ENV NODE_ENV=production
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION

RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./
COPY --from=build /app/assets ./assets
COPY --from=build /app/dist ./dist

RUN pnpm prune --prod

USER app

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/src/app/index.js"]
