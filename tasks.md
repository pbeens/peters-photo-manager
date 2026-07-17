# Tasks

## Current Focus

Phase 6 interactive ratings and embedded EXIF/XMP metadata integration — completed.

## Next Tasks

- [x] Resolve the `clippy::type_complexity` warning in thumbnail generation so the strict Rust lint check passes.
- [x] Implement interactive star ratings embedded directly into original image metadata.
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

## Open Questions

- What license should the project use?
- What public repository and issue URL will be used?
- Which thumbnail and image-decoding libraries should be evaluated?
- What measurable performance targets should the first prototype meet?

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
