import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

type AppSettings = {
  watchedFolders: string[];
  excludedFolders: string[];
  thumbnailSize: number;
  thumbnailSortKey: ThumbnailSortKey;
  thumbnailSortAscending: boolean;
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
  fileSize: number;
  dateTaken?: string;
  lastModified: number;
};

type ThumbnailSortKey = "name" | "dateTaken" | "lastModified" | "fileSize";

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

type ContextMenu = {
  kind: "image" | "folder";
  path: string;
  x: number;
  y: number;
};

const app = document.querySelector<HTMLElement>("#app");
const viewerHost = document.createElement("div");
viewerHost.id = "viewer-host";
document.body.append(viewerHost);
const contextMenuHost = document.createElement("div");
contextMenuHost.id = "context-menu-host";
document.body.append(contextMenuHost);
const removalDialogHost = document.createElement("div");
removalDialogHost.id = "removal-dialog-host";
document.body.append(removalDialogHost);
const ALL_FOLDERS = "__all_folders__";

let settings: AppSettings = {
  watchedFolders: [],
  excludedFolders: [],
  thumbnailSize: 180,
  thumbnailSortKey: "name",
  thumbnailSortAscending: true,
};
let activeFolder: string | null = null;
let folderEntries: FolderEntry[] = [];
const expandedFolders = new Set<string>();
let scanResult: ScanResult | null = null;
let scanProgress: ScanProgress | null = null;
let isScanning = false;
let thumbnails: Thumbnail[] = [];
let thumbnailProgress: ThumbnailProgress | null = null;
let isGeneratingThumbnails = false;
let isRawRendering = false;
let searchQuery = "";
let selectedThumbnailPath: string | null = null;
const selectedThumbnailPaths = new Set<string>();
let thumbnailSize = 180;
let thumbnailCacheBytes = 0;
let hideEmptyFolders = true;
let sidebarMenuOpen = false;
let thumbnailSortKey: ThumbnailSortKey = "name";
let thumbnailSortAscending = true;
let scanRequestId = 0;
let viewerSourcePath: string | null = null;
let ignoreViewerBackdropClick = false;
let contextMenu: ContextMenu | null = null;
let ignoreContextMenuDismiss = false;
let removalPath: string | null = null;
let errorMessage = "";
let progressRenderTimer: number | null = null;
let metadataError: string | null = null;
const catalogMetadata = new Map<string, ImageMetadata>();
let preferencesSaveTimer: number | null = null;

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
let allKnownTags: string[] = [];

async function loadAllCatalogTags(): Promise<void> {
  try {
    allKnownTags = await invoke<string[]>("get_all_catalog_tags");
  } catch (error) {
    console.error("Failed to load catalog tags:", error);
  }
}

function normalizeTag(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function addKnownTag(tag: string): void {
  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    return;
  }
  if (!allKnownTags.some((knownTag) => normalizeTag(knownTag) === normalizeTag(trimmedTag))) {
    allKnownTags = [...allKnownTags, trimmedTag].sort((a, b) =>
      a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase()),
    );
  }
}

function matchingKnownTags(value: string, currentTags: string[]): string[] {
  const normalizedValue = normalizeTag(value);
  if (!normalizedValue) {
    return [];
  }

  const assignedTags = new Set(currentTags.map(normalizeTag));
  return allKnownTags
    .filter((tag) => {
      const normalizedTag = normalizeTag(tag);
      return normalizedTag.startsWith(normalizedValue) && !assignedTags.has(normalizedTag);
    })
    .slice(0, 8);
}


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

function isSameOrNestedPath(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
}

function folderOpenLabel(): string {
  if (navigator.userAgent.includes("Mac")) {
    return "Open in Finder";
  }
  if (navigator.userAgent.includes("Windows")) {
    return "Open in Explorer";
  }
  return "Open in File Manager";
}

function showContextMenu(menu: ContextMenu): void {
  contextMenu = menu;
  ignoreContextMenuDismiss = true;
  renderContextMenu();
  window.requestAnimationFrame(() => {
    ignoreContextMenuDismiss = false;
  });
}

function dismissContextMenu(): void {
  contextMenu = null;
  contextMenuHost.replaceChildren();
}

function renderContextMenu(): void {
  if (!contextMenu) {
    contextMenuHost.replaceChildren();
    return;
  }

  const actions = contextMenu.kind === "folder"
    ? `<li><button data-context-action="open-folder" type="button">${folderOpenLabel()}</button></li><li><button data-context-action="copy-path" type="button">Copy folder path</button></li><li><button data-context-action="remove-folder" type="button">Remove folder</button></li>`
    : `${!viewerSourcePath ? `<li><button data-context-action="open-preview" type="button">Open preview</button></li>` : ""}<li><button data-context-action="reveal-file" type="button">${folderOpenLabel()}</button></li><li><button data-context-action="copy-name" type="button">Copy filename</button></li><li><button data-context-action="copy-path" type="button">Copy complete path</button></li><li><button data-context-action="copy-image" type="button">Copy image</button></li><li><button data-context-action="remove-or-delete" type="button">Remove or delete…</button></li>`;
  contextMenuHost.innerHTML = `<menu class="image-context-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px">${actions}</menu>`;
}

function showRemovalDialog(path: string): void {
  const thumbnail = thumbnails.find((entry) => entry.sourcePath === path);
  if (!thumbnail) {
    return;
  }

  dismissContextMenu();
  removalPath = path;
  removalDialogHost.innerHTML = `
    <div class="removal-backdrop" role="dialog" aria-modal="true" aria-labelledby="removal-title">
      <section class="removal-dialog">
        <p class="eyebrow">Photo removal</p>
        <h2 id="removal-title">Remove “${escapeHtml(thumbnail.name)}”?</h2>
        <p>Choose whether to hide this photo from the catalogue or permanently delete its original file from disk.</p>
        <div class="removal-actions">
          <button class="secondary-button" data-removal-action="cancel" type="button">Cancel</button>
          <button class="secondary-button" data-removal-action="catalogue" type="button">Remove from catalogue</button>
          <button class="danger-button" data-removal-action="disk" type="button">Delete from disk…</button>
        </div>
      </section>
    </div>`;
}

function dismissRemovalDialog(): void {
  removalPath = null;
  removalDialogHost.replaceChildren();
}

async function removePhoto(action: "catalogue" | "disk"): Promise<void> {
  const path = removalPath;
  if (!path) {
    return;
  }

  dismissRemovalDialog();
  try {
    await invoke<void>(action === "catalogue" ? "remove_from_catalogue" : "delete_from_disk", { path });
    thumbnails = thumbnails.filter((thumbnail) => thumbnail.sourcePath !== path);
    catalogMetadata.delete(path);
    selectedThumbnailPaths.delete(path);
    if (selectedThumbnailPath === path) {
      selectedThumbnailPath = null;
      selectedMetadata = null;
    }
    if (viewerSourcePath === path) {
      closeViewer();
    }
    errorMessage = "";
  } catch (error) {
    errorMessage = String(error);
  }
  render();
}

