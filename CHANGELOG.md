# Changelog

All notable changes to Peter’s Photo Manager are recorded here.

The project follows Semantic Versioning. Pre-release versions are for development and testing only.

## 0.3.0-alpha.5 — 2026-07-17

### Added

- **System folder opening**: Right-click a folder in the sidebar to open it in Finder on macOS or Explorer on Windows.
- **Confirmed photo removal**: A thumbnail context-menu action and Delete/Backspace open a required choice between removing a photo from the catalogue or permanently deleting it from disk.
- **Folder options menu**: The sidebar now groups **Hide folders with no images** under a compact Folder options menu.
- **Thumbnail sorting controls**: The thumbnail footer now sorts the grid by file name, date taken, date modified, or file size, with an ascending/descending toggle.
- **Persistent display preferences**: Thumbnail size, sort field, and sort direction are saved in the app configuration and restored at launch.
- **Anchored folder options**: Folder settings open in a compact pop-up menu.
- **Folder menu actions**: **Add folder** now lives alongside folder settings in the Folder options pop-up.
- **Folder catalogue actions**: **Reset & Rescan** now lives in the Folder options pop-up.
- **Optional support link**: The Details panel now includes a **Buy me a coffee** link.
- **All Folders toggle**: The All Folders row now collapses the hierarchy back to the visible top-level folder rows or expands them again.
- **Folder removal menu**: Right-click a folder to remove its watched root from the app.
- **Exact nested-folder removal**: Removing a nested folder now excludes only that selected folder from future scans, rather than removing its watched root.

### Fixed

- **Stable sorting controls**: Sort-field selection and the direction toggle are permanently visible in the thumbnail footer, eliminating the transient thumbnail sorting pop-up.

### Changed

- **Compact folder browser**: Folder names and tree rows use a smaller type size for denser browsing.
- **Clear thumbnail footer**: The thumbnail count now uses a compact localized label such as **1,800 images**, and the sort-direction toggle uses the same light styling as the sort-field selector.
- **Consistent thumbnail controls**: The thumbnail count, sort label, selector, and direction toggle now share a unified type scale and an explicit 32px control height. The obsolete thumbnail-grid label separator has been removed.
- **Compact sort sentence**: The thumbnail footer now reads as one lowercase sentence, such as **1,800 images sorted by File name**, with 26px sort controls.
- **Simplified sidebar footer**: Removed the redundant divider above Submit Feedback.
- **Balanced side panels**: The Folders and Details panels now share a 280px width, aligning their feedback and support footers.
- **Matched footer panels**: Submit Feedback and Buy me a coffee now use the same 52px footer container, padding, divider, and link styling.
- **Matched footer divider**: Both footer panels now use the same divider color as well as matching dimensions.
- **Compact footer panels**: Both footer panels use a shared 40px height and reduced top spacing.
- **Aligned sidebar footers**: The Folders and Details panels now use a shared header/body/footer structure, keeping their footer dividers aligned as content changes.
- **Pinned Details footer**: The Details heading is stable panel chrome and its zero-basis body now absorbs available height, keeping the coffee footer pinned to the bottom.

### Fixed

- **Thumbnail context menu**: Right-click menu actions on thumbnails now remain open instead of being dismissed by the opening pointer event.
- **Context-menu dismissal**: Choosing **Open preview** now removes the thumbnail menu before the viewer opens.
- **Context-menu controls**: Escape and normal clicks elsewhere now dismiss an open thumbnail or folder context menu.
- **Persistent context-menu host**: Thumbnail and folder menus no longer rely on rebuilding the application shell, so they remain available across repeated use.

## 0.3.0-alpha.4 — 2026-07-17

### Fixed

- **Reliable viewer mounting**: The viewer is now mounted in a persistent overlay host instead of rebuilding the thumbnail grid during the open gesture.
- **Thumbnail activation compatibility**: Both the native double-click event and the second thumbnail click open the viewer through the same path.
- **Folder-change state leak**: Changing, adding, removing, or resetting folders now closes the viewer instead of allowing a delayed image open in a new folder view.
- **Fit-to-window image sizing**: Viewer images preserve their complete aspect ratio within the available overlay area instead of filling and clipping the media box.
- **Browsing-position preservation**: Full interface refreshes now retain the folder-list and thumbnail-panel scroll positions.

### Added

- **Keyboard thumbnail navigation**: Arrow keys move the grid selection by item or row; Enter and Space open the selected image.

## 0.3.0-alpha.3 — 2026-07-16

### Changed

- **Responsive browsing repair**: Thumbnail selection updates the Details panel without rebuilding the thumbnail grid; scan progress updates status text only.
- **Persistent viewer overlay**: Opening or navigating the viewer updates a dedicated overlay instead of rebuilding the thumbnail grid; folder changes close it.
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
