# gfh-bot

The most powerful polling and voting bot.

Supports single-choice polls, multi-choice polls, ranked-choice voting, governance guardrails, starboard, exports, builders, and utility commands.

## Features

- Polls
- Interactive poll builder
- Governance guardrails for polls
- Persistent poll lookup
- Poll participation analytics
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
      <img src="https://github.com/user-attachments/assets/0a025615-2541-48f7-8f27-527d90edcbd9" alt="Interactive Poll Builder" width="100%" />
    </td>
    <td align="center" width="50%">
      <strong>Live Results Diagram</strong><br />
      <img src="https://github.com/user-attachments/assets/0d3a4d87-2fd4-40eb-806a-1410df42595d" alt="Live Results Diagram" width="100%" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>Ranked-Choice Ballot Menu</strong><br />
      <img src="https://github.com/user-attachments/assets/72602e72-a5de-4eca-804c-2620bb496431" alt="Ranked-Choice Ballot Menu" width="100%" />
    </td>
    <td align="center" width="50%">
      <strong>Pass Threshold Configuration</strong><br />
      <img src="https://github.com/user-attachments/assets/b50c0578-5714-465a-ab91-bca0bb5eb498" alt="Pass Threshold Configuration" width="100%" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>CSV Export</strong><br />
      <img src="https://github.com/user-attachments/assets/1dec7b8f-f7c0-4cd9-af67-cf6d619f85d2" alt="CSV Export" width="100%" />
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
- `R2_PUBLIC_BASE_URL` optional, but if set it must be a full URL like `https://example.com`

For local development on your machine, use `localhost` in `DATABASE_URL` and `REDIS_URL`.

Poll governance guardrails require the `Guild Members` privileged intent to be enabled for the bot in the Discord Developer Portal.

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
- `/poll question:... choices:... description:... mode:single anonymous:false quorum_percent:60 allowed_roles:"<@&...>" blocked_roles:"<@&...>" eligible_channels:"<#...>" time:24h`
- `/poll-builder`
- `/poll-results query:<message link|message id|poll id>`
- `/poll-export query:<message link|message id|poll id>`
- `/poll-analytics channel:#general days:30 limit:5`
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
