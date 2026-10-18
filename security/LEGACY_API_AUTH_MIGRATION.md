# Legacy LIVE DAGA API authorization migration

Status: design gate for implementation; not a claim that legacy endpoints are secured.

## Non-negotiable compatibility rule

Do not require a company-account bearer token on the existing public LIVE DAGA UI until the client has a supported sign-in/session flow and migration has been tested end-to-end. A global authentication gate on `/chat`, `/tts`, `/memory`, or `/liveavatar/token` would currently break the deployed `index.html` flow. Do not solve this by trusting caller-supplied IDs, browser localStorage, Origin, or Referer as identity.

## Route-by-route target

| Route | Current trust boundary | Required target |
|---|---|---|
| `GET/POST /memory` | Caller selects `userId`; persistent row keyed by that value | Derive memory owner from a server-verified account/session. Reject mismatched client IDs. Migrate existing anonymous memory only through an explicit, one-time claim proof; never attach by a supplied UUID alone. |
| `POST /chat` | Caller can submit arbitrary text/history/memory/context | Apply request size and rate limits immediately. For authenticated accounts, derive account/company context server-side and ignore client-supplied identity/entitlements. Keep anonymous mode explicitly scoped and abuse-limited until sign-in rollout. |
| `POST /tts` | Publicly callable provider-backed voice usage | Add server-side rate/usage controls and abuse limits first. Entitlement checks must use authenticated server-side identity; never accept a client-provided balance. |
| `POST /liveavatar/token` | Anyone may request a provider session token | Add rate limits and session issuance limits; later require authenticated identity and verify account/company entitlement before issuing a token. Never expose provider credentials. |
| `GET /liveavatar/avatars` | Provider-backed metadata endpoint | Keep only the minimum public metadata necessary; rate-limit and avoid returning provider payloads or private avatar details. |

## Safe rollout sequence

1. **Inventory and tests first.** Preserve snapshots of the existing production client and API behavior. Add route-level tests for current request/response contracts and resource limits; never deploy test-only behavior to production.
2. **Contain abuse without identity assumptions.** Implement conservative request-body caps, explicit content-type checks for JSON POSTs, bounded history and strings, per-IP throttles with a shared store where available, and generic provider errors that do not leak upstream bodies. These controls must not silently change successful response schemas.
3. **Create a stable personal account/session path.** Reuse the existing verified account/session primitives only after deciding how the current personal LIVE DAGA user signs in. A company membership is not automatically the same thing as a personal assistant identity.
4. **Design one-time memory claim.** The legacy random UUID in localStorage is not proof of ownership. Offer an explicit migration/claim flow, then bind the existing memory row to a server-owned account ID transactionally. Do not silently merge or expose another account's history.
5. **Dual-mode staging only.** Test the new authenticated client against the separate staging Worker/D1, while exercising the old UI against the unchanged production Worker. Never toggle an auth requirement on the production Worker as an experiment.
6. **Validate provider-backed features.** Verify chat, TTS playback, LiveAvatar token issuance, CORS, errors, rate limits, logout/session expiry, tenant isolation, and mobile browser behavior. Verify SMS/email only after the owner-approved staging secrets are configured.
7. **Release deliberately.** Publish a versioned client with the sign-in/session path first, then switch API enforcement only after the staged client is deployed and measured. Require explicit production approval; no automatic merge/deploy.

## Acceptance criteria

- A caller cannot read or overwrite another user's memory by changing a URL/body ID.
- No role, company, word balance, or entitlement is trusted from the browser.
- Logout, expiry, suspension, and revoked sessions stop protected operations.
- Anonymous compatibility is explicit, rate-limited, and does not grant persistent cross-user memory.
- Existing successful LIVE DAGA chat, TTS, and avatar flows are covered by automated contract tests before and after migration.
- Tenant-isolation tests include changed IDs, cross-company requests, expired/replayed sessions, and concurrent operations.
- Production release remains blocked until all staging gates pass and the owner explicitly approves.

## Current status

The existing legacy endpoints have not been converted to authenticated, role-aware routes. This document is a migration plan only. It does not assert that the risks above are fixed.
