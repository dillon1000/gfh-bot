# Privacy Policy

Last updated: April 7, 2026

This Privacy Policy describes how **Dillon Ring** ("we," "us," or "our") collects, uses, stores, shares, and otherwise processes personal information in connection with **GFH Bot** (the "App"), a Discord application that provides polling, search, audit logging, games, prediction markets, starboard, exports, and related community features.

## 1. Scope

This Privacy Policy applies to personal information processed through the App, including when the App is installed in a Discord server, used through slash commands, buttons, menus, reactions, threads, direct messages, exports, and related administrative tools.

This Privacy Policy does not apply to:

- Discord itself, which is governed by Discord's own terms and privacy disclosures.
- Third-party websites, services, or storage locations linked from the App.
- Servers, communities, or administrators that use the App, except to the extent we directly process data on their behalf or for our own purposes.

## 2. Who We Are

The App is operated by:

- **Dillon Ring**
- Email: **iam@dillonr.ing**

If applicable privacy law treats us as a "controller," "business," or similar regulated role, we act in that capacity for the processing described in this Privacy Policy. Server owners and administrators may separately decide how to configure and use the App in their communities and may have their own independent obligations to users.

## 3. Information We Collect

Depending on how the App is configured and used, we may collect and process the following categories of information.

### A. Discord Account and Server Identifiers

- Discord user IDs
- Guild/server IDs
- Channel IDs
- Thread IDs
- Message IDs
- Role IDs
- Interaction IDs
- Discord usernames, global names, nicknames, and bot flags where available

### B. Content You Submit or Trigger Through the App

- Poll questions, descriptions, options, reminder settings, role restrictions, and governance settings
- Prediction market titles, descriptions, outcomes, notes, evidence URLs, and tags
- Search queries and filters submitted through App commands
- Reaction-role panel titles, descriptions, and labels
- Quips submissions, votes, prompts, and weekly/lifetime stats
- Casino gameplay inputs, wagers, table actions, outcomes, and derived stats
- Starboard source message excerpts and related metadata
- Administrative configuration entered by server managers

### C. Message, Attachment, and Activity Data

If enabled or used by a given feature, the App may process:

- Message content and clean-content representations
- Attachment metadata such as filename, content type, size, and URLs
- Embed metadata
- Reply/reference metadata
- Reaction activity
- Typing events
- Presence/activity data
- Voice-state related event data
- Audit-log and moderation event data made available by Discord

For example:

- The App's search feature uses Discord's guild message search capabilities and processes search results returned by Discord.
- The App's audit-log feature may store message snapshots and event payloads so moderators can review changes, deletions, and other server events.
- The App's starboard feature may store excerpts of source messages and image URLs to create board posts.

### D. Gameplay and Economy Data

The App maintains persistent records for community features such as:

- Poll votes and vote history
- Prediction market accounts, trades, positions, profit/loss, and resolution history
- Casino balances, wagers, outcomes, hands, actions, and user stats

These are virtual, in-app community records only.

### E. Administrative and Support Data

- Installation and configuration choices
- Admin user allowlists and permission checks
- Messages or information you send us for support, abuse reports, or legal requests

### F. Technical and Operational Data

- Application logs and error information
- Queue/job metadata
- Redis session data used for temporary workflows
- Timestamps relating to creation, updates, reminders, expirations, and delivery status
- App revision/version metadata

## 4. How We Collect Information

We collect information:

- Directly from users and administrators through App interactions and submitted content
- From Discord when users invoke commands, interact with App messages, react to content, or when Discord delivers events to the App
- From service providers used to operate the App, such as hosting, database, cache, storage, and logging providers
- From generated outputs and derived records created by the App itself, such as analytics, scoreboards, and snapshots

## 5. How We Use Information

We use personal information to:

- Provide, operate, maintain, and improve the App
- Create and manage polls, markets, games, exports, audit logs, and search workflows
- Authenticate commands and enforce permissions, channel restrictions, rate limits, and admin controls
- Store server configuration and user participation records
- Generate App outputs, visualizations, reminders, statistics, and leaderboards
- Support moderation, auditing, anti-abuse, troubleshooting, security, and fraud prevention
- Generate downloadable or shareable exports
- Comply with legal obligations and enforce our Terms of Service

## 6. Legal Bases for Processing

If you are in the EEA, UK, or another jurisdiction requiring a lawful basis, we generally rely on one or more of the following:

- Performance of a contract: to provide the App and requested features
- Legitimate interests: to secure, operate, improve, moderate, and support the App and communities using it
- Consent: where required by law or where a feature is optional and presented on that basis
- Legal obligation: where we must retain, disclose, or otherwise process information under applicable law

## 7. Exports and Public Sharing

The App may generate exports, including CSV exports. If object storage is configured, export files may be uploaded to Cloudflare R2 or a compatible storage endpoint and shared using:

- A signed URL with limited duration, or
- A public base URL if the operator configures public file hosting

If you enable public export hosting, exported content may become accessible to anyone with the URL and may remain publicly reachable until deleted from storage or your CDN/cache layers.

