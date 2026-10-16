# DAGA V30 owner-auth staging test checklist

Do not run destructive tests against production data. Run only after migration 0001 and 0002 have been applied to a dedicated staging D1 database and real SMS/email providers are configured.

## Owner provisioning and identity
- [ ] Public signup cannot request or obtain the `program_owner` role.
- [ ] No account is granted owner status merely because it is the first account.
- [ ] Owner bootstrap fails closed when any required server secret, database binding, or verification provider is missing.
- [ ] A bootstrap token is one-time, high entropy, stored only as a Worker secret, rate-limited, and invalid after successful use.
- [ ] Phone OTP is sent only to the configured owner phone and email verification only to the configured owner email.
- [ ] Wrong, expired, replayed, and over-attempt OTPs are rejected.
- [ ] Phone and email must both be verified before owner activation.
- [ ] Owner login never returns or logs OTPs, passwords, raw bearer tokens, or recovery secrets.
- [ ] Owner credentials and session token hashes are not stored in source control or browser-delivered code.
- [ ] The exposed credentials shared in chat are not used as production credentials.

## Authorization and sessions
- [ ] Unauthenticated requests cannot access owner endpoints.
- [ ] Store owner, manager, and employee accounts receive 403 from every program-owner endpoint.
- [ ] Revoked and expired sessions are rejected.
- [ ] Changing a role or suspending an account takes effect server-side.
- [ ] Cross-store reads/writes are rejected even if a caller changes a store ID in the request.
- [ ] Sensitive changes write an audit event without secrets or full payment details.

## Existing DAGA functionality
- [ ] `/health` remains available and reveals no secrets.
- [ ] Existing /chat and /tts behavior remains functional after changes.
- [ ] LIVE DAGA token issuance has appropriate abuse controls and is not accidentally made owner-only if end users need it.
- [ ] Memory endpoints enforce authenticated user ownership before accessing per-user records.
- [ ] CORS is restricted to intended production/staging origins before production rollout.

## Release gate
No production deployment until all required checks pass. Database tables alone do not implement authentication; owner endpoints and provider integration must be implemented and tested separately.
