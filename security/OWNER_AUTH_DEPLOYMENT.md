# DAGA owner-auth deployment and API setup

This implementation is on the `daga-v30-implementation` branch. It is not active on the public Worker until reviewed, configured, migrated, and deployed.

## Database

Create a **new dedicated Cloudflare D1 database** for app/account data. Do not reuse the existing memory database unless you have verified its schema and contents. Apply these migrations in order to that database:

1. `migrations/0001_daga_core.sql`
2. `migrations/0002_daga_owner_auth.sql`
3. `migrations/0003_daga_owner_credentials.sql`
4. `migrations/0004_daga_offers.sql`
5. `migrations/0005_daga_store_identity_invitations.sql`
6. `migrations/0006_daga_public_identity_ids.sql`
7. `migrations/0007_daga_company_registration_challenges.sql`
8. `migrations/0008_daga_company_login_challenges.sql`
9. `migrations/0009_daga_payment_submission_uniqueness.sql` (prevents more than one pending-review payment submission per order)
10. `migrations/0010_email_only_auth.sql` (email-only account credentials; removes legacy phone columns)

Migration 0010 is part of the current email-only staging branch. Back up the dedicated staging database and review the migration before applying it. Do not apply it to the production database without a separately approved migration plan.

Bind that database to the Worker as `DAGA_APP_DB`. Keep the existing `DAGA_MEMORY_DB` binding separate until its user identity model is migrated and tested.

## Required Worker secrets / variables

Set these server-side in the isolated staging Worker (never in GitHub files or browser HTML):