## 8. How We Share Information

We may share personal information with the following categories of recipients:

- **Discord**, as necessary for the App to operate on the Discord platform
- **Hosting and infrastructure providers** that power the App
- **Analytics or Data Services** to analyze app performance, usage, and cost.
- **Database and caching providers**, including PostgreSQL and Redis infrastructure
- **Cloud storage providers**, including Cloudflare R2 if exports are enabled
- **Server owners and administrators**, to the extent the App displays logs, audit information, exports, search results, analytics, or community records in the server where the App is installed
- **Other users in the same server**, when features intentionally display public or semi-public outputs such as polls, starboard posts, game results, standings, or exported links
- **Professional advisors, law enforcement, courts, regulators, or counterparties** where reasonably necessary for legal compliance, rights protection, or dispute resolution
- **A successor entity** in connection with a merger, acquisition, financing, reorganization, sale of assets, or similar transaction

We do not sell personal information for money. We do not share personal information for cross-context behavioral advertising through the App as described in this draft.

## 9. Data Retention

We retain personal information for as long as reasonably necessary for the purposes described in this Privacy Policy, including to provide requested features, maintain community records, resolve disputes, enforce agreements, and comply with law.

- Temporary Redis-backed search sessions are typically retained for about 10 minutes unless deleted sooner.
- Signed export URLs generated without a public base URL are typically issued with a 24-hour expiry.
- Database records for polls, votes, market activity, gameplay, audit logs, message snapshots, leaderboards, and server configuration may persist until deleted by the operator, removed through product changes, or deleted as part of server-specific cleanup.
- Application logs may be retained according to the operator's hosting and logging setup.

Because retention settings can vary by deployment, hosting environment, and manual administrator action, exact retention periods may differ.

## 10. Security

We use reasonable administrative, technical, and organizational measures designed to protect personal information. However, no system is perfectly secure, and we cannot guarantee absolute security.

You are responsible for:

- Securing your Discord account
- Limiting which servers and channels the App can access
- Reviewing privileged intents and administrative settings before enabling sensitive features such as audit logging, message search, or public exports

## 11. International Transfers

We and our service providers may process information in the United States and other countries that may have different data protection laws than your jurisdiction. Where required, we will rely on appropriate transfer mechanisms for regulated cross-border transfers.

## 12. Children's Privacy

The App is not directed to children under 13, and the App should only be used by people who meet Discord's minimum age requirements in their jurisdiction. We do not knowingly collect personal information from children under 13 in violation of applicable law.

If you believe a child under 13 has provided personal information to us in connection with the App, contact us at **iam@dillonr.ing** so we can review and delete the information where appropriate.

## 13. Sensitive Information

The App is not intended to collect sensitive personal information such as government identification numbers, financial account credentials, precise geolocation, health information, or other similarly sensitive categories. Please do not submit that kind of information through the App.

If adult-mode humor or user-generated content is enabled in a server, some content may be mature, offensive, or inappropriate for some audiences. That content is user/community controlled and does not change the App's intended age restrictions.

## 14. Your Privacy Rights

Depending on your location and subject to applicable exceptions, you may have rights to:

- Request access to personal information we hold about you
- Request correction of inaccurate personal information
- Request deletion of personal information
- Request a copy of certain personal information in a portable format
- Object to or restrict certain processing
- Withdraw consent where processing is based on consent
- Appeal a denied privacy request where local law provides that right

To exercise privacy rights, contact us at **iam@dillonr.ing** and provide enough information for us to verify your request and locate the relevant records, such as your Discord user ID, server ID, and the feature involved.

We may deny or limit a request where permitted by law, including when we cannot verify identity, compliance would infringe another person's rights, or retention is required for security, legal, or operational reasons.

### California Notice

If the California Consumer Privacy Act ("CCPA"), as amended, applies to us, California residents may have rights to know, delete, correct, and receive a portable copy of personal information, as well as rights related to sensitive personal information and non-discrimination for exercising privacy rights.

This draft states that we do not sell personal information or share personal information for cross-context behavioral advertising through the App.

### EEA / UK Notice

If GDPR or UK GDPR applies, you may also have the right to lodge a complaint with your local supervisory authority.

## 15. Do Not Track / Global Privacy Control

Because the App primarily operates inside Discord rather than through a public browsing interface, browser-based "Do Not Track" or Global Privacy Control signals may not be relevant in all contexts. If applicable law requires recognition of a particular opt-out signal for a web-based property we operate in connection with the App, we will handle that signal as required by law.

## 16. Third-Party Services

The App may rely on or link to third-party services, including Discord, Cloudflare, and hosting providers. Their privacy practices are governed by their own policies, not this Privacy Policy.

## 17. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. If we make material changes, we will update the "Last updated" date and may provide additional notice where appropriate.

## 18. Contact Us

For privacy questions, requests, or complaints, contact:

- **Dillon Ring**
- Email: **iam@dillonr.ing**
- Support: **https://github.com/Dillon1000/gfh-bot/issues**
