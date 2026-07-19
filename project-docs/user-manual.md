# User Manual

## Current Version

`0.3.0-alpha.12` is an early testing build for macOS. It supports local folder browsing, subfolder creation, drag-and-drop file organization, instant startup via a persistent SQLite database catalogue, background synchronization, responsive thumbnail selection, auto-oriented camera RAW formats (.NEF, .CR2, .ARW, .DNG, .ORF, .RW2, .PEF, .RAF) with high-fidelity background raw sensor rendering (via sips on macOS / quickraw on Windows), cached-first original image previews with sequential navigation, context menu clipboard actions, and a Details panel with file facts, ratings, manual tags, and available EXIF information.

## Start the Application

From the project root, run:

```bash
cd apps/desktop
npm run tauri dev
```

Use `Control-C` in Terminal to stop the development application.

## Add Folders

1. Open the **••• Folder options** menu and select **Add folder**. The same menu contains **Reset & Rescan** after folders have been added.
2. Choose a local folder.
3. The folder and relevant subfolders appear in the sidebar.
4. Select a folder to scan and show its images.

Added folders are saved locally. Removing a folder from the sidebar removes only the application’s saved reference; it never changes the files on disk.

## Manage and Organize Folders

### Create Subfolder
1. Right-click on any folder in the left sidebar tree.
2. Select **Create subfolder** from the context menu.
3. Enter the name of the new subfolder in the dialog modal and click **Create** (or press Enter).
4. The folder will be created on disk and will instantly appear in the sidebar. It will remain open and visible even if it does not contain any images yet, regardless of your "Hide folders with no images" settings.

### Move Photos (Drag and Drop)
1. Select one or more photos in the thumbnail grid.
2. Click and drag the selection over any folder in the sidebar tree. You'll see a dashed border highlighting the active target folder and a compact badge indicating the number of dragged photos under the cursor.
3. Release the mouse button to drop the images. They will be moved on disk and the catalogue database will update automatically.

## Browse Folders

- Select **All Folders** to combine all listed root folders. Its arrow collapses the hierarchy back to the visible top-level folder rows or expands those rows again, without changing the active All Folders view. This view always includes subfolders.
- Use the arrows beside folder names to expand or collapse their paths.
- Right-click a folder to open it in Finder on macOS or Explorer on Windows, copy its path, or remove that exact folder from the app. Removing a nested folder excludes it from future scans while leaving its parent and sibling folders available.
- Folder views always include images in their subfolders. Open the **••• Folder options** menu and use **Hide folders with no images** to choose whether empty folders remain visible as destinations for later drag-and-drop work.

## Browse Thumbnails

The grid supports JPEG, PNG, and WebP files.

- Drag the **Thumbnail size** slider to resize the grid; your setting is restored the next time the app opens.
- Use the **Sorted by** control beneath the thumbnail grid to sort by file name, date taken, date modified, or file size. Its adjacent toggle switches between ascending and descending order. Both sort choices are restored the next time the app opens.
- Click a thumbnail to select it and immediately show its properties and rating in the Details panel.
- **Multi-Selection**: Hold `Command` (macOS) or `Control` (Windows) to select multiple photos in the grid. Hold `Shift` to select a range of photos. When multiple photos are selected, the Details panel displays their aggregated info (e.g. combined file size, shared format, shared tags, and uniform ratings). You can edit ratings or add/remove tags in bulk for all selected photos at once. Autocomplete suggestions will filter based on the tags already shared by all selected photos.
- **Star Ratings**: Click any of the 5 stars in the Details panel to assign a star rating to the photo. Click the `×` button beside the stars to clear the rating (make it unrated). Ratings are written directly to the image file's metadata (`IFD0:Rating` / `XMP:Rating`), making them fully persistent and synchronized across devices.
- **Keyboard Rating Shortcuts**: Press keys `0` through `5` on your keyboard when highlighting or viewing a photo to immediately set its rating (pressing `0` clears it).
- **Manual Tags**: Type a tag in the Details panel and press **Enter** or comma to add it. Previously used tags are suggested as you type and can be selected with click, **Enter**, **Tab**, or the arrow keys.
- Double-click a thumbnail to open it. A large cached preview appears first; the original file replaces it when ready. The viewer fits the complete image within the available window. The caption reports if the original could not be loaded.
- With the viewer closed, use the **Arrow keys** to move the grid selection and **Enter** or **Space** to open the selected image. Up and Down move by a full grid row.
- Press **Escape** or select **×** to close the viewer.
- Browse through photographs sequentially using the **Left/Right Arrow** keys on your keyboard, or the `<` and `>` button overlays on the screen.

