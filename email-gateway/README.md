# Admission Sky Email Gateway — Phase 2B

Server-only, provider-agnostic transactional email infrastructure.

## Runtime status

- Version: `phase2b-2`
- Cloudflare internal boundary: `/internal/email/*`
- Browser/Pages exposure: blocked
- Selected pool: Resend, Brevo, Mailjet, Mailtrap, MailerSend, SendPulse, EmailOctopus, Courier
- Default provider state: all disabled
- Phase 2B implementation approval: received on 2026-09-09
- Activated/configured/remote-verified production providers: none
- Auth/Supabase binding: none (separate start gate preserved)
- Login/Signup UI: none

EmailOctopus remains in the selected catalog but is deliberately ineligible for OTP delivery: its official API does not expose a direct one-to-one transactional send operation. It must never be treated as a successful fallback.

The runtime cannot send merely because a credential happens to exist. A transactional provider needs all of:

1. explicit non-secret provider policy with `enabled: true`;
2. global server activation gate;
3. that provider's sender-verification evidence flag and a valid sender address;
4. required isolated Cloudflare Worker Secret binding(s);
5. bounded daily or monthly quota policy;
6. a successful bounded, non-mutating remote health/sender probe;
7. strong Durable Object persistence;
8. a signed internal caller.

## Common provider interface

Every selected adapter exposes:

```js
await adapter.sendEmail(message, context);
await adapter.checkHealth(context);
await adapter.getStatus();
adapter.getCapabilities();
```

Every logical delivery requires a stable `requestId` and `idempotencyKey`; every actual provider mutation receives a deterministic `deliveryAttemptId`. The Durable Object uses the idempotency key as the atomic acquisition boundary. Timeout or unknown acceptance never causes blind fallback.

## Stable server contract

```js
const gateway = await createEmailGateway(...);
await gateway.send(request);
await gateway.healthCheck();
await gateway.getCapabilities();
await gateway.recordDeliveryEvent(event);
```

A future trusted backend uses `createEmailGatewayServiceClient(...)` to sign internal Worker requests. Future Supabase/Auth code may consume only `createEmailGatewayPort(gateway)` after its separately approved phase. Auth authority never selects a provider, and providers cannot mutate identity or session state.

## Protected rules

See `EMAIL_GATEWAY_PROTECTION_CONTRACT.md`. Provider setup and operations are documented under `docs/email-gateway/`.
