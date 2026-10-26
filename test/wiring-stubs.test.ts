/**
 * `stubApi`'s own contract, asserted directly rather than through the extension it is handed to.
 *
 * Every other caller reaches the recorder through `createStickyExtension`/`piSticky`, which only
 * ever calls the three members the extension registers against — so `on`'s unsubscribe, and an
 * `emit` over an event nothing subscribed to, were reached by no test at all and are the file's
 * only uncovered functions. Both are load-bearing for the recorders' promise: a handler list that
 * came back `undefined` would read as a pass, and `emit` has to answer `[]` for an event the
 * extension never registered (that is what "the reminder did not fire" looks like).
 */
import { expect, test } from "bun:test";

import { stubApi } from "./wiring-stubs.ts";

test("stubApi records what the extension registers and answers for what it does not", () => {
  const stub = stubApi();
  const api = stub.api as unknown as {
    registerTool(tool: Record<string, unknown>): void;
    registerCommand(name: string, options: unknown): void;
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown): () => void;
  };

  api.registerTool({ name: "pin_for_user" });
  api.registerCommand("pins", { handler: async () => {} });

  const unsubscribe = api.on("session_start", () => "fired");
  // pi's `on` hands back an unsubscribe; the suite never unregisters, so this proves the member
  // really answers rather than being a property that happens to exist.
  expect(typeof unsubscribe).toBe("function");
  expect(() => unsubscribe()).not.toThrow();

  expect(stub.tools.map((tool) => tool.name)).toEqual(["pin_for_user"]);
  expect([...stub.commands.keys()]).toEqual(["pins"]);
  expect(stub.emit("session_start", {}, {})).toEqual(["fired"]);
  // An event nothing subscribed to is an empty answer, not an error and not undefined.
  expect(stub.emit("session_compact", {}, {})).toEqual([]);

  // appendEntry is the recorder's other half: the branch-following state a test reads back is
  // exactly what the extension appended, in the order it appended it.
  stub.api.appendEntry("pi-sticky.user", { v: 1 });
  expect(stub.entries).toEqual([{ customType: "pi-sticky.user", data: { v: 1 } }]);
});
