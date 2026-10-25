/**
 * Component teardown for the recording UI, kept out of `recording-ui.ts` so the recorder
 * itself stays about recording.
 *
 * pi disposes an extension's widget component when the key is replaced or cleared
 * (`InteractiveMode.setExtensionWidget` → `removeExisting`) and disposes every widget on
 * `clearExtensionWidgets()`, which `resetExtensionUI()` calls on reload; a `custom()`
 * component is disposed when its dialog closes. The recorder reproduces that so a panel's
 * teardown code runs in tests, and it does so idempotently — `disposables.ts`-style fixtures
 * in tests count disposals, and a double disposal would be indistinguishable from a bug in the
 * extension under test.
 */
import type { RecordedCustomCall, RecordedWidget, WidgetFactory } from "./recorded-ui-types.ts";

/** Call a component's optional `dispose()` once, never letting a throwing one break teardown. */
export function disposeComponent(component: { dispose?: () => void } | undefined): void {
  try {
    component?.dispose?.();
  } catch {
    // A component whose teardown throws must not stop the harness from disposing the rest.
  }
}

/**
 * Dispose the component a recorded widget holds, flagging the entry so a later `dispose()`
 * of the same recorder does not dispose it twice. A string-array widget has no component —
 * pi wraps it in its own container — so there is nothing to dispose.
 *
 * `build` is the recorder's way of turning a stored factory back into the component it
 * returned: pi keeps the component it created, the recorder keeps the factory, and tests
 * register factories that hand back a stable fixture, so replaying it is cheap.
 */
export function disposeWidgetEntry(
  widget: RecordedWidget | undefined,
  build: (factory: WidgetFactory) => { dispose?: () => void } | undefined,
): void {
  if (!widget || widget.disposed || Array.isArray(widget.content)) return;
  widget.disposed = true;
  disposeComponent(build(widget.content));
}

/** Dispose each recorded `custom()` component once. */
export function disposeCustomCalls(calls: readonly RecordedCustomCall[]): void {
  for (const call of calls) {
    if (call.disposed) continue;
    call.disposed = true;
    disposeComponent(call.component);
  }
}
