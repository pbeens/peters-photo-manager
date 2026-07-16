# Audit: Thumbnail selection, Details panel, and full-size viewer

**Dates:** 2026-07-16 (initial) · 2026-07-16 (post-repair re-audit)  
**Scope:** Read-only review. **No application code was changed for this audit.**  
**Primary files:** `apps/desktop/src/main.ts`, `apps/desktop/src/styles.css`, `apps/desktop/src-tauri/src/lib.rs`

---

## Follow-up implementation status

The issues identified in this audit were subsequently addressed in the application: selection and scan-progress updates now avoid rebuilding the thumbnail grid; scan-time metadata work runs on blocking workers; and the viewer presents a cached preview while the original image loads in place. The latest tester report indicates the repaired behavior is working. The findings below remain as the historical basis for that repair.

---

## Latest tester feedback (post attempted repair)

> I never do get details, and it seems forever for an image to open in the viewer, although forward and next do not work. It really makes me wonder if there is something going on in the background that is hanging the program up.

**Verdict: that hang suspicion is correct.** The attempted repair did not fix the root architecture problems; it added a real `dblclick` path and event delegation, but left full-grid `innerHTML` rebuilds and a heavy sequential background scan/thumbnail/EXIF pipeline that can starve the UI and other commands.

---

## What the programmer changed (and what they did not)

### Changed (partial)

| Change | File | Assessment |
| --- | --- | --- |
| Stable click / dblclick delegation on `#app` | `main.ts` | Good direction |
| `data-thumbnail-index` + lookup in `thumbnails[]` | `main.ts` | OK if array and DOM stay in sync |
| `pointer-events: none` on card `img` / `span` | `styles.css` | Good |
| Deferred selection render (`scheduleSelectionRender`, **225ms**) | `main.ts` | Harmful — delays Details, races with other renders |
| Still full `app.innerHTML = …` on every `render()` | `main.ts` | **Not fixed** — core problem remains |
| Scan still processes files one-by-one with blocking EXIF on the async path | `lib.rs` | **Not fixed** — main hang source |

### Not fixed

1. Full UI rebuild on selection, progress, navigation, and viewer open  
2. Background scan/thumbnail/EXIF load monopolizing disk and the async/blocking pools  
3. Progress events forcing grid rebuilds up to ~10×/sec  
4. Viewer always loading the **full original** file with no progressive / cached intermediate  
5. Prev/next re-running selection + metadata work through the same full-render path  

---

## How interaction works now

### Click (select)

```text
#app click → closest [data-thumbnail-index]
          → selectAndLoadMetadata(path, deferRender=true)
          → set selectedThumbnailPath immediately
          → scheduleSelectionRender()  // waits 225ms then render()
          → optional invoke get_image_metadata if not in catalogMetadata
```

### Double-click (viewer)

```text
#app dblclick → set selectedThumbnailPath + viewerSourcePath
             → clear selection timer
             → render() immediately (opens overlay + full original via convertFileSrc)
```

### Prev / next

```text
#viewer-prev / #viewer-next click
  → navigateToImage(index)
  → viewerSourcePath = thumbnails[index].sourcePath
  → render()                          // full DOM rebuild
  → await selectAndLoadMetadata(...)  // may call get_image_metadata + another render()
```

There is still **no** targeted update of the Details panel or viewer image alone.

---

## Why Details never appear (or appear unreliable)

Details only render when:

```text
selectedThumbnail = thumbnails.find(t => t.sourcePath === selectedThumbnailPath)
```

is non-null. Filename/path should then show even without EXIF.

### Likely failure modes in the current code

1. **225ms deferred render after click**  
   Single-click does **not** call `render()` immediately (`deferRender = true`). The panel stays on “Select a photograph…” until a timer fires.  
   Re-clicking the same thumbnail **early-returns** (`selectedThumbnailPath === path`) and does **not** schedule another paint. If the first timer was cleared (e.g. by dblclick handling) or overwritten by other state, the UI can stay empty.

2. **Full re-render still wipes scroll and DOM**  
   Progress ticks (`scheduleProgressRender`, 100ms) and scan completion still rebuild the entire grid. Selection state variables can be set while the visible UI lags or jumps.

