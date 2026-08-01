---
id: qui-6uzz
status: closed
deps: []
links: []
created: 2026-07-31T23:25:58Z
type: feature
priority: 1
parent: qui-0ull
tags: [ui, review, lane]
---
# Comment button should float by the selection

Today the Comment action sits in the right rail, far from the text being commented on. Selecting a phrase and then travelling to the margin to act on it breaks the gesture — the control should come to the selection, the way it does in Google Docs, Medium and Notion.

Show a small floating toolbar anchored to the selected text as soon as there is a non-empty selection in the document, and dismiss it when the selection collapses.

## Design

Position from the selection's client rects, preferring above the selection and flipping below when there is no room, clamped to the page so it never escapes the viewport. It must not obscure the text it refers to, must not fight the overlaid ribbon, and must survive scrolling.

## Acceptance Criteria

Selecting text in the plan pops a floating Comment control beside it; using it opens the thread; collapsing the selection dismisses it; the rail no longer carries the primary comment action.


## Notes

**2026-08-01T00:02:28Z**

Done and merged. Verified on main: dragging a selection mid-document pops a 'Comment' control centred on the selection (both centred at x=353) sitting 10px above it, class quill-selection-toolbar.

Placement is pure math with a DOM-only measurement half. It prefers above with a 10px gap and flips below when the slot would fall inside the reserved chrome band — and the band is reserved in BOTH modes, so a toolbar placed in review mode cannot be swallowed when the ribbon slides in. Measured flip at scrollTop 680: above would have been top 79.5, inside the ribbon, so it went below.

On scroll it repositions rather than hides, one measurement per animation frame recomputed from live rects, so it cannot drift onto unrelated prose; it parks only once the text leaves the visible band.

One comment path preserved: the button drives the rail's existing draft flow, so the anchor model and sidecar persistence are unchanged. The rail's primary Comment button is gone and its empty state now describes the new gesture.

Keyboard: Shift+Arrow raises it, Alt+F10 focuses it (Tab stays inside the editor because Tiptap owns it), Escape dismisses and restores the selection. Verified mouse-free end to end.

Drive-by fix worth noting: the composer's autofocus was yanking the canvas from scrollTop 900 to 0. preventScroll fixed it, so the draft bubble now lands level with the text.
