import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";

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

type IndexedFile = {
  path: string;
  name: string;
  fileSize: number;
  format: string;
  width: number;
  height: number;
  camera?: string;
  lens?: string;
  latitude?: number;
  longitude?: number;
  gpsAltitude?: number;
  locationCountry?: string;
  locationState?: string;
  locationCity?: string;
  dateTaken?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  focalLength?: string;
  rating?: number;
  keywords?: string[];
  thumbnailPath?: string;
  lastModified: number;
  status: string;
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
let hideEmptyFolders = true;
let scanRequestId = 0;
let viewerSourcePath: string | null = null;
let contextMenu: { sourcePath: string; x: number; y: number } | null = null;
let errorMessage = "";
let progressRenderTimer: number | null = null;
let metadataError: string | null = null;
const catalogMetadata = new Map<string, ImageMetadata>();

type ImageMetadata = {
  fileSize: number;
  dimensions: [number, number];
  format: string;
  camera?: string;
  lens?: string;
  latitude?: number;
  longitude?: number;
  gpsAltitude?: number;
  locationCountry?: string;
  locationState?: string;
  locationCity?: string;
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

function scheduleProgressRender(): void {
  if (progressRenderTimer !== null) {
    return;
  }

  progressRenderTimer = window.setTimeout(() => {
    progressRenderTimer = null;
    updateProgressStatus();
  }, 100);
}

function hasEmbeddedMetadata(metadata: ImageMetadata): boolean {
  return Boolean(
    metadata.camera
      || metadata.lens
      || metadata.latitude !== undefined
      || metadata.longitude !== undefined
      || metadata.dateTaken
      || metadata.aperture
      || metadata.shutterSpeed
      || metadata.iso !== undefined
      || metadata.focalLength
      || metadata.rating !== undefined
      || metadata.keywords?.length,
  );
}



function renderDetailsContent(): string {
  const selectedThumbnail = thumbnails.find((thumbnail) => thumbnail.sourcePath === selectedThumbnailPath);
  if (!selectedThumbnail) {
    return `<div class="sidebar-heading"><p class="eyebrow">Details</p></div><div class="details-empty"><p>Select a photograph to view details.</p></div>`;
  }

  const metadata = selectedMetadata;
  return `<div class="sidebar-heading"><p class="eyebrow">Details</p></div><div class="details-content">
    <div class="details-group"><label>Filename</label><p>${escapeHtml(selectedThumbnail.name)}</p></div>
    <div class="details-group"><label>Path</label><p class="details-path" title="${escapeHtml(selectedThumbnail.sourcePath)}">${escapeHtml(selectedThumbnail.sourcePath)}</p></div>
    ${metadata ? `<div class="details-group"><label>Format</label><p>${escapeHtml(metadata.format)}</p></div>
      <div class="details-group"><label>File Size</label><p>${formatBytes(metadata.fileSize)}</p></div>
      <div class="details-group"><label>Dimensions</label><p>${metadata.dimensions[0]} × ${metadata.dimensions[1]} px</p></div>
      ${!hasEmbeddedMetadata(metadata) ? `<div class="details-loading">No embedded photo metadata is available.</div>` : ""}
      ${metadata.camera ? `<div class="details-group"><label>Camera</label><p>${escapeHtml(metadata.camera)}</p></div>` : ""}
      ${metadata.lens ? `<div class="details-group"><label>Lens</label><p>${escapeHtml(metadata.lens)}</p></div>` : ""}
      ${metadata.dateTaken ? `<div class="details-group"><label>Date Taken</label><p>${escapeHtml(metadata.dateTaken)}</p></div>` : ""}`
      : `<div class="details-loading">${escapeHtml(metadataError ?? "Loading photo details…")}</div>`}
  </div>`;
}

function updateSelectionUI(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-thumbnail-path]").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.thumbnailPath === selectedThumbnailPath);
  });
  const detailsPanel = document.querySelector<HTMLElement>("#details-panel");
  if (detailsPanel) {
    detailsPanel.innerHTML = renderDetailsContent();
  }
}

