# Owner authentication staging checklist

Do not use production data, real customer accounts, or real payment records during this checklist. Use a dedicated staging D1 database and staging Worker.

## Prerequisites
- [ ] Dedicated D1 database is created and bound as `DAGA_APP_DB`.
- [ ] Migrations 0001, 0002, 0003, and 0004 (offers) are applied in order.
- [ ] Worker secrets are set in Cloudflare: bootstrap token, OTP pepper, owner phone/email, Twilio credentials/sender, Resend API key, verified sender.
- [ ] `DAGA_ALLOWED_ORIGINS` is set to the exact staging frontend origin.
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

## Release gates
- [ ] CI syntax/schema workflow passes on the exact intended commit.
- [ ] SMS/email delivery and end-to-end staging tests are verified by a human.
- [ ] Existing chat/TTS/LiveAvatar routes are tested after Worker changes.
- [ ] Existing user-facing endpoints have role and tenant authorization; protecting owner routes alone is insufficient.
- [ ] Production deployment is intentionally approved, then the actual Worker version and endpoint responses are verified.
- [ ] Do not call the owner console production-secure until these checks pass.
