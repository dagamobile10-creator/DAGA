# Owner authentication staging checklist

Do not use production data, real customer accounts, or real payment records during this checklist. Use a dedicated staging D1 database and staging Worker.

## Prerequisites
- [ ] Dedicated D1 database is created and bound as `DAGA_APP_DB`.
- [ ] Migrations 0001–0010 are applied in order, including stable identities, invitations, registration OTPs, company-login OTPs, and the partial unique index that prevents duplicate pending payment submissions.
- [ ] Worker secrets are set in Cloudflare: bootstrap token, OTP pepper, Resend API key, verified sender.
- [ ] `DAGA_ALLOWED_ORIGINS` is set to the exact staging frontend origin.
- [ ] `DAGA_APP_BASE_URL` is set to the trusted HTTPS staging frontend origin/path used to create invitation links; it is never derived from the request Host header.
- [ ] Invitation page at `/invite/?token=...` is served over HTTPS and calls the staging Worker URL, not the production voice Worker until the application D1 binding is verified.
- [ ] `POST /api/company/auth/register` and `/register/verify` send and verify email OTPs; OTP challenges are hashed, expire, have bounded attempts, and use unique atomic claim IDs.
- [ ] `POST /api/company/auth/login` and `/login/verify` create company sessions with email + password; verify replay/race tests.
- [ ] `GET /api/company/auth/me` returns only approved companies and active memberships; `POST /api/company/auth/logout` revokes the current bearer session.
- [ ] Provider test delivery succeeds; do not expose codes in logs.
- [ ] Bootstrap token is generated out-of-band and not committed.

## Bootstrap and owner protection
- [ ] Bootstrap start without bearer token returns 401.
- [ ] Wrong bootstrap token returns 401.
- [ ] Valid bootstrap start sends one email verification code to the email supplied for the owner.
- [ ] Wrong, expired, consumed, and five-times-attempted OTPs fail.
- [ ] Password below policy is rejected.
- [ ] Successful verification creates exactly one `program_owner` and one owner singleton.
- [ ] A second bootstrap attempt returns 409.
- [ ] Bootstrap token is rotated/deleted after owner creation.
- [ ] Password is never stored/returned in plaintext; only session-token hashes are stored.

## Login, sessions, recovery
- [ ] Wrong password and unknown identifier return the same generic 401.
- [ ] Repeated login attempts hit rate limits.
- [ ] Valid login returns a session; `/owner/auth/me` succeeds only with it.
- [ ] Logout revokes the session; replaying it fails.
- [ ] Recovery sends a temporary code only to the verified owner email.
- [ ] Recovery fails if the email OTP, current recovery code, or password policy is wrong.
- [ ] Successful recovery rotates the recovery code and revokes all prior sessions.
- [ ] Recovery is rate-limited; OTPs/recovery codes never appear in logs.

## Owner admin and data integrity
- [ ] Every `/owner/admin/*` route returns 401 without a valid owner session.
- [ ] Store-owner, manager, and employee sessions are rejected by owner routes.
- [ ] Owner can create/update/disable plans; existing orders retain agreed price snapshots.
- [ ] Owner can update payment destinations and active status.
- [ ] Owner can create, schedule, activate, and disable offers; expired/inactive offers are rejected by the eventual order-creation service.
- [ ] Existing orders retain their agreed price snapshot when plan/offer settings change.
- [ ] Store approval/rejection updates both store and store-owner account status.
- [ ] Payment submission alone does not activate entitlement; owner confirmation is required.
- [ ] Duplicate payment review cannot create duplicate entitlement/word credits.
- [ ] LIVE DAGA word adjustments use unique request IDs; retries cannot double-credit.
- [ ] Column label changes preserve stable keys; regular users cannot edit calculation keys.
- [ ] Privileged changes create audit events.
- [ ] Tenant isolation is tested before enabling store/manager/employee data routes.

