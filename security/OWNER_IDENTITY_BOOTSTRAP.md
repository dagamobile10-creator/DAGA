# DAGA V30 — Program-owner identity bootstrap

## Security rules

- Never commit the owner's phone, email, password, OTP, recovery codes, or bootstrap token to GitHub, HTML, JavaScript shipped to browsers, migration SQL, or logs.
- The two secret-looking strings previously sent in chat are treated as exposed. Do not reuse either as a production password, recovery code, or bootstrap token; rotate them if either is currently active anywhere.
- The `program_owner` account is provisioned only by a server-side, one-time bootstrap. Public signup must never accept or assign the `program_owner` role.
- The owner identity is not considered verified until phone and email verification providers have independently confirmed possession. Merely storing contact details is not verification.
- All privileged operations must check the authenticated server-side session, verified owner account, and role on every request. A hidden UI button is not authorization.
- Do not enable owner bootstrap on the public Worker until a dedicated D1 database is bound, one-time bootstrap credentials are stored as Worker secrets, rate limits are in place, and the SMS/email verification providers are configured and tested.
- Do not use the same password for the owner login and the bootstrap token. Prefer a managed identity provider supporting MFA/passkeys; if custom sessions are implemented, use strong password hashing, short-lived secure sessions, CSRF protection where relevant, rate limits, and audit logs.

## Deployment sequence

1. Create a dedicated Cloudflare D1 database for the DAGA V30 backend; do not apply the schema blindly to any existing production database.
2. Apply `migrations/0001_daga_core.sql` to that database and bind it to the Worker as `DAGA_MEMORY_DB` only after confirming this is the intended database (or use a separate `DAGA_APP_DB` binding for application data).
3. Configure a real SMS OTP provider and an email verification provider using server-side secrets. Never send OTPs or provider credentials through the chat or store OTPs in plaintext.
4. Implement and test one-time owner provisioning plus verified login; disable the bootstrap path permanently after successful provisioning.
5. Add server-side authorization and tenant-isolation checks to every protected endpoint before connecting dashboard actions.
6. Test owner, store owner, manager, employee, unverified, suspended, and cross-store access cases in staging.
7. Deploy only after the above checks pass; then verify the live Worker and the existing DAGA voice flow separately.

## Current state

This file records the required security boundary; it is not proof that owner authentication or SMS/email verification is implemented. The current Worker still needs application authentication and authorization routes, provider configuration, database provisioning, and tests before it can safely enforce owner-only access.
