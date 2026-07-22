## Goal

Drop the app-minted JWT (`x-app-jwt`) as the credential for the invoices API and all inter-system edge functions. External callers (OTG CRM, Stridekidz systems, future integrations) authenticate with a single `x-api-key` header. The Federated Gateway (upstream auth-app) already resolves which systems a key may act on, so our edge functions delegate identity + system-scope checks to it.

The browser app keeps working — but instead of holding a minted app JWT, it holds a **session API key** issued by the gateway at login and sends it as `x-api-key` on every call.

## New auth model

```text
External system ──► POST /invoices
                     x-api-key: <system key>
                     x-org-id: otg_lab
                     x-environment: production

Edge function ──► GET  <auth-app>/verify-key
                   x-api-key: <same key>
                   x-target-system: invoices

auth-app ──► { valid: true, system_id, allowed_systems: [...],
                actor: { id, name, email, role } }
```

If `invoices` is in `allowed_systems`, the request proceeds. Otherwise 403.

Result is cached per-key in-memory for 60s inside the edge function to avoid a round-trip on every call.

## What changes

### Edge functions (Deno)

1. `_shared/auth.ts` — replace `verifyJwt` / `authenticate` with `authenticateApiKey(req)`:
  - Reads `x-api-key`
  - Calls upstream `verify-key` endpoint (new secret `FEDERATED_GATEWAY_URL` + reuse existing `AUTH_API_KEY_*` for gateway auth)
  - Returns `{ system_id, actor, allowed_systems }` or `null`
  - 60s LRU cache
2. `invoices/index.ts`, `data-proxy/index.ts`, `get-users-proxy/index.ts`, `xero/index.ts`, `auth/index.ts` — swap `authenticate()` call, use returned `actor` where JWT `sub`/`email`/`role` were previously read.
3. `clients-api-proxy/index.ts` — accept `x-api-key` from caller, forward it (already forwards `AUTH_API_KEY_*` — now forwards caller's key too).
4. `login-proxy/index.ts` — `verify-2fa` no longer mints an HS256 JWT. Instead it returns the **session API key** that the auth-app issues for the logged-in user (needs upstream support; if the auth-app already returns one, use it; else fall back to storing the upstream `token` as the session key and treating it as an api-key on inbound calls — the verify-key endpoint validates either).
5. Delete `createJwt` / `verifyJwt`. Remove `SUPABASE_SERVICE_ROLE_KEY`-as-signing-secret usage.
6. CORS: add `x-api-key` to `Access-Control-Allow-Headers` on every function.

### Frontend

1. `src/lib/api-client.ts`, `src/lib/neon-client.ts` — send `x-api-key: <session key from localStorage>`; remove `x-app-jwt` + `Authorization: Bearer <appJwt>`.
2. `src/contexts/AuthContext.tsx` — store the returned session key as `auth_api_key` in localStorage (rename from `auth_token` for clarity, with a one-time migration read).
3. `src/pages/ApiDocsPage.tsx` — rewrite auth section: single `x-api-key` header, remove JWT/2FA-token confusion, keep the "Copy my current key" helper renamed to **Copy API key**.
4. `src/lib/patch-functions-invoke.ts` — unchanged (error normalization still relevant).

### Secrets / config

- Add `FEDERATED_GATEWAY_VERIFY_URL` (via `add_secret`) — the endpoint on the auth-app that validates `x-api-key` and returns actor + allowed_systems. If the URL is already derivable from existing `WEBHOOK_SUPABASE_URL`, we hard-code the path and skip the new secret.
- No new signing secret; JWT signing key usage is removed.

## Out of scope

- Building the admin UI in the gateway for granting a key access to additional systems — that lives in the auth-app, not this project.
- Backward compat for old JWTs: since `x-app-jwt` was only used by the browser + a small handful of external callers you control, cutover is hard. External integrators re-issue their key once.

## Technical notes

- Cache key = raw api key string; cache value = `{ actor, allowed_systems, cachedAt }`. Evict at 60s.
- Every edge function declares its own `TARGET_SYSTEM` const (e.g. `"invoices"`, `"data-proxy"`) that gets passed to `authenticateApiKey` so the gateway checks the right allowlist entry.
- `data-proxy` and `xero` are internal-only — their `TARGET_SYSTEM` is `"internal"` and only the browser session key (which owns `internal`) can call them.
- Error taxonomy: `401 missing_api_key`, `401 invalid_api_key`, `403 system_not_allowed`.

## Files touched

- `supabase/functions/_shared/auth.ts` (rewrite)
- `supabase/functions/{invoices,data-proxy,get-users-proxy,xero,auth,clients-api-proxy,login-proxy}/index.ts` (swap authenticate + CORS)
- `src/lib/{api-client,neon-client,resolve-user-email,invoice-receipts}.ts` (header swap)
- `src/contexts/AuthContext.tsx` (storage key + no JWT mint expectation)
- `src/pages/{ApiDocsPage,GlobalConfigPage,AllStaffPage,CreateInvoicePage}.tsx` + `src/components/AmendInvoiceDialog.tsx` (any direct header reads)

## Open questions before I start

1. **Does the upstream auth-app already have a `verify-key` (or equivalent) endpoint that returns `{ actor, allowed_systems }` for a given `x-api-key`?** If not, this refactor can't land — the gateway needs to expose that endpoint first. I don't want to build a stub that trusts unvalidated keys.
2. **On successful 2FA today, does `login-proxy`'s upstream response include a per-session API key, or only the JWT-style token you showed earlier?** If only the JWT-style token, we treat that opaque string as the session key and rely on the gateway's `verify-key` to validate it — confirm that's how the gateway wants us to use it.
3. **Should the browser session and external CRM integrations use the same key type,** or does the gateway distinguish "user session key" vs "system integration key"? This affects whether `data-proxy` (browser-only) needs a different allowlist marker.  
  
**1. Verify-key endpoint — yes, it exists.** clients-api accepts x-api-key on every call and runs verifyApiKey before doing anything. It returns { systemId, systemName, permissions, allowedSystemIds } internally on every request. There isn't a dedicated verify-key-only action right now — validation is bundled into each action/entity call. If you want a pure { actor, allowed_systems } probe endpoint, say the word and I'll add an action: "verify-key" short-circuit to clients-api that returns exactly that shape without touching entities. Until that exists, don't stub — either add it here first, or have the upstream call any real action (e.g. describe) as its validation ping.
  **2. 2FA response — only the opaque session token.** auth (login → verify-2fa) returns token: "ses_..." plus the user profile. No separate per-session API key is minted. That ses_... string is validated exclusively via auth action: "verify" (opaque token → DB lookup in the sessions table). It is **not** an API key and will not pass verifyApiKey — do not send it as x-api-key.
  **3. Session keys vs system keys are distinct types — do not conflate.**
  - ses_... / fed_... → user/browser sessions. Sent as Authorization: Bearer, verified via auth verify. No allowed_systems concept; access is scoped by the user's system_access / agent_access on their profile.
  - prod_... / sb_... → system integration keys. Sent as x-api-key, verified via clients-api, carry allowedSystemIds (the per-key cross-system allowlist you set in the System Access dialog).
  So data-proxy (browser) should treat the Bearer session as a user identity and derive allowed systems from the returned user profile's system_access, not from an API-key allowlist. Machine-to-machine integrations use x-api-key and rely on allowedSystemIds.

Please answer 1–3 (or point me at the gateway's docs) and I'll implement.