function updateProgressStatus(): void {
  const statusElement = document.querySelector<HTMLElement>("#scan-status");
  if (!statusElement) {
    return;
  }
  const status = isScanning
    ? `Scanning folder entries… ${scanProgress?.imagesFound ?? 0} supported images found so far`
    : isGeneratingThumbnails
      ? `Generating thumbnails ${thumbnailProgress?.completed ?? 0} of ${thumbnailProgress?.total ?? 0}`
      : "";
  statusElement.hidden = !status;
  statusElement.classList.toggle("is-scanning", isScanning);
  statusElement.querySelector("span:last-child")!.textContent = status;
}

async function selectAndLoadMetadata(path: string | null): Promise<void> {
  if (selectedThumbnailPath === path) {
    return;
  }

  selectedThumbnailPath = path;
  selectedMetadata = path ? catalogMetadata.get(path) ?? null : null;
  metadataError = null;
  updateSelectionUI();

  if (!path || selectedMetadata) {
    return;
  }

  try {
    selectedMetadata = await invoke<ImageMetadata>("get_image_metadata", { path });
  } catch (error) {
    console.error("Failed to load image metadata:", error);
    metadataError = "Photo details could not be loaded.";
  }
  if (selectedThumbnailPath === path) {
    updateSelectionUI();
  }
}

async function navigateToImage(index: number): Promise<void> {
  if (index >= 0 && index < thumbnails.length) {
    viewerSourcePath = thumbnails[index].sourcePath;
    selectedThumbnailPath = viewerSourcePath;
    selectedMetadata = catalogMetadata.get(viewerSourcePath) ?? null;
    metadataError = null;
    updateSelectionUI();
    updateViewerUI();
  }
}

