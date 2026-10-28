/**
 * The panel's row table imports cold — no cycle, no TDZ.
 *
 * `panel-rows.ts` imported `panel-frame-geometry.ts` for the layout arithmetic, and the geometry imported
 * `GUTTER_COLUMNS` back out of `panel-rows.ts` to compute `FRAME_COLUMNS`. Two modules, one edge each way,
 * and both constants read at module scope: whichever module the runtime evaluated second had its
 * `const GUTTER_COLUMNS = 4` still uninitialised when the other's `FRAME_COLUMNS = GUTTER_COLUMNS + …` ran,
 * and the import threw `Cannot access 'GUTTER_COLUMNS' before initialization`. It stayed invisible for as
 * long as every entry point reached the pair through some third module that touched the geometry first —
 * `bun test` loads the whole suite in one process, so the ordering that hid it was the suite's own.
 *
 * The cycle is broken by `panel-tail.ts`: the gutter count and the tail's stamp live in a module that
 * imports neither side, and the edge now runs tail → rows → geometry, one way. This file is the guard
 * against re-tangling it, and it is written as a *cold* import for that reason: `await import()` alone
 * would hit bun's module registry and return a graph some earlier file in the same process already
 * evaluated, which is exactly the condition that hid the bug. A fresh `bun` subprocess per module names the
 * condition instead of inheriting it.
 */
import { expect, test } from "bun:test";

/** The modules whose import order used to matter, each reachable on its own as the first thing loaded. */
const COLD_MODULES = [
  "src/panel-rows.ts",
  "src/panel-frame-layout.ts",
  "src/panel-frame-geometry.ts",
  "src/panel-lines.ts",
  "src/panel-tail.ts",
  // The frame path evaluates it: `panel-frame-layout.ts` builds each heading through it, and it reaches
  // `panel-rows.ts` for the level glyph — so it is on the graph whose import order used to matter.
  "src/panel-section-headings.ts",
];

/**
 * Evaluate one module as the *only* thing a fresh runtime loads, and report what came back: the exit code,
 * the stdout the module itself wrote, and any stderr. A cycle that throws on this path is a cycle the suite
 * may still be hiding.
 */
async function cold(modulePath: string): Promise<{ code: number; out: string; err: string }> {
  const target = new URL(`../${modulePath}`, import.meta.url).pathname;
  const child = Bun.spawnSync([process.execPath, "-e", COLD_PROBE(modulePath, target)]);
  return {
    code: child.exitCode ?? -1,
    out: child.stdout.toString(),
    err: child.stderr.toString(),
  };
}

/**
 * The probe the child runs: import the module and print one token per module-scope binding the cycle used
 * to leave uninitialised. The token is chosen from what that module *exports*, so the probe fails if the
 * value is missing rather than merely throwing — a module that evaluates but hands back `undefined` is the
 * same defect wearing a different hat.
 */
function COLD_PROBE(modulePath: string, target: string): string {
  if (modulePath.endsWith("panel-rows.ts")) {
    // The row table's own bindings: the gutter count both the layout and the builder subtract, and the one
    // function that turns a pin into rows. The frame's table moved out to `panel-frame-layout.ts` and is
    // probed there — this module is the row, not the frame.
    return `import("${target}").then((m)=>{if(m.GUTTER_COLUMNS!==4||typeof m.panelPinRows!=="function")throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
  }
  if (modulePath.endsWith("panel-frame-layout.ts")) {
    // The frame's table: the one place a frame's rows are built and its height counted, cold so a section
    // module pulled into that graph cannot leave a constant read before its own module finished.
    return `import("${target}").then((m)=>{if(typeof m.panelLayoutSections!=="function")throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
  }
  if (modulePath.endsWith("panel-frame-geometry.ts")) {
    return `import("${target}").then((m)=>{if(!(m.FRAME_COLUMNS>0)||!(m.META_COLUMNS>0))throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
  }
  if (modulePath.endsWith("panel-tail.ts")) {
    return `import("${target}").then((m)=>{if(m.GUTTER_COLUMNS!==4||typeof m.metaStamp!=="function")throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
  }
  if (modulePath.endsWith("panel-section-headings.ts")) {
    // The headings of the frame path: both of its exported builders must survive a cold load, since
    // `panel-frame-layout.ts` builds a heading row and its cell on every frame it lays out.
    return `import("${target}").then((m)=>{if(typeof m.headingRow!=="function"||typeof m.headingCell!=="function")throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
  }
  // The builder: the module that reads both halves of the arithmetic, so it is the one whose import order
  // a future edit is most likely to change.
  return `import("${target}").then((m)=>{if(typeof m.buildPanelLines!=="function")throw new Error("bindings missing");console.log("OK")},(e)=>{console.error(String(e&&e.message||e));process.exit(1)})`;
}

for (const modulePath of COLD_MODULES) {
  test(`${modulePath} evaluates as the first module in a fresh runtime`, async () => {
    const { code, out, err } = await cold(modulePath);
    // The message is the interesting half: `Cannot access 'X' before initialization` is the cycle, and
    // anything else is at least as worth reading in the failure as in the log.
    expect(err.trim(), `${modulePath} stderr`).toBe("");
    expect(out.trim(), `${modulePath} reported its bindings`).toBe("OK");
    expect(code, `${modulePath} exited cleanly`).toBe(0);
  });
}

test("the cold probe is not vacuously green", () => {
  // A probe that prints `OK` for a module that does not exist would pass every case above, so it is run
  // against a path that is definitely not in `src/` — and against nothing at all, which is the shape a
  // refactor of `COLD_PROBE` would leave behind.
  const missing = cold("src/no-such-module.ts");
  return missing.then(({ code, out, err }) => {
    expect(out.trim(), "a missing module does not report OK").not.toBe("OK");
    expect(code, "a missing module exits non-zero").not.toBe(0);
    expect(err.length, "a missing module says why").toBeGreaterThan(0);
  });
});
