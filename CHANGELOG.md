# Changelog

All notable changes to Peter’s Photo Manager are recorded here.

The project follows Semantic Versioning. Pre-release versions are for development and testing only.

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
