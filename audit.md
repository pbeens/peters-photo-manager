# Audit: Side panel footers still broken (regression after “panel-footer” fix)

**Date:** 2026-07-17  
**Scope:** Read-only. No application code changed.  
**Files:** `apps/desktop/src/main.ts`, `apps/desktop/src/styles.css`  
**Evidence:** Latest screenshot — left “Submit Feedback” is at the bottom of the folder column; right “Buy me a coffee” sits mid-panel under the empty Details copy, with a large empty dark region below it.

## Goal (unchanged)

“Submit Feedback” (left) and “Buy me a coffee” (right) must share the **same bottom baseline** in the two side columns (divider + link aligned across the window).

## What the latest fix tried

The previous audit recommended a shared three-row flex pattern. The current code partially adopted that:

- Shared class `.panel-footer`
- Shared class `.panel-body` with `flex: 1 1 auto`
- Left footer is a direct sibling under `.sidebar`
- Right footer is a sibling under `.details-panel` via `renderDetailsSupportFooter()`
- `updateSelectionUI()` only rewrites `#details-body` (good — footer not destroyed on selection)

That was the right *direction*, but the **right column structure and flex sizing are still wrong**, so the coffee link is now **worse** than a slight misalignment: it no longer pins to the bottom at all.

## Current markup (rescanned)

### Left (works: footer at bottom)

```text
aside.sidebar                    flex column, height: 100%
  .sidebar-heading               auto height
  .folder-list.panel-body        flex: 1 1 auto  ← grows, fills middle
  .panel-footer                  auto            ← “Submit Feedback”
```

### Right (broken: footer packs under content)

```text
aside.details-panel              flex column, height: 100%
  .details-body.panel-body       flex: 1 1 auto, display:flex, overflow:hidden
    .sidebar-heading             “DETAILS” lives INSIDE the body
    .details-empty
      | .details-content
  .panel-footer                  “Buy me a coffee”
```

So the columns are **still not the same tree**:

| | Left | Right |
| --- | --- | --- |
| Header | Outside body | **Inside** `#details-body` |
| Growing region | `.folder-list` only | Whole details UI wrapped in one body |
| Footer | Sibling of body | Sibling of body (OK in theory) |

## Current CSS (rescanned)

```css
.sidebar,
.details-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 28px 18px 20px;
}

.panel-body {
  flex: 1 1 auto;   /* auto basis — unreliable for “eat free space” */
  min-height: 0;
}

.details-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;  /* no flex:1 of its own beyond .panel-body */
}

.details-empty {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  align-items: center;
  justify-content: center;
}

.panel-footer {
  flex: 0 0 auto;
  width: 100%;
  margin-top: 14px;   /* not margin-top: auto */
  padding-top: 12px;
  border-top: 1px solid #50524c;
  text-align: center;
}
```

## Why the screenshot looks “really messed up”

### Observed layout

```text
DETAILS
Select a photograph to view details.
──────── (footer border)
Buy me a coffee
                    ← large empty dark area
                    ← bottom of window
```

Left column still has Feedback on the bottom chrome. Right column’s coffee is **content-adjacent**, not window-bottom-adjacent.

### Cause: the growing middle on the right is not actually filling the column

For the footer sibling to sit on the bottom edge, **`.panel-body` must consume all free height** in `.details-panel`.

In the screenshot it does **not**. The body is only as tall as heading + empty message. The footer therefore sits immediately under that short stack. The remaining column height is empty space *below* the footer — classic “flex child did not grow” failure.

Contributing factors:

1. **`flex: 1 1 auto` on `.panel-body`**  
   Flex basis `auto` sizes from content first. In nested/grid + WebView layouts this often fails to absorb free space the way `flex: 1 1 0` / `flex: 1` does. Left *looks* fine because the folder tree is tall; the right empty state is short, so the failure is obvious.

2. **Header nested inside the body on the right only**  
   Left: `heading | body | footer`.  
   Right: `body(heading + empty) | footer`.  
   Even after growth is fixed, empty-state vertical centering and spacing will not match left unless the trees match.

