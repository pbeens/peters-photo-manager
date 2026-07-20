# Current Phase

## Phase

Phase 10: Edit Module Foundation and Rendered Save — active in `0.4.0-alpha.2`.

## Objective

Implement the first Lightroom-inspired editor and its explicit rendered-save workflow, keeping the source available by default.

> [!WARNING]
> The save feature is not ready to protect user work. It is present only for controlled testing: it does not yet reliably reproduce the preview, and saved-photo recipes are not restored when re-editing.

## Included Features

- An editor entry point from the viewer using `E` and a cursor-revealed Edit button. Implemented as a safe overlay scaffold.
- A full-window editor overlay that preserves the viewer's image context and does not rebuild the thumbnail grid.
- A per-photo recipe preview with reset, cancel, and explicit save boundaries.
- Light, colour, black-and-white, straighten, vignette, and frame adjustments.
- Experimental rendered JPEG/PNG/WebP output. Rendered DNG output for RAW sources is available only in a macOS Apple Silicon build with the optional Adobe DNG SDK toolchain installed.
- Original archive strategies and recorded archive/rendered mappings for a later restore-original command.

## Excluded

Automatic edits, presets, selective masks, healing, lens correction, batch processing, crop, undo/redo, restore-original, and Windows DNG packaging.

## Acceptance Criteria

- Opening the editor never alters the source photograph.
- `E` only opens the editor when the image viewer is active and focus is not in a form control.
- Edit-session commands remain reversible until **Save** is chosen.
- The default save strategy archives the source in an `Originals` subfolder before placing the rendered output; overwrite is separately confirmed.
- Cancelling an edit session restores the viewer with no source-file or catalogue mutation.

## Verification Results

- Rust test suite (`cargo test -q`): passed, including the raster archive-and-replace save transaction and DNG writer fixture.
- Frontend production build (`tsc && vite build`): passed after the save UI was added.

## Manual Test Needed

Manually verify JPEG, PNG, WebP, and representative RAW save output, all three source-retention choices, catalogue refresh, and the saved-image viewer handoff.

## Next Phase

Correct rendered-output fidelity and recipe restoration before treating editor saves as usable, then add undo/redo, restore-original, and the Windows DNG writer backend.