function updateViewerUI(): void {
  if (!viewerSourcePath) {
    return;
  }
  const viewerImage = document.querySelector<HTMLImageElement>("#viewer-image");
  if (!viewerImage) {
    render();
    window.requestAnimationFrame(updateViewerUI);
    return;
  }

  const currentIndex = thumbnails.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
  const thumbnail = thumbnails[currentIndex];
  if (!thumbnail) {
    return;
  }
  const path = viewerSourcePath;
  const cachedSource = convertFileSrc(thumbnail.thumbnailPath);
  const previewImage = document.querySelector<HTMLImageElement>("#viewer-preview");
  if (previewImage) {
    previewImage.src = cachedSource;
    previewImage.alt = thumbnail.name;
  }
  viewerImage.classList.remove("is-loaded");
  viewerImage.dataset.sourcePath = path;
  viewerImage.src = convertFileSrc(path);
  viewerImage.alt = thumbnail.name;
  document.querySelector<HTMLElement>("#viewer-name")!.textContent = thumbnail.name;
  document.querySelector<HTMLElement>("#viewer-position")!.textContent = `Original image (${currentIndex + 1} of ${thumbnails.length})`;
  document.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Loading original image…";
  const previousButton = document.querySelector<HTMLButtonElement>("#viewer-prev");
  const nextButton = document.querySelector<HTMLButtonElement>("#viewer-next");
  if (previousButton) previousButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex >= thumbnails.length - 1;

  const markOriginalLoaded = () => {
    if (viewerSourcePath === path && viewerImage.dataset.sourcePath === path) {
      viewerImage.classList.add("is-loaded");
      document.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Original image";
    }
  };
  viewerImage.onload = markOriginalLoaded;
  viewerImage.onerror = () => {
    if (viewerSourcePath === path && viewerImage.dataset.sourcePath === path) {
      document.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Original image could not load; showing cached preview.";
    }
  };
  if (viewerImage.complete && viewerImage.naturalWidth > 0) {
    markOriginalLoaded();
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
  const selectedHasEmbeddedMetadata = selectedMetadata ? hasEmbeddedMetadata(selectedMetadata) : false;
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
          <label class="sidebar-option"><input id="hide-empty-folders" type="checkbox" ${hideEmptyFolders ? "checked" : ""} /> Hide folders with no images</label>
          ${
            selectedFolder && !isAllFolders
              ? `<button class="secondary-button" id="remove-folder" type="button">Remove folder</button>`
              : ""
          }
          <div class="sidebar-footer" style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #3d3d37; text-align: center; display: flex; flex-direction: column; gap: 8px;">
            <a href="https://github.com/pbeens/peters-photo-manager/issues" target="_blank" rel="noopener noreferrer" style="color: #c9a873; text-decoration: none; font-size: 0.85rem; font-weight: 650; display: inline-block; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Submit Feedback</a>
            ${settings.watchedFolders.length ? `<button id="reset-catalogue" type="button" title="Wipe the database and regenerate all thumbnails from scratch" style="background: #7a2020; color: #ffd0d0; border: 1px solid #a03030; border-radius: 6px; padding: 5px 10px; font-size: 0.78rem; cursor: pointer; font-weight: 650;">⚠ Reset & Rescan</button>` : ""}
          </div>
        </div>
      </aside>

      <section class="content">
        <header class="content-header">
          <div>
            <p class="eyebrow">Phase 2 · Thumbnail grid</p>
            <p class="path path-heading">${isAllFolders ? "All listed folders · subfolders included" : selectedFolder ? escapeHtml(selectedFolder) : "Select a folder to scan for JPEG, PNG, and WebP images."}</p>
          </div>
        </header>

        <div class="scan-status ${isScanning ? "is-scanning" : ""}" id="scan-status" ${status ? "" : "hidden"}><span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(status)}</span></div>

        ${errorMessage ? `<p class="error-message" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

        <section class="file-panel" aria-label="Supported photographs">
          ${
            !selectedFolder
              ? `<div class="empty-state"><h3>Start with a photo folder</h3><p>Your original files stay where they are. Thumbnails are stored separately in a local cache.</p></div>`
              : isScanning && files.length === 0 && thumbnails.length === 0
                ? `<div class="empty-state"><h3>Looking for images…</h3><p>The scan is running in the background, so the application remains responsive.</p></div>`
                : files.length === 0 && thumbnails.length === 0
                  ? `<div class="empty-state"><h3>No supported images found</h3><p>Try another folder, or add JPEG, PNG, or WebP files to this folder.</p></div>`
                  : isGeneratingThumbnails && thumbnails.length === 0
                    ? `<div class="empty-state"><h3>Preparing thumbnails…</h3><p>Images are processed in the background. You can still change or remove the selected folder.</p></div>`
                    : `<div class="thumbnail-grid" style="--thumbnail-size: ${thumbnailSize}px">
                      ${thumbnails
                        .map(
                          (thumbnail, index) => `<button class="thumbnail-card ${selectedThumbnailPath === thumbnail.sourcePath ? "is-selected" : ""}" type="button" data-thumbnail-index="${index}" data-thumbnail-path="${escapeHtml(thumbnail.sourcePath)}" title="${escapeHtml(thumbnail.name)}"><img src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}" alt="${escapeHtml(thumbnail.name)}" loading="lazy" /><span>${escapeHtml(thumbnail.name)}</span></button>`,
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
              <div class="viewer-media">
                <img id="viewer-preview" src="${escapeHtml(convertFileSrc(thumbnails[currentIndex]?.thumbnailPath ?? viewerSourcePath))}" alt="${escapeHtml(folderName(viewerSourcePath))}" />
                <img id="viewer-image" src="${escapeHtml(convertFileSrc(viewerSourcePath))}" alt="${escapeHtml(folderName(viewerSourcePath))}" />
              </div>
              <figcaption>
                <span id="viewer-name">${escapeHtml(folderName(viewerSourcePath))}</span>
                <span id="viewer-position">Original image (${currentIndex + 1} of ${thumbnails.length})</span>
                <span id="viewer-load-state">Loading original image…</span>
              </figcaption>
            </figure>
            <button class="viewer-next" id="viewer-next" type="button" ${currentIndex === -1 || currentIndex >= thumbnails.length - 1 ? "disabled" : ""}>&rsaquo;</button>
          </div>
        ` : ""}
        ${contextMenu ? `<menu class="image-context-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px">${!viewerSourcePath ? `<li><button id="context-open-preview" type="button">Open preview</button></li>` : ""}<li><button id="context-copy-name" type="button">Copy filename</button></li><li><button id="context-copy-path" type="button">Copy complete path</button></li><li><button id="context-copy-image" type="button">Copy image</button></li></menu>` : ""}

        ${scanResult && scanResult.unreadableEntries > 0 ? `<p class="warning-message">${scanResult.unreadableEntries} unreadable item${scanResult.unreadableEntries === 1 ? " was" : "s were"} skipped safely.</p>` : ""}
      </section>

      <aside class="details-panel" id="details-panel" aria-label="Photo details">
        ${selectedThumbnail
            ? `<div class="sidebar-heading"><p class="eyebrow">Details</p></div><div class="details-content">
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
                      ${!selectedHasEmbeddedMetadata ? `<div class="details-loading">No embedded photo metadata is available.</div>` : ""}
                      ${selectedMetadata.camera ? `
                        <div class="details-group">
                          <label>Camera</label>
                          <p>${escapeHtml(selectedMetadata.camera)}</p>
                        </div>
                      ` : ""}
                      ${selectedMetadata.lens ? `
                        <div class="details-group">
                          <label>Lens</label>
                          <p>${escapeHtml(selectedMetadata.lens)}</p>
                        </div>
                      ` : ""}
                      ${(selectedMetadata.locationCountry || selectedMetadata.locationState || selectedMetadata.locationCity || selectedMetadata.latitude !== undefined) ? `
                        <div class="details-group">
                          <label>Location</label>
                          <p>${[
                            [
                              selectedMetadata.locationCity,
                              selectedMetadata.locationState,
                              selectedMetadata.locationCountry
                            ].filter(Boolean).join(", "),
                            selectedMetadata.latitude !== undefined && selectedMetadata.longitude !== undefined
                              ? `${selectedMetadata.latitude.toFixed(4)}, ${selectedMetadata.longitude.toFixed(4)}`
                              : ""
                          ].filter(Boolean).join(" · ")}</p>
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
                    : `<div class="details-loading">${escapeHtml(metadataError ?? "Loading photo details…")}</div>`
                }
              </div>`
            : `<div class="sidebar-heading"><p class="eyebrow">Details</p></div><div class="details-empty">
                <p>Select a photograph to view details.</p>
              </div>`
        }
      </aside>
    </section>
  `;

  document.querySelector("#add-folder")?.addEventListener("click", chooseFolder);
  document.querySelector("#remove-folder")?.addEventListener("click", removeFolder);
  document.querySelector("#reset-catalogue")?.addEventListener("click", async () => {
    const confirmed = await ask(
      "This will wipe the entire catalogue and thumbnail records, then rescan all folders from scratch.\n\nCached thumbnail image files will remain on disk.\n\nContinue?",
      { title: "⚠ Reset & Rescan", kind: "warning" }
    );
    if (!confirmed) return;
    try {
      await invoke<void>("reset_catalogue");
      scanResult = null;
      thumbnails = [];
      selectedThumbnailPath = null;
      selectedMetadata = null;
      errorMessage = "";
      activeFolder = settings.watchedFolders.length ? ALL_FOLDERS : null;
      render();
      if (activeFolder) void scanSelectedFolder();
    } catch (error) {
      errorMessage = String(error);
      render();
    }
  });
  document.querySelector<HTMLInputElement>("#hide-empty-folders")?.addEventListener("change", (event) => {
    hideEmptyFolders = (event.target as HTMLInputElement).checked;
    render();
  });
  document.querySelector<HTMLInputElement>("#thumbnail-size")?.addEventListener("input", (event) => {
    thumbnailSize = Number((event.target as HTMLInputElement).value);
    document.querySelector<HTMLElement>(".thumbnail-grid")?.style.setProperty("--thumbnail-size", `${thumbnailSize}px`);
    const value = document.querySelector<HTMLOutputElement>("#thumbnail-size-value");
    if (value) {
      value.textContent = `${thumbnailSize}px`;
    }
  });
  document.querySelector("#close-viewer")?.addEventListener("click", () => { viewerSourcePath = null; render(); });
  document.querySelector(".viewer-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      viewerSourcePath = null;
      render();
    }
  });
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
  document.querySelectorAll<HTMLButtonElement>("[data-select-folder]").forEach((button) => button.addEventListener("click", () => { activeFolder = button.dataset.selectFolder ?? null; scanResult = null; thumbnails = []; selectedThumbnailPath = null; selectedMetadata = null; render(); void scanSelectedFolder(); }));
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

async function loadCatalogFiles(folder: string | null): Promise<void> {
  try {
    const catalogFiles = await invoke<IndexedFile[]>("get_catalogued_files", {
      folder: folder ?? undefined,
    });
    catalogMetadata.clear();
    for (const file of catalogFiles) {
      catalogMetadata.set(file.path, {
        fileSize: file.fileSize,
        dimensions: [file.width, file.height],
        format: file.format,
        camera: file.camera,
        lens: file.lens,
        latitude: file.latitude,
        longitude: file.longitude,
        gpsAltitude: file.gpsAltitude,
        locationCountry: file.locationCountry,
        locationState: file.locationState,
        locationCity: file.locationCity,
        dateTaken: file.dateTaken,
        aperture: file.aperture,
        shutterSpeed: file.shutterSpeed,
        iso: file.iso,
        focalLength: file.focalLength,
        rating: file.rating,
        keywords: file.keywords,
      });
    }
    thumbnails = catalogFiles.map((file) => ({
      name: file.name,
      sourcePath: file.path,
      thumbnailPath: file.thumbnailPath ?? "",
    }));
  } catch (error) {
    console.error("Failed to load catalog files:", error);
  }
}

async function scanSelectedFolder(): Promise<void> {
  const folderToScan = activeFolder;
  if (!folderToScan) {
    return;
  }
  const requestId = ++scanRequestId;

  selectedThumbnailPath = null;
  selectedMetadata = null;

  // 1. Instantly load catalogued files from SQLite and render
  await loadCatalogFiles(folderToScan);
  errorMessage = "";
  render();

  // 2. Perform background sync (scanning + thumbnailing on the fly)
  isScanning = true;
  scanProgress = { scannedEntries: 0, imagesFound: 0 };
  render();

  try {
    const result = folderToScan === ALL_FOLDERS
      ? await invoke<ScanResult>("scan_folders", { folders: settings.watchedFolders })
      : await invoke<ScanResult>("scan_folder", { folder: folderToScan });

    if (requestId !== scanRequestId) return;
    scanResult = result;

    // 3. Re-load from catalog to get new thumbnail paths & metadata
    await loadCatalogFiles(folderToScan);
    await refreshCacheSize();

    if (result.errors.length > 0) {
      errorMessage = `${result.errors.length} error(s) occurred during background scan.`;
    }
  } catch (error) {
    if (requestId !== scanRequestId) return;
    scanResult = null;
    errorMessage = String(error);
  } finally {
    if (requestId === scanRequestId) {
      isScanning = false;
      isGeneratingThumbnails = false;
      render();
    }
  }
}

async function loadFolderTrees(): Promise<void> {
  const trees = await Promise.all(settings.watchedFolders.map((folder) => invoke<FolderEntry[]>("discover_folders", { folder })));
  folderEntries = trees.flat();
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
    app?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
      if (thumbnail) {
        void selectAndLoadMetadata(thumbnail.sourcePath);
      }
    });
    app?.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
      if (!thumbnail) {
        return;
      }
      selectedThumbnailPath = thumbnail.sourcePath;
      selectedMetadata = catalogMetadata.get(thumbnail.sourcePath) ?? null;
      viewerSourcePath = thumbnail.sourcePath;
      metadataError = null;
      updateSelectionUI();
      updateViewerUI();
    });
    app?.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
      if (!thumbnail) {
        return;
      }
      event.preventDefault();
      contextMenu = {
        sourcePath: thumbnail.sourcePath,
        x: event.clientX,
        y: event.clientY,
      };
      render();
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
        scheduleProgressRender();
      }
    });
    await listen<ThumbnailProgress>("thumbnail-progress", (event) => {
      thumbnailProgress = event.payload;
      isScanning = false;
      isGeneratingThumbnails = true;
      scheduleProgressRender();
    });
    settings = await invoke<AppSettings>("load_settings");
    await refreshCacheSize();
    await loadFolderTrees();
    render();

    if (settings.watchedFolders.length) {
      activeFolder = ALL_FOLDERS;
      settings.watchedFolders.forEach((folder) => expandedFolders.add(folder));
      await loadCatalogFiles(activeFolder);
      render();
      if (thumbnails.length === 0) {
        void scanSelectedFolder();
      }
    }
  } catch (error) {
    errorMessage = String(error);
    render();
  }
}

void initialize();
