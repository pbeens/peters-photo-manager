# Audit: Keyboard navigation for the thumbnail grid

**Date:** 2026-07-17  
**Scope:** Read-only. No application code changed.  
**File:** `apps/desktop/src/main.ts` (keydown handling, thumbnail cards, viewer open)

## Requested behaviour

1. **Arrow keys** move selection among thumbnails in the grid (not only scroll the panel).  
2. **Enter** on the selected thumbnail opens the full viewer (same outcome as double-click / open preview).

## What the app does today

### Keyboard handler is viewer-only

The only global key handling is:

```text
document keydown
  if viewer is open (viewerSourcePath set):
    Escape     → closeViewer()
    ArrowLeft  → previous image in viewer
    ArrowRight → next image in viewer
  else:
    (nothing — keys fall through to the browser)
```

There is **no** branch for:

- grid focus / selection movement  
- `ArrowUp` / `ArrowDown`  
- `Enter` / `Space` to open  
- preventing default scroll when arrows are used for navigation  

So when the viewer is **closed**, arrow keys do the **default browser action**: scroll the focused scrollable ancestor (usually `.file-panel` / the page). That matches the report: “moving the scroll window up and down.”

### Open is mouse-only (plus viewer chrome)

Thumbnails open via:

| Input | Opens viewer? |
| --- | --- |
| Double-click card | Yes (`openViewer`) |
| Second click with `detail >= 2` | Yes |
| Context menu “Open preview” | Yes |
| Enter / Space on selection | **No** |
| Arrow keys in grid | **No** |

Selection on single click goes through `selectAndLoadMetadata` and updates Details; that path never binds keys.

### Cards are buttons, but not a keyboard grid

Cards are rendered as:

```text
<button class="thumbnail-card" data-thumbnail-index="…" data-thumbnail-path="…">
```

They are focusable in principle, but:

- There is no roving `tabindex` strategy  
- No `keydown` on the grid or cards  
- No “move selection + scroll selected card into view” logic  
- No computation of columns-per-row for up/down movement  

Tab may eventually land on a card; arrows still won’t move selection across the collection in a deliberate way.

### Docs vs request

Current user manual documents **Left/Right arrows only while the viewer is open** (sequential browse in the overlay). It does **not** document grid keyboard navigation or Enter-to-open. The request is a product/UX gap relative to that manual, not a regression of implemented grid keys.

## Root cause

| Symptom | Cause |
| --- | --- |
| Arrows only scroll | No grid key handler; browser default scroll on `.file-panel` |
| Enter does nothing useful for open | No `Enter` handler calling `openViewer` for `selectedThumbnailPath` |
| Viewer arrows work | Keys are implemented only inside `if (viewerSourcePath)` |

This is **missing feature wiring**, not a CSS or scan bug.

## Desired interaction model

When the **viewer is closed** and the grid has thumbnails:

| Key | Behaviour |
| --- | --- |
| `ArrowLeft` / `ArrowRight` | Move selection to previous/next thumbnail in list order (wrap optional; usually stop at ends) |
| `ArrowUp` / `ArrowDown` | Move by one **row** (column count from grid layout) |
| `Enter` (and optionally `Space`) | `openViewer(selectedThumbnailPath)` if a selection exists |
| First arrow with no selection | Select first visible / first thumbnail, then move |

When the **viewer is open**, keep current behaviour (Escape close; Left/Right change image). Do **not** let grid navigation run on top of the viewer.

Also:

- `event.preventDefault()` on handled arrows so the file panel does not scroll instead  
- After moving selection, `scrollIntoView({ block: "nearest" })` on the selected card so the grid follows the selection  
- Update Details via existing `selectAndLoadMetadata` (or equivalent) so keyboard selection matches click selection  

## Implementation sketch (not applied)

1. **Shared helpers**

   - `selectedIndex()` → index of `selectedThumbnailPath` in `thumbnails`, or `-1`  
   - `columnCount()` → from `.thumbnail-grid` computed style / card width, or `Math.floor(gridWidth / columnWidth)`  
   - `moveGridSelection(deltaIndex)` → clamp index, `selectAndLoadMetadata(thumbnails[i].sourcePath)`, scroll card into view  

2. **Extend `document` keydown** (order matters):

   ```text
   if viewer open:
     existing Escape / Left / Right (preventDefault on arrows)
     return

   if focus is in an input/textarea/slider (e.g. thumbnail size):
     return  // don’t steal keys from form controls

   if no thumbnails:
     return

   ArrowLeft/Right/Up/Down:
     preventDefault()
     compute next index (up/down use ±columnCount)
     moveGridSelection(...)

   Enter (and optional Space):
     if selectedThumbnailPath:
       preventDefault()
       openViewer(selectedThumbnailPath)
   ```

3. **Focus policy (recommended)**

   - On thumbnail click, keep selection state as today; optionally focus the card or a grid container with `tabindex="0"`.  
   - Prefer a single **grid focus root** (`.file-panel` or `.thumbnail-grid` with `tabindex="0"`) plus roving `aria-selected` / `is-selected`, so arrows work after clicking the grid without Tabbing each card.  
   - Ensure `aria-activedescendant` or focus on the selected card for accessibility if implementing a full grid pattern.

4. **Column count for Up/Down**

   - Read live layout:  
     `const grid = document.querySelector(".thumbnail-grid")`  
     `const card = grid.querySelector(".thumbnail-card")`  
     `columns = max(1, floor(grid.clientWidth / card.offsetWidth))`  
   - Recalculate on each keypress (thumbnail size slider changes columns).

5. **Edge cases**

   - Empty grid: ignore  
   - Selection path not in current `thumbnails` (folder change): treat as no selection  
   - While context menu open: optional ignore or close menu first  
   - `Space` on a focused `<button>` may already “click” the button — if cards become focused buttons, Space might only re-select; explicit open on Space should `preventDefault` and call `openViewer` for consistency  

## Verification checklist

- [ ] Click a thumbnail, press Right/Left → selection moves; Details update; panel does not only scroll  
- [ ] Up/Down move by row for current thumbnail size (try small and large slider)  
- [ ] Enter opens viewer for current selection  
- [ ] With viewer open, Left/Right still change images; Escape closes  
- [ ] With viewer closed, arrows no longer free-scroll the grid when navigation handles them  
- [ ] Thumbnail size range / folder controls still accept keys when focused  
- [ ] Selected card stays visible (`scrollIntoView`) when moving off-screen  

## Out of scope

- Zoom/pan keys inside the viewer  
- Keyboard navigation of the folder tree (separate feature)  
- Code changes for this audit  
