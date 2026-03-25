# gfh-bot

The most powerful polling and voting bot.

Supports single-choice polls, multi-choice polls, ranked-choice voting, starboard, exports, builders, and utility commands.

## Features

- Polls
- Interactive poll builder
- Persistent poll lookup
- Poll reminders one hour before close
- Poll CSV export with optional R2 upload
- Message context-menu poll seeding
- Starboard
- Ping health check

## Gallery

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Interactive Poll Builder</strong><br />
      <img src="https://github.com/user-attachments/assets/4eb0106b-0e0c-4aab-b47a-8abaf9562968" alt="Interactive Poll Builder" width="100%" />
    </td>
    <td align="center" width="50%">
      <strong>Live Results Diagram</strong><br />
      <img src="https://github.com/user-attachments/assets/82dd2c5d-4c1b-46f4-a82c-b66dc0a23e6f" alt="Live Results Diagram" width="100%" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>Ranked-Choice Ballot Menu</strong><br />
      <img src="https://github.com/user-attachments/assets/2a9f8138-c0d2-4ec3-95c7-906415d88fc0" alt="Ranked-Choice Ballot Menu" width="100%" />
    </td>
    <td align="center" width="50%">
      <strong>Pass Threshold Configuration</strong><br />
      <img src="https://github.com/user-attachments/assets/e1bc306d-c834-4968-9763-f23d4b58a949" alt="Pass Threshold Configuration" width="100%" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>CSV Export</strong><br />
      <img src="https://github.com/user-attachments/assets/78052c13-c00b-4bd0-bf6a-eb3c708ed1e4" alt="CSV Export" width="100%" />
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Requirements

- Node `22.12.0+`
- `pnpm`
- Redis and Postgres, ideally running in Docker

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

## Development

```bash
docker compose up -d postgres redis
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm register-commands
pnpm dev
```

## Docker

```bash
docker compose pull bot
docker compose up -d
```

The container runs Prisma migrations on startup before launching.

Postgres and Redis stay on the internal Docker network by default and are not exposed on the VPS.

By default the `bot` service runs `ghcr.io/dillon1000/gfh-bot:latest`, published from GitHub Actions on pushes to `main`.

To enable automatic updates when a new registry image is published:

```bash
docker compose --profile autoupdate up -d
```

`watchtower` checks for a newer `bot` image every 5 minutes by default and restarts only containers labeled for updates.

If the package is private, authenticate the host with `docker login ghcr.io` first and mount the correct Docker auth file into the `watchtower` container.

## Commands

- `/ping`
- `/poll question:... choices:... description:... mode:single anonymous:false time:24h`
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

Part of this codebase was generated with AI. Review it like any other generated or third-party code before running it in production.
