# gfh-bot

The most powerful polling and voting bot.

Supports single-choice polls, multi-choice polls, ranked-choice voting, governance guardrails, starboard, exports, builders, and utility commands.

## Features

- Polls
- Prediction markets
- Interactive poll builder
- Governance guardrails for polls
- Persistent poll lookup
- Poll participation analytics
- Configurable poll reminders with optional role pings
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
- `DISCORD_ADMIN_USER_IDS` optional comma-separated Discord user IDs allowed to edit admin-gated bot config like `/search config`
- `DISCORD_PRESENCE_STATUS` optional: `online`, `idle`, `dnd`, or `invisible`
- `DISCORD_ACTIVITY_TYPE` optional: `playing`, `listening`, `watching`, `competing`, or `streaming`
- `DISCORD_ACTIVITY_TEXT` optional activity text, for example `help`
- `DISCORD_ACTIVITY_URL` optional stream URL, only used when the activity type is `streaming`
- `DATABASE_URL`
- `REDIS_URL`
- `LOG_LEVEL` optional
- `POLL_CREATION_LIMIT_PER_HOUR` optional
- `MEOW_LIMIT_PER_HOUR` optional
- `SEARCH_LIMIT_PER_MINUTE`
- `MARKET_DEFAULT_TIMEZONE` optional
- `XAI_API_KEY` optional, required for AI-generated corpse openers or Grok-backed quips prompts
- `CORPSE_OPENER_MODEL` optional
- `QUIPS_GROK_MODEL` optional
- `QUIPS_GEMINI_MODEL` optional
- `GOOGLE_GENERATIVE_AI_API_KEY` optional, required for Gemini via Google AI Studio
- `APP_REVISION` optional
- `R2_ACCOUNT_ID` optional
- `R2_ACCESS_KEY_ID` optional
- `R2_SECRET_ACCESS_KEY` optional
- `R2_BUCKET` optional
- `R2_PUBLIC_BASE_URL` optional, but if set it must be a full URL like `https://example.com`

For local development on your machine, use `localhost` in `DATABASE_URL` and `REDIS_URL`.

Poll governance guardrails require the `Guild Members` privileged intent to be enabled for the bot in the Discord Developer Portal.

Exhaustive audit logging works best with the `Guild Members`, `Guild Presences`, and relevant moderation / voice intents enabled in the Discord Developer Portal.

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

## Commands

- `/ping`
- `/market config set channel:#predictions-forum`
- `/market config view`
- `/market config disable`
- `/market create title:... outcomes:... close:24h description:... tags:...`
- `/market create title:... outcomes:... close:"April 6 2026 10:00pm CDT" description:... tags:...`
- `/market edit query:... title:... outcomes:... close:... description:... tags:...`
- `/market add-outcomes query:... outcomes:...`
- `/market view query:<message link|message id|market id>`
- `/market list status:open creator:@user tag:meta`
- `/market trade query:... action:buy outcome:1 amount:50`
- `/market trade query:... action:short outcome:1 amount:"10 pts"`
- `/market trade query:... action:cover outcome:1 amount:"2.5 shares"`
- `/market resolve query:... winning_outcome:1 note:... evidence_url:https://...`
- `/market cancel query:... reason:...`
- `/market portfolio user:@user`
- `/market leaderboard`
- `/casino config set channel:#casino`
- `/casino config view`
- `/casino config disable`
- `/casino balance user:@user`
- `/casino stats user:@user`
- `/casino slots bet:25`
- `/casino blackjack bet:25`
- `/casino poker bet:25`
- `/casino rtd bet:25`
- `/audit-log setup channel:#audit-log noisy_channel:#audit-noisy`
- `/audit-log status`
- `/audit-log disable`
- `/search messages query:... channel:#general`
- `/search advanced content:... channel_ids:"<#...>, <#...>" public:true`
- `/search config action:view`
- `/search config action:set channel_ids:"<#...>, <#...>"`
- `/search config action:clear`
- `/poll question:... choices:... description:... mode:single anonymous:false quorum_percent:60 allowed_roles:"<@&...>" blocked_roles:"<@&...>" eligible_channels:"<#...>" time:24h reminders:"1d,1h,10m" reminder_role:"<@&...>"`
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

## Legal

- [Privacy Policy](./docs/legal/PRIVACY_POLICY.md)
- [Terms of Service](./docs/legal/TERMS_OF_SERVICE.md)

## Note

Part of this codebase was generated with AI. Review it like any other generated or third-party code before running it in production.