function renderFolderTree(path: string, depth: number): string {
  const children = folderEntries.filter((entry) => parentPath(entry.path) === path && (!hideEmptyFolders || entry.containsImages));
  const expanded = expandedFolders.has(path);
  const active = activeFolder === path;
  return `<div class="tree-node"><button class="folder-item ${active ? "is-selected" : ""}" type="button" data-select-folder="${escapeHtml(path)}" data-folder-path="${escapeHtml(path)}" style="padding-left:${10 + depth * 16}px"><span class="tree-toggle ${children.length ? "has-children" : ""}" data-toggle-folder="${escapeHtml(path)}">${children.length ? (expanded ? "⌄" : "›") : ""}</span><span>${escapeHtml(folderName(path))}</span></button>${expanded ? children.map((child) => renderFolderTree(child.path, depth + 1)).join("") : ""}</div>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchRatingFilter(actualRating: number, val: string): boolean {
  val = val.trim();
  
  // 1. Check for range, e.g. "3-5" or "3to5"
  const rangeMatch = val.match(/^(\d)\s*(?:-|to)\s*(\d)$/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return actualRating >= min && actualRating <= max;
  }
  
  // 2. Check for comma-separated list, e.g. "2,3" or "2,3,4"
  if (val.includes(",")) {
    const list = val.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    return list.includes(actualRating);
  }
  
  // 3. Check for comparison operators, e.g. ">=3", ">2", "<=4", "<5"
  const compMatch = val.match(/^([><]=?)\s*(\d)$/);
  if (compMatch) {
    const op = compMatch[1];
    const target = parseInt(compMatch[2], 10);
    switch (op) {
      case ">": return actualRating > target;
      case ">=": return actualRating >= target;
      case "<": return actualRating < target;
      case "<=": return actualRating <= target;
    }
  }
  
  // 4. Fallback: single number
  const single = parseInt(val, 10);
  if (!isNaN(single)) {
    return actualRating === single;
  }
  
  return false;
}

function filterThumbnails(list: Thumbnail[], query: string): Thumbnail[] {
  if (!query.trim()) {
    return list;
  }
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((item) => {
    const meta = catalogMetadata.get(item.sourcePath);
    return tokens.every((token) => {
      if (token.includes(":")) {
        const colonIndex = token.indexOf(":");
        const key = token.slice(0, colonIndex);
        const val = token.slice(colonIndex + 1);
        if (!val) {
          return true;
        }
        switch (key) {
          case "tag":
          case "keyword":
            if (!meta || !meta.keywords) return false;
            return meta.keywords.some((kw) => kw.toLowerCase().includes(val));
          case "camera":
            if (!meta || !meta.camera) return false;
            return meta.camera.toLowerCase().includes(val);
          case "lens":
            if (!meta || !meta.lens) return false;
            return meta.lens.toLowerCase().includes(val);
          case "location":
            if (!meta) return false;
            const city = meta.locationCity ? meta.locationCity.toLowerCase() : "";
            const state = meta.locationState ? meta.locationState.toLowerCase() : "";
            const country = meta.locationCountry ? meta.locationCountry.toLowerCase() : "";
            return city.includes(val) || state.includes(val) || country.includes(val);
          case "rating":
            const actualRating = meta && meta.rating != null ? meta.rating : 0;
            return matchRatingFilter(actualRating, val);
          case "format":
            const formatStr = (meta && meta.format ? meta.format : item.name.split(".").pop() || "").toLowerCase();
            if (val === "raw") {
              return isRawFormat(formatStr);
            }
            return formatStr.includes(val);
          default:
            break;
        }
      }
      const nameMatch = item.name.toLowerCase().includes(token);
      const formatStr = (meta && meta.format ? meta.format : item.name.split(".").pop() || "").toLowerCase();
      const formatMatch = formatStr.includes(token);
      const kwMatch = meta && meta.keywords 
        ? meta.keywords.some((kw) => kw.toLowerCase().includes(token)) 
        : false;
      const cameraMatch = meta && meta.camera 
        ? meta.camera.toLowerCase().includes(token) 
        : false;
      const lensMatch = meta && meta.lens 
        ? meta.lens.toLowerCase().includes(token) 
        : false;
      const locationMatch = meta 
        ? ((meta.locationCity || "") + " " + (meta.locationState || "") + " " + (meta.locationCountry || "")).toLowerCase().includes(token)
        : false;
      return nameMatch || formatMatch || kwMatch || cameraMatch || lensMatch || locationMatch;
    });
  });
}

function isRawFormat(format: string): boolean {
  const rawExtensions = ["nef", "cr2", "arw", "dng", "orf", "rw2", "pef", "raf"];
  return rawExtensions.includes(format.toLowerCase());
}

function getFilteredThumbnails(): Thumbnail[] {
  return filterThumbnails(thumbnails, searchQuery);
}

function sortThumbnails(): void {
  const direction = thumbnailSortAscending ? 1 : -1;
  thumbnails.sort((left, right) => {
    if (thumbnailSortKey === "name") {
      return direction * left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    }
    if (thumbnailSortKey === "fileSize") {
      return direction * (left.fileSize - right.fileSize);
    }
    if (thumbnailSortKey === "lastModified") {
      return direction * (left.lastModified - right.lastModified);
    }

    const leftDate = left.dateTaken ? Date.parse(left.dateTaken) : Number.NaN;
    const rightDate = right.dateTaken ? Date.parse(right.dateTaken) : Number.NaN;
    if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
      if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) return 0;
      return Number.isNaN(leftDate) ? 1 : -1;
    }
    return direction * (leftDate - rightDate);
  });
}

async function saveDisplayPreferences(): Promise<void> {
  try {
    settings = await invoke<AppSettings>("save_display_preferences", {
      thumbnailSize,
      thumbnailSortKey,
      thumbnailSortAscending,
    });
  } catch (error) {
    console.error("Could not save thumbnail display preferences:", error);
  }
}

function scheduleDisplayPreferencesSave(): void {
  if (preferencesSaveTimer !== null) {
    window.clearTimeout(preferencesSaveTimer);
  }
  preferencesSaveTimer = window.setTimeout(() => {
    preferencesSaveTimer = null;
    void saveDisplayPreferences();
  }, 200);
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
      || metadata.latitude != null
      || metadata.longitude != null
      || metadata.dateTaken
      || metadata.aperture
      || metadata.shutterSpeed
      || metadata.iso != null
      || metadata.focalLength
      || metadata.rating != null
      || metadata.keywords?.length,
  );
}

function shouldShowFocalLength(lens: string, focalLength: string): boolean {
  const normLens = lens.toLowerCase().replace(/\s+/g, "");
  const normFocal = focalLength.toLowerCase().replace(/\s+/g, "");
  
  const focalNumbers = normFocal.match(/\d+(\.\d+)?/g);
  if (!focalNumbers) return true;
  
  const focalVal = focalNumbers[0];
  const isZoom = /\d+-\d+/.test(normLens);
  
  if (isZoom) {
    return true;
  }
  
  if (normLens.includes(focalVal)) {
    return false;
  }
  
  return true;
}

function renderDetailsContent(): string {
  if (selectedThumbnailPaths.size === 0) {
    return `<div class="details-empty"><p>Select a photograph to view details.</p></div>`;
  }

  if (selectedThumbnailPaths.size > 1) {
    const paths = Array.from(selectedThumbnailPaths);
    const formats = new Set<string>();
    let totalSize = 0;
    for (const p of paths) {
      const meta = catalogMetadata.get(p);
      if (meta) {
        formats.add(meta.format);
        totalSize += meta.fileSize;
      }
    }
    const formatDisplay = formats.size === 1 ? Array.from(formats)[0] : "Multiple formats";

    let sharedRating: number | undefined = undefined;
    let uniformRating = true;
    for (let i = 0; i < paths.length; i++) {
      const rating = catalogMetadata.get(paths[i])?.rating;
      if (i === 0) {
        sharedRating = rating;
      } else if (rating !== sharedRating) {
        uniformRating = false;
        break;
      }
    }
    const finalRating = uniformRating ? sharedRating : undefined;
    const sharedTags = intersectKeywords(paths);

    return `<div class="details-content">
      <div class="details-group">
        <label>Selection</label>
        <p>${paths.length} items selected</p>
      </div>
      <div class="details-group">
        <label>Format · Size</label>
        <p>${escapeHtml(formatDisplay)} · ${formatBytes(totalSize)}</p>
      </div>

      <div class="details-group">
        <label>Rating</label>
        <div class="details-rating-interactive" data-rating-container>
          ${[1, 2, 3, 4, 5].map(val => `
            <button class="star-button ${(finalRating && finalRating >= val) ? "is-active" : ""}" data-rate-value="${val}" type="button" title="Rate selected ${val} star${val === 1 ? '' : 's'}">★</button>
          `).join("")}
          ${finalRating ? `
            <button class="clear-rating-button" id="clear-rating" type="button" title="Clear ratings">×</button>
          ` : ""}
        </div>
      </div>

      <div class="details-group">
        <label>Shared Tags</label>
        <div class="tags-container">
          ${sharedTags.map(kw => `
            <span class="tag-pill">
              ${escapeHtml(kw)}
              <button class="tag-remove-button" data-remove-tag="${escapeHtml(kw)}" type="button" title="Remove tag from all selected">&times;</button>
            </span>
          `).join("")}
        </div>
        <div class="add-tag-wrapper">
          <input type="text" id="add-tag-input" class="add-tag-input" placeholder="Add tag to selected..." autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tag-suggestions">
          <div id="tag-suggestions" class="tag-suggestions" role="listbox" hidden></div>
        </div>
      </div>
    </div>`;
  }

  const path = Array.from(selectedThumbnailPaths)[0];
  const selectedThumbnail = thumbnails.find((thumbnail) => thumbnail.sourcePath === path);
  if (!selectedThumbnail) {
    return `<div class="details-empty"><p>Select a photograph to view details.</p></div>`;
  }

  const metadata = selectedMetadata;
  const selectedHasEmbeddedMetadata = metadata ? hasEmbeddedMetadata(metadata) : false;

  return `<div class="details-content">
    <div class="details-group">
      <label>Filename</label>
      <p>${escapeHtml(selectedThumbnail.name)}</p>
    </div>
    <div class="details-group">
      <label>Path</label>
      <p class="details-path" title="${escapeHtml(selectedThumbnail.sourcePath)}">${escapeHtml(selectedThumbnail.sourcePath)}</p>
    </div>
    ${metadata ? `
      <div class="details-group">
        <label>Format · Size</label>
        <p>${escapeHtml(metadata.format)} · ${formatBytes(metadata.fileSize)}</p>
      </div>
      <div class="details-group">
        <label>Dimensions</label>
        <p>${metadata.dimensions[0]} × ${metadata.dimensions[1]} px</p>
      </div>

      <div class="details-group">
        <label>Rating</label>
        <div class="details-rating-interactive" data-rating-container>
          ${[1, 2, 3, 4, 5].map(val => `
            <button class="star-button ${(metadata.rating && metadata.rating >= val) ? "is-active" : ""}" data-rate-value="${val}" type="button" title="Rate ${val} star${val === 1 ? '' : 's'}">★</button>
          `).join("")}
          ${metadata.rating ? `
            <button class="clear-rating-button" id="clear-rating" type="button" title="Clear rating">×</button>
          ` : ""}
        </div>
      </div>

      ${!selectedHasEmbeddedMetadata ? `<div class="details-loading">No embedded photo metadata is available.</div>` : ""}

      ${metadata.camera ? `
        <div class="details-group">
          <label>Camera</label>
          <p>${escapeHtml(metadata.camera)}</p>
        </div>
      ` : ""}
      ${(metadata.lens || metadata.focalLength) ? `
        <div class="details-group">
          <label>Lens</label>
          <p>${escapeHtml(
            metadata.lens && metadata.focalLength
              ? (shouldShowFocalLength(metadata.lens, metadata.focalLength)
                  ? `${metadata.lens} @ ${metadata.focalLength}`
                  : metadata.lens)
              : (metadata.lens || metadata.focalLength || "")
          )}</p>
        </div>
      ` : ""}
      ${(metadata.locationCountry || metadata.locationState || metadata.locationCity || metadata.latitude != null) ? `
        <div class="details-group">
          <label>Location</label>
          <p>${metadata.latitude != null && metadata.longitude != null ? `
            <a class="location-link" href="https://www.google.com/maps/search/?api=1&query=${metadata.latitude},${metadata.longitude}" target="_blank" rel="noopener noreferrer" title="View on Google Maps">
              ${[
                [
                  metadata.locationCity,
                  metadata.locationState,
                  metadata.locationCountry
                ].filter(Boolean).join(", "),
                `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`
              ].filter(Boolean).join(" · ")}
            </a>
          ` : [
            [
              metadata.locationCity,
              metadata.locationState,
              metadata.locationCountry
            ].filter(Boolean).join(", ")
          ].filter(Boolean).join(" · ")}</p>
        </div>
      ` : ""}
      ${metadata.dateTaken ? `
        <div class="details-group">
          <label>Date Taken</label>
          <p>${escapeHtml(metadata.dateTaken)}</p>
        </div>
      ` : ""}
      ${(metadata.aperture || metadata.shutterSpeed || metadata.iso) ? `
        <div class="details-group">
          <label>Exposure</label>
          <p>${[
            metadata.aperture,
            metadata.shutterSpeed,
            metadata.iso ? `ISO ${metadata.iso}` : ""
          ].filter(Boolean).join(" · ")}</p>
        </div>
      ` : ""}
      <div class="details-group">
        <label>Tags</label>
        <div class="tags-container">
          ${(metadata.keywords || []).map(kw => `
            <span class="tag-pill">
              ${escapeHtml(kw)}
              <button class="tag-remove-button" data-remove-tag="${escapeHtml(kw)}" type="button" title="Remove tag">&times;</button>
            </span>
          `).join("")}
        </div>
        <div class="add-tag-wrapper">
          <input type="text" id="add-tag-input" class="add-tag-input" placeholder="Add tag..." autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tag-suggestions">
          <div id="tag-suggestions" class="tag-suggestions" role="listbox" hidden></div>
        </div>
      </div>
    ` : `<div class="details-loading">${escapeHtml(metadataError ?? "Loading photo details…")}</div>`}
  </div>`;
}

async function addPhotoTag(path: string, tag: string): Promise<void> {
  const metadata = catalogMetadata.get(path) ?? selectedMetadata;
  if (!metadata) return;

  const currentTags = metadata.keywords || [];
  // Case-insensitive duplicate check
  if (currentTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
    const input = document.querySelector<HTMLInputElement>("#add-tag-input");
    if (input) input.value = "";
    return;
  }

  const updatedTags = [...currentTags, tag];

  try {
    // 1. Backend update
    await invoke<void>("set_photo_keywords", { path, keywords: updatedTags });

    // 2. Update local state
    metadata.keywords = updatedTags;
    addKnownTag(tag);
    if (selectedThumbnailPath === path && selectedMetadata) {
      selectedMetadata.keywords = updatedTags;
    }

    // 3. Reload tags list and refresh UI
    await loadAllCatalogTags();
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to add photo tag:", error);
    errorMessage = String(error);
    render();
  }
}

async function removePhotoTag(path: string, tag: string): Promise<void> {
  const metadata = catalogMetadata.get(path) ?? selectedMetadata;
  if (!metadata) return;

  const currentTags = metadata.keywords || [];
  const updatedTags = currentTags.filter(t => t !== tag);

  try {
    // 1. Backend update
    await invoke<void>("set_photo_keywords", { path, keywords: updatedTags });

    // 2. Update local state
    metadata.keywords = updatedTags;
    if (selectedThumbnailPath === path && selectedMetadata) {
      selectedMetadata.keywords = updatedTags;
    }

    // 3. Reload tags list and refresh UI
    await loadAllCatalogTags();
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to remove photo tag:", error);
    errorMessage = String(error);
    render();
  }
}

async function addMultiplePhotosTag(paths: string[], tag: string): Promise<void> {
  try {
    // 1. Backend update
    await invoke<void>("add_tag_to_multiple_photos", { paths, tag });

    // 2. Update local state
    for (const path of paths) {
      const metadata = catalogMetadata.get(path);
      if (metadata) {
        const currentTags = metadata.keywords || [];
        if (!currentTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
          metadata.keywords = [...currentTags, tag];
        }
      }
    }

    if (selectedThumbnailPath && paths.includes(selectedThumbnailPath) && selectedMetadata) {
      selectedMetadata.keywords = catalogMetadata.get(selectedThumbnailPath)?.keywords ?? [];
    }

    addKnownTag(tag);

    // 3. Reload tags list and refresh UI
    await loadAllCatalogTags();
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to add photo tag in bulk:", error);
    errorMessage = String(error);
    render();
  }
}

async function removeMultiplePhotosTag(paths: string[], tag: string): Promise<void> {
  try {
    // 1. Backend update
    await invoke<void>("remove_tag_from_multiple_photos", { paths, tag });

    // 2. Update local state
    for (const path of paths) {
      const metadata = catalogMetadata.get(path);
      if (metadata) {
        const currentTags = metadata.keywords || [];
        metadata.keywords = currentTags.filter(t => t !== tag);
      }
    }

    if (selectedThumbnailPath && paths.includes(selectedThumbnailPath) && selectedMetadata) {
      selectedMetadata.keywords = catalogMetadata.get(selectedThumbnailPath)?.keywords ?? [];
    }

    // 3. Reload tags list and refresh UI
    await loadAllCatalogTags();
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to remove photo tag in bulk:", error);
    errorMessage = String(error);
    render();
  }
}

async function setMultiplePhotosRating(paths: string[], rating: number | null): Promise<void> {
  try {
    // 1. Backend update
    await invoke<void>("set_rating_for_multiple_photos", { paths, rating: rating !== null ? rating : undefined });

    // 2. Update local state
    for (const path of paths) {
      const metadata = catalogMetadata.get(path);
      if (metadata) {
        metadata.rating = rating !== null ? rating : undefined;
      }
    }

    if (selectedThumbnailPath && paths.includes(selectedThumbnailPath) && selectedMetadata) {
      selectedMetadata.rating = rating !== null ? rating : undefined;
    }

    // 3. Update the UI
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to set photo rating in bulk:", error);
    errorMessage = String(error);
    render();
  }
}

function intersectKeywords(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const first = catalogMetadata.get(paths[0])?.keywords ?? [];
  let common = new Set<string>(first);
  for (let i = 1; i < paths.length; i++) {
    const keywords = new Set<string>(catalogMetadata.get(paths[i])?.keywords ?? []);
    common = new Set<string>([...common].filter(kw => keywords.has(kw)));
  }
  return Array.from(common).sort((a, b) => a.localeCompare(b));
}

function wireTagAutocomplete(tagInput: HTMLInputElement, suggestionsHost: HTMLElement, paths: string[]): void {
  let suggestions: string[] = [];
  let activeIndex = 0;

  const currentTags = (): string[] => {
    if (paths.length === 1) {
      return catalogMetadata.get(paths[0])?.keywords ?? [];
    }
    return intersectKeywords(paths);
  };

  const hideSuggestions = (): void => {
    suggestions = [];
    activeIndex = 0;
    suggestionsHost.hidden = true;
    suggestionsHost.innerHTML = "";
    tagInput.setAttribute("aria-expanded", "false");
    tagInput.removeAttribute("aria-activedescendant");
  };

  const renderSuggestions = (): void => {
    suggestions = matchingKnownTags(tagInput.value, currentTags());
    activeIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1));

    if (!suggestions.length) {
      hideSuggestions();
      return;
    }

    suggestionsHost.hidden = false;
    tagInput.setAttribute("aria-expanded", "true");
    tagInput.setAttribute("aria-activedescendant", `tag-suggestion-${activeIndex}`);
    suggestionsHost.innerHTML = suggestions
      .map((tag, index) => `
        <button
          type="button"
          id="tag-suggestion-${index}"
          class="tag-suggestion-option ${index === activeIndex ? "is-active" : ""}"
          data-tag-suggestion="${escapeHtml(tag)}"
          role="option"
          aria-selected="${index === activeIndex ? "true" : "false"}"
        >${escapeHtml(tag)}</button>
      `)
      .join("");
  };

  const commitTag = (tag: string): void => {
    const normalizedValue = normalizeTag(tag);
    const knownTag = allKnownTags.find((candidate) => normalizeTag(candidate) === normalizedValue);
    const selectedTag = knownTag ?? tag.trim();

    if (selectedTag) {
      tagInput.value = "";
      hideSuggestions();
      if (paths.length === 1) {
        void addPhotoTag(paths[0], selectedTag);
      } else {
        void addMultiplePhotosTag(paths, selectedTag);
      }
    }
  };

  tagInput.addEventListener("input", renderSuggestions);
  tagInput.addEventListener("focus", renderSuggestions);
  tagInput.addEventListener("blur", () => {
    window.setTimeout(hideSuggestions, 120);
  });
  tagInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      renderSuggestions();
      return;
    }

    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      renderSuggestions();
      return;
    }

    if ((event.key === "Enter" || event.key === "Tab") && suggestions.length) {
      event.preventDefault();
      commitTag(suggestions[activeIndex] ?? suggestions[0]);
      return;
    }

    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTag(tagInput.value);
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  suggestionsHost.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  suggestionsHost.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const option = target.closest<HTMLElement>("[data-tag-suggestion]");
    const tag = option?.dataset.tagSuggestion;
    if (tag) {
      commitTag(tag);
    }
  });
}

function updateSelectionUI(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-thumbnail-path]").forEach((card) => {
    const cardPath = card.dataset.thumbnailPath;
    card.classList.toggle("is-selected", Boolean(cardPath && selectedThumbnailPaths.has(cardPath)));
  });
  const detailsPanel = document.querySelector<HTMLElement>("#details-panel");
  const detailsBody = detailsPanel?.querySelector<HTMLElement>("#details-body");
  if (detailsBody) {
    detailsBody.innerHTML = renderDetailsContent();

    // Wire up add-tag-input listener
    const tagInput = detailsBody.querySelector<HTMLInputElement>("#add-tag-input");
    const suggestionsHost = detailsBody.querySelector<HTMLElement>("#tag-suggestions");
    const paths = Array.from(selectedThumbnailPaths);
    if (tagInput && suggestionsHost && paths.length > 0) {
      wireTagAutocomplete(tagInput, suggestionsHost, paths);
    }
  }
}

function renderDetailsSupportFooter(): string {
  return `<div class="panel-footer"><a class="app-footer-link" href="https://buymeacoffee.com/pbeens" target="_blank" rel="noopener noreferrer">Buy me a coffee</a></div>`;
}

function updateProgressStatus(): void {
  const modalBackdrop = document.querySelector<HTMLElement>(".scan-backdrop");
  if (!modalBackdrop) {
    return;
  }

  const modalTitle = modalBackdrop.querySelector("h3");
  const modalDesc = modalBackdrop.querySelector("p");
  const progressContainer = modalBackdrop.querySelector<HTMLElement>(".scan-progress-container");
  const progressBar = modalBackdrop.querySelector<HTMLElement>(".scan-progress-bar");

  if (isScanning) {
    if (modalTitle) modalTitle.textContent = "Scanning Folder";
    if (modalDesc) {
      modalDesc.textContent = `Scanning folder entries… found ${scanProgress?.imagesFound ?? 0} supported images so far`;
    }
    if (progressContainer) {
      progressContainer.style.display = "none";
    }
  } else if (isGeneratingThumbnails) {
    if (modalTitle) modalTitle.textContent = "Processing Images";
    if (modalDesc) {
      modalDesc.textContent = `Processing images: ${thumbnailProgress?.completed ?? 0} of ${thumbnailProgress?.total ?? 0}`;
    }
    if (progressContainer) {
      progressContainer.style.display = "";
    }
    if (progressBar && thumbnailProgress) {
      const pct = (thumbnailProgress.completed / (thumbnailProgress.total || 1)) * 100;
      progressBar.style.width = `${pct}%`;
    }
  }
}

async function selectAndLoadMetadata(path: string | null): Promise<void> {
  if (selectedThumbnailPath === path && selectedThumbnailPaths.size === (path ? 1 : 0) && (path === null || selectedThumbnailPaths.has(path))) {
    return;
  }

  selectedThumbnailPath = path;
  selectedThumbnailPaths.clear();
  if (path) {
    selectedThumbnailPaths.add(path);
  }
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

async function setPhotoRating(path: string, rating: number | null): Promise<void> {
  try {
    // 1. Invoke the Rust command
    await invoke<void>("set_photo_rating", { path, rating: rating !== null ? rating : undefined });

    // 2. Update local catalog metadata state
    const metadata = catalogMetadata.get(path);
    if (metadata) {
      metadata.rating = rating !== null ? rating : undefined;
    }

    if (selectedThumbnailPath === path && selectedMetadata) {
      selectedMetadata.rating = rating !== null ? rating : undefined;
    }

    // 3. Update the UI in place
    updateSelectionUI();
    errorMessage = "";
  } catch (error) {
    console.error("Failed to set photo rating:", error);
    errorMessage = String(error);
    render();
  }
}

function gridColumnCount(): number {
  const grid = document.querySelector<HTMLElement>(".thumbnail-grid");
  const card = grid?.querySelector<HTMLElement>(".thumbnail-card");
  if (!grid || !card) {
    return 1;
  }

  const columnGap = Number.parseFloat(window.getComputedStyle(grid).columnGap) || 0;
  return Math.max(1, Math.floor((grid.clientWidth + columnGap) / (card.offsetWidth + columnGap)));
}

function moveGridSelection(delta: number): void {
  const filtered = getFilteredThumbnails();
  if (!filtered.length) {
    return;
  }

  const currentIndex = filtered.findIndex((thumbnail) => thumbnail.sourcePath === selectedThumbnailPath);
  const nextIndex = currentIndex < 0
    ? 0
    : Math.max(0, Math.min(filtered.length - 1, currentIndex + delta));
  const thumbnail = filtered[nextIndex];
  if (!thumbnail) {
    return;
  }

  void selectAndLoadMetadata(thumbnail.sourcePath);
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-thumbnail-index="${nextIndex}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button:not(.thumbnail-card)"));
}

async function navigateToImage(index: number): Promise<void> {
  const filtered = getFilteredThumbnails();
  if (index >= 0 && index < filtered.length) {
    viewerSourcePath = filtered[index].sourcePath;
    selectedThumbnailPath = viewerSourcePath;
    selectedThumbnailPaths.clear();
    selectedThumbnailPaths.add(viewerSourcePath);
    selectedMetadata = catalogMetadata.get(viewerSourcePath) ?? null;
    metadataError = null;
    updateSelectionUI();
    await updateViewerUI();
  }
}

function openViewer(path: string): void {
  const thumbnail = thumbnails.find((entry) => entry.sourcePath === path);
  if (!thumbnail) {
    return;
  }

  selectedThumbnailPath = path;
  selectedMetadata = catalogMetadata.get(path) ?? null;
  metadataError = null;
  viewerSourcePath = path;
  ignoreViewerBackdropClick = true;
  window.requestAnimationFrame(() => {
    ignoreViewerBackdropClick = false;
  });
  updateSelectionUI();
  renderViewer();
  window.requestAnimationFrame(() => {
    updateViewerUI();
  });
}

function closeViewer(): void {
  viewerSourcePath = null;
  viewerHost.replaceChildren();
}

function renderViewer(): void {
  const filtered = getFilteredThumbnails();
  const currentIndex = viewerSourcePath
    ? filtered.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath)
    : -1;
  const thumbnail = currentIndex >= 0 ? filtered[currentIndex] : undefined;

  if (!viewerSourcePath || !thumbnail) {
    viewerHost.replaceChildren();
    return;
  }

  viewerHost.innerHTML = `
    <div class="viewer-backdrop" role="dialog" aria-modal="true">
      <button class="viewer-close" id="close-viewer" type="button">×</button>
      <button class="viewer-prev" id="viewer-prev" type="button" ${currentIndex <= 0 ? "disabled" : ""}>&lsaquo;</button>
      <figure class="viewer">
        <div class="viewer-media">
          <img id="viewer-preview" src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}?t=${thumbnail.lastModified}" alt="${escapeHtml(thumbnail.name)}" />
          <img id="viewer-image" src="" alt="${escapeHtml(thumbnail.name)}" />
        </div>
        <figcaption>
          <span id="viewer-name">${escapeHtml(thumbnail.name)}</span>
          <span id="viewer-position">Original image (${currentIndex + 1} of ${filtered.length})</span>
          <span id="viewer-load-state">Loading original image…</span>
        </figcaption>
      </figure>
      <button class="viewer-next" id="viewer-next" type="button" ${currentIndex >= filtered.length - 1 ? "disabled" : ""}>&rsaquo;</button>
    </div>`;
}

async function updateViewerUI(): Promise<void> {
  if (!viewerSourcePath) {
    return;
  }
  const viewerImage = viewerHost.querySelector<HTMLImageElement>("#viewer-image");
  if (!viewerImage) {
    renderViewer();
    window.requestAnimationFrame(() => {
      updateViewerUI();
    });
    return;
  }

  const filtered = getFilteredThumbnails();
  const currentIndex = filtered.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
  const thumbnail = filtered[currentIndex];
  if (!thumbnail) {
    return;
  }
  const path = viewerSourcePath;
  const cachedSource = `${convertFileSrc(thumbnail.thumbnailPath)}?t=${thumbnail.lastModified}`;
  const previewImage = viewerHost.querySelector<HTMLImageElement>("#viewer-preview");
  if (previewImage) {
    previewImage.src = cachedSource;
    previewImage.alt = thumbnail.name;
  }
  viewerImage.classList.remove("is-loaded");
  viewerImage.dataset.sourcePath = path;

  let renderablePath = path;
  try {
    renderablePath = await invoke<string>("get_viewer_path", { path });
  } catch (err) {
    console.error("Failed to get viewer path", err);
  }

  if (viewerSourcePath !== path || viewerImage.dataset.sourcePath !== path) {
    return;
  }

  viewerImage.src = `${convertFileSrc(renderablePath)}?t=${Date.now()}`;
  viewerImage.alt = thumbnail.name;
  viewerHost.querySelector<HTMLElement>("#viewer-name")!.textContent = thumbnail.name;
  viewerHost.querySelector<HTMLElement>("#viewer-position")!.textContent = `Original image (${currentIndex + 1} of ${filtered.length})`;
  viewerHost.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Loading original image…";
  const previousButton = viewerHost.querySelector<HTMLButtonElement>("#viewer-prev");
  const nextButton = viewerHost.querySelector<HTMLButtonElement>("#viewer-next");
  if (previousButton) previousButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex >= filtered.length - 1;

  const markOriginalLoaded = () => {
    if (viewerSourcePath === path && viewerImage.dataset.sourcePath === path) {
      viewerImage.classList.add("is-loaded");
      viewerHost.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Original image";
    }
  };
  viewerImage.onload = markOriginalLoaded;
  viewerImage.onerror = () => {
    if (viewerSourcePath === path && viewerImage.dataset.sourcePath === path) {
      viewerHost.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Original image could not load; showing cached preview.";
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

  const activeEl = document.activeElement;
  const isSearchFocused = activeEl && activeEl.id === "search-input";
  const selectionStart = isSearchFocused ? (activeEl as HTMLInputElement).selectionStart : null;
  const selectionEnd = isSearchFocused ? (activeEl as HTMLInputElement).selectionEnd : null;

  const folderList = document.querySelector<HTMLElement>(".folder-list");
  const filePanel = document.querySelector<HTMLElement>(".file-panel");
  const savedFolderScroll = {
    top: folderList?.scrollTop ?? 0,
    left: folderList?.scrollLeft ?? 0,
  };
  const savedFileScroll = {
    top: filePanel?.scrollTop ?? 0,
    left: filePanel?.scrollLeft ?? 0,
  };

  const selectedFolder = activeFolder;
  const isAllFolders = selectedFolder === ALL_FOLDERS;
  const files = scanResult?.files ?? [];
  const topLevelFoldersExpanded = settings.watchedFolders.some((folder) => expandedFolders.has(folder));
  const filteredThumbnails = getFilteredThumbnails();

  app.innerHTML = `
    <section class="shell">
      <aside class="sidebar" aria-label="Scanned folders">
        <div class="sidebar-heading">
          <p class="eyebrow">Peter’s Photo Manager</p>
          <div class="sidebar-title-row"><h1>Folders</h1><div class="folder-menu-anchor"><button class="folder-options-button" id="folder-options-button" type="button" aria-expanded="${sidebarMenuOpen}" aria-controls="folder-options-menu" title="Folder options">•••</button>${sidebarMenuOpen ? `<div class="folder-options-menu" id="folder-options-menu"><p class="eyebrow">Folder options</p><button class="primary-button" id="add-folder" type="button">Add folder</button><label class="folder-option-toggle"><input id="hide-empty-folders" type="checkbox" ${hideEmptyFolders ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span><span>Hide folders with no images</span></label>${settings.watchedFolders.length ? `<button id="reset-catalogue" type="button" class="reset-catalogue-button">⚠ Reset & Rescan</button>` : ""}</div>` : ""}</div></div>
        </div>
        <div class="folder-list panel-body">
          ${settings.watchedFolders.length ? `<button class="folder-item ${isAllFolders ? "is-selected" : ""}" type="button" data-select-folder="${ALL_FOLDERS}"><span class="tree-toggle has-children" data-toggle-top-level-folders>${topLevelFoldersExpanded ? "⌄" : "›"}</span><span>All Folders</span></button>` : ""}
          ${settings.watchedFolders.length ? settings.watchedFolders.map((folder) => renderFolderTree(folder, 0)).join("") : `<p class="empty-sidebar">No folders selected yet.</p>`}
        </div>
        <div class="panel-footer">
          <a class="app-footer-link" href="https://github.com/pbeens/peters-photo-manager/issues" target="_blank" rel="noopener noreferrer">Submit Feedback</a>
        </div>
      </aside>

      <section class="content">
        <header class="content-header">
          <div>
            <p class="eyebrow">Thumbnail grid</p>
            <p class="path path-heading">${isAllFolders ? "All listed folders" : selectedFolder ? escapeHtml(selectedFolder) : "Select a folder to scan for JPEG, PNG, and WebP images."}</p>
          </div>
          ${selectedFolder ? `
            <div class="search-box">
              <input id="search-input" type="search" placeholder="Search by tag, camera, lens, rating..." value="${escapeHtml(searchQuery)}" aria-label="Search photographs" />
              ${searchQuery ? `<button class="search-clear" id="search-clear" type="button" title="Clear search">×</button>` : ""}
              <div class="search-tooltip" role="tooltip">
                <div class="search-tooltip-header">Search Hints</div>
                <ul class="search-tooltip-list">
                  <li><strong>tag:keyword</strong> (e.g. tag:nature)</li>
                  <li><strong>camera:model</strong> (e.g. camera:nikon)</li>
                  <li><strong>lens:model</strong> (e.g. lens:180)</li>
                  <li><strong>location:place</strong> (e.g. location:city)</li>
                  <li><strong>rating:expr</strong> (e.g. rating:5, rating:>2, rating:3-5, rating:2,3)</li>
                  <li><strong>format:ext</strong> (e.g. format:raw or format:jpeg)</li>
                  <li>Multiple words will combine with <strong>AND</strong></li>
                </ul>
              </div>
            </div>
          ` : ""}
        </header>

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
                    : filteredThumbnails.length === 0
                      ? `<div class="empty-state"><h3>No matching images found</h3><p>Try adjusting your search query or advanced filter tags.</p></div>`
                      : `<div class="thumbnail-grid" style="--thumbnail-size: ${thumbnailSize}px">
                        ${filteredThumbnails
                          .map(
                            (thumbnail, index) => `<button class="thumbnail-card ${selectedThumbnailPaths.has(thumbnail.sourcePath) ? "is-selected" : ""}" type="button" data-thumbnail-index="${index}" data-thumbnail-path="${escapeHtml(thumbnail.sourcePath)}" title="${escapeHtml(thumbnail.name)}"><img src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}?t=${thumbnail.lastModified}" alt="${escapeHtml(thumbnail.name)}" loading="lazy" /><span>${escapeHtml(thumbnail.name)}</span></button>`,
                          )
                          .join("")}
                      </div>`
          }
        </section>

        ${selectedFolder ? `<footer class="grid-footer"><div class="grid-footer-summary"><div class="thumbnail-sort-control"><span class="thumbnail-count">${searchQuery.trim() ? `${filteredThumbnails.length.toLocaleString()} of ${thumbnails.length.toLocaleString()} image${thumbnails.length === 1 ? "" : "s"} found` : `${thumbnails.length.toLocaleString()} image${thumbnails.length === 1 ? "" : "s"}`} sorted by</span><select id="thumbnail-sort-key" aria-label="Sort thumbnails by"><option value="name" ${thumbnailSortKey === "name" ? "selected" : ""}>File name</option><option value="dateTaken" ${thumbnailSortKey === "dateTaken" ? "selected" : ""}>Date taken</option><option value="lastModified" ${thumbnailSortKey === "lastModified" ? "selected" : ""}>Date modified</option><option value="fileSize" ${thumbnailSortKey === "fileSize" ? "selected" : ""}>File size</option></select><button id="thumbnail-sort-direction" type="button" aria-pressed="${!thumbnailSortAscending}">${thumbnailSortAscending ? "Ascending ↑" : "Descending ↓"}</button><span class="thumbnail-cache">Cache ${formatBytes(thumbnailCacheBytes)}</span></div></div><label class="thumbnail-size-control" for="thumbnail-size"><span>Small</span><input id="thumbnail-size" type="range" min="120" max="300" step="10" value="${thumbnailSize}" /><span>Large</span><output id="thumbnail-size-value">${thumbnailSize}px</output></label></footer>` : ""}
        ${isRawRendering ? `<div class="raw-rendering-container"><span class="raw-rendering-indicator status-pulsing">RAW rendering in progress…</span></div>` : ""}

        ${scanResult && scanResult.unreadableEntries > 0 ? `<p class="warning-message">${scanResult.unreadableEntries} unreadable item${scanResult.unreadableEntries === 1 ? " was" : "s were"} skipped safely.</p>` : ""}
      </section>

      <aside class="details-panel" id="details-panel" aria-label="Photo details">
        <div class="sidebar-heading panel-header"><p class="eyebrow">Details</p></div>
        <div class="details-body panel-body" id="details-body">
        ${renderDetailsContent()}
        </div>
        ${renderDetailsSupportFooter()}
      </aside>
    </section>
    ${(isScanning || isGeneratingThumbnails) ? `
      <div class="scan-backdrop">
        <div class="scan-modal">
          <div class="scan-spinner"></div>
          <h3>${isScanning ? "Scanning Folder" : "Processing Images"}</h3>
          <p>
            ${isScanning 
              ? `Scanning folder entries… found ${scanProgress?.imagesFound ?? 0} supported images so far`
              : `Processing images: ${thumbnailProgress?.completed ?? 0} of ${thumbnailProgress?.total ?? 0}`
            }
          </p>
          <div class="scan-progress-container" style="${isGeneratingThumbnails ? "" : "display: none;"}">
            <div class="scan-progress-bar" style="width: ${isGeneratingThumbnails && thumbnailProgress ? ((thumbnailProgress.completed / (thumbnailProgress.total || 1)) * 100) : 0}%"></div>
          </div>
        </div>
      </div>
    ` : ""}
  `;

  renderViewer();

  document.querySelector("#add-folder")?.addEventListener("click", chooseFolder);
  document.querySelector<HTMLSelectElement>("#thumbnail-sort-key")?.addEventListener("change", (event) => {
    thumbnailSortKey = (event.currentTarget as HTMLSelectElement).value as ThumbnailSortKey;
    sortThumbnails();
    void saveDisplayPreferences();
    render();
  });
  document.querySelector("#thumbnail-sort-direction")?.addEventListener("click", () => {
    thumbnailSortAscending = !thumbnailSortAscending;
    sortThumbnails();
    void saveDisplayPreferences();
    render();
  });
  document.querySelector("#reset-catalogue")?.addEventListener("click", async () => {
    const confirmed = await ask(
      "This will wipe the entire catalogue, thumbnail records, and cached thumbnail image files, then rescan all folders from scratch.\n\nContinue?",
      { title: "⚠ Reset & Rescan", kind: "warning" }
    );
    if (!confirmed) return;
    try {
      closeViewer();
      await invoke<void>("reset_catalogue");
      scanResult = null;
      thumbnails = [];
      selectedThumbnailPath = null;
      selectedThumbnailPaths.clear();
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
    scheduleDisplayPreferencesSave();
  });
  document.querySelectorAll<HTMLElement>("[data-toggle-folder]").forEach((toggle) => toggle.addEventListener("click", (event) => { event.stopPropagation(); const path = toggle.dataset.toggleFolder; if (path) { expandedFolders.has(path) ? expandedFolders.delete(path) : expandedFolders.add(path); render(); } }));
  document.querySelector("[data-toggle-top-level-folders]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (settings.watchedFolders.some((folder) => expandedFolders.has(folder))) {
      expandedFolders.clear();
    } else {
      settings.watchedFolders.forEach((folder) => expandedFolders.add(folder));
    }
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-select-folder]").forEach((button) => button.addEventListener("click", () => { closeViewer(); activeFolder = button.dataset.selectFolder ?? null; scanResult = null; thumbnails = []; selectedThumbnailPath = null; selectedThumbnailPaths.clear(); selectedMetadata = null; render(); void scanSelectedFolder(); }));

  const searchInput = document.querySelector<HTMLInputElement>("#search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      searchQuery = (event.target as HTMLInputElement).value;
      render();
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        searchQuery = "";
        render();
      }
    });
  }

  document.querySelector("#search-clear")?.addEventListener("click", () => {
    searchQuery = "";
    render();
  });

  if (isSearchFocused) {
    const searchInput = document.querySelector<HTMLInputElement>("#search-input");
    if (searchInput) {
      searchInput.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        searchInput.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }
  // Wire up details panel autocomplete if input exists in DOM after rendering
  const tagInput = document.querySelector<HTMLInputElement>("#add-tag-input");
  const suggestionsHost = document.querySelector<HTMLElement>("#tag-suggestions");
  const paths = Array.from(selectedThumbnailPaths);
  if (tagInput && suggestionsHost && paths.length > 0) {
    wireTagAutocomplete(tagInput, suggestionsHost, paths);
  }

  const restoredFolderList = document.querySelector<HTMLElement>(".folder-list");
  if (restoredFolderList) {
    restoredFolderList.scrollTop = savedFolderScroll.top;
    restoredFolderList.scrollLeft = savedFolderScroll.left;
  }
  const restoredFilePanel = document.querySelector<HTMLElement>(".file-panel");
  if (restoredFilePanel) {
    restoredFilePanel.scrollTop = savedFileScroll.top;
    restoredFilePanel.scrollLeft = savedFileScroll.left;
  }
}

