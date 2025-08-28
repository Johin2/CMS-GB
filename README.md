# Outreach Dashboard — SQLite Edition (Next.js 14.2.31)

This build uses **SQLite** via Prisma and adds a **postinstall** hook so `@prisma/client` is always generated.

## Fixes included
- **SQLite** datasource (`DATABASE_URL="file:./prisma/dev.db"`).
- **Next.js 14.2.31** (to silence the outdated warning).
- **postinstall: prisma generate** to fix the `@prisma/client did not initialize yet` error.
- `npx prisma db push` creates the database file on first run.

## Setup
```bash
npm install              # runs prisma generate automatically
cp .env.example .env     # uses SQLite by default
npx prisma db push       # creates prisma/dev.db
npm run dev
```

If you still see a Prisma init error:
```bash
npx prisma generate
rm -rf .next node_modules
npm install
npm run dev
```

## Use
- Go to **/contacts** → enter domain + titles → fetch from Apollo and save.
- Go to **/sequences** → send a specific step to a contact email.
- Cron:
  - `/api/cron/relationships-monthly` → enqueue CEOs in "Relationships"
  - `/api/cron/process-queue` → sends any queued emails

Environment variables:
- `APOLLO_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` in `.env`.
