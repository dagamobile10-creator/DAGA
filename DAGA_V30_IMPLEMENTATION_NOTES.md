# DAGA V30 — implementation notes

This branch is a protected development track based on the existing main branch. The live index.html, existing LIVE DAGA behavior, and original V30 dashboard are not replaced by this migration.

## First implementation artifact

migrations/0001_daga_core.sql defines the proposed D1 data model for:
- one pre-provisioned program owner (never public self-registration),
- store approval and roles,
- versioned store and LIVE DAGA plans,
- fixed-price order snapshots,
- payment submission/review,
- entitlements and a word-usage ledger,
- stable column keys separate from editable display names,
- audit events.

## Security requirements before enabling production traffic

1. Do not trust a role, store ID, price, word balance, approval state, or payment confirmation sent by the browser.
2. Bootstrap the sole program-owner account through a one-time server-side process using verified contact channels. Never make the first public registrant the owner.
3. Enforce roles and store ownership on every protected Worker route. Use a verified session/token; do not treat a UI route or local storage as authorization.
4. Verify phone and email with time-limited, single-use challenges, rate limits, and attempt limits. Provider credentials belong in Worker secrets, never in HTML or Git.
5. Receipt upload is a claim, not proof of payment. Manual activation happens only after the owner confirms funds arrived. Automatic activation requires trusted payment-provider confirmation.
6. Use immutable order price/version snapshots so changing a plan or creating a promotion does not silently alter an existing order.
7. Debit LIVE DAGA words server-side with an idempotent request ID; never accept client-supplied balances.
8. Column display labels can change, but stable keys/calculation keys remain controlled. Dangerous calculation/behavior changes require owner-only confirmation, validation, and audit logging.
9. Existing /memory, /chat, /tts, and LiveAvatar routes have not yet been converted to authenticated role-aware routes. Do not treat this schema alone as live authorization.
10. Before production, review existing unauthenticated endpoints (including memory and paid voice/avatar usage), apply migrations to a dedicated database, add automated tests, then deploy Worker and test staging.

## Deployment status

This branch contains a schema and implementation plan only. It does not create a D1 database, configure SMS/email providers, enable payment integrations, or deploy the Worker. No production security behavior should be assumed until server routes are implemented and tested.