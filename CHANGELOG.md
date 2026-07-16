# Changelog

All notable changes to Peter’s Photo Manager are recorded here.

The project follows Semantic Versioning. Pre-release versions are for development and testing only.

## 0.3.0-alpha.3 — 2026-07-16

### Changed

- **Responsive browsing repair**: Thumbnail selection updates the Details panel without rebuilding the thumbnail grid; scan progress updates status text only.
- **Details-panel behavior**: File facts are shown immediately; the current panel displays camera, lens, and capture date when those EXIF fields are available.
- **Cached-first viewer**: The viewer shows a cached thumbnail immediately, then loads the full-resolution original in the background. Previous/next navigation updates in place.
- **Non-blocking scan metadata**: Scan-time image dimensions and EXIF extraction run on blocking workers, preserving the async command runtime for interface requests.

### Added

- **SQLite Database Integration**: Thread-safe, persistent local cataloguing of folders and images using SQLite and `rusqlite`.
- **Instant Startup**: Frontend retrieves cached image files and thumbnails instantly from the database without waiting for disk re-scans.
- **Background Synchronization & Maintenance**: Background directory sync detects, indexes, and cache-validates new or modified files on the fly.
- **Database Metadata Tracking**: Columns for Lens model, GPS coordinates (latitude, longitude, altitude), and textual location (country, state, city) parsed natively from EXIF headers and stored in the catalog.
- **UI Details Panel Upgrades**: Shows Lens model and formatted GPS location coordinates.
- **"Submit Feedback" Link**: Integrated in the sidebar controls footer to direct testers to the public issues repository.
- **Catalogue and file-operation backend**: Watched-folder removal cascades; commands exist for marking records ignored and deleting originals, cached thumbnails, and database entries. Corresponding user-interface actions remain future work.

## 0.3.0-alpha.2 — 2026-07-16

### Added

- Enriched photo Details Panel displaying filename, file size, path, format, and dimensions.
- Native EXIF metadata extraction for camera make/model, capture date, exposure parameters (aperture, shutter speed, ISO, focal length), star ratings, and keywords/tags.
- Full-resolution original image viewer utilizing Tauri's custom asset protocol.
- Left/Right sequential navigation in the viewer via keyboard arrow keys and circular button overlays, synced with active thumbnail and Details panel selection.
- Right-click context actions "Copy complete path" and "Copy image" (native system clipboard image copying).

### Changed

- Replaced the low-resolution thumbnail preview dialog with a high-resolution viewer backdrop.

### Removed

- Resolved limitation where the preview only displays a stretched thumbnail.

## 0.3.0-alpha.1 — 2026-07-16

### Added

- Multiple root folders and an **All Folders** collection view.
- An expandable, image-focused folder tree.
- Optional subfolder inclusion and empty-folder filtering.
- Background scanning for JPEG, PNG, and WebP files.
- Cached thumbnail generation, a selectable thumbnail grid, and thumbnail-size control.
- Thumbnail cache-size display.
- Basic double-click preview with Escape and close-button support.
- Application-controlled thumbnail context menu.
- Initial user manual.

### Changed

- Folder and thumbnail controls remain visible while their content areas scroll.
- Folder changes ignore stale scan results.

### Known Limitations

- The preview enlarges a cached thumbnail, not the full original image.
- Thumbnail generation still completes as a batch rather than showing each thumbnail immediately.
- Folder scanning and thumbnail generation need further performance work for very large collections.
- Windows manual verification and release packaging remain outstanding.
