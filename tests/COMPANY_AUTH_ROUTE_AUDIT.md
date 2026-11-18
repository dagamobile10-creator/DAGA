# DAGA company authentication — route audit (V30)

## Verified implementation

The company-account authentication routes are implemented in `company-invitations.js` and dispatched by `worker.js` through `handleCompanyInvitations`. The handler covers invitation-bound registration, email verification, password login, first-time password setup, recovery, current-account lookup, logout, and company invitations. It is separate from `/owner/auth/*`, which is for the singleton `program_owner`.

The company portal and LIVE DAGA call `/api/company/auth/login`, `/api/company/auth/me`, and `/api/company/auth/logout`. Password login uses approved company accounts and `daga_account_credentials`; session tokens are stored as hashes. Setup and recovery use email OTP and do not activate pending/rejected/suspended accounts.

## Email-only policy

Migration `0010_email_only_auth.sql` removes legacy phone authentication columns. Migration `0011_email_only_registration_challenges.sql` recreates the company registration challenge table with a database CHECK constraint requiring `channel = 'email'`, preserving email challenge rows and discarding any legacy phone-channel challenges. The migration regression checks now apply migrations `0001`–`0011` to a fresh SQLite database and verify the email-only constraint.

Invitation-bound employee/manager registration is intentionally separate from company onboarding. Company onboarding now has a public email-verified request flow in the company portal. The flow verifies the email by OTP, creates a store-owner account and company record in `pending` status, issues no session and no password, and leaves approval to the program-owner console. After approval, the owner console requests email-based password setup. Invitation-bound employee/manager registration remains separate.

## Regression and staging status

The latest CI runs for the reviewed branch completed successfully:
- company invitation, order/payment security, and schema migration checks;
- owner-auth syntax/schema and authorization guards;
- session security regression checks;
- navigation/route regression checks.

The isolated staging workflow also completed successfully: staging-only D1 migrations, staging Worker deployment, staging secret configuration, and staging health verification. This is not a production deployment.

## Remaining end-to-end checks

A green CI and staging health check do not prove that a real inbox receives OTP mail or that every browser flow succeeds against the deployed database. Before declaring authentication fully accepted, manually verify on staging:
1. Submit a company onboarding request and receive an email OTP; reject wrong, expired, exhausted, and replayed codes; confirm the resulting account/store remain pending and have no session.
2. Complete first-time password setup only after owner approval.
3. Verify pending, rejected, and suspended accounts cannot sign in or obtain setup codes.
4. Verify password recovery revokes existing sessions and login works only with the new password.
5. Verify company role/tenant isolation and that company accounts cannot call program-owner admin routes.
6. Confirm the existing LIVE DAGA voice/chat/TTS behavior remains intact.

## Production and merge boundary

PR #16 remains open and in draft. No merge or production deployment has been performed. Keep V30 as the only approved baseline, preserve the Premium RTL interface, and do not alter the production Worker or LIVE DAGA voice contract without explicit approval.
