# Current Phase

## Phase

Phase 3: Basic image viewer and responsiveness repair — completed.

## Objective

Provide a responsive thumbnail browser with immediate basic details, a cached-first image viewer, and sequential navigation while scanning and metadata work continue in the background.

## Included Features

- Right-side Details Panel displaying filename, full path, format, file size, and image dimensions immediately, plus camera/lens details and capture date when indexed EXIF is available.
- Cached-first image viewer that loads the original file via Tauri's asset protocol in the background.
- Image viewer fit-to-window scaling.
- Escape and close-button support for viewer dismissal.
- Next/previous navigation overlay controls (`<` and `>`) and keyboard arrow key bindings (`ArrowLeft` and `ArrowRight`) to browse sequentially.
- In-place synchronization of grid selection, Details, and viewer navigation without rebuilding the thumbnail grid.
- Scan-time image dimensions and EXIF extraction run on blocking workers rather than the async command runtime.
- Application-controlled thumbnail context menu.
- All Phase 1 and Phase 2 folder and thumbnail features.

## Excluded

Filesystem monitoring, editing, albums, exporting, AI, RAW support, video, plugins, and synchronization.

## Acceptance Criteria

- A selected image immediately displays basic Details without waiting for EXIF extraction.
- The viewer opens with a cached preview and displays the full-resolution original when ready.
- Escape and the close control dismiss the viewer.
- The grid remains available after closing the viewer.
- Selecting a thumbnail displays its file details in the Details panel without rebuilding the grid.
- Left and right navigation works via keys and screen overlays, updating the viewer, grid highlight, and Details state in place.

## Verification Results

- Frontend production build (tsc && vite build): passed.
- Rust unit tests for recursive discovery and thumbnail-cache reuse: passed.
- Rust formatting check (cargo fmt): passed.
- Rust Clippy check (`cargo clippy --all-targets --all-features -- -D warnings`): currently fails on `clippy::type_complexity` in `src/thumbnails.rs`; tracked as follow-up work.

## Manual Test Needed

- Responsive selection, viewer opening, and navigation have been manually accepted on macOS.

## Next Phase

Future work will focus on filesystem monitoring, richer metadata and search, and safe file operations.
