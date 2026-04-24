# Session log — add Opus 4.7, Sonnet 4.6, Haiku 4.5 to model selection

- **Date:** 2026-04-24
- **Branch:** `fix/add-latest-models` (off `main`, kept separate from
  `fix/reconnect-race-and-announcement-flood` and
  `fix/whitelist-lid-pn-handling`)
- **Scope:** extend `src/claude/utils.ts` so the three newest Claude
  models are recognised by `/model` / `--model` / `config set model`,
  and the bare family names (`opus`, `sonnet`, `haiku`) resolve to them
  as defaults.

## Goal

Users on WhatsApp should be able to pick the latest Claude models with
a short name, exactly as they already do for the older families:

- `opus` → `claude-opus-4-7`
- `sonnet` → `claude-sonnet-4-6`
- `haiku` → `claude-haiku-4-5-20251001`

Versioned shorthands (`opus-4.7`, `opus4-7`, `opus47`, etc.) must work
too, matching the existing style so muscle memory keeps working.

## Implementation plan

1. **Branch hygiene.** Create `fix/add-latest-models` off `main` before
   touching any file, so this change stays rebaseable independently of
   the two outstanding whitelist / reconnect fixes.
2. **Model table (`src/claude/utils.ts`).**
    - Add four-variant shorthand blocks for Opus 4.7, Sonnet 4.6 and
      Haiku 4.5 at the top of `MODEL_SHORTHANDS`, keeping the existing
      `-x.y` / `x.y` / `-x-y` / `xy` pattern.
    - Re-point the bare-name entries (`opus`, `sonnet`, `haiku`) at the
      new full IDs so they become the defaults.
    - Prepend the three new IDs to `AVAILABLE_MODELS` so `/models`
      surfaces them first.
    - Add the three new IDs to `MODEL_PREFERRED_SHORTHANDS` so status
      messages render `opus-4-7` instead of the raw ID.
3. **Unit tests (`src/claude/utils.spec.ts`).**
    - Update the "simple shorthands" block to expect the new defaults.
    - Add three new `describe` blocks (Opus 4.7, Sonnet 4.6, Haiku 4.5)
      mirroring the existing per-family variant tests.
    - Refresh case-insensitivity, whitespace and full-ID tests so they
      exercise the new IDs rather than retired ones.
    - Bump `AVAILABLE_MODELS.length` from 8 → 11 and add `toContain`
      assertions for the three new IDs.
    - Add `getModelShorthand` cases for each new ID.
4. **Docs (`documentation/commands.md`).** Update the shorthand table
   under "Agent & Model" so it lists the three new rows and the
   refreshed bare-name mappings. No other doc references the exact
   model IDs, so the blast radius is local.
5. **Verification.** Run `bun run tsc`, `bun test`, `bun run format`
   and `bun run lint` — all four must pass on the branch tip before
   committing.
6. **Commit.** Single commit in the Conventional Commits style required
   by `CONTRIBUTING.md`.

## What was changed

| File                        | Change                                         |
| --------------------------- | ---------------------------------------------- |
| `src/claude/utils.ts`       | +3 families, new defaults, updated tables      |
| `src/claude/utils.spec.ts`  | New describe blocks, refreshed expectations    |
| `documentation/commands.md` | Refreshed shorthand list under "Agent & Model" |

Deliberately **not** changed:

- `src/cli/commands.ts` CLI default (`claude-sonnet-4-20250514`) and
  `ConfigSchema.model` default in `src/types.ts`. The user asked for
  the bare _names_ to resolve to the new IDs, not for the installed
  default to move. Touching those would silently migrate existing
  installs on next run; that is a separate product decision.
- `CHANGELOG.md` — release tooling regenerates it.
- `bun.lock` — the uncommitted change present at session start was
  stashed; unrelated to model selection.

## Verification performed

- `bun run tsc` → no errors.
- `bun test src/claude/utils.spec.ts` → 68 pass, 0 fail.
- `bun test` (full suite) → 170 pass, 0 fail.
- `bun run format` → no diffs.
- `bun run lint` → clean (`--max-warnings 0`).

## Lessons learned

- **Ordering in `AVAILABLE_MODELS` is user-facing.** The list is what
  `/models` prints, so prepending the newest three keeps the most
  relevant choices at the top of the WhatsApp reply. If the list is
  ever rendered sorted, revisit this.
- **`MODEL_PREFERRED_SHORTHANDS` is a separate table from
  `MODEL_SHORTHANDS`.** Adding a new model requires touching both or
  status messages will keep printing the raw ID even though
  `/model opus` works. Easy to miss — the spec's
  `all available models have a shorthand` check is what catches it.
- **Haiku ID shape is inconsistent with Opus/Sonnet.** Opus 4.7 and
  Sonnet 4.6 use the undated `claude-<family>-4-<n>` form, while Haiku
  4.5 still carries a date suffix (`-20251001`). The shorthand layer
  hides that asymmetry; downstream code must keep treating these as
  opaque strings.
- **Defaults vs shorthands are not the same thing.** The user's ask
  ("standaard worden gekozen op de bijbehorende naam zonder
  versienummer") is about what bare names resolve to, not about the
  installed default. Moving the installed default is a larger change
  with migration implications and was left out of scope.
- **Branch discipline matters here.** Two other `fix/` branches are
  live on this repo; keeping this change on its own branch off `main`
  lets the maintainer land them in any order without rebase pain.

## Commit entry (Conventional Commits, per CONTRIBUTING.md)

```
feat(claude): add Opus 4.7, Sonnet 4.6 and Haiku 4.5 to model selection

Extend src/claude/utils.ts with the three latest Claude models:
- claude-opus-4-7       (opus, opus-4.7, opus4.7, opus-4-7, opus47)
- claude-sonnet-4-6     (sonnet, sonnet-4.6, sonnet4.6, sonnet-4-6, sonnet46)
- claude-haiku-4-5-20251001 (haiku, haiku-4.5, haiku4.5, haiku-4-5, haiku45)

The bare family names opus/sonnet/haiku now resolve to these new IDs
so "/model opus" picks Opus 4.7 by default, matching the project's
existing convention that simple shorthands track the most recent
version of each family. Versioned shorthands for older releases are
unchanged, so existing configs that pin e.g. "opus-4-5" or
"sonnet-4" keep working.

Updates MODEL_SHORTHANDS, AVAILABLE_MODELS and
MODEL_PREFERRED_SHORTHANDS in lockstep; documentation/commands.md is
refreshed to match. Full test suite and type check pass.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
