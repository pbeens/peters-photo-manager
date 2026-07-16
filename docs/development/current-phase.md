# Current Phase

## Phase

Phase 3: Basic image viewer — completed.

## Objective

Replace the temporary cached-preview dialog with a full-resolution image viewer while retaining the thumbnail grid, introduce the details metadata panel, and implement sequential image navigation.

## Included Features

- Right-side Details Panel displaying filename, full path, format, file size, image dimensions, camera model, date taken, exposure details, ratings, and keywords/tags when a thumbnail is selected.
- Full-resolution image viewer loading the original file via tauri's asset protocol.
- Image viewer fit-to-window scaling.
- Escape and close-button support for viewer dismissal.
- Next/previous navigation overlay controls (`<` and `>`) and keyboard arrow key bindings (`ArrowLeft` and `ArrowRight`) to browse sequentially.
- Synchronization of grid selection and EXIF metadata extraction during navigation.
- Application-controlled thumbnail context menu.
- All Phase 1 and Phase 2 folder and thumbnail features.

## Excluded

A persistent catalogue database (SQLite), filesystem monitoring, editing, albums, exporting, AI, RAW support, video, plugins, and synchronization.

## Acceptance Criteria

- A selected image opens at a useful preview size.
- The viewer displays a full-resolution original image.
- Escape and the close control dismiss the viewer.
- The grid remains available after closing the viewer.
- Selecting a thumbnail displays its metadata in the Details panel.
- Left and right navigation works via keys and screen overlays, updating the viewer, the grid highlight, and the Details panel state simultaneously.

## Verification Results

- Frontend production build (tsc && vite build): passed.
- Rust unit tests for recursive discovery and thumbnail-cache reuse: passed.
- Rust formatting check (cargo fmt): passed.
- Rust Clippy check (cargo clippy --all-targets --all-features -- -D warnings): passed.

## Manual Test Needed

- Verify that selecting a thumbnail updates the Details panel on the right with the correct metadata.
- Verify that double-clicking a thumbnail opens the original image in full resolution, scaling to fit the window.
- Verify that clicking the navigation overlays or pressing the arrow keys moves to the next/prev image, updating both the viewer and details.

## Next Phase

Phase 4 will add the persistent SQLite catalogue.
