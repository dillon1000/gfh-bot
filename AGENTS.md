# AGENTS.md

This project uses `pnpm` as its package manager. Always use `pnpm` for all package operations.

## Package Manager Rules

- Install packages with `pnpm add <package>`.
- Run scripts with `pnpm <script-name>`.
- Never use `npm` or `yarn` in this project.

## Required Completion Workflow

Before considering work complete, always run these commands in order:

1. `pnpm lint:fix`

If either command fails:

1. Read the error output carefully.
2. Fix the relevant files.
3. Re-run the commands.
4. Repeat until all checks pass.

Do NOT leave the project with type errors or linting issues.

## Documentation Rules

- Do not use emojis in code or documentation.
- Do not include file or folder structure diagrams in the README.
- Do not add Markdown documentation unless the user explicitly asks for it.

## Database Rules

- Define schema changes in code first.
- Generate migrations with `pnpm db:generate`.
- Review the generated migration output before applying it anywhere important.
- Before `pnpm db:push`, verify that `DATABASE_URL` points at the intended database, especially for production.
- Apply schema updates with `pnpm db:push`.
- Never write SQL migration files by hand.

## Code Cleanliness Rules

- Remove unused imports, variables, and functions instead of prefixing them with `_`, unless the parameter is intentionally required by a signature.