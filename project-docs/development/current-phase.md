# Current Phase

## Phase

Phase 7: Manual Tags & Catalogue Autocomplete — completed.

## Objective

Provide editable manual photo tags embedded directly into image metadata, maintain the tag catalogue, and suggest existing tags while a new tag is entered.

## Included Features

- Right-side Details Panel displaying filename, full path, combined format and file size, and image dimensions immediately, plus camera/lens details and capture date when indexed EXIF is available.
- Editable manual tags stored in IPTC/XMP metadata, with a catalogue-backed suggestion list and keyboard selection.
- Cached-first image viewer that loads the original file via Tauri's asset protocol in the background.
- Image viewer fit-to-window scaling.
- Escape and close-button support for viewer dismissal.
- Next/previous navigation overlay controls (`<` and `>`) and keyboard arrow key bindings (`ArrowLeft` and `ArrowRight`) to browse sequentially.
- In-place synchronization of grid selection, Details, and viewer navigation without rebuilding the thumbnail grid.
- Scan-time image dimensions and EXIF extraction run on blocking workers rather than the async command runtime.
- Application-controlled thumbnail context menu.
- Persistent thumbnail size, sort-field, and sort-direction preferences.
- Folder context actions for system opening, path copying, and exact nested-folder exclusion.
- Matched bottom footers for feedback and optional project support.
- All Phase 1 and Phase 2 folder and thumbnail features.

## Excluded

Filesystem monitoring, metadata editing beyond star ratings and manual tags, albums, exporting, AI, RAW support, video, plugins, and synchronization.

## Acceptance Criteria

- Manual tags can be added or removed in the Details panel and written to IPTC/XMP metadata through an atomic file replacement.
- Previously assigned tags are loaded from active catalogue entries and suggested case-insensitively by prefix.
- Suggestions can be selected with a pointer, arrow keys plus Enter, or Tab.
- Tags are parsed from image metadata when catalogue metadata is absent.

## Verification Results

- Frontend production build (`tsc && vite build`): passed.
- Rust unit tests (`cargo test`): passed.
- Rust formatting check (`cargo fmt`): passed.
- Rust Clippy check (`cargo clippy --all-targets --all-features -- -D warnings`): passed cleanly with no warnings or errors.

## Manual Test Needed

- Verify manual tag add, removal, persistence after restart, and suggestion selection against a packaged macOS build.

## Next Phase

Future work will focus on file search, albums, and filesystem monitoring.
