# Tasks

## Current Focus

Phase 9 subfolder creation, drag-and-drop file organization, context-menu viewport bounding, and open folder settings persistence — completed and packaged in `v0.3.0-alpha.11`.
Active focus: version `0.4.0-alpha.1` edit-module design and foundation cycle.

## Next Tasks

- [x] Package the 0.3.0-alpha.9 macOS release.
- [ ] Manually smoke-test the 0.3.0-alpha.9 macOS release before public distribution.
- [ ] Confirm the final project license.
- [x] Confirm the initial Tauri application structure.
- [x] Define Phase 0 acceptance criteria.
- [x] Define Phase 1 folder-management and folder-view behavior.
- [x] Build the Phase 1 desktop interface.
- [x] Add folder selection and folder removal.
- [x] Add background scanning for JPEG, PNG, and WebP files.
- [x] Add the left folder view.
- [x] Add a basic right-side filename list.
- [x] Add a recursive folder-scanning test.
- [x] Manually test folder selection, scanning, removal, and restart persistence.
- [x] Add the right thumbnail view in Phase 2.
- [x] Manually test thumbnail generation, selection, and cache reuse.
- [x] Implement full-resolution image preview and fit-to-window scaling.
- [x] Implement next/previous image navigation in the viewer.
- [x] Add the basic photo-details panel.
- [x] Implement always-confirmed photo removal workflow:
  - **Remove from catalogue** leaves the original file on disk and excludes it from future scans.
  - **Delete from disk** deletes the original file, cached thumbnail, and catalogue entry.
  - Context menu, Delete, and Backspace open the same explicit choice; the confirmation cannot be skipped.
- [x] Define the first public test package (0.3.0-alpha.6 DMG generated).
- [x] Package the 0.3.0-alpha.7 macOS release.
- [ ] Manually smoke-test the 0.3.0-alpha.7 macOS release before public distribution.
- [ ] Agree the first non-destructive edit set, adjustment semantics, and export behavior before implementing pixel changes.
- [x] Implement the editor overlay entry points: `E` in the image viewer and a cursor-revealed Edit button.
- [x] Add preview-only basic light, colour, black-and-white, and draw-to-straighten controls without altering photographs or saving edits.
- [x] Implement the rendered-image save pipeline: same-format JPEG/PNG/WebP output and rendered DNG output for RAW files on macOS Apple Silicon.
- [x] Establish and validate the macOS Apple Silicon Adobe DNG SDK backend for rendered 16-bit RGB DNG pixels.
- [x] Archive originals in `Originals/` (or the selected alternate strategy) and record the archive/rendered mapping for a later restore-original feature.
- [ ] **Release blocker — saved-recipe restoration:** When re-editing a rendered output whose archived original is available, find the original/archive mapping and restore the saved adjustment recipe into the editor.
- [ ] **Release blocker — render fidelity:** Replace the current approximate save renderer with one that matches the editor preview for every light control, black-and-white conversion, vignette, frame, and straighten operation. Validate against controlled image fixtures before enabling trusted saves.
- [ ] **Release blocker — save safety:** Keep a prominent experimental-save warning and do not describe editor output as trustworthy until render fidelity and recipe restoration are accepted in manual testing.
- [ ] Decide and automate distribution of the optional Adobe DNG SDK toolchain for developer and release builds; do not commit its generated libraries or full upstream source tree to the application repository.
- [ ] Add an edit-session model with reset, undo/redo, and safe cancel behavior before adjustment controls.

## Open Questions

- What license should the project use?
- What public repository and issue URL will be used?
- Which thumbnail and image-decoding libraries should be evaluated?
- What measurable performance targets should the first prototype meet?
- Should edits be saved as sidecars, in the catalogue, or both—and what should the first export workflow be?

## Recently Completed

- Phase 3 cached-first original viewer, fit-to-window scaling, and in-place navigation implemented.
- Right-side photo Details panel now updates immediately from catalogue file facts; EXIF remains optional.
- Scan progress no longer rebuilds the full thumbnail grid, and scan metadata extraction runs off the async command runtime.
- Initial product specification created.
- First prototype scope clarified.
- Public testing identified as a project goal.
- Initial project guidance and documentation structure created.
- Tauri desktop starter application scaffolded.
- Local development and build instructions documented.
- Phase 0 verification checks passed.
- Starter application identity updated to the intended display name.
- macOS application bundle verified successfully.
- Phase 1 folder browser implemented and packaged for macOS.
- Phase 1 manually accepted: one selected folder is intentional for this phase.
- Phase 2 thumbnail grid implemented.
- Multi-folder manager, All Folders view, sidebar filters, cache display, context menu, and cached preview implemented.
- Subfolder creation, drag-and-drop file organization, and active folder persistence implemented and merged in v0.3.0-alpha.11.
