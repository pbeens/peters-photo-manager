# Audit: Plus sign during photo drag-and-drop onto folders

**Date:** 2026-07-19  
**Scope:** Read-only analysis. No application code changed.  
**Branch:** `feature/folder-create-drag-drop`  
**Files:** `apps/desktop/src/main.ts`, `apps/desktop/src/styles.css`, `apps/desktop/src-tauri/src/lib.rs`  
**Symptom:** When dragging thumbnail(s) over a folder in the left tree, a **plus sign** appears (typically the macOS green “+” badge next to the pointer).

## Goal

Explain **why** the plus sign appears, confirm it is not intentional app chrome for “move,” and record where a fix would need to act.

## Short answer

The plus sign is **not drawn by this app’s CSS or HTML**. It is the **native platform drop-effect cursor badge**, which on macOS means **“copy”**.

The app already intends a **move** (not a copy):

| Layer | Intent | Evidence |
| --- | --- | --- |
| `dragstart` | Move | `event.dataTransfer.effectAllowed = "move"` |
| `dragenter` / `dragover` on folders | Move | `event.dataTransfer.dropEffect = "move"` |
| Payload prefix | Move | `pm-move:${JSON.stringify(paths)}` |
| Backend | Move | `std::fs::rename` in `move_files` |
| Custom drag ghost | Count badge only | Folder emoji + “N photo(s)” — **no “+”** |

So the plus is a **cursor mismatch**: system UI says “copy,” actual operation is “move.”

## What the UI actually draws during drag

### Custom drag image (app-controlled)

In `main.ts` (`dragstart` handler, ~2152–2183):

1. Clears transfer data, then sets `text/plain` to `pm-move:…`.
2. Sets `effectAllowed = "move"`.
3. Builds a temporary `.drag-feedback-icon` element:
   - Amber pill (`#dca461`)
   - `🗂️` + `"N photo"` / `"N photos"`
4. Calls `setDragImage(dragIcon, 40, 15)`.
5. Adds `is-dragging` on the card and `is-dragging-files` on `body`.

There is **no plus character**, CSS `content`, or icon that would render a “+” in that ghost.

### Folder drop target highlight (app-controlled)

- On `dragover` over a real folder (not “All folders”), the target gets class `drag-over`.
- CSS (`.folder-item.drag-over`): darker background + dashed amber outline.
- On drag end / leave / drop, that class is removed.

Again: **no plus** in markup or styles.

### Relevant CSS only

```css
.folder-item.drag-over {
  background: #50524c !important;
  outline: 2px dashed #dca461;
}

body.is-dragging-files .folder-item * {
  pointer-events: none; /* stabilizes hit-testing over folder row children */
}
```

Nothing here sets a cursor image or a “+” glyph.

## Drop pipeline (current behavior)

1. **`dragstart`** on `.thumbnail-card`  
   - Dragged paths = whole multi-selection if the card is selected, else just that card.  
   - `effectAllowed = "move"`.  
   - Custom drag image as above.

2. **`dragenter` / `dragover`**  
   - If target is `[data-folder-path]` and not “All folders”:
     - `preventDefault()` (required so drop is allowed, especially WebKit)
     - `dropEffect = "move"`
     - folder marked `drag-over`
   - If not a valid folder target: clear `drag-over` and **do not** set `dropEffect` / **do not** always `preventDefault`.

3. **`drop`**  
   - Parses `pm-move:…` (or legacy JSON / newline list).  
   - Calls `moveFilesToFolder` → Tauri `move_files`.

4. **`move_files` (Rust)**  
   - Validates target directory.  
   - Per file: `std::fs::rename(old, new)` then updates DB path/name/folder_id.  
   - Fail if a same-named file already exists in the target.  
   - **Rename = move**, not copy.

## Why the plus still shows

### 1. It is the OS “copy” drop cursor, not app chrome

On macOS, HTML5 drag-and-drop cursors commonly show:

| Drop effect | Typical system badge |
| --- | --- |
| `copy` | Green circle with **+** |
| `move` | Arrow / no plus (varies) |
| `link` | Curved arrow |
| `none` | “not allowed” |

The user-visible plus matches **copy**, not the app’s dashed folder highlight or the amber “N photos” ghost.

### 2. WebKit / WKWebView (Tauri on macOS) often ignores requested move

This desktop shell is Tauri → **WKWebView** on macOS.

