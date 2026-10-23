# DAGA company authentication — route audit (V30)

## Finding

The company portal UI in `company/portal.html` calls these routes:

- `/api/company/auth/me`
- `/api/company/auth/login`
- `/api/company/auth/setup/start`
- `/api/company/auth/setup/verify`
- `/api/company/auth/recovery/start`
- `/api/company/auth/recovery/complete`
- `/api/company/auth/logout`

The LIVE DAGA sign-in panel in `index.html` calls `/api/company/auth/login`, `/api/company/auth/me`, and `/api/company/auth/logout` too.

In the current Worker dispatch, `worker.js` imports `handleOwnerAuth`, `handleOwnerAdmin`, `handleCompanyInvitations`, and `handleCompanyOrders`. The owner auth module `owner-auth.js` registers only `/owner/bootstrap/*`, `/owner/auth/*`, and `/owner/recovery/*`. No `/api/company/auth/*` handler is imported or registered in this branch. These calls therefore fall through to the Worker’s not-found response unless another deployment artifact differs from this branch.

## Important separation

- `/owner/auth/*` authenticates the singleton `program_owner` account.
- `/api/company/auth/*` must authenticate approved company accounts (store owner, manager, employee) and must not reuse program-owner login as a shortcut.
- Migration `0010_email_only_auth.sql` creates `daga_account_credentials`; migrations `0007` and `0008` define older registration/login challenge tables. Before implementing company auth, confirm the migration sequence applied to the target D1 database and reconcile any legacy challenge design with the email-only policy.

## Required implementation and staging checks

1. Add a dedicated company-account auth handler and dispatch it before public voice routes.
2. Implement setup-start/setup-verify using email OTPs with hashed challenges, expiry, attempt limits, single-use consumption, and rate limits.
3. Implement login against `daga_account_credentials`, only for approved accounts; issue hashed-at-rest bearer sessions compatible with `authenticatedAccount`.
4. Implement `/me` and logout with session validation/revocation; recovery must verify the registered email and a recovery factor, rotate credentials, and revoke old sessions.
5. Keep program-owner routes and permissions separate.
6. Add automated tests for valid login, invalid credentials, pending/rejected account denial, OTP expiry/replay/attempt limits, recovery session revocation, logout, and role separation.
7. Run tests against a dedicated staging D1 database and staging Worker; do not apply destructive migration `0010` to production without a verified backup and reviewed migration state.

## Status

This file records a code-reviewed gap. It does not claim that company authentication has been implemented, tested end-to-end, or deployed.
