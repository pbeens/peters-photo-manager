# User Manual

## Current Version

`0.3.0-alpha.5` is an early testing build for macOS. It supports local folder browsing, instant startup via a persistent SQLite database catalogue, background synchronization, responsive thumbnail selection, cached-first original image previews with sequential navigation, context menu clipboard actions, and a Details panel with file facts and available EXIF information.

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

## Browse Folders

- Select **All Folders** to combine all listed root folders. Its arrow collapses the hierarchy back to the visible top-level folder rows or expands those rows again, without changing the active All Folders view. This view always includes subfolders.
- Use the arrows beside folder names to expand or collapse their paths.
- Right-click a folder to open it in Finder on macOS or Explorer on Windows, copy its path, or remove that exact folder from the app. Removing a nested folder excludes it from future scans while leaving its parent and sibling folders available.
- Folder views always include images in their subfolders. Open the **••• Folder options** menu and use **Hide folders with no images** to choose whether empty folders remain visible as destinations for later drag-and-drop work.

## Browse Thumbnails

The grid supports JPEG, PNG, and WebP files.

- Drag the **Thumbnail size** slider to resize the grid; your setting is restored the next time the app opens.
- Use the **Sorted by** control beneath the thumbnail grid to sort by file name, date taken, date modified, or file size. Its adjacent toggle switches between ascending and descending order. Both sort choices are restored the next time the app opens.
- Click a thumbnail to select it and immediately show its filename, path, format, size, and dimensions in the Details panel.
- Double-click a thumbnail to open it. A large cached preview appears first; the original file replaces it when ready. The viewer fits the complete image within the available window. The caption reports if the original could not be loaded.
- With the viewer closed, use the **Arrow keys** to move the grid selection and **Enter** or **Space** to open the selected image. Up and Down move by a full grid row.
- Press **Escape** or select **×** to close the viewer.
- Browse through photographs sequentially using the **Left/Right Arrow** keys on your keyboard, or the `<` and `>` button overlays on the screen.

The bottom panel shows the image total, current thumbnail-cache size, saved sort controls, and the saved thumbnail-size control.

## Context Menu

Right-click a thumbnail for application-controlled options:

- **Open preview** (thumbnails only)
- **Copy filename**
- **Copy complete path**
- **Copy image** (copies actual image data to system clipboard)
- **Remove or delete…** opens a required choice: **Remove from catalogue** hides the photo from the app while leaving the original file on disk; **Delete from disk…** permanently deletes the original file and its catalogue entry.

With a thumbnail selected, **Delete** (or **Backspace** on macOS) opens the same required choice. Press **Escape** or select **Cancel** to close it without changing anything.

The browser-style context menu is intentionally disabled.

## Photo Details Panel

Select a photograph in the grid to display its properties in the right-side Details panel:

- Filename, path, format, file size, and image dimensions are displayed from the local catalogue immediately.
- When embedded EXIF is available, camera model/make, lens model, and capture date are also shown.
- Photos without embedded EXIF explicitly state that no embedded photo metadata is available.

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

- The application has no rating/keyword editing, albums, file moving, export, or AI features yet.
- Large folders may take time to scan and thumbnail on their first run; the grid, Details panel, and viewer remain available while this work runs.
- The application has been manually tested on macOS; Windows testing is still required.