For **in-page** drags (draggable DOM nodes + custom `text/plain` payload, not native OS file promises), WebKit frequently:

- Still paints the **copy (+)** badge even when JS sets `effectAllowed = "move"` and `dropEffect = "move"`.
- Treats generic string payloads more like “copy this data” than “move a file.”
- Lets the **system** composite the drop-effect badge **on top of** `setDragImage()`.  
  `setDragImage` only replaces the dragged ghost; it does **not** remove the OS effect indicator.

So the app can correctly set move semantics and still show a plus in the cursor chrome.

### 3. Not caused by the custom drag feedback content

The ghost is only:

```html
<span>🗂️</span>
<span>N photo(s)</span>
```

No “+”. If the plus is next to the pointer as a small system badge, that is further evidence it is the **platform drop-effect cursor**, not the drag image.

### 4. Not caused by folder-create UI

Folder create/subfolder flows and context menus are separate. The tree does not inject a “+” button on `drag-over`. The only drag-specific folder styling is background + dashed outline.

## What is *not* the cause

| Hypothesis | Why ruled out |
| --- | --- |
| Plus in custom drag image HTML | Image is emoji + count text only |
| CSS `::before` / `content: "+"` on drag | No such rules under drag classes |
| Backend copies files | Uses `std::fs::rename` |
| Accidental `dropEffect = "copy"` in code | Code sets `"move"` on enter/over valid folders |
| Intentional “add to folder” copy UX | Payload, command name, and FS op are all move |

## Gaps / secondary issues (related, not the plus itself)

1. **`dropEffect` only set on valid folders**  
   Outside valid targets the code often neither sets `dropEffect = "none"` nor consistently `preventDefault`s. That can make the cursor feel inconsistent, but the plus **over folders** is still the copy badge problem.

2. **`text/plain` + custom `pm-move:` prefix**  
   Works for app drop handling, but does not look like a native file move to the OS, so WebKit has less reason to show a pure “move” cursor.

3. **No CSS attempt to hide the system drag cursor**  
   Even `cursor: none` during drag is unreliable for suppressing WebKit’s drag-effect badge; the badge is often outside normal CSS cursor control.

## Recommended directions (for a later fix; not applied here)

Ordered from least to most invasive:

1. **Keep asserting move** (already done):  
   `effectAllowed = "move"` on start; `dropEffect = "move"` on enter/over; optionally also set `dropEffect = "none"` when not over a valid folder and `preventDefault` on a broader drag surface so the only allowed effect is move.

2. **Try broader `effectAllowed` then force move on over**  
   Some engines behave better with `effectAllowed = "copyMove"` or `"all"` while still setting `dropEffect = "move"` on valid targets. Worth a quick try on macOS WKWebView; may not remove the plus.

3. **Accept that the OS badge may be unfixable via pure web APIs**  
   Rely on existing folder `drag-over` styling + the custom “N photos” ghost to communicate “move here.” Optionally add a small in-app status line (“Move N photos to FolderName”) instead of fighting the system cursor.

4. **Platform / Tauri-specific path only if must kill the plus**  
   Native file drag session APIs or a custom overlay that fully owns feedback (and may still not suppress WKWebView’s badge). Higher cost; not justified unless the plus is a hard product requirement to remove.

5. **Do not “fix” by changing the operation to copy**  
   That would make the plus accurate but would contradict current product behavior (reorganize into folders via move/rename).

## Verification checklist (when fixing later)

- Drag one photo onto another folder: no green **+** (or accepted substitute feedback), drop **moves** file on disk and in DB.
- Multi-select drag: same.
- Drag over “All folders” / non-folder UI: no drop, clear “not allowed” or no-op.
- Same-folder drop: no-op (already filtered in `moveFilesToFolder` when parent already equals target).
- Name collision in target: error path still works.
- Windows smoke test: drop cursor semantics differ; confirm move still works and feedback is sane.

## Conclusion

The plus sign appears because **macOS / WebKit shows the system “copy” drop-effect badge** during HTML5 drags, even though this app:

- requests **move** via `effectAllowed` / `dropEffect`,
- labels the payload **`pm-move:`**,
- and performs a real filesystem **rename** in `move_files`.

It is **not** an intentional “+” control or copy action in application CSS/HTML. Removing it is a **cursor / platform DnD feedback** problem, not a folder-tree rendering bug, and may require more than the current `dropEffect = "move"` lines already present in `main.ts`.
