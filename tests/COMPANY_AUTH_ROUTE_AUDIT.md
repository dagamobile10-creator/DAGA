# DAGA company authentication — route audit (V30)

## Verified implementation

The company-account authentication routes are implemented in `company-invitations.js` and dispatched by `worker.js` through `handleCompanyInvitations`. The handler covers registration, registration verification, password login, first-time password setup, recovery, current-account lookup, logout, and company invitations. It is separate from `/owner/auth/*`, which is for the singleton `program_owner`.

The company portal and LIVE DAGA call `/api/company/auth/login`, `/api/company/auth/me`, and `/api/company/auth/logout`. The portal also calls the setup and recovery routes implemented by the same handler. Password login uses approved company accounts and `daga_account_credentials`; session tokens are stored as hashes and account lookup/revocation use the shared session tables.

## Test-maintenance issue found

`tests/test_navigation_routes.py` checks whether company portal endpoints have handlers, but its handler-source list originally included `worker.js`, `company-orders.js`, and no `company-invitations.js`. This makes its auth-route assertion inaccurate: the auth handlers live in `company-invitations.js`. Update the regression test to inspect the actual handler module and to explicitly verify that `worker.js` dispatches to `handleCompanyInvitations`.

## Remaining staging validation

Static source checks do not prove that authentication works against the deployed Worker or the intended D1 database. Before declaring this complete, run the company-auth tests against a dedicated staging D1 database and staging Worker. Confirm migrations `0001`–`0010` are applied in order, email delivery works, setup and recovery OTPs expire and cannot be replayed, invalid credentials are rejected, logout/recovery revoke sessions, and company roles cannot use program-owner routes. Migration `0010_email_only_auth.sql` drops legacy phone columns; back up and verify the target database before applying it anywhere.

## Status

The source review confirms that the company auth handler exists. This audit does not claim end-to-end authentication or production deployment has been verified.
