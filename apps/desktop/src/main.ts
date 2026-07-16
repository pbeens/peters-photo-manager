import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type AppSettings = {
  watchedFolders: string[];
};

type FolderEntry = { name: string; path: string; depth: number; containsImages: boolean };

type ImageFile = {
  name: string;
  path: string;
};

type ScanProgress = {
  scannedEntries: number;
  imagesFound: number;
};

type ScanResult = {
  files: ImageFile[];
  scannedEntries: number;
  unreadableEntries: number;
  errors: string[];
};

type Thumbnail = {
  name: string;
  sourcePath: string;
  thumbnailPath: string;
};

type ThumbnailProgress = {
  completed: number;
  total: number;
};

type ThumbnailResult = {
  thumbnails: Thumbnail[];
  errors: string[];
};

const app = document.querySelector<HTMLElement>("#app");
const ALL_FOLDERS = "__all_folders__";

let settings: AppSettings = { watchedFolders: [] };
let activeFolder: string | null = null;
let folderEntries: FolderEntry[] = [];
const expandedFolders = new Set<string>();
let scanResult: ScanResult | null = null;
let scanProgress: ScanProgress | null = null;
let isScanning = false;
let thumbnails: Thumbnail[] = [];
let thumbnailProgress: ThumbnailProgress | null = null;
let isGeneratingThumbnails = false;
let selectedThumbnailPath: string | null = null;
let thumbnailSize = 180;
let thumbnailCacheBytes = 0;
let includeSubfolders = true;
let hideEmptyFolders = true;
let scanRequestId = 0;
let viewerSourcePath: string | null = null;
let contextMenu: { sourcePath: string; x: number; y: number } | null = null;
let errorMessage = "";

type ImageMetadata = {
  fileSize: number;
  dimensions: [number, number];
  format: string;
  camera?: string;
  dateTaken?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  focalLength?: string;
  rating?: number;
  keywords?: string[];
};
let selectedMetadata: ImageMetadata | null = null;