3. **`scanSelectedFolder()` still clears selection at start**  
   Any folder re-select / rescan zeros `selectedThumbnailPath` / `selectedMetadata`.

4. **Catalogue metadata vs empty panel**  
   If the path never sticks in state, the empty placeholder is shown. This is a selection/render binding problem, not “missing EXIF.” EXIF can fail and the panel should still show filename + path.

5. **CSS still hides Details at `max-width: 1024px`**  
   Secondary: default window is 1280 / minWidth 1100, so this is less likely in the normal desktop window, but still present.

**Bottom line:** Details not showing is still a frontend state/render problem. The 225ms defer + full `innerHTML` rebuilds are incomplete “fixes” that can make the empty state the steady state the user sees.

---

## Why the viewer feels forever slow

Opening the viewer sets:

```text
<img src={convertFileSrc(originalFilePath)} />
```

That asks the WebView to load and decode the **full original JPEG/PNG/WebP** from disk (often multi‑MB, multi‑thousand‑pixel images).

At the same time, background work may still be:

- walking folders  
- generating thumbnails **sequentially** (`spawn_blocking` + `.await` per file in a loop)  
- reading EXIF / dimensions for each file  

So disk and CPU compete with the viewer decode. Perceived “hang” is expected under a large library or first-time scan.

There is no:

- show-thumbnail-first then upgrade to full res  
- decode size limit / downscaled preview for the overlay  
- cancellation of in-flight full-res loads when navigating  

---

## Why prev / next appear broken

Several concrete issues stack:

### 1. Every navigation is a full app rebuild

`navigateToImage` → `render()` rebuilds sidebar + entire thumbnail grid + viewer. That is expensive and re-binds all listeners. Under load it feels like the buttons do nothing.

### 2. Navigation also awaits metadata

```text
render();  // should show new image URL
await selectAndLoadMetadata(viewerSourcePath);  // may block on get_image_metadata
```

If `get_image_metadata` is slow because the blocking pool / disk is busy with thumbnailing, follow-on work piles up. The first paint may still happen, but rapid next/prev and Details updates become unreliable.

### 3. Buttons disabled when `currentIndex === -1`

```text
currentIndex = thumbnails.findIndex(t => t.sourcePath === viewerSourcePath)
```

If `thumbnails` was replaced/cleared, or path identity diverges briefly, **both** prev and next render as `disabled`.

### 4. Click handlers live only until the next `render()`

Prev/next listeners are attached inside `render()` on freshly created buttons. That can work, but combined with heavy main-thread `innerHTML` work, clicks are easy to lose or delay. Keyboard arrows use the same `navigateToImage` path and will feel equally stuck.

### 5. Double-click path does not go through `selectAndLoadMetadata`

Dblclick sets catalogue metadata only (`catalogMetadata.get`). That is fine for opening, but navigation then mixes paths that all still full-render.

---

## Background hang analysis (yes — this is real)

### Frontend: progress → full grid rebuild

```text
scan-progress / thumbnail-progress
  → scheduleProgressRender (throttle 100ms)
  → render()
  → rebuild HTML for every thumbnail (convertFileSrc × N)
  → replace entire #app innerHTML
```

For large N this is main-thread heavy and will make clicks, Details updates, and viewer chrome feel frozen even though “background” work is “async.”

### Backend: sequential thumbnail + EXIF in `perform_scan_and_sync` (`lib.rs`)

For each file needing work:

1. `spawn_blocking` → generate thumbnail → **`.await`** (one at a time)  
2. **`get_image_metadata_internal(&path)` called directly on the async task** (not `spawn_blocking`)  
   - filesystem metadata  
   - `image::image_dimensions`  
   - full EXIF parse  

Step 2 **blocks the async runtime thread** while decoding headers/EXIF. That is a serious design bug: it can delay other async Tauri commands and event handling.

Only after the whole batch finishes does it write to SQLite under `Mutex<Connection>`.

### Command contention

