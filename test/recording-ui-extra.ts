/**
 * What the protected recorder cannot answer on its own: how often a widget key was *written*.
 *
 * `test/recording-ui.ts` is the shared harness and stays byte-identical to `main`, so a question one file
 * needs that the recorder does not answer is answered *beside* it rather than inside it. `widgets` says what
 * is installed; it cannot say how many times the extension asked — and for a rail that is the whole
 * observable half of `RailGuard`'s decision. pi keeps the component a key holds until the key is written
 * again, and `RailComponent` caches its rows by width, so the only thing that re-ages a rail already on
 * screen is an install: a tick whose minute did not move must write the key zero further times, one whose
 * minute moved must write it once.
 *
 * A wrapper, not a subclass: `uiForPi` copies *own* properties and walks the prototype chain for names, and
 * an inherited constructor would be a function this file declares, owns the coverage of, and never runs.
 * Wrapping forwards through the instance `piContext` puts on the context, so the count is taken by the very
 * call that installs the widget — which is what makes a guard's refusal observable rather than merely
 * unrecorded.
 */
import { RecordingUi } from "./recording-ui.ts";

/** What `countingRecorder` hands back: the recorder to assert on, and the tally beside it. */
export interface CountingRecorder {
  /** The recorder itself — pass this to `piContext` as the `ui`, and read its arrays as usual. */
  recorder: RecordingUi;
  /** Writes per widget key, the clear included. Read it with `written()` below. */
  installs: Map<string, number>;
  /** Writes to `key` so far: zero is the answer a guard that refused to reinstall has to give. */
  written(key: string): number;
}

/**
 * A recorder that also counts the writes each widget key receives.
 *
 * A clear (`content === undefined`) counts, because the question is whether the extension *asked*: pi
 * disposes the component the key held for that write too, and a rail cleared to nothing is a different
 * answer from a rail left standing.
 */
export function countingRecorder(): CountingRecorder {
  const recorder = new RecordingUi();
  const installs = new Map<string, number>();
  const install = recorder.setWidget.bind(recorder);
  recorder.setWidget = (key, content, options) => {
    installs.set(key, (installs.get(key) ?? 0) + 1);
    install(key, content, options);
  };
  return { recorder, installs, written: (key: string) => installs.get(key) ?? 0 };
}
