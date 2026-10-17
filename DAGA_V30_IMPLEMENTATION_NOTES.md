# DAGA V30 — implementation notes

This branch is a protected development track based on the existing main branch. The live index.html, existing LIVE DAGA behavior, and original V30 dashboard are not replaced by this migration.

## First implementation artifact

migrations/0001_daga_core.sql defines the proposed D1 data model for:
- one pre-provisioned program owner (never public self-registration),
- store approval and roles,
- versioned store and LIVE DAGA plans,
- fixed-price order snapshots,
- payment submission/review,
- entitlements and a word-usage ledger,
- stable column keys separate from editable display names,
- audit events.

## Store identity and invitations (schema foundation only)\n\n- `migrations/0005_daga_store_identity_invitations.sql` adds an optional stable `public_id` to each store, explicit store memberships, and single-use invitations scoped to a store and intended role.\n- Store QR identity and invitation QR/link are intentionally different concepts: a public store ID identifies a store but does not authorize access; an invitation carries a random secret whose hash is stored in D1.\n- This migration is not yet an invitation API or complete membership/authentication flow. Token creation, hashing, inviter permission checks, atomic acceptance/replay prevention, role-scoped data routes, QR rendering, and safe backfill of existing stores must be implemented and tested before use.\n\n## Security requirements before enabling production traffic

1. Do not trust a role, store ID, price, word balance, approval state, or payment confirmation sent by the browser.
2. Bootstrap the sole program-owner account through a one-time server-side process using verified contact channels. Never make the first public registrant the owner.
3. Enforce roles and store ownership on every protected Worker route. Use a verified session/token; do not treat a UI route or local storage as authorization.
4. Verify phone and email with time-limited, single-use challenges, rate limits, and attempt limits. Provider credentials belong in Worker secrets, never in HTML or Git.
5. Receipt upload is a claim, not proof of payment. Manual activation happens only after the owner confirms funds arrived. Automatic activation requires trusted payment-provider confirmation.
6. Use immutable order price/version snapshots so changing a plan or creating a promotion does not silently alter an existing order.
7. Debit LIVE DAGA words server-side with an idempotent request ID; never accept client-supplied balances.
8. Column display labels can change, but stable keys/calculation keys remain controlled. Dangerous calculation/behavior changes require owner-only confirmation, validation, and audit logging.
9. Existing /memory, /chat, /tts, and LiveAvatar routes have not yet been converted to authenticated role-aware routes. Do not treat this schema alone as live authorization.
10. Before production, review existing unauthenticated endpoints (including memory and paid voice/avatar usage), apply migrations to a dedicated database, add automated tests, then deploy Worker and test staging.

## Deployment status

This branch contains a schema and implementation plan only. It does not create a D1 database, configure SMS/email providers, enable payment integrations, or deploy the Worker. No production security behavior should be assumed until server routes are implemented and tested.

## Owner-auth groundwork added on the development branch

- `migrations/0002_daga_owner_auth.sql` adds hashed OTP challenge records, hashed opaque-session records, and a minimal security-event log.
- `security/OWNER_IDENTITY_BOOTSTRAP.md` defines the required one-time owner bootstrap and provider/deployment gates.
- `tests/OWNER_AUTH_STAGING_CHECKLIST.md` lists owner verification, role isolation, session revocation, memory access, and regression checks.
- These artifacts are not a working login flow. Worker routes, provider integrations, session issuance/validation, and automated tests still need implementation. Do not deploy or claim owner protection is active yet.


## Owner authentication implementation progress

- Added `owner-auth.js` with one-time bootstrap start/verify, SMS + email OTP delivery adapters (Twilio and Resend), PBKDF2 password hashing, one-owner-only provisioning, hashed bearer sessions, login, logout, and dual-channel recovery with recovery-code rotation.
- Wired the owner-auth handler into `worker.js` without replacing the existing chat/TTS/LiveAvatar implementation.
- Added migrations `0002_daga_owner_auth.sql` and `0003_daga_owner_credentials.sql`, plus `.github/workflows/daga-owner-auth-checks.yml` for syntax and fresh-SQLite migration checks.
- Added `security/OWNER_AUTH_DEPLOYMENT.md` with the required environment configuration and staging-only bootstrap steps.

## Current release status

The code is committed on the development branch, but the deployment is not yet operational: no D1 database has been provisioned/bound, no provider secrets have been configured, no real SMS/email delivery has been tested, and no staging Worker deployment or successful CI run has been verified. Existing application routes and the store/admin dashboard still require role/tenant authorization before production use.


## Owner admin API and console progress (latest)

- Added `owner-admin.js`, wired into the Worker. The endpoints require a valid, unexpired owner session and implement plan create/update, payment destination create/update, store approval/rejection/suspension, manual payment review, idempotent LIVE DAGA word credits, and column definition create/display-name update.
- Added `owner-console.html`, an Arabic RTL owner console for login, overview, plans, payment methods, payment review, store decisions, word credits, and column labels. The bearer session is held in page memory and is not written to localStorage.
- CI run for the current code passed Node syntax checks for the Worker, owner auth, owner admin, and owner-console inline JavaScript, plus all three migrations applied to a fresh SQLite database. The existing live-app validation passed too; the deployment job was skipped for the draft pull request.

## Remaining production blockers

No D1 database or provider secrets have been provisioned through this workflow, and no real SMS/email, end-to-end API, or staging Worker tests have run. The existing store/employee authentication, public store onboarding/order submission, full tenant isolation for existing `/memory`, `/chat`, `/tts`, and LiveAvatar routes, and integration of this console into the original V30 dashboard are still outstanding. The draft pull request must not be merged or described as a completed production release yet.


## Company terminology and stable identities

The user-facing business entity is **Company** (Arabic: الشركة), not shop/store. Existing SQL table names and API field names remain unchanged for compatibility until a separately tested API migration. Migration `0006_daga_public_identity_ids.sql` adds unique stable public IDs for accounts and companies and backfills existing records from their immutable internal IDs, never from editable display names. Public IDs identify records; they are not credentials and do not authorize access.

The company membership and single-use invitation schema exists, but role-aware invite creation/acceptance, QR rendering, and authenticated account/company profile flows are not yet implemented. Do not claim QR identities or invitations are operational until those routes and tests are complete.
