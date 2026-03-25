# gfh-bot
The most powerful polling/voting bot. Supports single choice, Multi-choice, and Ranked Choice Voting.
## Features

- Polls
- Interactive poll builder
- Persistent poll lookup
- Poll reminders one hour before close
- Poll CSV export with optional R2 upload
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
- `R2_ACCOUNT_ID` optional
- `R2_ACCESS_KEY_ID` optional
- `R2_SECRET_ACCESS_KEY` optional
- `R2_BUCKET` optional
- `R2_PUBLIC_BASE_URL` optional

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
docker compose pull bot
docker compose up -d
```
*The container will run migrations on startup before launching.
Postgres and Redis stay on the internal Docker network by default and are not exposed on the VPS.
By default the `bot` service now runs `ghcr.io/dillon1000/gfh-bot:latest`, which is published from GitHub Actions on pushes to `main`.

To enable automatic updates when a new registry image is published:

```bash
docker compose --profile autoupdate up -d
```

`watchtower` will check for a newer `bot` image every 5 minutes by default and restart only containers labeled for updates.
## Commands

- `/ping`
- `/poll question:... choices:... description:... single_select:true anonymous:false time:24h`
- `/poll-builder`
- `/poll-results query:<message link|message id|poll id>`
- `/poll-export query:<message link|message id|poll id>`
- Message context menu: `Create Poll From Message`
- `/starboard setup channel:#starboard emoji:"⭐,💎,<:gold_star:123>" threshold:3`
- `/starboard disable`
- `/starboard status`

## Testing

```bash
pnpm test
```

## Note
A portion of this codebase was generated with AI, and while I've done my best to ensure security, etc. you should never blindly trust code that's running on you machine.
