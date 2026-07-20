# Changelog

All notable changes to Peter’s Photo Manager are recorded here.

The project follows Semantic Versioning. Pre-release versions are for development and testing only.

## 0.4.0-alpha.1 — 2026-07-19

### Changed

- Began the dedicated edit-module development cycle on `feature/edit-module-0.4.0-alpha.1`.
- Defined the first non-destructive, Lightroom-inspired editor scope and its safety boundaries.
- **Experimental Save Warning**: Editor saving is now explicitly documented as unsuitable for trusted photo preservation until output fidelity and recipe restoration are corrected. The optional Adobe DNG SDK toolchain is excluded from source control; without a local installation, RAW-to-DNG saving is disabled while the rest of the app builds normally.

### Added

- **Edit Workspace Scaffold**: Open a full-window edit workspace from the image viewer using `E` or a cursor-revealed **Edit** button. The workspace safely returns to the viewer and does not alter photographs.
- **Preview-Only Basic Edits**: Added collapsible Light and Colour panels for brightness, exposure, contrast, highlights, shadows, whites, blacks, vibrance, and saturation, plus Neutral, High contrast, and Matte black-and-white conversions.
- **Draw-to-Straighten**: Added horizontal and vertical line guides for straightening. Either guide can be used alone; the latest guide controls preview rotation.
- **Clipping Indicator**: Added a toggle in the editor’s **•••** menu and a `J` shortcut. Holding Alt on Windows or Option on macOS while moving a Light control temporarily shows the same preview warning.
- **Effects and Frames**: Added light/dark vignette with size control, plus Gallery, Film, and Matte frame previews with size and spread controls.
- **Persistent Editor Panels**: The open/collapsed state of every editor adjustment section is retained locally for the next image.
- **Rendered Image Saving**: Saving edited JPEG, PNG, and WebP photos now renders the current edit into the same file format. RAW inputs render to a new 16-bit RGB DNG; on macOS Apple Silicon this uses the embedded Adobe DNG SDK writer.
- **Original Handling Choices**: The editor menu now controls how the source is retained: an **Originals** subfolder, `filename_original.EXT`, or a separately confirmed overwrite. The completed save refreshes the viewer and thumbnail catalogue.
- **Saved-File Reveal**: Added a persisted editor-menu switch that dynamically offers **Open saved file in Finder** on macOS or **Open saved file in Explorer** on Windows. Successful saves now show a clear Saved state.

### Fixed

- **Saved Viewer Refresh**: Leaving the editor after a completed save now rebuilds the viewer from the saved file instead of retaining a stale pre-save preview.
- **JPEG Editor Save**: Fixed JPEG output by converting the rendered RGBA working image to RGB before encoding. Save failures now remain visible in the editor instead of being mistaken for a completed save.
- **Save Responsiveness**: Saving no longer blocks on a full-folder thumbnail rebuild. The new output is displayed immediately while the catalogue refreshes in the background, and archived `Originals` are not reprocessed as duplicate gallery images.
- **Original Archive Visibility**: Added a persisted **Hide originals** switch to Folder options, matching the existing folder-visibility toggle. The Folder menu’s Add folder and Reset & Rescan controls now share the same height.

