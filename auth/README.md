# Admission Sky Auth Foundation — Phase 2A

This directory is a protected, isolated authentication domain. It is foundation code only.

## Current status

- Public contract: `auth/index.mjs`
- Concrete Auth authority: **unbound**
- Supabase binding: **deferred to Phase 3 by owner decision**
- Login/Signup UI: **not mounted**
- Live Auth API: **not exposed**
- Real email providers: **not activated; Phase 2B requires separate approval**

## Dependency rule

Application features may consume only `auth/index.mjs`. They must not import `auth/core/**`, `auth/services/**`, or mutate the Auth state store. Auth modules must not import feature modules.

## Security rule

No password, OTP, access token, refresh token, provider credential, secret, or raw session credential may be stored in localStorage/sessionStorage, embedded in public config, logged, or exposed through the public snapshot. Persistence belongs to a future concrete authority/session adapter using a secure server-managed strategy.

## Stable public contract

- `initialize()`
- `getCurrentUser()`
- `getSession()`
- `getState()`
- `isAuthenticated()`
- `subscribe()`
- `signIn()`
- `signOut()`
- `signUp()`
- `verify()`
- `recover()`

See `AUTH_PROTECTION_CONTRACT.md` and `docs/AUTH-PHASE-2-EXECUTION-PLAN.md`.
