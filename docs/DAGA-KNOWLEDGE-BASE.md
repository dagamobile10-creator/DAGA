# DAGA curated knowledge

## Purpose

This is the preparation guide for adding owner-approved facts and operating rules to LIVE DAGA without rewriting its core behavior instructions. The Worker supports an optional `DAGA_KNOWLEDGE_BASE` environment variable. It is currently a deployment-time setting, not an in-app editor.

## Current behavior

- The Worker appends the variable's contents to the chat instructions when the variable is non-empty.
- The value is capped at 8,000 characters by the Worker.
- If the variable is unset or empty, this feature contributes no extra text and the existing prompt path remains in place.
- The same extra context is passed to the configured Groq and Cloudflare AI chat paths.
- This feature is not yet live: the change is on a draft feature branch and has not been merged or deployed.
- Do not put passwords, API keys, customer personal data, or private account/financial records in this knowledge field.

## Suggested format for future entries

Use short, explicit sections. Mark uncertain or temporary information clearly.

### Identity and language
- Assistant name and spelling:
- Required dialect and tone:
- Names/identities it must never assume:

### Confirmed project facts
- Fact:
- Source/owner confirmation:
- Last verified date:

### Shop workflow rules
- Rule:
- What data is required before applying it:
- What to do if data is missing:

### Response behavior
- Desired behavior:
- Example trigger:
- Exact response only if the wording must be fixed:

### Things the assistant must not claim
- Never claim an action was completed unless a tool or system confirms it.
- Never invent current shop balances, sales, orders, or inventory.
- Treat examples and policy descriptions as guidance, not as live operational data.

## Safe update process

1. Add only facts confirmed by the owner.
2. Keep core identity, privacy, security, and anti-fabrication rules in the Worker code; do not override them with knowledge entries.
3. Configure `DAGA_KNOWLEDGE_BASE` in a non-production Worker environment first.
4. Test normal conversation, Egyptian Arabic, memory/recall, and refusal to invent live shop figures.
5. Review the diff and deployment configuration before promoting to production.
6. Do not deploy this feature to the production `daga-voice` Worker without explicit approval.

## Future improvement

A proper owner-only knowledge editor backed by the app database would allow approved entries to be added, edited, disabled, and audited without redeploying the Worker. That requires a separate authenticated API, database schema/migration, and UI; this draft does not claim to implement that editor.
