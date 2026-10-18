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

Bind that database to the Worker as `DAGA_APP_DB`. Keep the existing `DAGA_MEMORY_DB` binding separate until its user identity model is migrated and tested.

## Required Worker secrets / variables

Set these server-side in Cloudflare Worker settings (never in GitHub files or browser HTML):

- `DAGA_OWNER_BOOTSTRAP_TOKEN`: one-time high-entropy random secret, at least 32 random bytes.
- `DAGA_OWNER_PHONE`: the owner's verified phone in international format, e.g. `+201xxxxxxxxx`.
- `DAGA_OWNER_EMAIL`: the owner's verified email address.
- `DAGA_OTP_PEPPER`: a separate high-entropy random secret used to hash verification codes and recovery codes.
- `DAGA_APP_BASE_URL`: trusted HTTPS origin of the Worker serving `/go/`, `/company/`, and `/invite/`; do not derive it from the incoming Host header.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: valid Twilio SMS configuration.
- `RESEND_API_KEY`, `DAGA_EMAIL_FROM`: valid Resend email configuration; sender must be verified.

Optionally set `DAGA_ALLOWED_ORIGINS` to the exact deployed frontend origin(s); do not use `*` in production. The phone and email values must be configured out-of-band. Never copy passwords, OTPs, recovery codes, provider keys, or bootstrap tokens into chat or source control.

## One-time bootstrap

Only after all three migrations and providers are configured, call the bootstrap start endpoint from a trusted terminal (not from a public browser):

```sh
curl -X POST "https://YOUR-WORKER/owner/bootstrap/start" \
  -H "Authorization: Bearer $DAGA_OWNER_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

The owner receives separate SMS and email codes. Choose a new, unique password of 14–128 characters containing uppercase, lowercase, and a number, plus a new recovery code of at least 20 characters. Do not reuse credentials previously shared in chat.

Then submit the codes and newly chosen credentials from the trusted terminal. Use environment variables or an interactive local prompt; do not put secrets into shell history:

```sh
curl -X POST "https://YOUR-WORKER/owner/bootstrap/verify" \
  -H "Authorization: Bearer $DAGA_OWNER_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneCode":"$PHONE_CODE","emailCode":"$EMAIL_CODE","password":"$NEW_PASSWORD","recoveryCode":"$NEW_RECOVERY_CODE"}'
```

The recovery code must be a new, unique secret of at least 20 characters. The response contains a session token; keep it private. After the owner is provisioned, rotate/delete `DAGA_OWNER_BOOTSTRAP_TOKEN` in Worker secrets.

## Routes implemented in this branch

- `POST /owner/bootstrap/start`: sends independent phone/email OTPs; requires bootstrap bearer token.
- `POST /owner/bootstrap/verify`: verifies both OTPs and creates the single program owner; requires bootstrap bearer token.
- `POST /owner/auth/login`: body `{"identifier":"owner email or phone","password":"..." }`; validates the password and sends separate SMS and email OTPs; does not issue a session yet.
- `POST /owner/auth/login/verify`: body `{"phoneCode":"123456","emailCode":"123456"}`; only after both codes verify does it issue an opaque bearer session.
- `GET /owner/auth/me`: validates the bearer session and returns masked owner contact details.
- `POST /owner/auth/logout`: revokes the bearer session.
- `POST /owner/recovery/start`: sends recovery OTPs to the configured owner phone and email.
- `POST /owner/recovery/complete`: requires both OTPs, the current recovery code, a new password, and a new recovery code; revokes all sessions and rotates the recovery code.

All routes fail closed when required configuration is absent. Sessions expire after eight hours. Passwords use PBKDF2-HMAC-SHA256 with 310,000 iterations and a per-password random salt; OTPs and session tokens are stored as hashes.

## Company onboarding and staging

The branch also contains `company-invitations.js`, the company portal at `/company/`, invitation acceptance at `/invite/`, and the public DAGA QR landing page at `/go/`. The company portal creates role-limited invitations and locally renders their QR codes; the public QR is separate from invitation QR codes. The program owner provisions a pending company and owner account in the owner console; the owner can sign in after the company is approved.

The manual/automatic-on-development staging workflow is `.github/workflows/daga-staging-setup.yml`. It uses a separate `daga-app-staging` D1 and `daga-app-staging` Worker; it never targets the production `daga-voice` Worker. It requires GitHub Actions secrets named `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DAGA_OTP_PEPPER`, `DAGA_OWNER_BOOTSTRAP_TOKEN`, `DAGA_OWNER_PHONE`, `DAGA_OWNER_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `RESEND_API_KEY`, and `DAGA_EMAIL_FROM`. The isolated staging Worker and D1 were provisioned successfully, all nine migrations applied, and runtime smoke checks passed for the health endpoint, CORS, /go/, /company/, /invite/, /owner/, /owner-console/, and unauthenticated API denial. However, the latest staging run reported DAGA_OTP_PEPPER missing and intentionally skipped configuring all owner/SMS/email delivery secrets. Therefore owner bootstrap, OTP delivery, real login, and recovery are NOT ready. Add valid values through GitHub repository Actions secrets; do not put their values in chat or source control.

## Not yet release-ready

- These routes do not by themselves provide a finished owner dashboard or authorization for every existing business/payment/store endpoint.
- The existing `/memory`, `/chat`, `/tts`, and LiveAvatar routes have not been comprehensively integrated with authenticated user/store context.
- The owner endpoints need automated unit/integration tests and a staging deployment before production. Owner password login now requires both SMS and email OTP verification before a session is issued.
- Restrict CORS to the real production origins, verify provider delivery, verify D1 migrations, and run `tests/OWNER_AUTH_STAGING_CHECKLIST.md` before release.
- Do not claim production owner security is enabled until the staging checks pass and the Worker deployment is verified.


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