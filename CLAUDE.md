# CLAUDE.md
<!-- Agent context file. Read at the start of every session. Keep this current. -->
<!-- Last reviewed: 2026-05-13 -->

## Project context

A multi-CDN demo environment that proves: (1) a single R2 origin serves multiple CDNs without replication, (2) CDN failover is operational not architectural, (3) protected content is JWT-gated and audited at the edge, and (4) origin egress fees are zero regardless of which CDN pulls. Built for a ~15-minute first meeting with a hospital IT director.

Five Workers deploy from a single `wrangler.toml`:
- **public-steering** (`cf-pool.demo...`) — passthrough / path_routing / percent_rollout modes
- **secure** (`secure.demo...`) — JWT issuance, validation, protected content, audit log
- **meter** (`meter.demo...`) — live egress-cost comparison UI
- **portal** (`portal.demo...`) — patient portal HTML (injects DOMAIN at runtime)
- **audit** (`audit.demo...`) — live audit log viewer HTML (injects DOMAIN at runtime)

---

## Stack

| Concern | Tool |
|---|---|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| Package manager | npm (bun referenced in scripts but not installed in this env) |
| Testing | vitest + `@cloudflare/vitest-pool-workers` |
| Linting / formatting | biome |
| Storage (blob) | R2 |

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
  index.ts                     # Default-config Worker stub (used by vitest)
  types.ts                     # All shared types; augments Cloudflare.Env
  lib/
    meter.ts                   # Shared egress-counter helpers (R2-backed)
  workers/
    public-steering/index.ts   # Bound to cf-pool.demo — multi-mode CF pool
    secure/index.ts            # Bound to secure.demo — JWT + audit log
    meter/index.ts             # Bound to meter.demo — egress meter UI
    portal/index.ts            # Bound to portal.demo — patient portal HTML
    audit/index.ts             # Bound to audit.demo — live audit viewer HTML
__tests__/                     # Mirrors src/ structure
wrangler.toml                  # Single config with [env.public|secure|meter|portal|audit]
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
- **Substituting a workaround for a path the user explicitly named** — if the user asks you to test/verify/debug `X` and `X` is broken, the default is to diagnose and fix `X`, not redirect to a working `Y`. Reach for `Y` only when the user chooses the workaround, when fixing `X` is genuinely out of scope, or when you've explicitly asked first.

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

Run tests before any commit that touches code. All checks must pass: `npm run typecheck && npm run lint && npm test`.

State docs (`STATE.md`, `HANDOFF.md`, `TODO.md`, `RESTART.md`) were removed in commit `640ab3a`. Do not recreate them unless explicitly asked.

---

## Local dev workflow

```bash
npm install          # install deps
npx wrangler dev     # local Worker dev server
npm test             # run vitest
npm run lint         # biome check
npm run typecheck    # tsc --noEmit
```

All four should pass before considering anything shippable.

## Deploy

```bash
npm run deploy:public   # public-steering Worker
npm run deploy:secure   # secure Worker
npm run deploy:meter    # meter Worker
npm run deploy:portal   # portal Worker
npm run deploy:audit    # audit Worker
npm run deploy:all      # all five in sequence
```

> `npm run deploy` (without `--env`) deploys the test-only stub. Always use the env-specific scripts above.

---

## Gotchas learned the hard way

- `wrangler dev` and `wrangler dev --local` behave differently for D1 — always use `--local` for local DB testing.
- McpAgent sessions are tied to Durable Objects — don't expect them to survive a DO migration.
- Workers AI responses are non-deterministic even at temperature 0 on some models — write tests that check structure, not exact content.
- R2 `put` is eventually consistent for list operations — don't rely on immediate list visibility after a write in tests.
- The KV namespace exists but is unused — audit and meter were migrated to R2 because KV write perms were not available on the demo account.