## Company checkout and payment review
- [ ] Unauthenticated requests to `/api/company/plans`, `/api/company/payment-methods`, `/api/company/orders`, and `/api/company/orders/:id/payment` return 401.
- [ ] Manager and employee sessions cannot create orders or submit payment for a company.
- [ ] A store owner can list only orders belonging to an approved store they own; changing `storeId` to another company's ID returns 403.
- [ ] Inactive plans cannot be ordered; order creation uses the current server-side plan price/version and ignores any client-supplied amount.
- [ ] An eligible offer is applied only for the matching service and within its active time window; fixed and percentage discounts never make the final price negative.
- [ ] Offer redemption limits remain correct under concurrent order attempts; failed order creation does not permanently consume a redemption.
- [ ] The order and immutable price adjustment snapshot match the final agreed price, list price, discount, and offer name at order time.
- [ ] Payment submission is accepted only for the account's own order in `awaiting_payment`, uses an active payment method, and cannot set the order to paid/approved.
- [ ] Duplicate or concurrent payment submissions cannot create multiple pending submissions for one order.
- [ ] Payment submission alone never creates an entitlement or LIVE DAGA word credit; only a successful owner review can do so.
- [ ] Manual-transfer references/receipts are reviewed by the owner; do not treat a user-supplied receipt URL or claimed amount as proof that funds arrived.
- [ ] Company portal checkout controls appear only for store-owner accounts; employee/manager invitation permissions remain unchanged.

## Store identity and invitation gates
- [ ] Every store receives a stable public ID distinct from its internal database ID; changing the display name does not change either identity.
- [ ] The store QR identifies the store only and grants no membership or session.
- [ ] Invitation tokens are generated with cryptographic randomness; only token hashes are stored, and raw tokens are returned only once.
- [ ] `POST /api/company/invitations` fails closed until the trusted HTTPS `DAGA_APP_BASE_URL` is configured.
- [ ] Invitation acceptance requires an authenticated account and server-side checks of token hash, store, expiry, status, use count, intended role, and inviter permissions.
- [ ] Invitation acceptance and membership creation are atomic; replaying or concurrently accepting the same invitation cannot create extra memberships.
- [ ] Revoked and expired invitations fail; a manager cannot grant a role or permission beyond their own delegation limits.
- [ ] A membership from store A cannot read or modify store B data, even when the client changes IDs in requests.
- [ ] Existing memberships are not silently broken by the introduction of new membership tables; migration/backfill behavior is tested.
- [ ] Shop QR and invitation QR/link are separate; revoking an invitation does not rotate the store identity.

## Release gates
- [ ] CI syntax/schema workflow passes on the exact intended commit.
- [ ] Email delivery and end-to-end staging tests are verified by a human.
- [ ] Existing chat/TTS/LiveAvatar routes are tested after Worker changes.
- [ ] Existing user-facing endpoints have role and tenant authorization; protecting owner routes alone is insufficient.
- [ ] Production deployment is intentionally approved, then the actual Worker version and endpoint responses are verified.
- [ ] Do not call the owner console production-secure until these checks pass.


## Stable account/company public IDs
- [ ] Migration 0006 applied to a dedicated staging D1 database; every existing account and company has a unique, non-empty public ID.
- [ ] Editing a company display name does not change its public ID.
- [ ] Public ID / identity QR alone never authenticates or grants access.
- [ ] Company terminology is used in user-facing copy; internal legacy SQL names are not renamed without a separate compatibility migration.


## Email-only authentication migration
- [ ] Migration 0010 is applied only to the intended staging D1 database after review and backup.
- [ ] Owner login uses verified email and password and never requires an OTP on every login.
- [ ] First-time owner bootstrap verifies the supplied email before creating the singleton program-owner account.
- [ ] Company owner created from the admin dashboard can set a password after approval using a single-use email OTP.
- [ ] Invitation registration keeps its single-use invitation check, verifies email, and creates password/recovery code and membership atomically.
- [ ] Company login, setup, and recovery are rate-limited; recovery rotates recovery code and revokes prior sessions.
- [ ] Existing approved accounts without credentials can set a password through email verification.
- [ ] Migration 0010 clears stored phone values; no authentication endpoint requires phone fields or SMS secrets.
- [ ] Passwords/recovery codes are never stored in plaintext; OTPs are hashed, expire, have bounded attempts, and are single-use.
