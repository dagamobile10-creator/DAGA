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

## Company identity, authentication, and invitations

- Migrations 0005–0008 add stable public company/account IDs, explicit per-company memberships, single-use invitations, and bounded registration/login OTP challenge tables. These IDs identify records and are not credentials.
- `company-invitations.js` implements invitation creation/list/revoke/accept, role and permission checks, invitation-bound registration, dual-channel OTP login, session inspection, and logout. Invitation and OTP secrets are stored as hashes; invite acceptance requires an authenticated session and explicit acceptance.
- `owner-admin.js` and `owner-console.html` now allow the authenticated program owner to provision a pending company and its owner account, review/approve or reject companies, and inspect stable public IDs.
- `company/portal.html` provides the company login and invitation-management portal. `invite/index.html` provides the invitation acceptance flow. The Worker serves both from its own origin so invite links do not depend on GitHub Pages copying nested files.
- Manager invitations are limited to employees; a manager must have the invite-employees permission and can only revoke their own employee invitations. Owner-only actions remain behind the program-owner session.
- `.github/workflows/daga-staging-setup.yml` is a manual-only workflow that provisions/reuses a separate `daga-app-staging` D1 database, applies tracked migrations, deploys a separate `daga-app-staging` Worker, and installs staging secrets. Pushes only validate the workflow; they do not provision or deploy staging resources.
- CI syntax and SQLite schema/security regression checks pass on the current development branch. This does not prove real SMS/email delivery, Cloudflare D1 runtime behavior, invitation acceptance across two devices, or deployment configuration.

## Known release gates

1. Run the manual **DAGA isolated staging setup** workflow in GitHub Actions after confirming the repository secrets listed in `security/OWNER_AUTH_DEPLOYMENT.md` exist. This connector can edit files and inspect workflow runs, but it cannot dispatch the manual workflow or inspect repository secret values.
2. Complete end-to-end staging tests for company-owner provisioning/approval, phone+email OTP, manager permission restrictions, invite create/revoke/accept, expired/replayed/concurrent invitations, session logout, and cross-company isolation.
3. The company portal now generates invitation QR graphics locally in the browser, without sending invitation tokens to a third-party QR service. The separate `/go/` landing page generates the official public DAGA QR and links to the current web app. Android/iOS store links are intentionally marked unavailable until real official download URLs exist.
4. Existing `/memory`, `/chat`, `/tts`, and LiveAvatar routes are still separate from company authorization. Preserve the existing LIVE DAGA voice experience while planning and testing those protections independently.
5. Production D1 bindings, secrets, migrations, and Worker deployment must be reviewed and configured deliberately. Do not merge PR #7 or deploy this branch to the production `daga-voice` Worker until the staging gates pass.

## Security requirements before enabling production traffic

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

The current branch includes implemented owner-auth groundwork and company invitation/account flows with CI checks. A manual staging workflow has been added but has not been dispatched from this connector. No production D1 migration or production Worker deployment has been performed as part of this work.

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