- \`DAGA_OWNER_BOOTSTRAP_TOKEN\`: one-time high-entropy secret, at least 32 random bytes; used only for first-time program-owner provisioning.
- \`DAGA_OTP_PEPPER\`: separate high-entropy secret used to hash OTPs and recovery codes.
- \`RESEND_API_KEY\` and \`DAGA_EMAIL_FROM\`: valid Resend configuration with a verified sender.
- \`DAGA_APP_BASE_URL\`: trusted HTTPS origin for company/invitation URLs; never derive it from the incoming Host header.
- \`DAGA_ALLOWED_ORIGINS\`: exact deployed frontend origin(s); do not use \`*\` in production.

The email-only flow has no phone-number field, SMS provider, or phone OTP. The program owner's email is entered during one-time bootstrap and stored after successful verification. Never copy passwords, OTPs, recovery codes, provider keys, or bootstrap tokens into chat or source control.

## One-time program-owner bootstrap

Only run this against the isolated staging Worker after migration 0010 and email delivery are configured. The bootstrap token must be supplied out-of-band and must not be committed.

Start by submitting the chosen owner email:

\`\`\`sh
jq -n --arg email "$OWNER_EMAIL" '{email:$email}' |
curl -X POST "https://YOUR-STAGING-WORKER/owner/bootstrap/start" \
  -H "Authorization: Bearer $DAGA_OWNER_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" --data-binary @-
\`\`\`

The owner receives one six-digit email verification code. Choose a unique password of 14–128 characters with uppercase, lowercase, and a number, and a unique recovery code of at least 20 characters. Then submit:

\`\`\`sh
jq -n --arg email "$OWNER_EMAIL" --arg emailCode "$EMAIL_CODE" \
  --arg password "$NEW_PASSWORD" --arg recoveryCode "$NEW_RECOVERY_CODE" \
  '{email:$email,emailCode:$emailCode,password:$password,recoveryCode:$recoveryCode}' |
curl -X POST "https://YOUR-STAGING-WORKER/owner/bootstrap/verify" \
  -H "Authorization: Bearer $DAGA_OWNER_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" --data-binary @-
\`\`\`

Use secure prompts or a secrets manager for values rather than placing secrets in shell history. The recovery code is never shown again; store it offline. After successful provisioning, rotate or remove \`DAGA_OWNER_BOOTSTRAP_TOKEN\`.

## Email-only authentication routes

- \`POST /owner/bootstrap/start\`: accepts the email to be verified and sends one email OTP; requires the one-time bootstrap bearer token.
- \`POST /owner/bootstrap/verify\`: verifies the email OTP and creates the one program-owner account; requires the bootstrap token.
- \`POST /owner/auth/login\`: body \`{"email":"owner@example.com","password":"..."}\`; verifies email + password and issues a session without an OTP on every login.
- \`POST /owner/recovery/start\`: sends a temporary code to the program owner's registered email.
- \`POST /owner/recovery/complete\`: requires the email OTP, current recovery code, new password, and new recovery code; rotates credentials and revokes old sessions.
- \`POST /api/company/auth/register\` and \`/register/verify\`: invitation-bound registration with one email OTP, password, and recovery code. The invitation remains single-use and role/permission checks are unchanged.
- \`POST /api/company/auth/login\`: company owner, manager, and employee sign-in with email + password.
- \`POST /api/company/auth/setup/start\` and \`/setup/verify\`: approved existing accounts without credentials can verify email and create a password.
- \`POST /api/company/auth/recovery/start\` and \`/recovery/complete\`: email OTP + current recovery code; successful recovery rotates the recovery code and revokes existing sessions.
- \`GET /api/company/auth/me\` and \`POST /api/company/auth/logout\`: inspect and revoke the current session.

Migration \`0010_email_only_auth.sql\` creates company credential storage and removes the legacy phone columns. Apply it only to the intended staging database after backup and review.

## Staging status and release gates

The staging workflow is \`.github/workflows/daga-staging-setup.yml\`; it uses the separate \`daga-app-staging\` D1 database and Worker and does not deploy the production \`daga-voice\` Worker. The owner-auth CI and isolated staging setup passed for commit \`7ee89f7152dc01242bcd15cbf4911f87d73aad5c\`. These results verify the workflow's static/schema checks and staging job, not actual mailbox delivery or full owner/company end-to-end authentication.

Before production release, manually verify email delivery, owner bootstrap/login/recovery, company owner approval and password setup, two-device invitation registration, role/permission enforcement, expired/replayed/concurrent invitations, session revocation, and cross-company isolation. Existing \`/memory\`, \`/chat\`, \`/tts\`, and LiveAvatar routes are not comprehensively integrated with authenticated company identity. Do not merge to \`main\` or deploy the production Worker until the release gates are complete and explicitly approved.

## Owner console and administration APIs

After the Worker and database are configured, the Arabic RTL owner console is served by the Worker at `/owner/` and `/owner-console/`; the HTML page uses a same-origin API base and keeps the session token in page memory rather than localStorage. It keeps the session token in page memory rather than localStorage; refreshing the page requires signing in again.

The console currently calls these owner-session-protected endpoints:

- `GET /owner/admin/overview`
- `GET|POST /owner/admin/plans`; `PATCH /owner/admin/plans/:uuid`
- `GET|POST /owner/admin/payment-methods`; `PATCH /owner/admin/payment-methods/:uuid`
- `GET /owner/admin/stores`; `POST /owner/admin/stores/:uuid/decision`
- `GET /owner/admin/payments`; `POST /owner/admin/payments/:uuid/review`
- `POST /owner/admin/words/adjust` (requires a unique request ID for idempotency)
- `GET|POST /owner/admin/columns`; `PATCH /owner/admin/columns/:uuid` (display label can change while stable key remains fixed)

The payment review route is an explicit owner action. The owner must verify that money actually arrived before choosing “confirmed”; the API cannot independently prove a manual transfer. Automatic payment verification still requires a trusted payment provider webhook. The console is an initial admin surface, not a replacement for integrating the owner role into the existing V30 dashboard.


## Offers and discounts

The owner console exposes `GET/POST /owner/admin/offers` and `PATCH /owner/admin/offers/:id` for configuring store or LIVE DAGA offers. Apply migration `0004_daga_offers.sql` before using these routes. The company checkout now exposes eligible offers to authenticated store owners, validates offer service/window/redemption limits server-side, and writes a price-adjustment snapshot when creating an order. Full authenticated end-to-end purchase and owner-review verification is still a release gate.


## Company checkout API (implementation groundwork)

The authenticated company portal now includes an initial subscription/payment flow for approved store-owner accounts. APIs are served by the Worker module `company-orders.js`: `GET /api/company/plans`, `GET /api/company/payment-methods`, `GET /api/company/offers`, `GET|POST /api/company/orders`, and `POST /api/company/orders/:uuid/payment`.

Order creation snapshots the server-calculated price and any supplied eligible offer; client-provided amounts are ignored. Payment submission records a claimed transfer for owner review only. It does not activate entitlements or credit LIVE DAGA words. Owner confirmation remains required, and the payment destination is a manual-transfer instruction until a trusted provider webhook is integrated.

Before production release, complete authenticated end-to-end checkout tests, offer selection UI, payment-review idempotency tests, SMS/email owner OTP setup, authenticated identity/tenant integration for legacy memory/chat/TTS/LiveAvatar endpoints, and manager/employee cross-company isolation checks. Do not treat staging anonymous-denial smoke tests as proof of a complete production authorization model.