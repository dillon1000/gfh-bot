# syntax=docker/dockerfile:1.7

FROM node:24.22.1-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.28.6 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm prisma generate

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod
# Fetch the schema engine for this image's OpenSSL now; the runtime user cannot write here.
RUN ./node_modules/.bin/prisma version

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

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/assets ./assets
COPY --from=build /app/dist ./dist

USER app

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./dist/src/app/instrumentation.js dist/src/app/index.js"]