3. **Nested flex without a hard height contract**  
   `.details-empty { flex: 1 }` only expands if `.details-body` already has a definite used height. If the body stays content-sized, empty never fills, text stays near the top, footer stays under it.

4. **No `margin-top: auto` belt-and-suspenders on `.panel-footer`**  
   Not required if body growth works, but with the current failure there is nothing pulling the footer to the bottom either.

5. **Partial adoption of the prior audit**  
   Shared class names were added, but the right panel was not made a true clone of the left three-row layout, and flex basis was left as `auto`.

## What “fixed” must look like

Mirror the **left column exactly**:

```text
aside.details-panel
  .sidebar-heading / .panel-header     ← OUTSIDE the scroll/grow region
  #details-body.panel-body             ← ONLY empty state or metadata list
  .panel-footer                        ← coffee link only
```

And force the middle to take free space with a **zero flex basis**:

```css
.sidebar,
.details-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 28px 18px 20px;
  box-sizing: border-box;
}

.panel-body {
  flex: 1 1 0;          /* critical: 0 basis, not auto */
  min-height: 0;
  overflow: auto;
}

.panel-footer {
  flex: 0 0 auto;
  margin-top: 0;        /* spacing via padding only; same both sides */
  padding-top: 12px;
  border-top: 1px solid #50524c;
  text-align: center;
  width: 100%;
}
```

### Markup / JS changes required

1. **`render()` details column** — same order as folders:

   ```html
   <aside class="details-panel" id="details-panel">
     <div class="sidebar-heading panel-header">
       <p class="eyebrow">Details</p>
     </div>
     <div class="panel-body" id="details-body">
       <!-- empty OR details-content only -->
     </div>
     <div class="panel-footer">…Buy me a coffee…</div>
   </aside>
   ```

2. **`renderDetailsContent()`** — stop emitting the Details heading. Heading is stable chrome; body is only:

   - empty: `<div class="details-empty"><p>…</p></div>`
   - selected: `<div class="details-content">…</div>`

3. **`updateSelectionUI()`** — keep updating only `#details-body` (already correct). Do not replace `#details-panel`.

4. **Do not** put the coffee footer inside `#details-body`.

5. Optional hardening: `margin-top: auto` on `.panel-footer` **in addition to** `flex: 1 1 0` on `.panel-body` so a future content change cannot undock the footer.

### Nuclear option (only if flex still fails in WKWebView)

Shell-level grid with a shared bottom row for both links — guaranteed same Y. Prefer fixing the three-row flex first; it is enough if implemented symmetrically.

## Explicit “do not” list for the next edit

- Do not only tweak `margin-top` / `padding-top` on the coffee footer while the body stays content-sized.  
- Do not keep the Details title inside `#details-body` if the left title stays outside `.folder-list`.  
- Do not use `flex: 1 1 auto` for the expanding middle; use **`flex: 1 1 0`** (or `flex: 1` with `min-height: 0`).  
- Do not nest the footer in another wrapper on one side only.

## Verification checklist

- [ ] Empty details: coffee divider aligns with Submit Feedback divider  
- [ ] Empty details: “Select a photograph…” is centered in the **middle** of the details column (or top of body if preferred), **not** glued to the coffee link with a void under the link  
- [ ] Selected photo, short metadata: footer still bottom-aligned with left  
- [ ] Selected photo, long metadata: body scrolls; footer stays pinned  
- [ ] Window resize height: both footers move together  
- [ ] After clicking many thumbnails (`updateSelectionUI` only): footer never jumps mid-panel  

## Symptom → cause (this regression)

| Screenshot | Cause |
| --- | --- |
| Coffee mid-panel, void below | `.panel-body` on the right not consuming free height; footer packs under short content |
| Feedback still at bottom | Left three-row layout effectively works with a tall folder list |
| Shared `.panel-footer` didn’t fix alignment | Same class, different flex success / different header nesting |

## Out of scope

- Link URLs/copy  
- Applying the code fix in this audit  