async function chooseFolder(): Promise<void> {
  errorMessage = "";
  closeViewer();
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
    selectedThumbnailPaths.clear();
    selectedMetadata = null;
    await scanSelectedFolder();
  } catch (error) {
    errorMessage = String(error);
    render();
  }
}

async function removeFolder(folderPath: string | null = activeFolder): Promise<void> {
  try {
    closeViewer();
    if (!folderPath || folderPath === ALL_FOLDERS) return;
    settings = await invoke<AppSettings>("remove_folder_from_browser", { folder: folderPath });
    if (activeFolder && isSameOrNestedPath(activeFolder, folderPath)) {
      activeFolder = settings.watchedFolders.length ? ALL_FOLDERS : null;
    }
    await loadFolderTrees();
    scanResult = null;
    await loadCatalogFiles(activeFolder);
    scanProgress = null;
    selectedThumbnailPath = null;
    selectedThumbnailPaths.clear();
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
      fileSize: file.fileSize,
      dateTaken: file.dateTaken,
      lastModified: file.lastModified,
    }));
    sortThumbnails();
    if (folder && folder !== ALL_FOLDERS) {
      void invoke("prioritize_raw_rendering_for_folder", { folder });
    }
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
  selectedThumbnailPaths.clear();
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
    await loadAllCatalogTags();

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
  folderEntries = trees.flat().filter((entry) => !settings.excludedFolders.some((folder) => isSameOrNestedPath(entry.path, folder)));
}

