# AGENTS.md

This file is auto-loaded by pi when any agent works inside this repo. It sets the rules, conventions and project-specific constraints for all development work. Read once; apply throughout.

> ℹ️ **Two agents.** pi-sticky is a pi extension that lets *the main agent* of a pi session pin messages for *the user*. When this file says "the agent", it means you, the one reading this and changing the code. When it says "the pinning agent" or "the model", it means the product surface: the model that calls `pin_for_user` at runtime.

## Specs: which document wins

- `docs/research-summary.md` is the spec: the research findings and the operator's design decisions that the code implements. `docs/plan.md` is the **historical** working spec written before that research — where the two disagree, or where either disagrees with the code, **`docs/research-summary.md` and the code win**. The plan is kept for history only: do not tick or rewrite its task checkboxes, and do not renumber its sections — `src/` and `test/` cite plan sections 6.2, 6.9 and 8, and `docs/spike-results.md` cites section 8.
- Every issue names the tasks or sections it implements. Do not build anything the issue and these two files do not ask for.

## Pre-push quality gates (blocking)

CI is for VERIFICATION, not DISCOVERY. Run `bun run check` (Biome, then `tsc --noEmit`) and `bun test` (every test, with the 80% coverage gate from `bunfig.toml`) before every push. `.pi/verify-cmd` runs the same pair for the `/work` driver, and CI runs it again. Do NOT:

- ❌ Use `--no-verify`, `--no-gpg-sign`, or skip hooks
- ❌ Add `// biome-ignore` or `// @ts-ignore` to bypass a check: fix the code
- ❌ Push and hope CI catches it
- ❌ Run only the test that covers your change: the suite is fast and offline
- ❌ Lower `coverageThreshold` or exclude files from coverage to get green

`.pi/` and `.github/` are operator-owned: a `/work` cycle cannot change them. If a gate or the CI workflow needs to change, say so in the PR and the operator changes it.

## pi extension conventions

- TypeScript loaded by pi's jiti loader: no build step, no `dist/`. The entry point is `src/index.ts`, declared in `package.json` under `pi.extensions`.
- Host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`) are `peerDependencies` with `"*"` and exact-pinned `devDependencies`. Never list them in `dependencies`: pi maps them to its own copies at load time. Runtime `dependencies` stay empty.
- Import types from `@earendil-works/pi-coding-agent` with `import type`. Value imports from `@earendil-works/pi-tui` (`visibleWidth`, `truncateToWidth`, components) are fine.
- Guard every UI call by mode. `ctx.mode` is `"tui" | "rpc" | "json" | "print"`; `ctx.hasUI` is true in TUI and RPC. RPC ignores component widgets and has no overlays, focus or key input (string-array widgets only). Print and JSON have no UI at all; the tool must still work there.
- `ctx.ui.notify` is a transcript line that scrolls away, and the footer status can be restyled by other extensions. Neither is a persistent surface.
- pi clears extension widgets and overlays on `/new`, `/reload` and resume. Rebuild state from the session and redraw on every `session_start` and `session_tree`. Never use a `ctx` or `pi` captured before a reload or session switch: it throws.
- Branch-following state lives in the `pin_for_user` tool result `details` and in custom entries (`pi.appendEntry`). Never edit `systemPrompt` in `before_agent_start`: other extensions (pi-rukas) replace it and the last writer wins. Return a `message` instead.
- Tool rules: `executionMode: "sequential"`; flat, primitive parameters. Throwing from `execute()` drops `details`.

## pi compatibility

The exact `devDependencies` pins (pi packages `1.3.0`, `typebox` `1.3.27`) make `bun install --frozen-lockfile` reproducible. They are not a support claim: the extension runs inside whatever pi the user has installed. Last verified against pi **1.3.0** (2026-10-25). When bumping the pins, move all three pi packages together, re-read the pi changelog for changes to the extension API, widgets, overlays, keybindings and session events, and run the manual acceptance check listed in `docs/plan.md` Task 11 again (that checklist is the
original one — run it against the surfaces the README documents today: panel, rail and reply).

## Isolation from pi-rukas subagents

- When `PI_ENSEMBLE_ROLE` is set, the process is a pi-rukas subagent: the extension registers nothing. pi-rukas sets this variable for every child; `PI_ENSEMBLE_SUBAGENT_MODE` is set only for some, so do not rely on it. `PI_STICKY_DISABLE=1` also registers nothing.
- Install with `pi install` only. Never symlink or copy this repo into `~/.pi/agent/extensions/`: pi-rukas forwards everything there into its subagents.

## Tests never touch the real pi setup

- No test loads `~/.pi`, the user's settings, extensions or credentials. Use a fresh temp directory as both `agentDir` and `cwd` for `DefaultResourceLoader`, and `SettingsManager.inMemory()` or `SettingsManager.create(cwd, agentDir)` (positional arguments).
- Set `PI_OFFLINE=1`. No test calls a real model: use the faux provider from `@earendil-works/pi-ai`.
- Call `session.bindExtensions` with a `uiContext`, or `session.reload()` never re-fires `session_start`. Use a file-backed session for anything that asserts on compaction entries.
- Never spawn `pi` against the user's agent directory.

## Untrusted text

Pin text comes from a model and is untrusted. All of it passes through the sanitizer before it reaches state, the screen or the model. The sanitizer removes every escape sequence (including unterminated ones), every C0 and C1 control and DEL, bidi controls and stray zero-width or format characters (ZWJ and VS16 inside emoji stay), maps U+2028 and U+2029 to newlines, drops lone surrogates, caps combining marks per grapheme, and truncates by grapheme. Never emit an OSC 8 hyperlink from pin text. Measure and cut every drawn line with `visibleWidth` and `truncateToWidth` from `@earendil-works/pi-tui`. A pin never runs anything: only the user acts on it.

## Supply chain

- `bunfig.toml` refuses any package version published in the last 4 days (`minimumReleaseAge`). Need a fresher release? Add it to `minimumReleaseAgeExcludes` with a reason in the PR; keep the list empty otherwise.
- `bun.lock` is committed; CI uses `bun install --frozen-lockfile`. Only npm-registry packages: no `github:` or `git+` URLs.

## Code conventions

- Biome is the single source of truth for lint and format (`bun run check`). Avoid `any`: use `unknown` and narrow; if you must cast, comment why.
- **Hard limit: 300 lines per TypeScript file** in `src/` and `test/`, enforced by `test/file-size.test.ts`. Refactor trigger: near the limit, or three or more distinct responsibilities in one file. One responsibility per file.
- The authoritative description of a module is the jsdoc header of its source file. Do not add file-by-file tables to this file or to docs.
- Commit messages: conventional commits with an alphabetic scope (`feat(tool):`, `fix(render):`) or a bare type. Never put an issue number in the scope; link issues with `Closes #N` in the PR body. First line ≤ 72 characters; explain why in the body.

