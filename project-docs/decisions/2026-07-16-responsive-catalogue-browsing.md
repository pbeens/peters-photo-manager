# Responsive Catalogue Browsing

## Decision

Keep thumbnail selection, Details updates, scan-progress updates, and viewer navigation independent of full thumbnail-grid rendering.

The local catalogue provides basic file facts immediately. A selected photo displays its filename, path, format, file size, and dimensions from that catalogue before optional EXIF work completes. Viewer opening displays the cached thumbnail first, then replaces it with the original file after it loads. The viewer is mounted in a persistent host outside the rebuilt application shell, so opening and navigating it do not replace the thumbnail grid.

Image dimension and EXIF extraction performed while scanning runs on blocking workers rather than the Tauri async command runtime.

## Rationale

Rebuilding a large thumbnail grid for every selection or progress event made normal interaction unreliable and caused viewer navigation to compete with scanning work. Synchronous metadata extraction on the async scan command also delayed other interface requests.

## Consequences

- Scan progress changes status text without replacing the thumbnail grid.
- Selection and navigation preserve the current grid and its scroll position.
- The viewer remains useful while large originals load.
- Folder changes close the viewer rather than carrying an open image into a different folder view.
- Future UI changes must avoid full-grid re-renders for ordinary interaction state changes.
