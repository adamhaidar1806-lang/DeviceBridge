# DeviceBridge

DeviceBridge connects people who need digital devices with providers offering donations, loans, and lower-cost sales.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/devicebridge/src/App.tsx` — responsive React UI, routing, role-aware dashboards, auth, browse, requests, profile, support, approvals, and impact views.
- `artifacts/devicebridge/src/index.css` — DeviceBridge nature-inspired visual system, animated leaf motifs, and reduced-motion support.
- `artifacts/api-server/src/routes/devicebridge.ts` — database-backed API routes for auth, profiles, items, requests, support, notifications, approvals, and metrics.
- `artifacts/api-server/src/lib/devicebridge-auth.ts` — password hashing and session cookie helpers; creates only the required admin account.
- `lib/db/src/schema/devicebridge.ts` — PostgreSQL schema for users, providers, items, requests, complaints, messages, notifications, and status history.
- `lib/api-spec/openapi.yaml` — source of truth for the generated API client and Zod contracts.

## Architecture decisions

- PostgreSQL is the source of truth for every persisted product action; the new database is intentionally empty apart from the required admin account.
- Public item responses expose provider display details only; IC numbers and private contact fields stay server-side.
- Browser authentication uses an HTTP-only session cookie; passwords are stored as salted scrypt hashes.
- Impact and admin metrics are SQL aggregates over real records, so empty data renders as zero rather than fabricated activity.

## Product

Landing and authentication flows lead into role-aware user, provider, and admin workspaces. Users can browse approved items, submit requests, edit profiles, follow support threads, and read notifications. Providers can edit their profile, submit listings for review, and decide incoming requests. Admins can review providers and listings, manage complaints, and inspect database-backed impact metrics.

## User preferences

- Do not invent or hardcode statistics, users, providers, devices, transactions, donations, loans, or impact numbers; calculate them from PostgreSQL records.
- Keep the DeviceBridge purpose centered on digital access and community support rather than turning it into a generic shopping site.
- Use a green, nature-inspired visual direction with animated leaves and plant motifs.

## Gotchas

- API contract changes require `pnpm --filter @workspace/api-spec run codegen` before using the generated hooks or Zod schemas.
- The current workspace uses the shared Express API artifact and Drizzle PostgreSQL package conventions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
