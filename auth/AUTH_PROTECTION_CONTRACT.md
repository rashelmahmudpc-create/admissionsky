# 🔒 Admission Sky Auth Protection Contract

**Protected path:** `/auth/**`  
**Foundation version:** `phase2a-1`

> Roadmap note (2026-09-09): the owner exercised rule 12 and approved the separate Cloudflare-native production adapter in `/auth-native/**`. This contract continues to protect the provider-neutral `/auth/**` foundation and does not authorize restoration of the retired legacy implementation.

## Mandatory rules

1. Auth Core is an isolated domain, never a feature child.
2. Features consume only `auth/index.mjs`; direct imports from internal core/services are forbidden.
3. Auth state has one authoritative store and can change only through validated state-machine transitions.
4. Profile, Leaderboard, Reward, AI, Progress, content, voice, or any other feature failure must never mutate Auth state or force logout.
5. Passwords, OTPs, raw credentials, access/refresh tokens, private keys and provider secrets must never enter public state, `localStorage`/`sessionStorage`, cookies, URLs, analytics, or logs.
6. Remember Me must use a future secure server-managed session strategy—not manual browser token persistence.
7. No concrete provider endpoint or credential may be hard-coded in the foundation.
8. Unconfigured providers stay safely unbound/disabled.
9. Every operation has bounded timeout/retry behavior; infinite retry, duplicate mutation, stale completion and unbounded loading are forbidden.
10. Phase 2A may not expose live account endpoints, create users, or mount Login/Profile UI.
11. Phase 2B Email Gateway and real providers require explicit owner approval.
12. Supabase or another authority binding belongs to Phase 3 unless the owner changes the approved roadmap.

## Change protocol

Any `/auth/**` modification requires:

```text
Detect change
  → impact analysis
  → foundation regression
  → failure/chaos tests
  → security boundary scan
  → existing app regression
  → owner-visible report
```

No critical Auth test may be bypassed for deployment. Phase advancement always requires explicit owner approval.
