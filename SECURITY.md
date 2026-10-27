# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

pi-sticky is a pre-1.0 extension maintained by a single maintainer. Only the latest release receives security attention.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Security Advisories:

<https://github.com/randomm/pi-sticky/security/advisories/new>

Do not open a public issue or PR for a vulnerability — that publishes it. Do not include credentials or secrets in the report; describe the flaw and, if useful, link a minimal repro.

## Scope

The threat model is a hostile model talking to a human's terminal.

**In scope (please report here):**

- **Untrusted pin text reaching the screen or the model.** Every pin string — from the `pin_for_user` tool, from a `/pins`-driven edit, or reconstructed from a session file — passes through `src/sanitize.ts` before it reaches state, the drawn panel/rail, or the model again. Anything that draws, stores or re-emits pin text that has not been sanitized is a vulnerability: terminal escape sequences (including unterminated OSC/DCS and 8-bit CSI), control and bidi characters, or an over-wide line should not survive. See the jsdoc header of `src/sanitize.ts` for what the sanitizer promises.
- **Session-file tampering.** A pin snapshot read back out of a session file is untrusted; `src/session-entries.ts` returns nothing unless `isPinState` (`src/state-guards.ts`) vouches for the whole shape, and hands back a copy with its drawn strings sanitized. A crafted session entry that bypasses that guard is a vulnerability.
- **A pin causing code to run.** By design a pin never executes anything: pi-sticky registers no
  command or shortcut that acts on pin content, and only the user acts on a pin (the panel's Enter
  only prefills `Re #<id>: ` in the editor). Any path where pin text triggers behaviour without the
  user is a vulnerability. Note that `src/` does read user input and call pi APIs — the claim is
  that it never runs what a pin says, not that it does nothing.

**Out of scope (open a regular issue):**

- Vulnerabilities in upstream dependencies (pi, bun, the model provider) — report them upstream.
- A model pinning misleading or annoying content. The agent choosing bad pins is a product problem, not a security flaw.
- Anything that requires the attacker to already control the user's `~/.pi` directory, pi configuration, or account session.

## What src/ does not do

`src/` reads nothing beyond memory: no `node:fs` import, no socket or HTTP client (`node:net`,
`node:http`, `fetch`), no `child_process`, and no way to run a command — `src/` imports only the pi
host packages, which pi resolves to its own copies. It does not download or install packages or
fetch remote content. The one value it reads from the operating environment is `process.env`, in
`src/index.ts`, for the extension's own configuration (see the jsdoc header there).

This describes `src/` and runtime dependencies, which are empty; the devDependency tree used for
tests is a different matter.
