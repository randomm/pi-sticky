/**
 * The keys the focused panel answers, as one string, in a leaf module.
 *
 * The words belong to the bottom border, but the module that draws the border cannot own them:
 * `panel-option-hint.ts` composes the focused label out of `HINT`, and `panel-lines.ts` imports
 * `focusedHint` back out of it to fill that border — so while the string lived in the builder the pair
 * named each other, and the edge ran both ways. It stayed invisible for the same reason the tick/age pair
 * did: `HINT` is read inside a function rather than at module scope, so the ordering that would have thrown
 * never arrived on its own. It is the text half of the same seam the header of `panel-tail.ts` describes for
 * the gutter columns: one module that reaches no other panel module holds what both sides quote.
 *
 * `panel-lines.ts` re-exports it, so the frame tests keep naming the module that always exported it.
 */

/** The keys the panel answers, written into the bottom border while the panel holds focus. */
export const HINT = "↑↓/jk move · Enter reply · d dismiss · Esc back";
