# CLAUDE.md
<!-- Agent context file. Read at the start of every session. Keep this current. -->
<!-- Last reviewed: 2026-04-30 -->

## First session bootstrap

If the Project context section below still says "TODO", this project was just created from the template and has not been configured yet. Before doing anything else:

1. Ask the user: "What does this project do?" — use the answer to replace the Project context section
2. Ask the user: "Which bindings will you need?" — trim the Stack table to only those
3. Uncomment the matching bindings in `wrangler.toml` and update `src/types.ts` `Env` to match
4. Remove the First steps section from `README.md`
5. Tell the user: "Template configured. Ready to build."

Do not proceed with any other work until these steps are done.

---

## Project context

A multi-CDN demo environment that proves: (1) a single R2 origin serves multiple CDNs without replication, (2) CDN failover is operational not architectural, (3) protected content is JWT-gated and audited at the edge, and (4) origin egress fees are zero regardless of which CDN pulls. Built for a ~15-minute first meeting with a hospital IT director.

---

## Stack

| Concern | Tool |
|---|---|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| Package manager | bun |
| Testing | vitest |
| Linting / formatting | biome |
| Storage (blob) | R2 |
| Storage (ephemeral KV) | Workers KV |

<!-- TODO: Remove bindings not used in this project -->

---

## TypeScript conventions

- `strict: true` in tsconfig. No exceptions.
- No `any`. Use `unknown` and narrow it, or define a proper type.
- No type assertions (`as Foo`) unless you add a comment explaining why it's safe.
- Shared types go in `src/types.ts`. Not inline, not scattered.
- Prefer `type` over `interface` unless declaration merging is needed.
- Prefer explicit return types on exported functions.

---

## Code style

- No classes. Functions and closures only. Durable Objects are the one exception — they require a class by the Workers runtime contract.
- One concern per file. Don't put multiple unrelated handlers or utilities in the same file.
- Explicit error returns over `try/catch` where practical. Prefer `Result<T, E>` pattern for functions that can fail in expected ways.
- No magic strings. Named constants or enums for anything used more than once.
- No commented-out code. Delete it. Git has history.

---

## Comments

- Comment on **why**, never on **what**.
- If a block of code needs a what-comment to be understood, simplify the code instead.
- JSDoc on all exported functions: description, `@param`, `@returns`. Nothing else.
- Inline comments only for non-obvious decisions, tradeoffs, or Cloudflare-specific gotchas.

---

## File structure

```
src/
  index.ts                     # Default-config Worker (template stub, used by vitest)
  types.ts                     # All shared types; augments Cloudflare.Env
  workers/
    public-steering/index.ts   # Bound to cf-pool.demo — multi-mode CF pool
    secure/index.ts            # Bound to secure.demo — JWT + audit log
    meter/index.ts             # Bound to meter.demo — egress meter UI
  pages/
    portal/index.html          # Pages: patient portal
    audit/index.html           # Pages: live audit view
__tests__/                     # Mirrors src/ structure
wrangler.toml                  # Default dev/test config (vitest reads this)
wrangler.public.toml           # Deploy config for public-steering
wrangler.secure.toml           # Deploy config for secure
wrangler.meter.toml            # Deploy config for meter
biome.json
tsconfig.json
vitest.config.mts
```

Do not create files outside this structure without asking first.

---

## Testing

- Every exported function gets at least one test. No exceptions.
- Tests live in `__tests__/` and mirror the `src/` directory structure.
- Test file naming: `foo.test.ts` mirrors `src/foo.ts`.
- Test behavior, not implementation. If a refactor breaks tests without changing behavior, the tests are wrong.
- No empty tests. No `expect(true).toBe(true)`. No tests that only check a value is defined.
- Cover: happy path, expected failure cases, and edge cases (empty input, nulls, boundary values).
- For Workers: use `@cloudflare/vitest-pool-workers` for tests that need the Workers runtime.
- Mock external services (D1, R2, KV, fetch) — don't hit real resources in tests.

---

## Cloudflare-specific rules

- **Never use Node.js built-ins** (`fs`, `path`, `crypto`, `stream`, etc.). Use Web API equivalents or Workers-native APIs.
- **Workers AI tool calling**: assume JSON-mode is required unless you have confirmed native tool call support on the specific model. Default workaround: prompt the model to return `{"action": "...", ...}` and parse.
- **D1**: always use prepared statements. Never concatenate user input into SQL strings.
- **KV**: not for data that needs consistency. For ephemeral caching and config only.
- **Durable Objects**: one DO per logical entity, not per user session. Think carefully about migration behavior before changing DO class names or storage schemas.
- **Secrets**: use `wrangler secret put` for anything sensitive. Never put secrets in `wrangler.toml` or `.dev.vars` files committed to the repo.
- **`wrangler.toml`**: do not modify without asking. It controls bindings, routes, and compatibility dates — mistakes here break the whole deployment.

---

## Handling uncertainty

**Ask before proceeding on:**
- Architecture decisions (new files, new bindings, new services, data model changes)
- Anything that modifies `wrangler.toml`
- Adding new dependencies
- Deleting or renaming existing files
- Any approach where two reasonable implementations exist and the tradeoff isn't obvious

**Make a reasonable call and note your assumption on:**
- Implementation details within an established pattern
- Naming of internal variables and functions
- Order of operations within a function
- Test case selection

When you make an assumption, note it briefly at the end of your response: `Assumed: X. Let me know if you'd prefer Y.`

---

## What not to do

- Do not add logging unless asked. One `console.log` left in production code silently burns CPU.
- Do not install new dependencies without asking. Check if something in the existing stack already covers the need.
- Do not generate boilerplate "just in case." Build exactly what was asked.
- Do not write placeholder implementations with TODO comments and call it done.
- Do not explain what you just did in a long post-response summary. Show the diff, state any assumptions, stop.

---

## Commit hygiene

Project-state docs (anything tracking resource inventory, status, handoff context, or open work — typically named `STATE.md`, `HANDOFF.md`, `TODO.md`, `RESTART.md`, or similar) MUST be updated as part of preparing any commit that materially changes the project. Treat them as part of the diff, not as an afterthought.

Specifically:
- A commit that changes infrastructure (resources created, deleted, or reconfigured) updates `STATE.md` in the same commit.
- A commit that changes "what's working / what's broken / what's next" updates `HANDOFF.md` and `TODO.md` in the same commit.
- A commit that changes how a future agent should restart on this project updates `RESTART.md` in the same commit.
- Run tests before any commit that touches code (per global agent rules); update test counts in state docs if they shifted.

If no state docs exist yet but the project has accumulated context worth tracking, propose them before the next commit instead of letting context decay.

---

## Local dev workflow

```bash
bun install          # install deps
wrangler dev         # local Worker dev server
bun test             # run vitest
bun run lint         # biome check
bun run typecheck    # tsc --noEmit
```

All four should pass before considering anything shippable.

---

## Gotchas learned the hard way

- `wrangler dev` and `wrangler dev --local` behave differently for D1 — always use `--local` for local DB testing.
- McpAgent sessions are tied to Durable Objects — don't expect them to survive a DO migration.
- Workers AI responses are non-deterministic even at temperature 0 on some models — write tests that check structure, not exact content.
- R2 `put` is eventually consistent for list operations — don't rely on immediate list visibility after a write in tests.

<!-- Add to this file as you learn new things. It feeds the agent context on every session. -->
