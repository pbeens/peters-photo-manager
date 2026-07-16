# Current Phase

## Phase

Phase 3: Basic image viewer — in progress.

## Objective

Replace the temporary cached-preview dialog with a full-resolution image viewer while retaining the thumbnail grid.

## Included Features

- A temporary double-click cached-preview dialog.
- Escape and close-button support for preview dismissal.
- Application-controlled thumbnail context menu.
- All Phase 1 and Phase 2 folder and thumbnail features.

## Excluded

Full-resolution image decoding and viewing, metadata extraction, a catalogue database, filesystem monitoring, editing, albums, exporting, AI, RAW support, video, plugins, and synchronization.

## Acceptance Criteria

- A selected image opens at a useful preview size.
- The viewer displays a full-resolution or suitably sized original preview.
- Escape and the close control dismiss the viewer.
- The grid remains available after closing the viewer.

## Verification Results

- Frontend production build: passed.
- Rust unit tests for recursive discovery and thumbnail-cache reuse: passed.
- Phase 1 multi-folder and Phase 2 thumbnail behavior: manually tested on macOS.
- Rust formatting check: passed.
- Rust Clippy check: passed.
- macOS `.app` bundle: passed.

## Manual Test Needed

The current cached-preview dialog needs to be replaced by a full-resolution viewer before Phase 3 acceptance.

## Next Phase

Phase 4 will add the persistent SQLite catalogue after Phase 3 acceptance.
