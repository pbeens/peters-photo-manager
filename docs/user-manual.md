# User Manual

## Current Version

`0.3.0-alpha.1` is an early testing build for macOS. It supports local folder browsing and cached thumbnails. It does not yet edit, move, delete, export, tag, or catalogue photographs.

## Start the Application

From the project root, run:

```bash
cd apps/desktop
npm run tauri dev
```

Use `Control-C` in Terminal to stop the development application.

## Add Folders

1. Select **Add folder** in the sidebar.
2. Choose a local folder.
3. The folder and relevant subfolders appear in the sidebar.
4. Select a folder to scan and show its images.

Added folders are saved locally. Removing a folder from the sidebar removes only the application’s saved reference; it never changes the files on disk.

## Browse Folders

- Select **All Folders** to combine all listed root folders. This view always includes subfolders.
- Use the arrows beside folder names to expand or collapse their paths.
- Select **Include subfolders** to include images below the active folder. Clear it to show only images directly in that folder.
- Select **Hide folders with no images** to keep the tree focused on folders with supported images in their path.

## Browse Thumbnails

The grid supports JPEG, PNG, and WebP files.

- Drag the **Thumbnail size** slider to resize the grid.
- Click a thumbnail to select it.
- Double-click a thumbnail to open a larger cached preview.
- Press **Escape** or select **×** to close the preview.

The bottom panel shows the number of ready thumbnails and the size of the local thumbnail cache.

## Context Menu

Right-click a thumbnail for application-controlled options:

- **Open preview**
- **Copy filename**

The browser-style context menu is intentionally disabled.

## Cache and Privacy

Original photographs remain in their existing folders. Generated thumbnails are stored in the application cache, not beside originals.

On macOS, the current cache location is:

```text
~/Library/Caches/com.peterbeens.photomanager/thumbnails/
```

The cache can be regenerated. A cache-clear command will be added in a later phase.

## Current Limitations

- The preview is a cached thumbnail, not a full-resolution viewer.
- The application has no metadata panel, ratings, tags, albums, file operations, editing, export, or AI features yet.
- Large folders may take time to scan and thumbnail.
- The application has been manually tested on macOS; Windows testing is still required.
