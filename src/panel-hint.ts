/**
 * What the panel's bottom border says while the user is *not* in it: the focus key, spelled as the
 * operator configured it.
 *
 * The focused panel already names its keys in that border (`HINT`, `panel-lines.ts`). An unfocused one
 * said nothing at all, so the affordance that gets a user into the panel — press the focus key, then
 * `Enter` to answer the pin under the bar — was invisible exactly when the user needed it.
 *
 * The label is built here rather than in the drawer so the drawer keeps taking no config: the component
 * reads `config.focusKey` and hands the finished string down as a `PanelContent` field, and
 * `buildPanelLines` draws it through the same `borderLine`/`fitLabel` path as the header and the hint —
 * which is the escape policy (strip, then cut with `…`), so nothing added on the component side.
 *
 * Three values reach this function and only one of them is a key. `null` is the operator's `off`, and
 * `undefined` is a config that never named one: neither has a key to advertise, so both answer with the
 * empty string and the border is left as nothing but rule. A placeholder word ("no focus key") would
 * advertise an action the user cannot take, which is the same lie the focused hint refuses to tell.
 */
import type { StickyConfig } from "./types.ts";

/** What follows the key id in the border: the label is the key itself, and what pressing it gets. */
const TO_REPLY = " to reply";

/** The border's bottom label while the panel is unfocused; "" when there is no focus key to name. */
export function replyHint(config: StickyConfig): string {
  return config.focusKey ? `${config.focusKey}${TO_REPLY}` : "";
}