- **Viewer Edit Button Hover**: Anchored the button to the viewer and kept it interactive while moving the pointer onto it.
- **Straighten Guides**: A newly drawn horizontal or vertical guide now replaces the prior guide rather than averaging rotations.
- **Clipping Mask Bounds**: Replaced the corner-gradient clipping decoration with a pixel mask positioned only over the displayed photograph, preventing false warnings on the editor canvas, vignette, or frame.
- **Clipping Controls**: Matched the sidebar’s compact switch style for the editor clipping toggle and reload the source as a same-origin image before inspecting its pixels, allowing the indicator to render reliably.
- **Editor Adjustment Reset**: Double-clicking an adjustment slider now restores its neutral value.
- **Photo-Bound Frames**: Frames and vignettes now use the displayed image bounds rather than the surrounding editor canvas.
- **Simplified Frames**: Removed the misleading Spread slider, replaced the Frame None button with Reset, added a Polaroid frame, and changed Film sizing to overlay its border without shrinking the photograph.
- **Persistent Viewer Edit Action**: The viewer Edit button now remains visible at all times.
- **Vignette Feather**: Added a Feather control to adjust the vignette edge softness.
- **Frame/Clipping Layering**: Frames now render above clipping masks, preventing warnings from appearing on a frame.
- **Editor Menu Dismissal**: Clicking outside the editor options popover now closes it.
- **Editable Adjustment Values**: Numeric slider values can now be typed directly.
- **Channel-Aware Clipping**: Clipping now evaluates adjusted RGB channels against true black/white bounds instead of using a coarse luminance threshold.
- **Non-Destructive Edit Recipes**: The catalogue now stores each image’s adjustment recipe and restores it only when the same original file size and modification timestamp are available.
- **Persistent Editor Preferences**: The clipping switch and last non-zero frame size are retained locally.
- **Straighten Guide Removal**: Removing a guide now hides only its line and preserves the resulting rotation.
- **Viewer Edit Continuity**: Closing the editor preserves the active tonal, colour, and rotation preview in the image viewer.
- **Thumbnail Edit Continuity**: The thumbnail grid now loads each valid stored recipe and shows its tonal, colour, and rotation preview.

## 0.3.0-alpha.11 — 2026-07-19

### Added

- **Empty Subfolder Creation**: Added a context-menu option to create subfolders on disk directly from the sidebar. Empty directories remain open and visible in the tree even when the "Hide folders with no images" filter is enabled.
- **Image Drag-and-Drop**: Supported dragging single or multiple selected photos from the grid onto directory nodes in the sidebar, which moves the files on disk and automatically updates their database records.
- **Small Drag Badge**: Created a custom floating badge under the cursor showing the number of dragged photos, replacing the large default browser drag representation to keep target folder names visible.
- **Active Folder Persistence**: The program now saves the last open folder to settings on exit and restores it on startup, automatically expanding parent directories in the sidebar to reveal nested targets.

### Fixed

- **Stable Drop Targets (Flicker Fix)**: Stabilized hover highlights by disabling mouse events on children of folder rows while dragging, preventing outline blinking.
- **Tauri File-Drop Interceptions**: Disabled Tauri's native window file-drop listeners and formatted drag payloads with custom prefixes to bypass OS-level copy overrides, ensuring correct drag cursors and drop-trigger operations in WebKit.
- **Context Menu Bounding**: Adjusted the position coordinates of context menus to guarantee they stay within the screen boundaries.

## 0.3.0-alpha.10 — 2026-07-19

### Added

- **Local-First Search Engine**: Introduced real-time search filtering with advanced prefixes (`tag:`, `camera:`, `lens:`, `location:`, `rating:`, `format:`) and free-text AND queries.
- **Advanced Rating Expressions**: Supported comparison operators (e.g., `rating:>2`), ranges (`rating:3-5`), and comma-separated lists (`rating:2,3`).
- **Interactive Search Hints**: Added a hover/focus tooltip listing search tips and query formats.
- **Zoom Lens Focal Length Display**: Show zoom settings (e.g., `@ 300 mm`) for zoom lenses while hiding redundant metrics for prime lenses.

### Fixed

- **Search Results Mismatch**: Resolved index lookup misalignment in search mode for card selections, double-clicks, and context menus.
- **Viewer Navigation**: Aligned full-screen viewer next/prev buttons, position counters, and keyboard controls to navigate within active search results.
- **Scanner Redundancy**: Synchronized SQLite file size and modification timestamps immediately after writing metadata, preventing duplicate rescans and RAW rendering loops.
- **Mojibake UTF-8 Glitches**: Set `IPTC:CodedCharacterSet` to UTF-8 to prevent string corruption (e.g., `Annie's Restaurant` becoming corrupted on write).
- **Tag Removal**: Re-wired tag remove buttons to a global click listener using event delegation, ensuring they remain clickable after DOM rebuilds.

## 0.3.0-alpha.9 — 2026-07-18

### Added

