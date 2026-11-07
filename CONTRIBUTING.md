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

## Dependencies and toolchain

Every version in this repo is pinned on purpose, and a pin is a reviewed decision rather than a
default: the host packages sit in `peerDependencies` as `"*"` and in `package.json`
`devDependencies` at exact versions, and CI installs the toolchain at the version its own step
names. The three `@earendil-works/pi` packages are one unit — pi maps them to its own copies at
load time, so a change to one is a change to all three in the same commit, never a partial bump.

Moving a pin, or the CI toolchain version, is a deliberate commit that a reviewer reads: it is not
something an automated dependency bot does here. There is no dependabot or automerge config, and
there does not need to be one for new releases: `bunfig.toml` `minimumReleaseAge` refuses any
registry package younger than its own window, so a freshly released version cannot enter the lockfile
until it has sat there for a while. The numbers themselves live in `bunfig.toml` and in
`package.json` `devDependencies` — read them there rather than copying them into prose, so this page
cannot go stale when a pin moves.

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

## Release process

`release-please` turns the conventional commits on `main` into one **release PR** — it bumps
`package.json`, writes `CHANGELOG.md` and prepares the `vX.Y.Z` tag. Merging that PR **is** the release:
it tags, opens the GitHub Release and publishes to npm with a provenance attestation. **Merging it is
irreversible** — an npm version, once published, cannot be replaced or unpublished in place, so a release
PR is reviewed like a deploy, not like a merge.

- **Never hand-edit `CHANGELOG.md` and never create a tag by hand.** Both are generated; a hand-written
  entry is overwritten by the next release PR and a hand-made tag desynchronises the release-please
  manifest. Nothing is published or tagged outside a merged release PR, and the first release is `0.1.0` — the
  `initial-version` in `release-please-config.json`, so merging the release PR is the release and the first
  version npm serves is that one. Two one-time
  operator steps make the automation work: add the `RELEASE_PLEASE_TOKEN` secret, and configure the npm
  trusted publisher for repo `randomm/pi-sticky`, workflow filename `release-please.yml`, environment name
  **empty**.
- **Close a stale release PR** rather than letting it sit across later merges. A PR that has drifted from
  main carries a version bump nobody reviewed, and the next run recomputes it anyway.
- **Breaking changes:** mark the type with `!` and add a `BREAKING CHANGE:` footer
  (`feat(panel)!: drop the rail below 80 columns`). While the project is below 1.0.0 — which
  `bump-minor-pre-major: true` in `release-please-config.json` keeps it at — that is what makes
  release-please bump the **minor**, not the major: a breaking change takes `0.1.0` to `0.2.0`, so it never
  publishes `1.0.0` by accident.
- **No issue numbers in scopes** — `fix(#12): x` is rejected by `pr-title-check.yml`, because squash-merge
  makes the title the commit subject and a scope that renders as a markdown link is not a parseable
  conventional-commit header. Link the issue with `Closes #N` in the PR body instead.
- **The publish job must not declare an `environment:` key.** npm's trusted publisher is matched on the
  tuple (owner `randomm`, repo `pi-sticky`, workflow `release-please.yml`, **environment name empty**), and
  the two halves have to agree: a job that declares an environment can only match a publisher configured
  with that same name. Adding `environment:` to `.github/workflows/release-please.yml` — or renaming that
  file — breaks every automatic release while leaving all the checks green. The workflow file's own header
  states the same pair; `test/release-automation.test.ts` fails if either half drifts.

## Code of Conduct

Participation in this project is governed by the [Contributor Code of Conduct](CODE_OF_CONDUCT.md),
adapted from Contributor Covenant. Report a conduct problem through the private channel that file
names.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the license this project uses.