function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentPath(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

function renderFolderTree(path: string, depth: number): string {
  const children = folderEntries.filter((entry) => parentPath(entry.path) === path && (!hideEmptyFolders || entry.containsImages));
  const expanded = expandedFolders.has(path);
  const active = activeFolder === path;
  return `<div class="tree-node"><button class="folder-item ${active ? "is-selected" : ""}" type="button" data-select-folder="${escapeHtml(path)}" style="padding-left:${10 + depth * 16}px"><span class="tree-toggle ${children.length ? "has-children" : ""}" data-toggle-folder="${escapeHtml(path)}">${children.length ? (expanded ? "⌄" : "›") : ""}</span><span>${escapeHtml(folderName(path))}</span></button>${expanded ? children.map((child) => renderFolderTree(child.path, depth + 1)).join("") : ""}</div>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}



async function selectAndLoadMetadata(path: string | null): Promise<void> {
  if (selectedThumbnailPath !== path) {
    selectedThumbnailPath = path;
    selectedMetadata = null;
    render();
    if (path) {
      try {
        selectedMetadata = await invoke<ImageMetadata>("get_image_metadata", { path });
      } catch (error) {
        console.error("Failed to load image metadata:", error);
      }
      render();
    }
  }
}

async function navigateToImage(index: number): Promise<void> {
  if (index >= 0 && index < thumbnails.length) {
    viewerSourcePath = thumbnails[index].sourcePath;
    render();
    await selectAndLoadMetadata(viewerSourcePath);
  }
}

function render(): void {
  if (!app) {
    return;
  }

  const selectedFolder = activeFolder;
  const isAllFolders = selectedFolder === ALL_FOLDERS;
  const selectedThumbnail = thumbnails.find((thumbnail) => thumbnail.sourcePath === selectedThumbnailPath);
  const currentIndex = viewerSourcePath ? thumbnails.findIndex((t) => t.sourcePath === viewerSourcePath) : -1;
  const files = scanResult?.files ?? [];
  const status = isScanning
    ? `Scanning folder entries… ${scanProgress?.imagesFound ?? 0} supported images found so far`
    : isGeneratingThumbnails
      ? `Generating thumbnails ${thumbnailProgress?.completed ?? 0} of ${thumbnailProgress?.total ?? 0}`
      : "";

  app.innerHTML = `
    <section class="shell">
      <aside class="sidebar" aria-label="Scanned folders">
        <div class="sidebar-heading">
          <p class="eyebrow">Peter’s Photo Manager</p>
          <h1>Folders</h1>
        </div>
        <button class="primary-button" id="add-folder" type="button">Add folder</button>
        <div class="folder-list">
          ${settings.watchedFolders.length ? `<button class="folder-item ${isAllFolders ? "is-selected" : ""}" type="button" data-select-folder="${ALL_FOLDERS}"><span class="tree-toggle">⌁</span><span>All Folders</span></button>` : ""}
          ${settings.watchedFolders.length ? settings.watchedFolders.map((folder) => renderFolderTree(folder, 0)).join("") : `<p class="empty-sidebar">No folders selected yet.</p>`}
        </div>
        <div class="sidebar-controls">
          <label class="sidebar-option"><input id="include-subfolders" type="checkbox" ${includeSubfolders ? "checked" : ""} /> Include subfolders</label>
          <label class="sidebar-option"><input id="hide-empty-folders" type="checkbox" ${hideEmptyFolders ? "checked" : ""} /> Hide folders with no images</label>
          ${
            selectedFolder && !isAllFolders
              ? `<button class="secondary-button" id="remove-folder" type="button">Remove folder</button>`
              : ""
          }
        </div>
      </aside>

      <section class="content">
        <header class="content-header">
          <div>
            <p class="eyebrow">Phase 2 · Thumbnail grid</p>
            <p class="path path-heading">${isAllFolders ? "All listed folders · subfolders included" : selectedFolder ? escapeHtml(selectedFolder) : "Select a folder to scan for JPEG, PNG, and WebP images."}</p>
          </div>
          <button class="secondary-button" id="rescan-folder" type="button" ${selectedFolder && !isScanning ? "" : "disabled"}>
            ${isScanning ? "Scanning…" : "Scan folder"}
          </button>
        </header>

        ${status ? `<div class="scan-status ${isScanning ? "is-scanning" : ""}"><span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(status)}</span></div>` : ""}

        ${errorMessage ? `<p class="error-message" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

        <section class="file-panel" aria-label="Supported photographs">
          ${
            !selectedFolder
              ? `<div class="empty-state"><h3>Start with a photo folder</h3><p>Your original files stay where they are. Thumbnails are stored separately in a local cache.</p></div>`
              : isScanning && files.length === 0
                ? `<div class="empty-state"><h3>Looking for images…</h3><p>The scan is running in the background, so the application remains responsive.</p></div>`
                : files.length === 0
                  ? `<div class="empty-state"><h3>No supported images found</h3><p>Try another folder, or add JPEG, PNG, or WebP files to this folder.</p></div>`
                  : isGeneratingThumbnails && thumbnails.length === 0
                    ? `<div class="empty-state"><h3>Preparing thumbnails…</h3><p>Images are processed in the background. You can still change or remove the selected folder.</p></div>`
                    : `<div class="thumbnail-grid" style="--thumbnail-size: ${thumbnailSize}px">
                      ${thumbnails
                        .map(
                          (thumbnail) => `<button class="thumbnail-card ${selectedThumbnailPath === thumbnail.sourcePath ? "is-selected" : ""}" type="button" data-thumbnail-path="${escapeHtml(thumbnail.sourcePath)}" title="${escapeHtml(thumbnail.name)}"><img src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}" alt="${escapeHtml(thumbnail.name)}" loading="lazy" /><span>${escapeHtml(thumbnail.name)}</span></button>`,
                        )
                        .join("")}
                    </div>`
          }
        </section>

        ${selectedFolder ? `<footer class="grid-footer"><span>${thumbnails.length} image thumbnail${thumbnails.length === 1 ? "" : "s"} ready · Cache ${formatBytes(thumbnailCacheBytes)}</span><label class="thumbnail-size-control" for="thumbnail-size"><span>Small</span><input id="thumbnail-size" type="range" min="120" max="300" step="10" value="${thumbnailSize}" /><span>Large</span><output id="thumbnail-size-value">${thumbnailSize}px</output></label></footer>` : ""}
        ${viewerSourcePath ? `
          <div class="viewer-backdrop" role="dialog" aria-modal="true">
            <button class="viewer-close" id="close-viewer" type="button">×</button>
            <button class="viewer-prev" id="viewer-prev" type="button" ${currentIndex <= 0 ? "disabled" : ""}>&lsaquo;</button>
            <figure class="viewer">
              <img src="${escapeHtml(convertFileSrc(viewerSourcePath))}" alt="${escapeHtml(folderName(viewerSourcePath))}" />
              <figcaption>
                <span>${escapeHtml(folderName(viewerSourcePath))}</span>
                <span>Original image (${currentIndex + 1} of ${thumbnails.length})</span>
              </figcaption>
            </figure>
            <button class="viewer-next" id="viewer-next" type="button" ${currentIndex === -1 || currentIndex >= thumbnails.length - 1 ? "disabled" : ""}>&rsaquo;</button>
          </div>
        ` : ""}
        ${contextMenu ? `<menu class="image-context-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px">${!viewerSourcePath ? `<li><button id="context-open-preview" type="button">Open preview</button></li>` : ""}<li><button id="context-copy-name" type="button">Copy filename</button></li><li><button id="context-copy-path" type="button">Copy complete path</button></li><li><button id="context-copy-image" type="button">Copy image</button></li></menu>` : ""}

        ${scanResult && scanResult.unreadableEntries > 0 ? `<p class="warning-message">${scanResult.unreadableEntries} unreadable item${scanResult.unreadableEntries === 1 ? " was" : "s were"} skipped safely.</p>` : ""}
      </section>

      <aside class="details-panel" aria-label="Photo details">
        <div class="sidebar-heading">
          <p class="eyebrow">Details</p>
        </div>
        ${
          selectedThumbnail
            ? `<div class="details-content">
                <div class="details-group">
                  <label>Filename</label>
                  <p>${escapeHtml(selectedThumbnail.name)}</p>
                </div>
                <div class="details-group">
                  <label>Path</label>
                  <p class="details-path" title="${escapeHtml(selectedThumbnail.sourcePath)}">${escapeHtml(selectedThumbnail.sourcePath)}</p>
                </div>
                ${
                  selectedMetadata
                    ? `<div class="details-group">
                        <label>Format</label>
                        <p>${escapeHtml(selectedMetadata.format)}</p>
                      </div>
                      <div class="details-group">
                        <label>File Size</label>
                        <p>${formatBytes(selectedMetadata.fileSize)}</p>
                      </div>
                      <div class="details-group">
                        <label>Dimensions</label>
                        <p>${selectedMetadata.dimensions[0]} × ${selectedMetadata.dimensions[1]} px</p>
                      </div>
                      ${selectedMetadata.camera ? `
                        <div class="details-group">
                          <label>Camera</label>
                          <p>${escapeHtml(selectedMetadata.camera)}</p>
                        </div>
                      ` : ""}
                      ${selectedMetadata.dateTaken ? `
                        <div class="details-group">
                          <label>Date Taken</label>
                          <p>${escapeHtml(selectedMetadata.dateTaken)}</p>
                        </div>
                      ` : ""}
                      ${(selectedMetadata.aperture || selectedMetadata.shutterSpeed || selectedMetadata.iso || selectedMetadata.focalLength) ? `
                        <div class="details-group">
                          <label>Exposure</label>
                          <p>${[
                            selectedMetadata.focalLength,
                            selectedMetadata.aperture,
                            selectedMetadata.shutterSpeed,
                            selectedMetadata.iso ? `ISO ${selectedMetadata.iso}` : ""
                          ].filter(Boolean).join(" · ")}</p>
                        </div>
                      ` : ""}
                      ${selectedMetadata.rating ? `
                        <div class="details-group">
                          <label>Rating</label>
                          <p class="details-rating">${"★".repeat(selectedMetadata.rating)}${"☆".repeat(5 - selectedMetadata.rating)}</p>
                        </div>
                      ` : ""}
                      ${selectedMetadata.keywords ? `
                        <div class="details-group">
                          <label>Keywords</label>
                          <div class="details-keywords">
                            ${selectedMetadata.keywords.map(kw => `<span class="keyword-tag">${escapeHtml(kw)}</span>`).join("")}
                          </div>
                        </div>
                      ` : ""}
                      `
                    : `<div class="details-loading">Loading metadata…</div>`
                }
              </div>`
            : `<div class="details-empty">
                <p>Select a photograph to view details.</p>
              </div>`
        }
      </aside>
    </section>
  `;

  document.querySelector("#add-folder")?.addEventListener("click", chooseFolder);
  document.querySelector("#remove-folder")?.addEventListener("click", removeFolder);
  document.querySelector<HTMLInputElement>("#include-subfolders")?.addEventListener("change", (event) => {
    includeSubfolders = (event.target as HTMLInputElement).checked;
    thumbnails = [];
    scanResult = null;
    void scanSelectedFolder();
  });
  document.querySelector<HTMLInputElement>("#hide-empty-folders")?.addEventListener("change", (event) => {
    hideEmptyFolders = (event.target as HTMLInputElement).checked;
    render();
  });
  document.querySelector("#rescan-folder")?.addEventListener("click", scanSelectedFolder);
  document.querySelector<HTMLInputElement>("#thumbnail-size")?.addEventListener("input", (event) => {
    thumbnailSize = Number((event.target as HTMLInputElement).value);
    document.querySelector<HTMLElement>(".thumbnail-grid")?.style.setProperty("--thumbnail-size", `${thumbnailSize}px`);
    const value = document.querySelector<HTMLOutputElement>("#thumbnail-size-value");
    if (value) {
      value.textContent = `${thumbnailSize}px`;
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-thumbnail-path]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.thumbnailPath ?? null;
      void selectAndLoadMetadata(path);
    });
    button.addEventListener("dblclick", () => {
      viewerSourcePath = button.dataset.thumbnailPath ?? null;
      render();
      if (viewerSourcePath) {
        void selectAndLoadMetadata(viewerSourcePath);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      contextMenu = { sourcePath: button.dataset.thumbnailPath ?? "", x: event.clientX, y: event.clientY };
      render();
    });
  });
  document.querySelector("#close-viewer")?.addEventListener("click", () => { viewerSourcePath = null; render(); });
  document.querySelector("#viewer-prev")?.addEventListener("click", () => {
    void navigateToImage(currentIndex - 1);
  });
  document.querySelector("#viewer-next")?.addEventListener("click", () => {
    void navigateToImage(currentIndex + 1);
  });
  document.querySelector("#context-open-preview")?.addEventListener("click", () => { viewerSourcePath = contextMenu?.sourcePath ?? null; contextMenu = null; render(); });
  document.querySelector("#context-copy-name")?.addEventListener("click", async () => {
    if (contextMenu) await navigator.clipboard.writeText(folderName(contextMenu.sourcePath));
    contextMenu = null;
    render();
  });
  document.querySelector("#context-copy-path")?.addEventListener("click", async () => {
    if (contextMenu) await navigator.clipboard.writeText(contextMenu.sourcePath);
    contextMenu = null;
    render();
  });
  document.querySelector("#context-copy-image")?.addEventListener("click", async () => {
    if (contextMenu) {
      const path = contextMenu.sourcePath;
      try {
        document.body.style.cursor = "wait";
        await invoke<void>("copy_image_to_clipboard", { path });
      } catch (error) {
        console.error("Failed to copy image to clipboard:", error);
      } finally {
        document.body.style.cursor = "default";
      }
    }
    contextMenu = null;
    render();
  });
  if (viewerSourcePath) {
    document.querySelector(".viewer img")?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      contextMenu = { sourcePath: viewerSourcePath ?? "", x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      render();
    });
  }
  document.querySelectorAll<HTMLElement>("[data-toggle-folder]").forEach((toggle) => toggle.addEventListener("click", (event) => { event.stopPropagation(); const path = toggle.dataset.toggleFolder; if (path) { expandedFolders.has(path) ? expandedFolders.delete(path) : expandedFolders.add(path); render(); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-select-folder]").forEach((button) => button.addEventListener("click", () => { activeFolder = button.dataset.selectFolder ?? null; scanResult = null; thumbnails = []; selectedThumbnailPath = null; selectedMetadata = null; void scanSelectedFolder(); render(); }));
}

async function chooseFolder(): Promise<void> {
  errorMessage = "";
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a photo folder to scan",
    defaultPath: activeFolder ?? undefined,
  });

  if (typeof selected !== "string") {
    return;
  }

  try {
    settings = await invoke<AppSettings>("add_watched_folder", { folder: selected });
    activeFolder = selected;
    expandedFolders.add(selected);
    await loadFolderTrees();
    scanResult = null;
    thumbnails = [];
    selectedThumbnailPath = null;
    selectedMetadata = null;
    await scanSelectedFolder();
  } catch (error) {
    errorMessage = String(error);
    render();
  }
}

async function removeFolder(): Promise<void> {
  try {
    const selectedFolder = activeFolder;
    if (!selectedFolder) return;
    const root = settings.watchedFolders.find((folder) => selectedFolder === folder || selectedFolder.startsWith(`${folder}/`)) ?? selectedFolder;
    settings = await invoke<AppSettings>("remove_watched_folder", { folder: root });
    activeFolder = settings.watchedFolders[0] ?? null;
    await loadFolderTrees();
    scanResult = null;
    thumbnails = [];
    scanProgress = null;
    selectedThumbnailPath = null;
    selectedMetadata = null;
    errorMessage = "";
  } catch (error) {
    errorMessage = String(error);
  }

  render();
}

async function scanSelectedFolder(): Promise<void> {
  const folderToScan = activeFolder;
  if (!folderToScan) {
    return;
  }
  const requestId = ++scanRequestId;

  selectedThumbnailPath = null;
  selectedMetadata = null;
  isScanning = true;
  scanProgress = { scannedEntries: 0, imagesFound: 0 };
  errorMessage = "";
  render();

  try {
    const result = folderToScan === ALL_FOLDERS
      ? await invoke<ScanResult>("scan_folders", { folders: settings.watchedFolders })
      : await invoke<ScanResult>("scan_folder", { folder: folderToScan, recursive: includeSubfolders });
    if (requestId !== scanRequestId) return;
    scanResult = result;
    await generateThumbnails(result, requestId);
  } catch (error) {
    if (requestId !== scanRequestId) return;
    scanResult = null;
    errorMessage = String(error);
  } finally {
    if (requestId === scanRequestId) { isScanning = false; render(); }
  }
}

async function loadFolderTrees(): Promise<void> {
  const trees = await Promise.all(settings.watchedFolders.map((folder) => invoke<FolderEntry[]>("discover_folders", { folder })));
  folderEntries = trees.flat();
}

async function generateThumbnails(scan: ScanResult, requestId: number): Promise<void> {
  isGeneratingThumbnails = true;
  thumbnailProgress = { completed: 0, total: scan.files.length };
  render();

  try {
    const result = await invoke<ThumbnailResult>("generate_thumbnails", { files: scan.files });
    if (requestId !== scanRequestId) return;
    thumbnails = result.thumbnails;
    await refreshCacheSize();
    if (result.errors.length > 0) {
      errorMessage = `${result.errors.length} image${result.errors.length === 1 ? " could" : "s could"} not be thumbnailed.`;
    }
  } catch (error) {
    if (requestId !== scanRequestId) return;
    errorMessage = String(error);
  } finally {
    if (requestId === scanRequestId) { isGeneratingThumbnails = false; render(); }
  }
}

async function refreshCacheSize(): Promise<void> {
  try {
    thumbnailCacheBytes = await invoke<number>("thumbnail_cache_size");
  } catch {
    thumbnailCacheBytes = 0;
  }
}

async function initialize(): Promise<void> {
  try {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("click", () => {
      if (contextMenu) { contextMenu = null; render(); }
    });
    document.addEventListener("keydown", (event) => {
      if (viewerSourcePath) {
        if (event.key === "Escape") {
          viewerSourcePath = null;
          render();
        } else if (event.key === "ArrowLeft") {
          const currentIndex = thumbnails.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex > 0) {
            void navigateToImage(currentIndex - 1);
          }
        } else if (event.key === "ArrowRight") {
          const currentIndex = thumbnails.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex >= 0 && currentIndex < thumbnails.length - 1) {
            void navigateToImage(currentIndex + 1);
          }
        }
      }
    });
    await listen<ScanProgress>("scan-progress", (event) => {
      scanProgress = event.payload;
      if (isScanning) {
        render();
      }
    });
    await listen<ThumbnailProgress>("thumbnail-progress", (event) => {
      thumbnailProgress = event.payload;
      if (isGeneratingThumbnails) {
        render();
      }
    });
    settings = await invoke<AppSettings>("load_settings");
    await refreshCacheSize();
    await loadFolderTrees();
    render();

    if (settings.watchedFolders.length) {
      activeFolder = ALL_FOLDERS;
      settings.watchedFolders.forEach((folder) => expandedFolders.add(folder));
      await scanSelectedFolder();
    }
  } catch (error) {
    errorMessage = String(error);
    render();
  }
}

void initialize();
