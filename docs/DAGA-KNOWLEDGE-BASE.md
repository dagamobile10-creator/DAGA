# DAGA curated knowledge

## Purpose

This is the preparation guide for adding owner-approved facts and operating rules to LIVE DAGA without rewriting its core behavior instructions. The Worker supports an optional `DAGA_KNOWLEDGE_BASE` environment variable. It is currently a deployment-time setting, not an in-app editor.

## Current behavior

- The Worker appends the variable's contents to the chat instructions when the variable is non-empty.
- The value is capped at 8,000 characters by the Worker.
- If the variable is unset or empty, this feature contributes no extra text and the existing prompt path remains in place.
- The same extra context is passed to the configured Groq, Cloudflare AI, and OpenAI fallback chat paths.
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

## Owner dashboard editor

The app-owner dashboard now includes a **معرفة ضجه** section. After the Worker branch is deployed to a test environment and the owner dashboard is served by that same Worker, an authenticated program owner can:
- Add entries with a title, category, and content.
- Review up to 200 saved entries.
- Edit entries and enable/disable them.
- See changes recorded in the admin audit log.

The API uses `/owner/admin/knowledge` and is protected by the existing authenticated-owner gate. The Worker creates the knowledge table/index on the first authenticated knowledge API request, so a separate manual schema migration is not required for this draft.

Active database entries are appended to chat context, newest first, with at most 30 entries and a combined total capped at 8,000 characters. The optional `DAGA_KNOWLEDGE_BASE` environment value is still supported and is combined with database entries.

## Safe test and release process

1. Merge/deploy nothing to production yet; this change is still a draft.
2. Create a non-production Worker environment with the existing required database bindings and secrets.
3. Open the owner console on that same Worker origin and authenticate as the program owner.
4. Add a harmless test fact such as “Demo fact: the test shop name is Cedar.” Ask LIVE DAGA about it and verify the answer, then disable the entry and verify it is no longer supplied in new chat requests.
5. Test editing, empty fields, overlong content, unauthenticated API calls, and audit-log entries.
6. Verify the existing chat, TTS, LiveAvatar and account flows still work.
7. Review the final diff and deployment settings before considering production release.

Do not put passwords, API keys, customer personal data, or private account/financial records in the knowledge entries. Knowledge entries provide context, not authorization or live operational data. The assistant must still never invent balances, orders, sales, inventory, or claim actions that were not performed.

## Current release status

- Code and owner UI are committed to the feature branch.
- This draft has not been merged or deployed.
- Static review found and fixed an OpenAI fallback path that initially did not receive the curated knowledge context.
- Live runtime tests have not yet been performed.
- The production `daga-voice` Worker and `main` branch have not been changed.
