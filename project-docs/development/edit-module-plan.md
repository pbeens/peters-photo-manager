# Edit Module Plan

## Goal

Add a Lightroom-inspired editor that feels native to the existing viewer while retaining originals by default. The editor is a separate full-window overlay, entered from the image viewer and dismissed back to that viewer.

## Entry and Layout

- Double-clicking a thumbnail opens the existing viewer.
- Pressing `E` in the viewer opens the editor, unless a form control has focus.
- The viewer has a persistent **Edit** button in the lower-right corner.
- The editor uses a dark, quiet surface consistent with the viewer: a large centred preview, a narrow right adjustment panel, and a slim top bar for the filename, undo/redo, reset, and close controls.
- The bottom bar contains the histogram later, plus a zoom/fit control and before/after toggle. These are planned controls, not part of the initial scaffold.

## First Adjustment Set

Start with a deliberately compact "Basic" panel, familiar to Lightroom users:

1. Straighten using either a horizontal or vertical draw guide; the latest guide controls rotation and crop remains later.
2. White balance: temperature and tint.
3. Tone: exposure, contrast, highlights, shadows, whites, and blacks.
4. Presence: texture, clarity, dehaze, vibrance, and saturation.

The controls are grouped in collapsible sections with numeric values and keyboard-accessible sliders. The current alpha provides preview-only light, colour, vignette, and frame controls; four black-and-white conversions; a menu-controlled clipping indicator; and a horizontal-or-vertical straightening guide. Section expansion state persists locally. Avoid presets, masks, healing, curves, and local adjustments until this core interaction is reliable.

The tonal controls must remain distinct: global contrast expands around the midpoint, while highlights, shadows, whites, and blacks use bounded tonal ranges instead of acting as global exposure. Preview clipping is calculated per image pixel inside the rendered photo bounds, with red only for an adjusted channel above white and blue only for an adjusted channel below black.

## Safety and Persistence

- Opening and cancelling editing never changes a source photograph.
- An edit session is reversible with reset before any output is produced; undo/redo remains future work.
- Cancel returns to the viewer without changes.
- **Save** renders the current edit. It archives the source by default and never overwrites a source without confirmation. For RAW files under the Originals-subfolder strategy, archive the untouched RAW and place a newly rendered DNG alongside it with the same base filename.
- Persist adjustments separately from source metadata. The preferred initial direction is a catalogue record keyed by source path and source modification timestamp, with a portable sidecar format evaluated before public release.
- The first implementation stores a non-destructive edit recipe in SQLite, keyed by the source path, file size, and modification timestamp. A missing or changed source invalidates that recipe and restores neutral settings.
- The editor options menu selects original handling: Originals subfolder, `filename_original.EXT`, or overwrite. Overwrite retains an explicit confirmation step.

## Technical Shape

Reuse the viewer host pattern: mount an `editor-host` beside `viewer-host`, maintain editor state separately from grid selection state, and run preview rendering off the interface thread. Start with one photo per session. Preview render requests need an incrementing revision token so a delayed result cannot replace a newer adjustment state.

For saved RAW output, the native renderer produces full-resolution pixels and writes a rendered DNG via the embedded Adobe DNG SDK on macOS Apple Silicon. The interactive preview can remain cache-based.

## Recommended Delivery Sequence

1. Editor overlay scaffold and entry/exit controls — complete.
2. Basic tone, colour, black-and-white, straighten, vignette, and frame controls — complete.
3. Rendered save and original-retention choices — complete on macOS Apple Silicon.
4. Safe session state, reset, undo, redo, and cancel tests.
5. Restore original, crop, and portable sidecar evaluation.

## Open Decisions

- Whether the first user-visible saved state is catalogue-only, sidecar-only, or both.
- Which export formats and destination chooser should ship first.
- Whether generated previews should be cached and how they are invalidated when the source file changes.
