/**
 * The fixture behind `test/harness-context-isolation.test.ts`: a test-owned root under the OS
 * temp dir holding an `AGENTS.md` that pi would otherwise walk up into, plus the environment
 * restore that test owes the rest of the suite.
 *
 * A test reaches it only through the `.test.ts` file, which keeps `node:fs`/`node:os`/
 * `node:path` out of `test/harness.ts` and the files that import it. The root is created with
 * `mkdtemp`, so concurrent tests never share a planted file.
 *
 * The environment is restored, not deleted: bun runs every test file in one process, so a
 * `TMPDIR` left pointing at the planted root would send every later harness's temp dir there
 * too. That is why `restore()` puts back the previous value of each variable it touched — and
 * why the test that uses this helper must call it in a `finally`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Text that used to decide the A2 spike test on its own: the substring `error` in lowercase
 * arrives in a request through the injected file and nowhere else. A marker word alone would
 * not reproduce the bug — the old assertion failed on pi's own shape, not on a sentinel.
 */
export const CONTEXT_MARKER = "ISOLATION-MARKER";

/**
 * Lowercase `error` appears the way a real home-directory AGENTS.md writes it — in a
 * quality-gate checklist — because that is the text the substring assertion mistook for a
 * failed run.
 */
export const CONTEXT_MARKER_FILE = `# ${CONTEXT_MARKER}\n\nQuality gates:\n\n- [ ] Tests passing (0 failures)\n- [ ] Linting passing (0 errors)\n`;

/** An active ambient context file and the environment needed to make pi read it. */
export interface AmbientContext {
  /** The directory the planted `AGENTS.md` sits above; pass it as `TMPDIR`. */
  root: string;
  /** Restore the process environment and remove the planted root. */
  restore(): void;
}

/**
 * Plant `AGENTS.md` (and `CLAUDE.md`, so a change to pi's candidate list cannot make the test
 * vacuous) in a fresh temp root and point `TMPDIR` at it, so a harness built afterwards lands
 * underneath it and pi's ancestor walk from `cwd` reaches the planted files.
 *
 * `TMPDIR` is what makes the planting visible — `mkdtempSync` honours it — and the previous
 * value is captured so the caller can put it back in a `finally`. It has to be restored: bun
 * runs every test file in one process, so a `TMPDIR` left pointing at the planted root would
 * send every later harness's temp dir there too, and the planted `AGENTS.md` with it.
 *
 * `XDG_CONFIG_HOME` is redirected to a marked directory of its own so the isolation control is
 * not at the mercy of whatever the machine running the suite keeps in its user config tree.
 * `HOME` is deliberately *not* touched: pi's default agent directory comes from `os.homedir()`
 * (`config.js`, `getAgentDir`), bun resolves that from the home libuv cached at process start,
 * and the harness passes `cwd` and `agentDir` to the loader explicitly anyway — so the agentDir
 * half of the isolation is what `noContextFiles` and the explicit paths already guarantee, and
 * a mid-process `HOME` write would only make the control's premise unclear. The `agentDir` side
 * is exercised directly by `test/harness-context-isolation.test.ts`, which builds a loader with
 * context files enabled and asks pi which files it would have injected.
 */
export function plantAmbientContext(): AmbientContext {
  const previous = {
    TMPDIR: process.env.TMPDIR,
    XDG: process.env.XDG_CONFIG_HOME,
  };
  const root = mkdtempSync(join(tmpdir(), "pi-sticky-ambient-"));
  writeFileSync(join(root, "AGENTS.md"), CONTEXT_MARKER_FILE);
  writeFileSync(join(root, "CLAUDE.md"), CONTEXT_MARKER_FILE);
  // `root` is deliberately both `TMPDIR` and the planted ancestor: the harness dir is created
  // under it, so the ancestor walk from `cwd` reaches the files below.
  const xdg = join(root, "xdg");
  mkdirSync(xdg, { recursive: true });
  writeFileSync(join(xdg, "AGENTS.md"), CONTEXT_MARKER_FILE);
  process.env.TMPDIR = root;
  process.env.XDG_CONFIG_HOME = xdg;
  return {
    root,
    restore: () => {
      restore(process.env, "TMPDIR", previous.TMPDIR);
      restore(process.env, "XDG_CONFIG_HOME", previous.XDG);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Put one variable back: a value that was absent is deleted, not set to the empty string. */
function restore(env: NodeJS.ProcessEnv, name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(env, name);
  else env[name] = value;
}
