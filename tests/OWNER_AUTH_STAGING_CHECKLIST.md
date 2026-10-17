# Owner authentication staging checklist

Do not use production data, real customer accounts, or real payment records during this checklist. Use a dedicated staging D1 database and staging Worker.

## Prerequisites
- [ ] Dedicated D1 database is created and bound as `DAGA_APP_DB`.
- [ ] Migrations 0001–0006 are applied in order, including store identity, invitations, and stable public IDs.
- [ ] Worker secrets are set in Cloudflare: bootstrap token, OTP pepper, owner phone/email, Twilio credentials/sender, Resend API key, verified sender.
- [ ] `DAGA_ALLOWED_ORIGINS` is set to the exact staging frontend origin.
- [ ] `DAGA_APP_BASE_URL` is set to the trusted HTTPS staging frontend origin/path used to create invitation links; it is never derived from the request Host header.
- [ ] Provider test delivery succeeds; do not expose codes in logs.
- [ ] Bootstrap token is generated out-of-band and not committed.

## Bootstrap and owner protection
- [ ] Bootstrap start without bearer token returns 401.
- [ ] Wrong bootstrap token returns 401.
- [ ] Valid bootstrap start sends separate SMS and email codes.
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
- [ ] Recovery sends codes only to configured owner contacts.
- [ ] Recovery fails if either OTP, current recovery code, or password policy is wrong.
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
- [ ] SMS/email delivery and end-to-end staging tests are verified by a human.
- [ ] Existing chat/TTS/LiveAvatar routes are tested after Worker changes.
- [ ] Existing user-facing endpoints have role and tenant authorization; protecting owner routes alone is insufficient.
- [ ] Production deployment is intentionally approved, then the actual Worker version and endpoint responses are verified.
- [ ] Do not call the owner console production-secure until these checks pass.


## Stable account/company public IDs
- [ ] Migration 0006 applied to a dedicated staging D1 database; every existing account and company has a unique, non-empty public ID.
- [ ] Editing a company display name does not change its public ID.
- [ ] Public ID / identity QR alone never authenticates or grants access.
- [ ] Company terminology is used in user-facing copy; internal legacy SQL names are not renamed without a separate compatibility migration.