- **Multi-Selection support**: Added bulk selection of grid thumbnails using `Command` / `Control` click (toggle) and `Shift` click (range select).
- **Bulk Metadata Editing**: Supported editing star ratings and tags for all selected images in the Details panel simultaneously.
- **High-Fidelity RAW Rendering**: Integrated linear raw sensor demosaicing via Apple's native `sips` engine on macOS and `quickraw` on Windows.
- **Dynamic Folder Prioritization**: Background raw rendering queue dynamically prioritizes the folder currently viewed by the user.
- **Google Maps Integration**: Added clickable links for GPS coordinates in the Details panel that open Google Maps in the default browser.
- **Cache-Busting Previews**: Enabled automatic cache-busting using file size/modified timestamp hash values to refresh thumbnails instantly on metadata changes or external edits.

### Fixed

- **Autocomplete in Multi-Select**: Fixed tag autocompletion when multiple images are selected by suggesting only tags from the shared tag intersection.
- **Erratic Lens Metadata**: Fixed erratic null-padding strings (`", "", ...`) in EXIF parser and corrected range aperture parsing (`f/5.6-6.3` is fully removed, leaving the correct lens model).
- **RAW Progress Indicator**: Centered the pulsing progress bar indicator horizontally at the bottom of the middle panel.

## 0.3.0-alpha.8 — 2026-07-18

### Added

- **RAW image format support**: Added scanning, high-resolution preview caching, and rendering support for camera RAW files (`.NEF`, `.CR2`, `.ARW`, `.DNG`, `.ORF`, `.RW2`, `.PEF`, `.RAF`).
- **Robust DNG preview fallback**: Integrated an `exiftool` metadata reader fallback to extract high-quality JPEG previews from computational DNG RAW files (like Google Pixel 9 Pro) when pure Rust libraries fail.
- **Blocking progress modal**: Implemented a centered popup progress overlay with a spinner and real-time status counters ("Processing images: X of Y") that disables interaction during scans.
- **Tauri capability permissions**: Added `core:window:allow-set-title` to default capabilities config.

### Changed

- **Auto-rotation orientation correction**: Automatically decodes and rotates pixel data of thumbnails and previews based on EXIF orientation metadata, ensuring vertical JPEGs show correctly.
- **Window title versioning**: Dynamically sets the window title on startup with the package version number and local ISO build timestamp (for dev builds).
- **Physical cache cleanup**: Wipes the physical thumbnail cache files from disk when resetting the database catalog, resolving stale thumbnail display issues.
- **Side panels layout optimization**: Scaled down text size and compact padding in both folders and details side panels to prevent tag overflow wrapping.
- **Exposure details cleaning**: Stripped duplicate aperture string formatting from Lens Model, rounded focal lengths to unit integers (e.g. `18 mm`), and formatted shutter speed denominators as simplified whole integers (e.g. `1/473s`).
- **Release management skill**: Added a global workspace release manager procedure inside `~/.agents/skills/release-manager/SKILL.md`.

## 0.3.0-alpha.7 — 2026-07-17

### Added

- **Manual photo tags**: Add or remove tags in the Details panel. Changes are written to IPTC/XMP metadata and retained in the local catalogue.
- **Manual tag autocomplete**: The Details panel suggests previously used catalogue tags while adding tags to another photo, with click and keyboard selection support.

### Changed

- **Compact file facts**: Format and file size are presented together in the Details panel.

## 0.3.0-alpha.6 — 2026-07-17

### Added

- **Embedded star ratings**: Clicking stars in the details pane writes EXIF/XMP Rating tag metadata directly to the image file atomically, synchronizing ratings across machines.
- **Keyboard rating shortcuts**: Press keys `0` through `5` when viewing or highlighting a photo to set or clear (`0`) its rating.
- **System file reveal**: Right-click a thumbnail to reveal/show the file in Finder (macOS) or Explorer (Windows) with standard highlighting support.
- **Frontend error reporting**: Added window-level unhandled exception loggers writing to `frontend_error.log` for real-time frontend diagnostic support.

### Fixed

- **GPS coordinates formatting crash**: Resolved details panel rendering errors by replacing strict inequality checks with robust loose inequality checks for optional SQLite null columns.
- **Fallback metadata scanner**: Implemented a fallback rating reader using `exiftool-rs` to ensure ratings are read back correctly from formats (like PNG text metadata chunks) during scans and database resets.

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