- `get_image_metadata` (UI Details) also uses `spawn_blocking`  
- Thumbnail jobs also use `spawn_blocking`  
- Under a large first scan, the blocking pool and disk are saturated  
- UI invokes for metadata feel hung; full-res opens crawl  

### Folder scan always re-enters this pipeline

`scanSelectedFolder()` always sets `isScanning = true` and invokes `scan_folder` / `scan_folders` after loading the catalogue. Even when most files are up to date, the directory walk and per-file checks still run. Selecting folders repeatedly re-triggers load.

---

## Symptom → cause map (current)

| User symptom | Most probable cause |
| --- | --- |
| Details never show | Deferred 225ms selection paint + full re-renders; selection not painted immediately; possible clear on rescan; path binding only after `render()` |
| Viewer takes forever to open | Full original decode + disk/CPU contention from sequential thumbnail/EXIF scan; full DOM rebuild on open |
| Prev / next do not work | Full rebuild per navigation; metadata await contention; possible `currentIndex === -1` disabling controls; main thread busy rebuilding grid |
| App feels hung in background | Sequential thumbnail loop + **blocking EXIF on async thread** + 10Hz full-grid HTML rebuilds during progress |

---

## Required repair direction (for the next implementer)

Do **not** add more timers or more deferred paints on top of full `innerHTML` rebuilds. Fix the architecture.

### A. Frontend (must)

1. **Stop rebuilding the whole app on selection / progress / viewer nav.**  
   - Keep stable DOM for shell, sidebar, grid container.  
   - Update: selected class, Details panel text, viewer `img.src`, counters.  
   - Preserve `.file-panel` scrollTop.

2. **Paint Details on click immediately** (same turn as setting `selectedThumbnailPath`).  
   - Remove the 225ms `scheduleSelectionRender` deferral for selection.  
   - Filename + path from the thumbnail record first; EXIF async after.

3. **Viewer UX**  
   - On open: show cached thumbnail (or existing card image) instantly, then swap to full-res when loaded.  
   - Cancel or ignore stale image loads when moving next/prev quickly.  
   - Do not re-render the thumbnail grid when only the viewer index changes.

4. **Progress UI**  
   - Update a status string only; do **not** rebuild the grid on every thumbnail-progress event.  
   - Optionally append new cards when catalogue rows appear, without replacing all nodes.

5. **Prev/next**  
   - Change `viewerSourcePath` + `img.src` + caption + Details in place.  
   - Keep buttons enabled based on a stable index into the current list.

### B. Backend (must for hang)

1. Move **all** EXIF/dimension work in the scan loop onto `spawn_blocking` (or one dedicated worker), never directly on the async task.  
2. Bound concurrency for thumbnails (small pool), instead of unbounded wall-clock sequential `.await` that still blocks the runtime with sync EXIF between items.  
3. Prefer catalogue fields already in SQLite for Details; avoid re-invoking `get_image_metadata` when the catalogue row is complete.  
4. Do not hold or contend in ways that stall UI commands; keep DB lock scopes short (already partially done — keep it that way).  
5. Consider skipping full rescan work when nothing changed more aggressively so idle browsing stays light.

### C. Verification checklist

- [ ] Click thumbnail → Details shows filename/path **within one frame** (no multi-hundred-ms empty state)  
- [ ] No full-grid blink or scroll jump on selection  
- [ ] Double-click → viewer chrome appears immediately; image may refine to full-res  
- [ ] Prev/next change image promptly even during/after a large library load  
- [ ] During first scan, UI remains clickable; status text updates without rebuilding hundreds of cards  
- [ ] With scan idle, open + navigate feel snappy on multi‑MB JPEGs  

---

## Historical note (initial audit)

Earlier issues still relevant:

- Docs specify double-click; an older build used second-click-on-selected only (partially addressed by adding `dblclick`).  
- `prompts.md` documents many failed interaction fixes; the recurring mistake is patching events while keeping full-document `innerHTML` renders and heavy synchronous scan work.

---

## Out of scope

- This document does not implement fixes.  
- Licence, delete-from-disk UI gaps, and other roadmap items are separate unless they share the same render/scan bottlenecks.