async function refreshCacheSize(): Promise<void> {
  try {
    thumbnailCacheBytes = await invoke<number>("thumbnail_cache_size");
  } catch {
    thumbnailCacheBytes = 0;
  }
}

window.addEventListener("error", (event) => {
  const err = event.error;
  const msg = err 
    ? `${err.message || String(err)}\nStack:\n${err.stack || ""}`
    : event.message;
  void invoke("log_frontend_error", { msg: `Unhandled Window Error: ${msg}` });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = reason 
    ? `${reason.message || String(reason)}\nStack:\n${reason.stack || ""}`
    : "Promise rejection";
  void invoke("log_frontend_error", { msg: `Unhandled Promise Rejection: ${msg}` });
});

async function initialize(): Promise<void> {
  try {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    contextMenuHost.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const action = target.closest<HTMLButtonElement>("[data-context-action]")?.dataset.contextAction;
      const menu = contextMenu;
      if (!action || !menu) {
        return;
      }

      dismissContextMenu();
      if (action === "open-preview" && menu.kind === "image") {
        openViewer(menu.path);
      } else if (action === "reveal-file" && menu.kind === "image") {
        try {
          await invoke<void>("show_item_in_file_manager", { path: menu.path });
        } catch (error) {
          errorMessage = String(error);
          render();
        }
      } else if (action === "remove-or-delete" && menu.kind === "image") {
        showRemovalDialog(menu.path);
      } else if (action === "open-folder" && menu.kind === "folder") {
        try {
          await invoke<void>("open_folder_in_file_manager", { path: menu.path });
        } catch (error) {
          errorMessage = String(error);
          render();
        }
      } else if (action === "remove-folder" && menu.kind === "folder") {
        await removeFolder(menu.path);
      } else if (action === "copy-name" && menu.kind === "image") {
        await navigator.clipboard.writeText(folderName(menu.path));
      } else if (action === "copy-path") {
        await navigator.clipboard.writeText(menu.path);
      } else if (action === "copy-image" && menu.kind === "image") {
        try {
          document.body.style.cursor = "wait";
          await invoke<void>("copy_image_to_clipboard", { path: menu.path });
        } catch (error) {
          console.error("Failed to copy image to clipboard:", error);
        } finally {
          document.body.style.cursor = "default";
        }
      }
    });
    removalDialogHost.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const action = target.closest<HTMLButtonElement>("[data-removal-action]")?.dataset.removalAction;
      if (action === "cancel" || target.classList.contains("removal-backdrop")) {
        dismissRemovalDialog();
      } else if (action === "catalogue" || action === "disk") {
        void removePhoto(action);
      }
    });
    viewerHost.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("#close-viewer")) {
        closeViewer();
        return;
      }
      if (target.closest("#viewer-prev")) {
        const filtered = getFilteredThumbnails();
        const currentIndex = filtered.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
        void navigateToImage(currentIndex - 1);
        return;
      }
      if (target.closest("#viewer-next")) {
        const filtered = getFilteredThumbnails();
        const currentIndex = filtered.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
        void navigateToImage(currentIndex + 1);
        return;
      }
      if (target.classList.contains("viewer-backdrop") && !ignoreViewerBackdropClick) {
        closeViewer();
      }
    });
    viewerHost.addEventListener("contextmenu", (event) => {
      if (!viewerSourcePath) {
        return;
      }
      event.preventDefault();
      showContextMenu({
        kind: "image",
        path: viewerSourcePath,
        x: event.clientX,
        y: event.clientY,
      });
    });
    document.addEventListener("click", (event) => {
      if (ignoreContextMenuDismiss || (event instanceof MouseEvent && event.button !== 0)) {
        return;
      }
      if (event.target instanceof Element && event.target.closest("#context-menu-host")) {
        return;
      }
      if (contextMenu) dismissContextMenu();
    });
    app?.addEventListener("click", (event) => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        
        const rateButton = target.closest<HTMLButtonElement>("[data-rate-value]");
        if (rateButton && selectedThumbnailPaths.size > 0) {
          const rating = Number(rateButton.dataset.rateValue);
          if (selectedThumbnailPaths.size === 1) {
            void setPhotoRating(Array.from(selectedThumbnailPaths)[0], rating);
          } else {
            void setMultiplePhotosRating(Array.from(selectedThumbnailPaths), rating);
          }
          return;
        }

        const clearRatingButton = target.closest<HTMLButtonElement>("#clear-rating");
        if (clearRatingButton && selectedThumbnailPaths.size > 0) {
          if (selectedThumbnailPaths.size === 1) {
            void setPhotoRating(Array.from(selectedThumbnailPaths)[0], null);
          } else {
            void setMultiplePhotosRating(Array.from(selectedThumbnailPaths), null);
          }
          return;
        }

        const removeTagButton = target.closest<HTMLButtonElement>("[data-remove-tag]");
        if (removeTagButton && selectedThumbnailPaths.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          const tagToRemove = removeTagButton.dataset.removeTag;
          const paths = Array.from(selectedThumbnailPaths);
          if (tagToRemove) {
            if (paths.length === 1) {
              void removePhotoTag(paths[0], tagToRemove);
            } else {
              void removeMultiplePhotosTag(paths, tagToRemove);
            }
          }
          return;
        }

        if (target.closest("#folder-options-button")) {
          sidebarMenuOpen = !sidebarMenuOpen;
          render();
          return;
        }
        if (contextMenu && !target.closest("#context-menu-host")) {
          dismissContextMenu();
        }
        const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
        const index = Number(card?.dataset.thumbnailIndex);
        const filtered = getFilteredThumbnails();
        const thumbnail = Number.isInteger(index) ? filtered[index] : undefined;
        if (thumbnail) {
          if (event.detail >= 2) {
            event.preventDefault();
            event.stopPropagation();
            openViewer(thumbnail.sourcePath);
            return;
          }

          const mouseEvent = event as MouseEvent;
          const isCmdOrCtrl = mouseEvent.metaKey || mouseEvent.ctrlKey;
          const isShift = mouseEvent.shiftKey;

          if (isShift && selectedThumbnailPath) {
            const anchorIndex = filtered.findIndex(t => t.sourcePath === selectedThumbnailPath);
            if (anchorIndex !== -1) {
              const start = Math.min(anchorIndex, index);
              const end = Math.max(anchorIndex, index);
              
              if (!isCmdOrCtrl) {
                selectedThumbnailPaths.clear();
              }
              
              for (let i = start; i <= end; i++) {
                selectedThumbnailPaths.add(filtered[i].sourcePath);
              }
              
              selectedThumbnailPath = thumbnail.sourcePath;
              selectedMetadata = catalogMetadata.get(thumbnail.sourcePath) ?? null;
              metadataError = null;
              updateSelectionUI();
              return;
            }
          }

          if (isCmdOrCtrl) {
            if (selectedThumbnailPaths.has(thumbnail.sourcePath)) {
              selectedThumbnailPaths.delete(thumbnail.sourcePath);
              if (selectedThumbnailPath === thumbnail.sourcePath) {
                const remaining = Array.from(selectedThumbnailPaths);
                selectedThumbnailPath = remaining.length > 0 ? remaining[remaining.length - 1] : null;
                selectedMetadata = selectedThumbnailPath ? catalogMetadata.get(selectedThumbnailPath) ?? null : null;
              }
            } else {
              selectedThumbnailPaths.add(thumbnail.sourcePath);
              selectedThumbnailPath = thumbnail.sourcePath;
              selectedMetadata = catalogMetadata.get(thumbnail.sourcePath) ?? null;
            }
            metadataError = null;
            updateSelectionUI();
            return;
          }

          selectedThumbnailPaths.clear();
          selectedThumbnailPaths.add(thumbnail.sourcePath);
          void selectAndLoadMetadata(thumbnail.sourcePath);
        }
      } catch (error: any) {
        const msg = error ? (error.stack || error.message || String(error)) : "Unknown click error";
        void invoke("log_frontend_error", { msg: `Error in click listener: ${msg}` });
      }
    });
    app?.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const filtered = getFilteredThumbnails();
      const thumbnail = Number.isInteger(index) ? filtered[index] : undefined;
      if (thumbnail) {
        event.preventDefault();
        openViewer(thumbnail.sourcePath);
      }
    });
    app?.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const folder = target.closest<HTMLElement>("[data-folder-path]");
      const folderPath = folder?.dataset.folderPath;
      if (folderPath) {
        event.preventDefault();
        showContextMenu({
          kind: "folder",
          path: folderPath,
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }
      const card = target.closest<HTMLButtonElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const filtered = getFilteredThumbnails();
      const thumbnail = Number.isInteger(index) ? filtered[index] : undefined;
      if (!thumbnail) {
        return;
      }
      event.preventDefault();
      showContextMenu({
        kind: "image",
        path: thumbnail.sourcePath,
        x: event.clientX,
        y: event.clientY,
      });
    });
    document.addEventListener("keydown", (event) => {
      if (removalPath) {
        if (event.key === "Escape") {
          event.preventDefault();
          dismissRemovalDialog();
        }
        return;
      }
      if (contextMenu && event.key === "Escape") {
        event.preventDefault();
        dismissContextMenu();
        return;
      }
      if (sidebarMenuOpen && event.key === "Escape") {
        event.preventDefault();
        sidebarMenuOpen = false;
        render();
        return;
      }
      if (!isFormControl(event.target) && selectedThumbnailPath && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        showRemovalDialog(selectedThumbnailPath);
        return;
      }
      if (!isFormControl(event.target) && selectedThumbnailPath && ["0", "1", "2", "3", "4", "5"].includes(event.key)) {
        event.preventDefault();
        const rating = event.key === "0" ? null : Number(event.key);
        void setPhotoRating(selectedThumbnailPath, rating);
        return;
      }
      if (viewerSourcePath) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeViewer();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          const filtered = getFilteredThumbnails();
          const currentIndex = filtered.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex > 0) {
            void navigateToImage(currentIndex - 1);
          }
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          const filtered = getFilteredThumbnails();
          const currentIndex = filtered.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex >= 0 && currentIndex < filtered.length - 1) {
            void navigateToImage(currentIndex + 1);
          }
        }
        return;
      }

      if (isFormControl(event.target) || !thumbnails.length) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveGridSelection(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveGridSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveGridSelection(-gridColumnCount());
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveGridSelection(gridColumnCount());
      } else if ((event.key === "Enter" || event.key === " ") && selectedThumbnailPath) {
        event.preventDefault();
        openViewer(selectedThumbnailPath);
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
    await listen("catalogue-updated", async () => {
      if (activeFolder) {
        await loadCatalogFiles(activeFolder);
        render();
      }
    });
    await listen<boolean>("raw-rendering-status", (event) => {
      isRawRendering = event.payload;
      render();
    });
    settings = await invoke<AppSettings>("load_settings");
    try {
      const appVersion = await invoke<string>("get_app_version");
      const isDev = (import.meta as any).env.DEV;
      let title = `Peter’s Photo Manager v${appVersion}`;
      if (isDev) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        title += `-${localIso}`;
      }
      await getCurrentWindow().setTitle(title);
    } catch (err) {
      console.error("Failed to set window title:", err);
    }
    await refreshCacheSize();
    await loadAllCatalogTags();
    thumbnailSize = settings.thumbnailSize;
    thumbnailSortKey = settings.thumbnailSortKey;
    thumbnailSortAscending = settings.thumbnailSortAscending;
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
