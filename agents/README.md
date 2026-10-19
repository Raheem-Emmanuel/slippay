# Slippay agents — four units, mechanically bounded

Money agents, not chatbots. Every one is a **pair**: enforcement code (the teeth,
holds even if the agent's model is fully compromised) + an `.ssl` policy (the
auditable statement). The `.ssl` files are **descriptive** — they document the
policy the code enforces, and are not executed. The `.mjs` implementation is the
single source of truth; if code and spec disagree, **the code wins**.

| agent | role | teeth | tests |
|---|---|---|---|
| **Billing** | proposes charge intents | `billing/bill.mjs` — eligibility (active, period-elapsed, not expired/maxed); consented amount+recipient only | 7 |
| **Authority** | the gate | `authority/authorize.mjs` — ed25519 signature + consent-digest (anti slow-drift) + replay | 5 |
| **Settlement** | reconciles payments | `settlement/settle.mjs` — memo + **consented-recipient** (closes redirection) + amount + replay | 8 |
| **AntiAbuse** | the panopticon | `antiabuse/antiabuse.mjs` — velocity + conservation + non-interference; **HALT = disarm to empty toolset** | 7 |

`node --test agents/**/**.test.mjs` → 46/46 (incl. the Axl primitives).

## The chain composes

```
Billing.proposeCharge ─intent→ Authority.authorizeIntent ─ok→ Settlement.verifySettlement ─ok→ mark paid
                                         ▲                                                      
                            AntiAbuse observes every edge; HALT disarms any agent
```

The emitted intent shape is shared end-to-end, so the four units snap together
without a shared mutable helper that could become a backdoor.

## Why this is mechanical, not advisory

For a money system an `.ssl` `@assertion` is **not** the security boundary — a
compromised agent will not honor its own assertions. The boundary is what the
agent cannot control:

1. **Axl `bind`** — each agent's `tools=[...]` array contains only its bound
   capabilities. Billing/Authority/Settlement/AntiAbuse all lack `transfer_funds`;
   the model cannot emit a tool that isn't in the request. (`agents/axl/`)
2. **`prove` as code** — Authority/Settlement/Billing decisions are deterministic
   checks (signatures, consent digests, periods), never an LLM judge.
3. **On-chain ceiling** — the audited Soroban wallet (cap + allowlist) bounds any
   authorized spend, and its budget invariant is **machine-checked** (`outflow ≤
   2·window_cap` over all action sequences — `agents/axl/proofs/`).
4. **HALT** — AntiAbuse recompiles a flagged agent to the empty toolset: zero
   action space, not a request to stop.

A fully IPI-compromised agent still cannot move money: it lacks the tool, its
proposal fails the deterministic gate, the on-chain cap bounds it, and AntiAbuse
can disarm it.

## Honest gaps

- The agents are tested in isolation; wiring the chain into the live charge path
  (`supabase/functions/api`) + the listener is the integration step, not done.
- AntiAbuse's per-event label check is money-path-local; the full non-interference
  checker over a declared flow graph is `agents/ifc/` (Python, 16/16) — production
  AntiAbuse delegates whole-graph checks to it (cross-language boundary).
- The `.ssl` files have no Slippay-side runtime yet; they are the auditable specs,
  the `.mjs` is what executes.

## Two policy mechanisms — `.ssl` vs AXL

The repo carries two distinct policy-expression mechanisms. They are not
interchangeable, and only one of them is machine-checked.

**`.ssl` documents (descriptive).** `agents/{antiabuse,authority,billing,concierge,
perena,pulse,settlement}/*.ssl` are human-readable statements of the limits each
agent enforces. There is no `.ssl` parser or runtime, so these files are **not**
executed and are **not** a security boundary. They are kept honest by a test that
asserts the documented limits match the constants in the corresponding `.mjs`
(see `agents/policy.test.mjs`); when the code changes, the test fails until the
document is updated. Treat them as auditable documentation, not as proofs.

**AXL (normative, machine-checked).** `agents/axl/` (grammar + proofs) and the
`axl-compiler` crate compile `.axl` sources through a parser, SMT layer, certifier
and invariant prover, gated by `axl-compiler/scripts/axl-gate.sh`. AXL policies
are *discharged* — the gate proves the invariant rather than trusting an
assertion. The on-chain budget invariant (`outflow ≤ 2·window_cap`) is checked
this way in `agents/axl/proofs/`.

**When to use which.** Use AXL when a property must be *proven* (budget ceilings,
invariants over action sequences) — route new machine-checkable policies through
`axl-compiler` and the gate. Use `.ssl` only to *describe* what the deterministic
`.mjs` checks already enforce, for auditors and reviewers. Never treat an `.ssl`
`@assertion` as the boundary; the boundary is the bound toolset, the deterministic
gate, the on-chain cap, and HALT.