The development branch now has working code paths for company invitation creation, revocation, acceptance, invitation-bound registration, phone+email OTP login, company memberships, and the public/company/invitation HTML pages. Registration now claims a verified single-use invitation and creates the account, membership, session, and audit event in one D1 batch; accepting an invite for an existing membership is blocked before token consumption. Company login OTP verification is rate-limited by both IP and account. Registration input validation was also corrected so email addresses and six-digit OTPs are checked with proper JavaScript regexes; regression coverage now guards against double-escaped patterns and confirms company approval/rejection/suspension updates the owner account in the same D1 batch. CI passed the current syntax, security-regression, and fresh-SQLite-migration checks in run [38996021940](https://github.com/dagamobile10-creator/DAGA/actions/runs/38996021940). The isolated staging workflow completed successfully in run [38996019065](https://github.com/dagamobile10-creator/DAGA/actions/runs/38996019065): it created/reused a separate staging D1, applied migrations 0001–0008, deployed a separate staging Worker, and passed HTTP smoke tests for `/go/`, `/company/`, `/invite/`, unauthenticated company/invitation endpoints, and registration failing closed while delivery secrets are absent. This is staging validation, not production deployment or proof of real SMS/email delivery.

## Owner admin API and console progress

- `owner-admin.js` requires a valid program-owner session for admin endpoints and includes company/owner provisioning, company decisions, plan/payment configuration, payment review, idempotent LIVE DAGA word credits, and column configuration.
- `owner-console.html` is an Arabic RTL program-owner console; its session token remains in page memory.
- Company owner accounts and companies are provisioned as pending and must be approved before company access is granted.
- `company/portal.html` provides account login and company invitation management; `invite/index.html` handles invitation registration or acceptance; `go/index.html` is a separate public DAGA QR landing page. QR codes are generated locally in the browser, not by sending URLs/tokens to an external QR service.

## Remaining production blockers

A successful staging deployment is not a production release. The current staging smoke tests confirm routes and fail-closed behavior, but the registration endpoint returned the expected unavailable status while delivery secrets were absent. Configure all required staging auth/delivery secrets, then test real SMS/email delivery, company-owner approval, two-device invitation registration/acceptance, manager permission enforcement, expired/replayed/concurrent invites, session revocation, and cross-company isolation. The existing `/memory`, `/chat`, `/tts`, and LiveAvatar routes are not comprehensively integrated with company identity/authorization. Preserve the existing LIVE DAGA experience and do not merge PR #7 or deploy these changes to the production `daga-voice` Worker until release gates are completed.

## Company terminology and stable identities

The user-facing business entity is **Company** (Arabic: الشركة), not shop/store. Existing SQL table names and API field names remain unchanged for compatibility until a separately tested API migration. Migration `0006_daga_public_identity_ids.sql` adds stable public IDs for accounts and companies; these IDs identify records and are not credentials. Migration 0005 adds membership and invitation tables, and migrations 0007–0008 add registration/login OTP challenge storage.

## Follow-up verification — 2026-10-17

- Added a staging smoke check that requires unauthenticated requests to `/owner/auth/me` and `/owner/admin/overview` to return HTTP 401, alongside existing company/invitation checks. The staging worker remains separate from production.
- Added CI regression guards for singleton program-owner identity, bootstrap bearer-token protection, refusal to provision a second program owner, and the rule that password verification alone cannot issue a session before both phone and email OTPs pass.
- Latest owner-auth CI run: [39059823015](https://github.com/dagamobile10-creator/DAGA/actions/runs/39059823015) — passed at commit `c1c8eaaa20be4167553c7b8659f490e21d389222`. Validation includes JavaScript syntax, security regression guards, company invitation tests, and all eight migrations against fresh SQLite.
- Latest Pages workflow validation at the same commit: [39059825512](https://github.com/dagamobile10-creator/DAGA/actions/runs/39059825512) — passed. On a pull-request event this workflow validates the source; it does not publish GitHub Pages.
- Owner phone/email and SMS/email delivery secrets intentionally remain the final setup step, as requested. Without those secrets, staging cannot complete real owner bootstrap/login/recovery or prove real OTP delivery.
- Still release-blocking: end-to-end testing with configured staging delivery, manager/employee permission and cross-company isolation tests, and authenticated identity integration for the legacy `/memory`, `/chat`, `/tts`, and LiveAvatar routes. These are explicitly not marked complete. PR #7 remains open; no merge or production Worker deployment was performed.

## Follow-up verification — 2026-10-18 (stage-six security pass)

- Added `.github/workflows/daga-session-security-checks.yml` to keep session-expiry/revocation and owner-admin authorization invariants visible in CI.
- Latest owner-auth checks passed at commit `a749b7ec847ccd56f62a446b54e39808c03ed28d`: [run 39069572560](https://github.com/dagamobile10-creator/DAGA/actions/runs/39069572560).
- Latest session-security regression checks passed at the same commit: [run 39069572631](https://github.com/dagamobile10-creator/DAGA/actions/runs/39069572631).
- Pages/PR source validation passed; the publish/deploy job was skipped as expected for a pull-request event: [run 39069572459](https://github.com/dagamobile10-creator/DAGA/actions/runs/39069572459).
- PR #7 is still a draft and unmerged. No production Worker, production D1, or `main` branch was changed.
- **Stage-six is in progress, not complete.** The passing checks are code/schema/regression checks; they do not prove real authentication delivery or complete runtime authorization.
- Confirmed release blockers still include the unauthenticated legacy `/memory` route accepting a caller-selected `userId`, unauthenticated `/chat` and `/tts`, and LiveAvatar token issuance without a company/role identity check. These routes must be integrated with authenticated identity without breaking the existing LIVE DAGA UI/voice flow. Until then, this branch is not safe to merge into production.
- The staging environment still needs the intentionally deferred owner contact and SMS/email provider secrets before real OTP bootstrap/login/recovery can be verified. After those are supplied through repository/Cloudflare secret settings, run the full staging checklist in `tests/OWNER_AUTH_STAGING_CHECKLIST.md`, then resolve any failures before considering a production release.


## Follow-up verification — 2026-10-18 (isolated staging and owner-console routing)

- Added Worker routes /owner/ and /owner-console/ for the Arabic RTL owner console; the console now uses window.location.origin rather than hard-coding the production voice Worker.
- Added staging smoke assertions for both owner-console routes, expected owner-console markup, same-origin API configuration, and absence of the production Worker URL in the served console.
- Isolated staging workflow run 39083515409 passed: the dedicated daga-app-staging D1 migrations and Worker deployment succeeded; /health, allowlisted/hostile-origin CORS checks, all five pages, and unauthenticated company/invitation/owner API checks passed.
- Owner-auth CI passed at commit 6a8f8cba38ffb7f73fbe507a2451c4c05a568ad7: run 39083517946. Session-security regression CI passed: run 39083515562. The Pages workflow validated the PR source and skipped publishing as expected: run 39083517887.
- Important: staging health passed, but the staging workflow log explicitly reports missing DAGA_OTP_PEPPER and exits the secret-configuration step successfully by design. Owner bootstrap/OTP delivery is therefore still disabled; a green infrastructure smoke test is not proof of end-to-end authentication readiness.
- PR #7 remains a draft and unmerged. Production daga-voice and main were not targeted by the staging workflow.

## Follow-up verification — 2026-10-18 (company checkout groundwork)

- Added authenticated company order APIs in `company-orders.js`: list active plans and payment methods; create an order for an approved store owned by the authenticated store-owner account; snapshot the agreed server-calculated price; optionally apply an active, in-window offer with a bounded redemption count; list that company's orders; and submit transfer reference/HTTPS receipt for owner review.
- Payment submission is explicitly pending review. It does not activate an entitlement or credit LIVE DAGA words; the existing owner review flow remains the activation gate.
- Wired the module into `worker.js` and added regression coverage for authentication/role checks, company ownership, server-side price calculation, offer windows/redemption limits, payment-state gates, schema uniqueness, and checkout UI wiring.
- Added Arabic RTL subscription/payment controls to the existing company portal, visible only to store-owner accounts. The portal fetches prices from the server and warns that submitting payment does not activate a subscription.
- Latest owner-auth syntax/schema, company portal JavaScript syntax, checkout regression tests, and migration/schema checks passed at commit `81e5fe8b27a8d899545f5b85350962f746a21c5d`: [run 39084058080](https://github.com/dagamobile10-creator/DAGA/actions/runs/39084058080). Session-security regression checks also passed: [run 39084058153](https://github.com/dagamobile10-creator/DAGA/actions/runs/39084058153).
- Isolated staging run [39083963097](https://github.com/dagamobile10-creator/DAGA/actions/runs/39083963097) passed runtime checks including anonymous access denial for company plans, payment methods, eligible offers, orders, and order-payment submission. The company portal's offer API route is included in that smoke test. Its log still reports missing `DAGA_OTP_PEPPER`; OTP setup is skipped by design. Real owner bootstrap/login/recovery and SMS/email delivery remain unverified.
- Still release-blocking: no end-to-end order/payment test with an authenticated approved store owner and a real review action; checkout now exposes eligible active offers in the company portal; legacy `/memory`, `/chat`, `/tts`, and LiveAvatar routes still need authenticated user/company identity integration; tenant-isolation and manager/employee permission tests remain required.
- PR #7 remains a draft and unmerged. The staging workflow targets only the isolated staging Worker/D1; production `daga-voice` and `main` were not changed.