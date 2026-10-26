/**
 * Waiting out the writes pi leaves in flight inside a harness temp directory, so that
 * `rmSync()` in `harness-build.ts` is the last word.
 *
 * `pi.registerProvider()` ends up in `ModelRuntime.registerNativeProvider()`, whose last
 * statement is `void this.refresh({ allowNetwork: false })` — fire-and-forget, with no handle
 * on the promise afterwards. That refresh reaches `FileAuthStorageBackend.withLockAsync()` for
 * both `auth.json` and `models-store.json` (both under `agentDir`, i.e. inside this harness's
 * temp dir), and that method calls `ensureParentDir()`/`ensureFileExists()` before it does
 * anything else — so a *read* of either file re-creates it. `AgentSession.dispose()` cancels
 * neither: it aborts the agent and invalidates the runner, and the refresh is neither.
 *
 * Removal therefore cannot simply follow `abort()`. A single `setTimeout(0)` does not cover an
 * I/O-backed refresh, and a harness disposed while another is being built leaves `auth.json`
 * and `models-store.json` behind in roughly one disposal in five (measured; sequential runs
 * never leak, which is why the suite passes). So poll the directory and require a *quiet
 * window* — no entry newer than the previous sample for `quietMs` — before returning. The quiet
 * condition is checked on the initial sample before the first sleep, so the common case (a
 * directory that has been idle since the caller got here) costs one macrotask turn and no
 * polls. The window starts at `SETTLE_QUIET_MS` and doubles each time activity is seen, up to
 * `SETTLE_QUIET_MAX_MS`: a turn aborted mid-stream keeps writing on `setTimeout` delays (faux
 * schedules a chunk every few milliseconds) and must not be mistaken for quiet on a single idle
 * poll. Then hand the macrotask back once more, so a write already scheduled at that point
 * lands before the caller removes the tree. The whole wait is bounded by `SETTLE_TIMEOUT_MS`:
 * teardown must never hang a test because a writer never settles.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** How long `settlePendingWrites()` waits in total before it gives up and lets removal run. */
const SETTLE_TIMEOUT_MS = 500;
/** Floor for the quiet window `settlePendingWrites()` requires before it stops waiting. */
const SETTLE_QUIET_MS = 10;
/** Ceiling for that window, so a writer that never stops cannot hold teardown hostage. */
const SETTLE_QUIET_MAX_MS = 100;
/** Poll interval for the same wait; one timer per round when the directory is already quiet. */
const SETTLE_POLL_MS = 10;

/** Wait until nothing is still writing inside `dir`, so that `rmSync()` is the last word. */
export async function settlePendingWrites(dir: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quietMs = SETTLE_QUIET_MS;
  let previous = newestEntryTime(dir);
  let quietSince = Date.now();
  // Already quiet on the first sample: done, minus the final macrotask below that lets a write
  // scheduled at this point land before the removal.
  if (Date.now() - quietSince >= quietMs) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return;
  }
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    const current = newestEntryTime(dir);
    if (current !== previous) {
      previous = current;
      quietSince = Date.now();
      quietMs = Math.min(quietMs * 2, SETTLE_QUIET_MAX_MS);
      continue;
    }
    if (Date.now() - quietSince >= quietMs) break;
  }
  // Falling out of the loop on the deadline rather than on `break` means a writer was still
  // active when the wait ran out: the caller's `rmSync()` runs anyway and that writer can
  // re-create the tree behind it. Deliberate — teardown must not hang a test — so the failure
  // mode is a leftover temp directory, which `harness-lifecycle.test.ts` asserts against for
  // the writer shapes the harness actually produces. No flag is reported here because no
  // caller could act on one: teardown removes the directory either way.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Newest mtime among the entries of `dir`, or 0 when it is gone or empty. One `readdirSync` and
 * one `statSync` per entry per round: the dirs hold a handful of files, and the caller polls at
 * `SETTLE_POLL_MS`, so this stays well below anything a test would notice.
 */
function newestEntryTime(dir: string): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let newest = 0;
  for (const name of names) {
    // An entry that cannot be stat'ed counts as just-written, so a file disappearing mid-sample
    // keeps the loop polling another round rather than ending the wait early.
    newest = Math.max(newest, entryTime(join(dir, name)));
  }
  return newest;
}

/**
 * mtime of `path`, or "now" when it cannot be read. Treating an unreadable entry as just
 * written keeps the quiet-window loop polling another round rather than ending the wait early,
 * which is what an entry deleted between the readdir and the stat would otherwise do.
 */
function entryTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Date.now();
  }
}
