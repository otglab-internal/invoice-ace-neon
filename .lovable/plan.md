## Goal

Three connected fixes on `src/pages/CreateInvoicePage.tsx`:

1. **Existing client/contact must be read-only on this page** — selecting an existing contact/client should not edit and persist any field changes. Current code keeps the form editable and runs `update` calls in `handleSubmit`. Per the user, edits only happen in the "create new" flows.
2. **Contact UI should become a multi-select** — when an existing client is selected, instead of a single-contact dropdown, show every contact for that client as a checkbox row of `Name — EMAIL`. Contacts whose `HasBillingEmailFlag` is true (or any equivalent truthy value) are checked by default; the user can toggle them. Only checked contacts' emails go into `recipient_emails`.

## Changes (all in `src/pages/CreateInvoicePage.tsx`)

### A. Make existing client + existing contact read-only

- Render the existing-client and existing-contact field cards as **read-only display** (use disabled `Input` or a label/value pair), not editable inputs. Replace the helper text "Changes will be saved …" with "Selected from saved records — not editable here."
- Drop validation noise: when `clientMode === "select"` (or `contactMode === "select"`), do **not** run `validateSchemaValues` against `existingClient/ContactFields`. `clientValid` becomes simply `!!clientId`; `contactValid` for select mode becomes `!!contactId` (plus the new email-selection rule from §C). Update `missingFields` accordingly so prefilled fields can never produce a "Missing: …" message.
- Remove the existing-record update branches in `handleSubmit` (the two blocks under "Update existing client if changed" and "Update existing contact if changed", roughly lines 982–1055), and the related state: `existingClientOriginal`, `existingContactOriginal`, and the `diffChanged` helper if no longer used. Keep `existingClientFields` / `existingContactFields` only for **display** prefill.

### B. Multi-select contacts with HasBillingEmailFlag

Replace today's single-contact `Popover`/`Command` picker (lines 1357–1414) and the trailing "Send invoice to" block (1493–1525) with a single checkbox list when an existing client is selected.

UI layout per row:

```text
[ ] Jane Doe — jane@example.com
[x] John Smith — john@example.com   (default checked: HasBillingEmailFlag = true)
[ ] No-Email Person                  (no email shown)
```

Behavior:

- Source: `contacts` already loaded for the selected client.
- Each row: `Checkbox` + `Name`, with `— email` appended only when the contact has at least one email.
- For contacts with multiple emails, show one row per (contact, email) pair OR show contact + first email and join others with commas — keep it as one row per email so each is independently togglable. (Most rows will have one email.)
- Default-checked when the contact's `HasBillingEmailFlag` field is truthy. Truthy = `true`, `"true"`, `"1"`, `1`, `"yes"`, case-insensitive. Read from `contact.fields.HasBillingEmailFlag` (the field is already mirrored into `fields` by the existing mapper).
- Above the list: a "Create new contact" button that switches into the existing `effectiveContactMode === "new"` flow (unchanged).
- State: replace `contactId: string` with `selectedContactIds: Set<string>` (or array). Keep the `contactMode` state to flip between "select" (multi) and "new" (single new contact, unchanged).
- Seeding: when `contacts` for a client load, initialize `selectedRecipientEmails` to every email whose owning contact has `HasBillingEmailFlag` truthy. Selecting/deselecting a row toggles that contact's emails into/out of `selectedRecipientEmails`.
- Validation: contact step is valid in select mode when at least one row is checked **and** its email is present (or, if `sendToClient` is off, just one row checked is enough — no email needed for non-send invoices). If zero rows are checked, surface "Select at least one contact" in `missingFields`.

### C. Submit payload

- Drop the `effectiveContactId` derived from a single `contactId`. Instead:
  - `contact_id`: the first selected contact's id, or `"__new__"` if creating new. (The schema/DB still expects a single id.)
  - `contact_name`: the first selected contact's display name (or joined names if you prefer; keep first to minimize blast radius).
  - `recipient_emails`: emails from the selected checkbox rows when `sendToClient` is true (filtered through `emailRegex`).
- Remove all "update existing client/contact" calls from `handleSubmit`.

### D. Cleanup

- Remove unused imports (`Popover`, `Command`, etc.) only if nothing else on the page uses them.
- Remove the now-unused `setExistingClientOriginal`, `setExistingContactOriginal` state if confirmed unreferenced.
- Keep the create-new flows for client and contact unchanged — they remain the only paths that mutate records.

## Out of scope

- No edge-function changes; the `clients-api-proxy` continues to serve read/create. Update calls just stop being made from this page.
- No schema/DB migrations.
- Other pages that may still edit clients/contacts are untouched.