## Common pitfalls

- 🚨 **AGENTS.md re-read habit.** pi auto-loads this file. Do not tell agents to re-read it, and do not write "as documented in AGENTS.md": state the requirement.
- 🚨 **Branching off stale main.** Detect the mainline, verify a clean tree, `git pull --ff-only`, then branch.
- 🚨 **Width.** `string.length` is not display width. Emoji and CJK are two columns; measure with `visibleWidth`.

## Quality Gates

Run these before pushing. All must pass locally:

- **bun test** — `bun run test`
- **bun check** — `bun run check`
- **bun typecheck** — `bun run typecheck`

## Commands

| kind | command |
| --- | --- |
| test | `bun run test` |
| lint | `bun run check` |
| typecheck | `bun run typecheck` |

## Environment

- Manifest: `package.json`
- Package manager: `bun`
- Language: `typescript`
- CI workflows: `.github/workflows/ci.yml`

## Operator choices

- **Review-blocking severity:** Review findings are blocking at HIGH severity and above; MEDIUM and LOW findings may be deferred to follow-up issues.
- **Merge authority:** If all project quality gates have been met (code reviews, CI, linters, type checks etc) LLMs / agents are allowed to squash merge PRs.
- **Project intent & stack:** A small pi extension: the main agent pins messages for the user (pin_for_user tool); pins stay visible in a toggleable right-hand panel until resolved, and the user can reply to a specific pin from the main editor.


# Minimalist Engineering

Every line of code is a liability. Before creating anything:

- **Is this explicitly required** by the GitHub issue?
- **Can existing code/tools** solve this instead?
- **What's the SIMPLEST** way to meet the requirement?
- **Am I building for hypothetical** future needs?

If you cannot justify necessity, DO NOT CREATE IT.

# Git Workflow

## Conventional commits

```
<type>(<scope>): <description>
```

Types: `feat` | `fix` | `refactor` | `docs` | `test` | `chore`

## Branch naming

```
feature/issue-{N}-brief-description
```

## Branch protection

- ❌ NO direct commits to `main`
- ❌ NO force pushes to `main`
- ✅ All work on feature branches → PR
- ✅ PRs squash-merged, only after every quality gate, review and CI check has passed

This repo lives on GitHub, so `gh` and "PR" are used throughout.

# Documentation Policy

## The 200-PR test

Before adding documentation: *"Will this be true in 200 PRs?"*

- **YES** (enduring principle) → Document the principle (WHY)
- **NO** (implementation detail) → Skip, or use code comments (WHAT/HOW)

## Forbidden documentation

- ❌ Issue drafts, implementation summaries, fix notes, scratch files
- ❌ `TODO` comments — create GitHub issues instead

# Issue-Driven Development

## Before starting

1. GitHub issue exists for the work
2. Issue clearly describes the requirement
3. Your approach matches issue scope exactly
4. No scope expansion without updating the issue

## Linking

Link PRs to issues via `Closes #N` in the PR body. Use the issue number
in the branch name, never in the commit scope.

# Code Review Doctrine

## Quality gates (blocking)

All checks must pass locally before push:

- [ ] Tests passing (0 failures)
- [ ] Coverage meets threshold
- [ ] Linting passing (0 errors)
- [ ] Type checking passing (0 errors)

## Zero technical debt

- ❌ No `# noqa`, `@ts-ignore`, `# type: ignore`
- ❌ No `// biome-ignore` without explicit justification
- ❌ No suppressions in the diff

# Context7 Protocol

Before writing ANY code that uses the pi API, read the installed pi
sources, not memory: `node_modules/@earendil-works/pi-coding-agent/`
(its `docs/`, `examples/` and
`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`)
and `node_modules/@earendil-works/pi-tui/`. Training data is out of
date, and pi's API moves between minor versions. Use Context7 for other
libraries. Skip both for the project's own code and standard-library
features.

# Testing Standards

- TDD preferred: write the failing test first, then the minimal
  implementation that passes it; refactor with the tests green.
- Coverage threshold: **≥80% line and function coverage, enforced by bunfig.toml ([test] coverageThreshold = 0.8); `bun test` fails below it** for new code.
- Coverage for lower-risk areas (documentation, config, formatting)
  may be lower; the threshold is the floor for logic, not a target for
  boilerplate.
- A bug fix ships with its regression test — a fix without a test that
  failed first is an incomplete fix.
