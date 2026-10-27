# Contributing to pi-sticky

Small extension, small surface. Read [AGENTS.md](AGENTS.md) before you start — it is the
authoritative rulebook for this repo, and this file only lists the commands.

## Dev setup

```bash
git clone https://github.com/randomm/pi-sticky.git
cd pi-sticky
bun install --frozen-lockfile
```

Bun is the only package manager here; `bun.lock` is committed and CI installs with
`--frozen-lockfile`. Dependencies must come from the npm registry — no `github:` or `git+` URLs —
and `bunfig.toml` refuses any package published in the last 4 days.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | Biome (lint + format) over `src` and `test`, then `tsc --noEmit`. |
| `bun run typecheck` | `tsc --noEmit` only. |
| `bun test` | The whole suite with the coverage gate from `bunfig.toml` (≥80% lines and functions). |

Both `bun run check` and `bun test` must pass before you push — they are exactly what CI and the
`.pi/verify-cmd` gate run. Fix lint and format complaints by running Biome, not by hand, and never
add `// biome-ignore`, `@ts-ignore` or a coverage-threshold lowering to get to green.

## Rules that bite

- **300-line cap per `.ts` file** in `src/` and `test/`, enforced by `test/file-size.test.ts`.
  Near the limit, split along a real seam rather than compressing comments.
- **Tests stay offline and never touch `~/.pi`.** `test/harness.ts` sets `PI_OFFLINE=1` and answers
  every request with the faux provider from `@earendil-works/pi-ai`; use a fresh temp directory for
  `agentDir` and `cwd`. Never spawn pi against the user's agent directory.
- **Host packages stay `peerDependencies` with `"*"`** and exact-pinned `devDependencies`; runtime
  `dependencies` stays empty. pi maps them to its own copies at load time.
- Pin text is untrusted model output — everything drawn or re-emitted goes through `src/sanitize.ts`.

See [AGENTS.md](AGENTS.md) for the rest (pi conventions, the isolation rules, common pitfalls).

## Commits and PRs

[Conventional Commits](https://www.conventionalcommits.org/) with an alphabetic scope —
`feat(tool):`, `fix(render):`, `chore(deps):` — and never an issue number in the scope. Link the
issue with `Closes #N` in the PR body. PRs are squash-merged once every gate passes.

One concern per PR. No LICENSE, SECURITY.md or docs/ changes bundled with code.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the license this project uses.
