# NestJS support — design

**Issue:** [#43](https://github.com/Shah-in-alam/LiveArch/issues/43) — out-of-the-box support for NestJS.
**Date:** 2026-07-12
**Status:** approved (design)

## Problem

NestJS is one of the most widely used TS/JS backend frameworks, but LiveArch
currently mis-reads Nest projects:

1. **File conventions are unrecognised.** Nest organises code by filename
   *suffix* inside feature folders (`users/users.controller.ts`,
   `users/users.service.ts`, `users/users.module.ts`) rather than by directory
   (`services/`, `routes/`). `classifyFile` keys off directories and a few
   filename patterns, so these files fall through to the generic "module"
   bucket instead of becoming controller/service/module nodes.
2. **Routes are undetected.** Nest routes are *decorator-based*
   (`@Controller('users')` + `@Get()`), but route detection (`ROUTE_RE`) only
   matches call patterns like `app.get('/x')`. So Nest endpoints never appear.

The NestJS stack node itself already exists — `dep-map.json` maps `@nestjs/core`
to a NestJS backend node — so no dependency-map change is needed.

## Scope

In scope (approved):

- Classify Nest files by suffix into the correct node types.
- Parse `@Controller` + HTTP-method decorators into route endpoints, feeding the
  existing `--routes` graph (parity with the Express/Fastify route detection).
- Include `*.module.ts` as `module` nodes.

Out of scope (deferred):

- `*.dto.ts` — numerous data-shape files; skipped to avoid diagram noise.
- `@Module({ imports, controllers, providers })` module-dependency edges.
- `@Controller({ path: '...' })` object form (only the string form is parsed for
  now); a cheap follow-up.

## Design

All changes live in `lib/analyser.js`. No new files.

### 1. File-convention classification (`classifyFile`)

Add a NestJS suffix check for code files (`.ts` / `.js`), placed **before** the
generic-module fallback and after the existing directory-based rules (so an
explicit `services/` directory still wins where present). The node **label** is
the base name with the Nest suffix stripped (`users.controller.ts` → `users`).

| Filename suffix | `type` | Layer | Icon |
|---|---|---|---|
| `*.controller.ts` | `route` | BACKEND | ⚡ |
| `*.resolver.ts`, `*.gateway.ts` | `route` | BACKEND | ⚡ |
| `*.service.ts`, `*.repository.ts` | `service` | BACKEND | ⚙ |
| `*.module.ts` | `module` | BACKEND | 📦 |
| `*.guard.ts`, `*.interceptor.ts`, `*.pipe.ts`, `*.filter.ts`, `*.middleware.ts` | `middleware` | BACKEND | 🔀 |
| `*.entity.ts` | `model` | DATA | 📐 |

Notes:
- `*.spec.ts` / `*.e2e-spec.ts` continue to be classified as `test` by the
  existing test rule (which runs earlier), so they are unaffected.
- `*.dto.ts` is intentionally **not** matched — it falls through to the generic
  module handling (or is excluded like today), keeping DTO noise out.
- The suffix match is on the full basename (e.g. `app.controller.ts`), so a file
  merely named `controller.ts` with no dot-suffix is not falsely matched.

### 2. Decorator route parsing (`parseNestRoutes`)

A new pure function `parseNestRoutes(absPath)` (mirroring `parseRoutes`):

1. Read the file (same size guard / error handling as `parseImports`).
2. Find the controller base path: `@Controller('base')` → `base`;
   `@Controller()` or no decorator → `''`.
3. Find method decorators on the controller:
   `@Get('sub')` / `@Post()` / `@Put()` / `@Patch()` / `@Delete()` /
   `@Options()` / `@Head()` / `@All()`, capturing the optional path arg.
4. Emit `{ method, route }` for each, where `route` is the base and sub joined as
   a URL path and normalised: `/` + `[base, sub].filter(Boolean).join('/')` with
   duplicate slashes collapsed. Examples:
   - `@Controller('users')` + `@Get()` → `GET /users`
   - `@Controller('users')` + `@Get(':id')` → `GET /users/:id`
   - `@Controller()` + `@Post('login')` → `POST /login`

Regexes (JSONC-tolerant of single/double/back-tick quotes), applied per file:
- Base: `@Controller\(\s*['"\`]([^'"\`]*)['"\`]\s*\)` (optional; default `''`).
- Methods: `@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*(?:['"\`]([^'"\`]+)['"\`])?\s*\)`.

A single file has one controller in the common case; if `@Controller` is absent
the base is `''` and any method decorators still resolve against `/`.

### 3. Wire-up (`buildRouteGraph`)

`buildRouteGraph` already builds endpoint nodes from `parseRoutes` (Express-style)
for every scanned file. Extend it to **also** run `parseNestRoutes` on
`*.controller.ts` / `*.controller.js` files, merging the resulting
`{ method, route }` pairs into the same endpoint-node/edge machinery. Endpoint
nodes remain opt-in behind `--routes` (`opts.endpoints`), unchanged.

The controller file's own node (from step 1, type `route`) is the `from` side of
the `defines` edges to its endpoint nodes — the same relationship Express route
files have today.

## Data flow

```
scanFiles → classifyFile                       (controller/service/module/... nodes)
buildRouteGraph → parseRoutes    (Express)  ┐
              → parseNestRoutes (Nest)      ┴→ endpoint nodes + "defines" edges  (--routes)
buildImportEdges                               (real import edges between the above)
```

Import edges (already working) connect controllers → services → repositories →
Prisma/TypeORM naturally, since Nest uses normal `import` statements.

## Error handling

- `parseNestRoutes` returns `[]` on any read error or oversized file (same guard
  as the other parsers). No throw.
- Files with no recognised decorators yield `[]` — a controller with only
  non-HTTP decorators simply contributes no endpoints.
- Suffix classification is purely string-based and cannot throw.

## Testing (TDD)

Unit (`test/analyser.test.js`):
- `classifyFile` returns the right `type` for each suffix
  (`*.controller/.service/.module/.guard/.entity/.repository/.resolver`), and the
  label has the suffix stripped.
- `*.dto.ts` is **not** classified as a Nest node (guards the skip decision).
- `parseNestRoutes`: base + method assembly, `@Controller()` no-arg,
  `@Get(':id')` dynamic segment, multiple methods in one controller, and a file
  with no decorators → `[]`.
- End-to-end `analyse` on a small Nest fixture (`app.controller.ts`,
  `users/users.controller.ts`, `users/users.service.ts`, `users/users.module.ts`,
  `users/user.entity.ts`) asserting node types; with `{ endpoints: true }`,
  asserting `GET /users` etc. appear as route nodes.

## Public API

- `parseNestRoutes` is exported from `lib/analyser.js` alongside `parseRoutes`
  (keeps the module's route parsers symmetric and unit-testable).

## Risks / mitigations

- **Over-matching filenames** — mitigated by matching explicit dotted suffixes on
  the basename, not substrings.
- **Ordering vs existing rules** — the Nest suffix block sits after directory
  rules and after the App Router block, before the generic fallback, so it only
  catches files that would otherwise be generic modules.
- **Decorator parsing brittleness** — regex-based, tolerant of quote styles and
  optional path args; anything it can't parse simply yields no endpoint (never an
  error).
