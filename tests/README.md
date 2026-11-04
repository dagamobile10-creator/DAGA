# DAGA V30 test plan

Before any production deployment, automate these checks against a staging D1 database:

- Public registration cannot create or promote a `program_owner` account.
- Only the pre-provisioned owner can approve store owners, edit global plans/payment destinations, or change system-wide column behavior.
- Store owners cannot read or mutate another store's records, plans, word balance, or columns.
- A payment submission alone never activates an entitlement.
- A payment can be approved only once; duplicate callbacks/requests do not double-credit LIVE DAGA words.
- Plan price changes do not change existing orders' agreed price.
- LIVE DAGA word debits are server-side, non-negative, and idempotent.
- Column display-name changes do not change stable keys or calculation bindings.
- Phone and email verification codes expire, are single-use, and have rate/attempt limits.
- Existing `/memory`, `/chat`, `/tts`, and LiveAvatar endpoints enforce the intended account/entitlement policy before production.

These are test requirements, not claims that the application currently passes them.