The bottom panel shows the image total, current thumbnail-cache size, saved sort controls, and the saved thumbnail-size control.

## Search Photos

The search engine at the top right of the thumbnail grid filters photos in real-time. Typing search terms filters the photos currently visible (either in the selected folder or in All Folders).

- **Free-Text Search**: Type any words to match any metadata field (filename, format, camera, lens, tags, or location). Multiple terms are combined with **AND** logic (e.g., `Nikon puffin`).
- **Advanced Filter Keys**: Restrict searches to specific fields using colon-separated key-value prefixes:
  - `tag:value` / `keyword:value` (e.g., `tag:nature`) — matches keywords/tags.
  - `camera:value` (e.g., `camera:Zf`) — matches camera model.
  - `lens:value` (e.g., `lens:180`) — matches lens model.
  - `location:value` (e.g., `location:Elliston`) — matches city, state, or country.
  - `rating:expression` (e.g. `rating:5`, comparison `rating:>2`, range `rating:3-5` or `rating:3to5`, list `rating:2,3`, or `rating:0` for unrated) — matches star rating expressions.
  - `format:value` (e.g., `format:raw` or `format:jpeg`) — matches file format or RAW extensions.
- You can combine multiple filter keys and free-text keywords (e.g., `camera:Nikon tag:nature puffin`). Press **Escape** or click the clear (`×`) button to reset the search.

## Context Menu

Right-click a thumbnail for application-controlled options:

- **Open preview** (thumbnails only)
- **Open in Finder** (macOS) or **Open in Explorer** (Windows) opens the photo's containing folder and highlights/selects the file in the file manager.
- **Copy filename**
- **Copy complete path**
- **Copy image** (copies actual image data to system clipboard)
- **Remove or delete…** opens a required choice: **Remove from catalogue** hides the photo from the app while leaving the original file on disk; **Delete from disk…** permanently deletes the original file and its catalogue entry.

With a thumbnail selected, **Delete** (or **Backspace** on macOS) opens the same required choice. Press **Escape** or select **Cancel** to close it without changing anything.

The browser-style context menu is intentionally disabled.

## Photo Details Panel

Select a photograph in the grid to display its properties in the right-side Details panel:

- Filename, path, combined format and file size, and image dimensions are displayed from the local catalogue immediately.
- Star rating, manual tags, and location coordinates (latitude/longitude) are also displayed. Ratings and tags are editable. Clicking the location coordinates opens the position on Google Maps in your default browser.
- When embedded EXIF is available, camera model/make, lens model, and capture date are also shown.
- Photos without embedded EXIF or star ratings explicitly state that no embedded photo metadata is available.

## Cache and Privacy

Original photographs remain in their existing folders. Generated thumbnails are stored in the application cache, not beside originals.

On macOS, the current cache location is:

```text
~/Library/Caches/com.peterbeens.photomanager/thumbnails/
```

The cache can be regenerated. A cache-clear command will be added in a later phase.

## Feedback and Issues

If you find bugs or have feature requests, please submit them on the [GitHub Issues](https://github.com/pbeens/peters-photo-manager/issues) page. You can also click the **Submit Feedback** link directly in the app's sidebar. The Details panel includes a **Buy me a coffee** link for optional support.

## Current Limitations

- The application has no albums, file moving, export, or AI features yet.
- Large folders may take time to scan and thumbnail on their first run; the grid, Details panel, and viewer remain available while this work runs.
- The application has been manually tested on macOS; Windows testing is still required.
