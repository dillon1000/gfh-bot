# gfh-bot
discord bot built with discord.js :D

## Features

- Polls
- Interactive poll builder
- Persistent poll lookup
- Message context-menu poll seeding
- Starboard
- Ping health check

## Requirements

- Node `22.12.0+`
- pnpm
- Redis & Postgres, optimally running in Docker

## Environment

Copy `.env.example` to `.env` and fill in:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `DATABASE_URL`
- `REDIS_URL`

For local development on your machine, use `localhost` in `DATABASE_URL` and `REDIS_URL`.
## development

```bash
docker compose up -d postgres redis
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm register-commands
pnpm dev
```

## Use on Docker

```bash
docker compose up --build
```
*The container will run migrations on startup before launching.

## Commands

- `/ping`
- `/poll question:... choices:... description:... single_select:true anonymous:false time:24h`
- `/poll-builder`
- `/poll-results query:<message link|message id|poll id>`
- Message context menu: `Create Poll From Message`
- `/starboard setup channel:#starboard emoji:<:gold_star:123> threshold:3`
- `/starboard disable`
- `/starboard status`

## Testing

```bash
pnpm test
```

## Note
A portion of this codebase was generated with AI, and while I've done my best to ensure security, etc. you should never blindly trust code that's running on you machine.
