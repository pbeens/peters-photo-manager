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
  hideEmptyFolders: boolean;
  hideOriginals: boolean;
  selectedFolder: string | null;
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
const editorHost = document.createElement("div");
editorHost.id = "editor-host";
document.body.append(editorHost);
const contextMenuHost = document.createElement("div");
contextMenuHost.id = "context-menu-host";
document.body.append(contextMenuHost);
const removalDialogHost = document.createElement("div");
removalDialogHost.id = "removal-dialog-host";
document.body.append(removalDialogHost);
const folderDialogHost = document.createElement("div");
folderDialogHost.id = "folder-dialog-host";
document.body.append(folderDialogHost);
const ALL_FOLDERS = "__all_folders__";

let settings: AppSettings = {
  watchedFolders: [],
  excludedFolders: [],
  thumbnailSize: 180,
  thumbnailSortKey: "name",
  thumbnailSortAscending: true,
  hideEmptyFolders: true,
  hideOriginals: true,
  selectedFolder: null,
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
let hideOriginals = true;
let sidebarMenuOpen = false;
let thumbnailSortKey: ThumbnailSortKey = "name";
let thumbnailSortAscending = true;
let scanRequestId = 0;
let viewerSourcePath: string | null = null;
let ignoreViewerBackdropClick = false;
let editorSourcePath: string | null = null;
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

type EditorAdjustments = {
  brightness: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  saturation: number;
  vignetteAmount: number;
  vignetteSize: number;
  vignetteFeather: number;
  frameSize: number;
  blackAndWhite: "none" | "neutral" | "contrast" | "matte" | "soft";
  frameStyle: "none" | "gallery" | "film" | "matte" | "polaroid";
};

const defaultEditorAdjustments = (): EditorAdjustments => ({
  brightness: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  vignetteAmount: 0,
  vignetteSize: 50,
  vignetteFeather: 50,
  frameSize: 0,
  blackAndWhite: "none",
  frameStyle: "none",
});

let editorAdjustments = defaultEditorAdjustments();
let editorStraightenMode: "horizontal" | "vertical" | null = null;
let editorStraightenStart: { x: number; y: number } | null = null;
let editorHorizontalRotation: number | null = null;
let editorVerticalRotation: number | null = null;
let editorMenuOpen = false;
let clippingIndicatorEnabled = false;
let editorAltClippingPreview = false;
let clippingCanvasSource: HTMLImageElement | null = null;
let clippingCanvasSourcePath: string | null = null;
let clippingCanvasObjectUrl: string | null = null;
const editorSectionStorageKey = "peters-photo-manager.editor-section-state";
const editorSaveOriginalStorageKey = "peters-photo-manager.editor-save-original-strategy";
const editorRevealSavedStorageKey = "peters-photo-manager.editor-reveal-saved-file";
const editorClippingStorageKey = "peters-photo-manager.editor-clipping-indicator";
const editorFrameSizeStorageKey = "peters-photo-manager.editor-frame-size";
type EditorSaveOriginalStrategy = "originals-subfolder" | "filename-original" | "overwrite";
let editorSaveOriginalStrategy: EditorSaveOriginalStrategy = "originals-subfolder";
let editorRevealSavedFile = false;
let editorSavedOutputPath: string | null = null;
let editorSaveError: string | null = null;
let isRefreshingSavedCatalogue = false;
let editorRecipeSaveTimer: number | null = null;
let restoringEditorRecipe = false;
type StoredEditRecipe = { adjustments: EditorAdjustments; rotation: number };
type EditedImageSaveResult = { outputPath: string; archivedOriginalPath?: string };
const editRecipeCache = new Map<string, StoredEditRecipe>();
type EditorSliderKey = Exclude<keyof EditorAdjustments, "blackAndWhite" | "frameStyle">;
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

function shouldShowFolder(path: string): boolean {
  if (hideOriginals && folderName(path).toLocaleLowerCase() === "originals") {
    return false;
  }
  if (!hideEmptyFolders) {
    return true;
  }
  const entry = folderEntries.find((e) => e.path === path);
  if (entry && entry.containsImages) {
    return true;
  }
  if (activeFolder === path || expandedFolders.has(path)) {
    return true;
  }
  return folderEntries.some(
    (e) => isSameOrNestedPath(e.path, path) && (activeFolder === e.path || expandedFolders.has(e.path))
  );
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
    ? `<li><button data-context-action="open-folder" type="button">${folderOpenLabel()}</button></li><li><button data-context-action="create-subfolder" type="button">Create subfolder</button></li><li><button data-context-action="copy-path" type="button">Copy folder path</button></li><li><button data-context-action="remove-folder" type="button">Remove folder</button></li>`
    : `${!viewerSourcePath ? `<li><button data-context-action="open-preview" type="button">Open preview</button></li>` : ""}<li><button data-context-action="reveal-file" type="button">${folderOpenLabel()}</button></li><li><button data-context-action="copy-name" type="button">Copy filename</button></li><li><button data-context-action="copy-path" type="button">Copy complete path</button></li><li><button data-context-action="copy-image" type="button">Copy image</button></li><li><button data-context-action="remove-or-delete" type="button">Remove or delete…</button></li>`;

  contextMenuHost.innerHTML = `<menu class="image-context-menu" style="visibility:hidden;position:fixed;left:${contextMenu.x}px;top:${contextMenu.y}px">${actions}</menu>`;

  const menuEl = contextMenuHost.querySelector<HTMLElement>(".image-context-menu");
  if (menuEl) {
    const rect = menuEl.getBoundingClientRect();
    let x = contextMenu.x;
    let y = contextMenu.y;

    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }
    if (y < 8) {
      y = 8;
    }
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }
    if (x < 8) {
      x = 8;
    }

    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    menuEl.style.visibility = "visible";
  }
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

let folderCreateState: { clickedPath: string } | null = null;

function showFolderCreateDialog(clickedPath: string): void {
  folderCreateState = { clickedPath };
  dismissContextMenu();
  folderDialogHost.innerHTML = `
    <div class="removal-backdrop" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title">
      <section class="removal-dialog">
        <p class="eyebrow">Create subfolder</p>
        <h2 id="folder-dialog-title">New folder name</h2>
        <p style="margin-bottom: 12px; color: #5e5b54;">Creating in: <span style="word-break: break-all; font-family: monospace;">${escapeHtml(clickedPath)}</span></p>
        <input type="text" id="folder-name-input" class="folder-name-input" placeholder="Folder name" autofocus />
        <div class="removal-actions">
          <button class="secondary-button" data-folder-dialog-action="cancel" type="button">Cancel</button>
          <button class="primary-button" data-folder-dialog-action="create" type="button">Create</button>
        </div>
      </section>
    </div>`;

  const input = document.getElementById("folder-name-input") as HTMLInputElement;
  input?.focus();
  input?.select();

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitFolderCreation();
    } else if (event.key === "Escape") {
      event.preventDefault();
      dismissFolderCreateDialog();
    }
  });
}

function dismissFolderCreateDialog(): void {
  folderCreateState = null;
  folderDialogHost.replaceChildren();
}

async function submitFolderCreation(): Promise<void> {
  if (!folderCreateState) {
    return;
  }
  const input = document.getElementById("folder-name-input") as HTMLInputElement;
  const name = input?.value.trim();
  if (!name) {
    errorMessage = "Folder name cannot be empty.";
    render();
    return;
  }
  const clickedPath = folderCreateState.clickedPath;
  dismissFolderCreateDialog();
  try {
    document.body.style.cursor = "wait";
    const newDirPath = await invoke<string>("create_directory", { parentPath: clickedPath, name });
    expandedFolders.add(clickedPath);
    expandedFolders.add(newDirPath);
    await loadFolderTrees();
    setActiveFolder(newDirPath);
    thumbnails = [];
    selectedThumbnailPath = null;
    selectedThumbnailPaths.clear();
    selectedMetadata = null;
    errorMessage = "";
    render();
    void scanSelectedFolder();
  } catch (error) {
    errorMessage = String(error);
    render();
  } finally {
    document.body.style.cursor = "default";
  }
}

async function moveFilesToFolder(paths: string[], targetFolderPath: string): Promise<void> {
  const pathsToMove = paths.filter((path) => parentPath(path) !== targetFolderPath);
  if (pathsToMove.length === 0) {
    return;
  }

  try {
    document.body.style.cursor = "wait";
    await invoke<void>("move_files", { paths: pathsToMove, targetFolder: targetFolderPath });

    // Clear selection
    selectedThumbnailPath = null;
    selectedThumbnailPaths.clear();
    selectedMetadata = null;

    // Reload files and folder tree
    await loadFolderTrees();
    if (activeFolder) {
      await loadCatalogFiles(activeFolder);
    }

    errorMessage = "";
    render();
  } catch (error) {
    errorMessage = String(error);
    render();
  } finally {
    document.body.style.cursor = "default";
  }
}

function setActiveFolder(folder: string | null): void {
  activeFolder = folder;
  void saveSelectedFolder(folder);
}

async function saveSelectedFolder(folder: string | null): Promise<void> {
  try {
    settings = { ...settings, selectedFolder: folder };
    await invoke("set_selected_folder", { folder });
  } catch (error) {
    console.error("Could not save selected folder:", error);
  }
}

function renderFolderTree(path: string, depth: number): string {
  const children = folderEntries.filter((entry) => parentPath(entry.path) === path && shouldShowFolder(entry.path));
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
      hideEmptyFolders,
      hideOriginals,
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
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, div[role='button']:not(.thumbnail-card)"));
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
  closeEditor();
  viewerHost.replaceChildren();
}

function openEditor(): void {
  if (!viewerSourcePath) return;
  editorSourcePath = viewerSourcePath;
  editorAdjustments = defaultEditorAdjustments();
  const savedFrameSize = Number(window.localStorage.getItem(editorFrameSizeStorageKey));
  if (Number.isFinite(savedFrameSize) && savedFrameSize >= 0 && savedFrameSize <= 100) editorAdjustments.frameSize = savedFrameSize;
  clippingIndicatorEnabled = window.localStorage.getItem(editorClippingStorageKey) === "true";
  editorStraightenMode = null;
  editorStraightenStart = null;
  editorHorizontalRotation = null;
  editorVerticalRotation = null;
  editorMenuOpen = false;
  editorSavedOutputPath = null;
  editorSaveError = null;
  editorRevealSavedFile = window.localStorage.getItem(editorRevealSavedStorageKey) === "true";
  restoringEditorRecipe = true;
  const savedStrategy = window.localStorage.getItem(editorSaveOriginalStorageKey);
  if (savedStrategy === "originals-subfolder" || savedStrategy === "filename-original" || savedStrategy === "overwrite") {
    editorSaveOriginalStrategy = savedStrategy;
  }
  renderEditor();
  void updateEditorPreview();
  void restoreEditorRecipe(editorSourcePath);
}

function closeEditor(): void {
  const savedOutputPath = editorSavedOutputPath;
  if (!savedOutputPath) applyViewerEditPreview();
  if (editorRecipeSaveTimer !== null) {
    window.clearTimeout(editorRecipeSaveTimer);
    editorRecipeSaveTimer = null;
    void saveEditorRecipe();
  }
  editorSourcePath = null;
  editorSavedOutputPath = null;
  editorSaveError = null;
  editorStraightenMode = null;
  editorStraightenStart = null;
  if (clippingCanvasObjectUrl) URL.revokeObjectURL(clippingCanvasObjectUrl);
  clippingCanvasObjectUrl = null;
  clippingCanvasSource = null;
  clippingCanvasSourcePath = null;
  editorHost.replaceChildren();
  if (savedOutputPath && viewerSourcePath === savedOutputPath) {
    renderViewer();
    void updateViewerUI();
  }
}

function savedFileManagerLabel(): string {
  return navigator.userAgent.includes("Macintosh") ? "Finder" : "Explorer";
}

function editorHasEdits(): boolean {
  const defaults = defaultEditorAdjustments();
  return editorRotation() !== 0 || Object.entries(defaults).some(([key, value]) => {
    const adjustment = key as keyof EditorAdjustments;
    if (adjustment === "frameSize" && editorAdjustments.frameStyle === "none") return false;
    return editorAdjustments[adjustment] !== value;
  });
}

async function saveEditorImage(): Promise<void> {
  if (!editorSourcePath || !editorHasEdits()) {
    closeEditor();
    return;
  }
  if (editorSaveOriginalStrategy === "overwrite") {
    const approved = await ask(
      "This will permanently replace the original photo. The original cannot be restored by Peter’s Photo Manager yet. Continue?",
      { title: "Overwrite original?", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" },
    );
    if (!approved) return;
  }
  const sourcePath = editorSourcePath;
  const sourceThumbnail = thumbnails.find((thumbnail) => thumbnail.sourcePath === sourcePath);
  const saveButton = editorHost.querySelector<HTMLButtonElement>("#save-editor");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
  }
  try {
    const result = await invoke<EditedImageSaveResult>("save_edited_image", {
      path: sourcePath,
      adjustments: editorAdjustments,
      rotation: editorRotation(),
      originalSaveStrategy: editorSaveOriginalStrategy,
    });
    editRecipeCache.delete(sourcePath);
    viewerSourcePath = result.outputPath;
    selectedThumbnailPath = result.outputPath;
    selectedThumbnailPaths.clear();
    selectedThumbnailPaths.add(result.outputPath);
    if (!thumbnails.some((thumbnail) => thumbnail.sourcePath === result.outputPath)) {
      thumbnails.push({
        name: result.outputPath.split(/[\\/]/).pop() ?? result.outputPath,
        sourcePath: result.outputPath,
        thumbnailPath: sourceThumbnail?.thumbnailPath ?? "",
        fileSize: 0,
        lastModified: Date.now(),
      });
      sortThumbnails();
    }
    render();
    void updateViewerUI();
    editorSourcePath = result.outputPath;
    editorSavedOutputPath = result.outputPath;
    editorSaveError = null;
    editorAdjustments = defaultEditorAdjustments();
    editorHorizontalRotation = null;
    editorVerticalRotation = null;
    renderEditor();
    void updateEditorPreview();
    void refreshCatalogueAfterEditorSave();
    if (editorRevealSavedFile) {
      try {
        await invoke<void>("show_item_in_file_manager", { path: result.outputPath });
      } catch (revealError) {
        console.warn("Could not reveal saved image", revealError);
      }
    }
  } catch (error) {
    console.error("Could not save edited image", error);
    editorSaveError = `Could not save: ${String(error)}`;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
    const editState = editorHost.querySelector<HTMLElement>(".editor-header small");
    if (editState) editState.textContent = editorSaveError;
  }
}

async function refreshCatalogueAfterEditorSave(): Promise<void> {
  if (isRefreshingSavedCatalogue) return;
  isRefreshingSavedCatalogue = true;
  try {
    const folderToScan = activeFolder && activeFolder !== ALL_FOLDERS ? activeFolder : null;
    if (folderToScan) {
      await invoke<ScanResult>("scan_folder", { folder: folderToScan });
    } else {
      await invoke<ScanResult>("scan_folders", { folders: settings.watchedFolders });
    }
    await loadCatalogFiles(activeFolder);
    selectedMetadata = viewerSourcePath ? catalogMetadata.get(viewerSourcePath) ?? null : null;
    render();
    void updateViewerUI();
  } catch (error) {
    console.warn("Could not refresh the catalogue after saving an image", error);
  } finally {
    isRefreshingSavedCatalogue = false;
    isScanning = false;
    isGeneratingThumbnails = false;
    thumbnailProgress = null;
    render();
  }
}

function applyViewerEditPreview(): void {
  if (!viewerSourcePath || viewerSourcePath !== editorSourcePath) return;
  const filter = editorFilter();
  const transform = `rotate(${editorRotation().toFixed(2)}deg)`;
  viewerHost.querySelectorAll<HTMLImageElement>("#viewer-preview, #viewer-image").forEach((image) => {
    image.style.filter = filter;
    image.style.transform = transform;
  });
}

function scheduleEditorRecipeSave(): void {
  if (!editorSourcePath || restoringEditorRecipe) return;
  if (editorRecipeSaveTimer !== null) window.clearTimeout(editorRecipeSaveTimer);
  editorRecipeSaveTimer = window.setTimeout(() => {
    editorRecipeSaveTimer = null;
    void saveEditorRecipe();
  }, 350);
}

async function saveEditorRecipe(): Promise<void> {
  if (!editorSourcePath) return;
  const thumbnail = getFilteredThumbnails().find((item) => item.sourcePath === editorSourcePath);
  if (!thumbnail) return;
  const settingsJson = JSON.stringify({ adjustments: editorAdjustments, rotation: editorRotation() });
  const recipe: StoredEditRecipe = { adjustments: { ...editorAdjustments }, rotation: editorRotation() };
  editRecipeCache.set(thumbnail.sourcePath, recipe);
  applyThumbnailEditPreview(thumbnail.sourcePath, recipe);
  try {
    await invoke("save_edit_recipe", {
      path: thumbnail.sourcePath,
      fileSize: thumbnail.fileSize,
      lastModified: thumbnail.lastModified,
      settingsJson,
    });
  } catch (error) {
    console.error("Could not save edit recipe", error);
  }
}

async function restoreEditorRecipe(path: string): Promise<void> {
  const thumbnail = getFilteredThumbnails().find((item) => item.sourcePath === path);
  if (!thumbnail) {
    restoringEditorRecipe = false;
    return;
  }
  restoringEditorRecipe = true;
  try {
    const settingsJson = await invoke<string | null>("get_edit_recipe", {
      path: thumbnail.sourcePath,
      fileSize: thumbnail.fileSize,
      lastModified: thumbnail.lastModified,
    });
    if (!settingsJson || editorSourcePath !== path) return;
    const recipe = JSON.parse(settingsJson) as { adjustments?: Partial<EditorAdjustments>; rotation?: number };
    editorAdjustments = { ...defaultEditorAdjustments(), ...recipe.adjustments };
    if (typeof recipe.rotation === "number") editorHorizontalRotation = recipe.rotation;
    editRecipeCache.set(path, { adjustments: { ...editorAdjustments }, rotation: editorRotation() });
    renderEditor();
    void updateEditorPreview();
  } catch (error) {
    console.error("Could not restore edit recipe", error);
  } finally {
    restoringEditorRecipe = false;
  }
}

function editorSectionIsOpen(section: string): boolean {
  try {
    const state = JSON.parse(window.localStorage.getItem(editorSectionStorageKey) ?? "{}") as Record<string, boolean>;
    return state[section] ?? true;
  } catch {
    return true;
  }
}

function saveEditorSectionState(section: string, isOpen: boolean): void {
  try {
    const state = JSON.parse(window.localStorage.getItem(editorSectionStorageKey) ?? "{}") as Record<string, boolean>;
    state[section] = isOpen;
    window.localStorage.setItem(editorSectionStorageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save editor section state", error);
  }
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
        <button class="viewer-edit" id="open-editor" type="button">Edit</button>
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

function renderEditor(): void {
  const thumbnail = editorSourcePath
    ? getFilteredThumbnails().find((item) => item.sourcePath === editorSourcePath)
    : null;
  if (!editorSourcePath || !thumbnail) {
    closeEditor();
    return;
  }
  editorHost.innerHTML = `
    <div class="editor-backdrop" role="dialog" aria-modal="true" aria-label="Photo editor">
      <section class="editor-window">
        <header class="editor-header"><div><strong>Edit</strong><span>${escapeHtml(thumbnail.name)}</span><small>${editorSaveError ?? (editorHasEdits() ? "Unsaved edits" : editorSavedOutputPath ? "Saved" : "No edits yet")}</small></div><div class="editor-header-actions"><div class="editor-menu"><button id="editor-more-menu" type="button" aria-expanded="${editorMenuOpen}" aria-label="Editor options">•••</button><div class="editor-menu-popover" ${editorMenuOpen ? "" : "hidden"}><label class="folder-option-toggle editor-clipping-toggle" title="Toggle with J. Hold Alt on Windows or Option on macOS while moving a Light slider to preview clipping."><input id="clipping-indicator-toggle" type="checkbox" ${clippingIndicatorEnabled ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span><span>Clipping indicator</span></label><label class="folder-option-toggle editor-reveal-toggle"><input id="reveal-saved-file-toggle" type="checkbox" ${editorRevealSavedFile ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span><span>Open saved file in ${savedFileManagerLabel()}</span></label><fieldset class="editor-save-options"><legend>When saving an edited version</legend><label><input name="save-original-strategy" value="originals-subfolder" type="radio" ${editorSaveOriginalStrategy === "originals-subfolder" ? "checked" : ""} /> Originals subfolder</label><label><input name="save-original-strategy" value="filename-original" type="radio" ${editorSaveOriginalStrategy === "filename-original" ? "checked" : ""} /> filename_original.EXT</label><label><input name="save-original-strategy" value="overwrite" type="radio" ${editorSaveOriginalStrategy === "overwrite" ? "checked" : ""} /> Overwrite original</label></fieldset></div></div><button id="save-editor" type="button">${editorHasEdits() ? "Save" : "Done"}</button></div></header>
        <div class="editor-media" id="editor-media"><img id="editor-preview" src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}?t=${thumbnail.lastModified}" alt="${escapeHtml(thumbnail.name)}" /><img id="editor-image" src="" alt="${escapeHtml(thumbnail.name)}" /><div id="editor-vignette" aria-hidden="true"></div><div id="editor-frame" aria-hidden="true"></div><canvas id="clipping-overlay" aria-hidden="true"></canvas><svg id="straighten-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line /></svg></div>
        <aside class="editor-panel">
          <div class="editor-panel-heading"><h2>Adjustments</h2><button class="editor-reset" data-editor-action="reset" type="button">Reset</button></div>
          <details class="editor-section" data-editor-section="light" ${editorSectionIsOpen("light") ? "open" : ""}><summary>Light</summary>
            ${editorSlider("brightness", "Brightness", -100, 100)}
            ${editorSlider("exposure", "Exposure", -5, 5, 0.1)}
            ${editorSlider("contrast", "Contrast", -100, 100)}
            ${editorSlider("highlights", "Highlights", -100, 100)}
            ${editorSlider("shadows", "Shadows", -100, 100)}
            ${editorSlider("whites", "Whites", -100, 100)}
            ${editorSlider("blacks", "Blacks", -100, 100)}
          </details>
          <details class="editor-section" data-editor-section="colour" ${editorSectionIsOpen("colour") ? "open" : ""}><summary>Colour</summary>
            ${editorSlider("vibrance", "Vibrance", -100, 100)}
            ${editorSlider("saturation", "Saturation", -100, 100)}
          </details>
          <details class="editor-section" data-editor-section="black-and-white" ${editorSectionIsOpen("black-and-white") ? "open" : ""}><summary>Black &amp; White <button class="editor-summary-reset" data-editor-action="reset-bw" type="button">Reset</button></summary>
            <div class="bw-methods" role="group" aria-label="Black and white conversion"><button data-bw-mode="neutral" type="button">Neutral</button><button data-bw-mode="contrast" type="button">High contrast</button><button data-bw-mode="matte" type="button">Matte</button><button data-bw-mode="soft" type="button">Soft</button></div>
          </details>
          <details class="editor-section" data-editor-section="straighten" ${editorSectionIsOpen("straighten") ? "open" : ""}><summary>Straighten</summary>
            <p class="editor-help">Draw one horizontal or vertical guide. A new guide replaces the earlier rotation; no geometric warp is applied.</p>
            <div class="straighten-actions"><button data-straighten-mode="horizontal" type="button">Draw horizontal</button><button data-straighten-mode="vertical" type="button">Draw vertical</button></div>
            <div class="straighten-readout" id="straighten-readout">No guide drawn</div><button class="editor-text-button" data-editor-action="clear-straighten" type="button">Remove guide</button>
          </details>
          <details class="editor-section" data-editor-section="effects" ${editorSectionIsOpen("effects") ? "open" : ""}><summary>Effects</summary>
            ${editorSlider("vignetteAmount", "Vignette", -100, 100)}
            ${editorSlider("vignetteSize", "Vignette size", 0, 100)}
            ${editorSlider("vignetteFeather", "Feather", 0, 100)}
          </details>
          <details class="editor-section" data-editor-section="frame" ${editorSectionIsOpen("frame") ? "open" : ""}><summary>Frame <button class="editor-summary-reset" data-editor-action="reset-frame" type="button">Reset</button></summary>
            <div class="frame-methods" role="group" aria-label="Frame style"><button data-frame-style="gallery" type="button">Gallery</button><button data-frame-style="film" type="button">Film</button><button data-frame-style="matte" type="button">Matte</button><button data-frame-style="polaroid" type="button">Polaroid</button></div>
            ${editorSlider("frameSize", "Size", 0, 100)}
          </details>
        </aside>
      </section>
    </div>`;
  applyEditorPreview();
}

function editorSlider(name: EditorSliderKey, label: string, min: number, max: number, step = 1): string {
  const value = editorAdjustments[name];
  return `<label class="editor-slider"><span>${label}</span><input data-editor-adjustment="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><input class="editor-value" data-editor-value="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label} value" /></label>`;
}

function editorRotation(): number {
  return editorVerticalRotation ?? editorHorizontalRotation ?? 0;
}

function filterForAdjustments(values: EditorAdjustments): string {
  const bw = values.blackAndWhite;
  const bwContrast = bw === "contrast" ? 35 : bw === "matte" ? -20 : bw === "soft" ? -28 : 0;
  const bwBrightness = bw === "matte" ? 8 : bw === "soft" ? 5 : 0;
  const brightness = 100 + values.brightness + values.exposure * 12 + values.highlights * 0.12 + values.shadows * 0.1 + values.whites * 0.08 + values.blacks * 0.06 + bwBrightness;
  const contrast = 100 + values.contrast + values.highlights * 0.08 - values.shadows * 0.05 + values.whites * 0.08 - values.blacks * 0.08 + bwContrast;
  const saturation = bw === "none" ? Math.max(0, 100 + values.saturation + values.vibrance * 0.65) : 0;
  return `brightness(${Math.max(0, brightness)}%) contrast(${Math.max(0, contrast)}%) saturate(${saturation}%) grayscale(${bw === "none" ? 0 : 1})`;
}

function editorFilter(): string {
  return filterForAdjustments(editorAdjustments);
}

function applyThumbnailEditPreview(path: string, recipe: StoredEditRecipe): void {
  document.querySelectorAll<HTMLImageElement>(`[data-thumbnail-preview-path="${CSS.escape(path)}"]`).forEach((image) => {
    image.style.filter = filterForAdjustments(recipe.adjustments);
    image.style.transform = `rotate(${recipe.rotation.toFixed(2)}deg)`;
  });
}

function thumbnailPreviewStyle(path: string): string {
  const recipe = editRecipeCache.get(path);
  if (!recipe) return "";
  return ` style="filter:${filterForAdjustments(recipe.adjustments)};transform:rotate(${recipe.rotation.toFixed(2)}deg)"`;
}

function editorPhotoBounds(): { left: number; top: number; width: number; height: number } | null {
  const media = editorHost.querySelector<HTMLElement>("#editor-media");
  const original = editorHost.querySelector<HTMLImageElement>("#editor-image");
  const preview = editorHost.querySelector<HTMLImageElement>("#editor-preview");
  const image = original?.naturalWidth && original?.naturalHeight ? original : preview;
  if (!media || !image?.naturalWidth || !image.naturalHeight) return null;
  const padding = 20;
  const availableWidth = media.clientWidth - padding * 2;
  const availableHeight = media.clientHeight - padding * 2;
  const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return { left: padding + (availableWidth - width) / 2, top: padding + (availableHeight - height) / 2, width, height };
}

function positionEditorPhotoLayer(layer: HTMLElement, bounds: { left: number; top: number; width: number; height: number }): void {
  layer.style.left = `${bounds.left}px`;
  layer.style.top = `${bounds.top}px`;
  layer.style.width = `${bounds.width}px`;
  layer.style.height = `${bounds.height}px`;
}

function applyEditorPreview(): void {
  const filter = editorFilter();
  const transform = `rotate(${editorRotation().toFixed(2)}deg)`;
  editorHost.querySelectorAll<HTMLImageElement>("#editor-preview, #editor-image").forEach((image) => {
    image.style.filter = filter;
    image.style.transform = transform;
  });
  const readout = editorHost.querySelector<HTMLElement>("#straighten-readout");
  if (readout) {
    const source = editorVerticalRotation !== null ? "vertical" : editorHorizontalRotation !== null ? "horizontal" : null;
    readout.textContent = source ? `${source} guide: ${editorRotation().toFixed(1)}°` : "No guide drawn";
  }
  editorHost.querySelectorAll<HTMLButtonElement>("[data-bw-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.bwMode === editorAdjustments.blackAndWhite);
  });
  editorHost.querySelectorAll<HTMLButtonElement>("[data-frame-style]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.frameStyle === editorAdjustments.frameStyle);
  });
  const bounds = editorPhotoBounds();
  const vignette = editorHost.querySelector<HTMLElement>("#editor-vignette");
  if (vignette) {
    if (bounds) positionEditorPhotoLayer(vignette, bounds);
    const amount = editorAdjustments.vignetteAmount;
    const colour = amount >= 0 ? "0,0,0" : "255,255,255";
    const opacity = Math.abs(amount) / 100;
    const edgeStart = 95 - editorAdjustments.vignetteSize * 0.55;
    const edgeEnd = Math.min(100, edgeStart + 3 + editorAdjustments.vignetteFeather * 0.5);
    vignette.style.background = `radial-gradient(ellipse at center, transparent ${edgeStart}%, rgba(${colour},${opacity.toFixed(2)}) ${edgeEnd}%, rgba(${colour},${opacity.toFixed(2)}) 100%)`;
  }
  const frame = editorHost.querySelector<HTMLElement>("#editor-frame");
  if (frame) {
    if (bounds) positionEditorPhotoLayer(frame, bounds);
    const style = editorAdjustments.frameStyle;
    const size = editorAdjustments.frameSize;
    frame.className = `frame-${style}`;
    frame.style.setProperty("--frame-size", `${size / 2}px`);
  }
  const clipping = editorHost.querySelector<HTMLCanvasElement>("#clipping-overlay");
  if (clipping) {
    clipping.classList.toggle("is-visible", clippingIndicatorEnabled || editorAltClippingPreview);
    if (clipping.classList.contains("is-visible")) void renderClippingMask();
  }
  const saveButton = editorHost.querySelector<HTMLButtonElement>("#save-editor");
  if (saveButton && !saveButton.disabled) saveButton.textContent = editorHasEdits() ? "Save" : "Done";
  const editState = editorHost.querySelector<HTMLElement>(".editor-header small");
  if (editState) editState.textContent = editorSaveError ?? (editorHasEdits() ? "Unsaved edits" : editorSavedOutputPath ? "Saved" : "No edits yet");
  scheduleEditorRecipeSave();
}

function adjustedLuminance(value: number): number {
  const adjustment = editorAdjustments;
  const brightness = 1 + (adjustment.brightness + adjustment.exposure * 12 + adjustment.highlights * 0.12 + adjustment.shadows * 0.1 + adjustment.whites * 0.08 + adjustment.blacks * 0.06) / 100;
  const contrast = 1 + (adjustment.contrast + adjustment.highlights * 0.08 - adjustment.shadows * 0.05 + adjustment.whites * 0.08 - adjustment.blacks * 0.08) / 100;
  return (value * brightness - 0.5) * contrast + 0.5;
}

function adjustedPixel(red: number, green: number, blue: number): [number, number, number] {
  const adjustment = editorAdjustments;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const targetLuminance = adjustedLuminance(luminance);
  const scale = luminance > 0.00001 ? targetLuminance / luminance : targetLuminance;
  let channels = [red * scale, green * scale, blue * scale];
  const saturation = adjustment.blackAndWhite === "none" ? 1 + (adjustment.saturation + adjustment.vibrance * 0.65) / 100 : 0;
  const neutral = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  channels = channels.map((channel) => neutral + (channel - neutral) * saturation);
  return [channels[0], channels[1], channels[2]];
}

async function imageForClippingCanvas(image: HTMLImageElement): Promise<HTMLImageElement> {
  const sourcePath = image.dataset.sourcePath ?? image.src;
  if (clippingCanvasSource && clippingCanvasSourcePath === sourcePath) return clippingCanvasSource;
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error(`Could not load photo pixels for clipping preview (${response.status})`);
  const blob = await response.blob();
  if (clippingCanvasObjectUrl) URL.revokeObjectURL(clippingCanvasObjectUrl);
  clippingCanvasObjectUrl = URL.createObjectURL(blob);
  const source = new Image();
  source.src = clippingCanvasObjectUrl;
  await source.decode();
  clippingCanvasSource = source;
  clippingCanvasSourcePath = sourcePath;
  return source;
}

async function renderClippingMask(): Promise<void> {
  const canvas = editorHost.querySelector<HTMLCanvasElement>("#clipping-overlay");
  const media = editorHost.querySelector<HTMLElement>("#editor-media");
  const image = editorHost.querySelector<HTMLImageElement>("#editor-image");
  if (!canvas || !media || !image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;

  const mediaRect = media.getBoundingClientRect();
  const padding = 20;
  const availableWidth = mediaRect.width - padding * 2;
  const availableHeight = mediaRect.height - padding * 2;
  const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
  const displayWidth = image.naturalWidth * scale;
  const displayHeight = image.naturalHeight * scale;
  const left = padding + (availableWidth - displayWidth) / 2;
  const top = padding + (availableHeight - displayHeight) / 2;
  let source: HTMLImageElement;
  try {
    source = await imageForClippingCanvas(image);
  } catch (error) {
    console.warn("Could not load photo pixels for clipping indicator", error);
    canvas.classList.remove("is-visible");
    return;
  }
  if (!canvas.classList.contains("is-visible") || editorSourcePath !== image.dataset.sourcePath) return;
  const sampleWidth = Math.min(1024, source.naturalWidth);
  const sampleHeight = Math.max(1, Math.round(source.naturalHeight * (sampleWidth / source.naturalWidth)));

  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.clearRect(0, 0, sampleWidth, sampleHeight);
    context.drawImage(source, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const [red, green, blue] = adjustedPixel(pixels.data[index] / 255, pixels.data[index + 1] / 255, pixels.data[index + 2] / 255);
      if (red > 1 || green > 1 || blue > 1) {
        pixels.data[index] = 255;
        pixels.data[index + 1] = 35;
        pixels.data[index + 2] = 25;
        pixels.data[index + 3] = 205;
      } else if (red < 0 || green < 0 || blue < 0) {
        pixels.data[index] = 0;
        pixels.data[index + 1] = 92;
        pixels.data[index + 2] = 255;
        pixels.data[index + 3] = 205;
      } else {
        pixels.data[index + 3] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
  } catch (error) {
    console.warn("Could not render clipping indicator", error);
    canvas.classList.remove("is-visible");
  }
}

function editorGuidePoint(event: PointerEvent): { x: number; y: number } | null {
  const media = editorHost.querySelector<HTMLElement>("#editor-media");
  if (!media) return null;
  const rect = media.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  };
}

function drawStraightenGuide(start: { x: number; y: number }, end: { x: number; y: number }): void {
  const line = editorHost.querySelector<SVGLineElement>("#straighten-guide line");
  if (!line) return;
  line.setAttribute("x1", String(start.x));
  line.setAttribute("y1", String(start.y));
  line.setAttribute("x2", String(end.x));
  line.setAttribute("y2", String(end.y));
  line.parentElement?.classList.add("is-visible");
}

function normaliseAngle(angle: number): number {
  let result = angle;
  while (result > 90) result -= 180;
  while (result < -90) result += 180;
  return result;
}

function commitStraightenGuide(end: { x: number; y: number }): void {
  if (!editorStraightenStart || !editorStraightenMode) return;
  const dx = end.x - editorStraightenStart.x;
  const dy = end.y - editorStraightenStart.y;
  if (Math.hypot(dx, dy) > 3) {
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const adjustment = editorStraightenMode === "horizontal"
      ? -normaliseAngle(angle)
      : -normaliseAngle(angle - 90);
    if (editorStraightenMode === "horizontal") {
      editorHorizontalRotation = adjustment;
      editorVerticalRotation = null;
    } else {
      editorVerticalRotation = adjustment;
      editorHorizontalRotation = null;
    }
  }
  editorStraightenMode = null;
  editorStraightenStart = null;
  applyEditorPreview();
}

async function updateEditorPreview(): Promise<void> {
  if (!editorSourcePath) return;
  const image = editorHost.querySelector<HTMLImageElement>("#editor-image");
  if (!image) return;
  const path = editorSourcePath;
  image.dataset.sourcePath = path;
  try {
    const renderablePath = await invoke<string>("get_viewer_path", { path });
    if (editorSourcePath === path && image.dataset.sourcePath === path) {
      image.onload = () => {
        applyEditorPreview();
      };
      image.src = `${convertFileSrc(renderablePath)}?t=${Date.now()}`;
      applyEditorPreview();
    }
  } catch (error) {
    console.error("Failed to load image for editor", error);
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
          <div class="sidebar-title-row"><h1>Folders</h1><div class="folder-menu-anchor"><button class="folder-options-button" id="folder-options-button" type="button" aria-expanded="${sidebarMenuOpen}" aria-controls="folder-options-menu" title="Folder options">•••</button>${sidebarMenuOpen ? `<div class="folder-options-menu" id="folder-options-menu"><p class="eyebrow">Folder options</p><button class="primary-button" id="add-folder" type="button">Add folder</button><label class="folder-option-toggle"><input id="hide-empty-folders" type="checkbox" ${hideEmptyFolders ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span><span>Hide folders with no images</span></label><label class="folder-option-toggle"><input id="hide-originals" type="checkbox" ${hideOriginals ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span><span>Hide originals</span></label>${settings.watchedFolders.length ? `<button id="reset-catalogue" type="button" class="reset-catalogue-button">⚠ Reset & Rescan</button>` : ""}</div>` : ""}</div></div>
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
                            (thumbnail, index) => `<div class="thumbnail-card ${selectedThumbnailPaths.has(thumbnail.sourcePath) ? "is-selected" : ""}" role="button" tabindex="0" data-thumbnail-index="${index}" data-thumbnail-path="${escapeHtml(thumbnail.sourcePath)}" title="${escapeHtml(thumbnail.name)}" draggable="true"><img data-thumbnail-preview-path="${escapeHtml(thumbnail.sourcePath)}" src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}?t=${thumbnail.lastModified}" alt="${escapeHtml(thumbnail.name)}" loading="lazy" draggable="false"${thumbnailPreviewStyle(thumbnail.sourcePath)} /><span>${escapeHtml(thumbnail.name)}</span></div>`,
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
      setActiveFolder(settings.watchedFolders.length ? ALL_FOLDERS : null);
      render();
      if (activeFolder) void scanSelectedFolder();
    } catch (error) {
      errorMessage = String(error);
      render();
    }
  });
  document.querySelector<HTMLInputElement>("#hide-empty-folders")?.addEventListener("change", (event) => {
    hideEmptyFolders = (event.target as HTMLInputElement).checked;
    void saveDisplayPreferences();
    render();
  });
  document.querySelector<HTMLInputElement>("#hide-originals")?.addEventListener("change", (event) => {
    hideOriginals = (event.target as HTMLInputElement).checked;
    void saveDisplayPreferences();
    render();
    if (!hideOriginals && activeFolder) void scanSelectedFolder();
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
  document.querySelectorAll<HTMLButtonElement>("[data-select-folder]").forEach((button) => button.addEventListener("click", () => { closeViewer(); setActiveFolder(button.dataset.selectFolder ?? null); scanResult = null; thumbnails = []; selectedThumbnailPath = null; selectedThumbnailPaths.clear(); selectedMetadata = null; render(); void scanSelectedFolder(); }));

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
    setActiveFolder(selected);
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
      setActiveFolder(settings.watchedFolders.length ? ALL_FOLDERS : null);
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
    editRecipeCache.clear();
    const recipes = await Promise.all(
      catalogFiles.map(async (file) => {
        try {
          const settingsJson = await invoke<string | null>("get_edit_recipe", {
            path: file.path,
            fileSize: file.fileSize,
            lastModified: file.lastModified,
          });
          if (!settingsJson) return null;
          const recipe = JSON.parse(settingsJson) as { adjustments?: Partial<EditorAdjustments>; rotation?: number };
          return {
            path: file.path,
            recipe: {
              adjustments: { ...defaultEditorAdjustments(), ...recipe.adjustments },
              rotation: typeof recipe.rotation === "number" ? recipe.rotation : 0,
            } satisfies StoredEditRecipe,
          };
        } catch (error) {
          console.error("Could not load edit recipe", error);
          return null;
        }
      }),
    );
    for (const result of recipes) {
      if (result) editRecipeCache.set(result.path, result.recipe);
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
      } else if (action === "create-subfolder" && menu.kind === "folder") {
        showFolderCreateDialog(menu.path);
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
    folderDialogHost.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const action = target.closest<HTMLButtonElement>("[data-folder-dialog-action]")?.dataset.folderDialogAction;
      if (action === "cancel" || target.classList.contains("removal-backdrop")) {
        dismissFolderCreateDialog();
      } else if (action === "create") {
        void submitFolderCreation();
      }
    });
    viewerHost.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("#open-editor")) {
        openEditor();
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
    editorHost.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#close-editor") || target.classList.contains("editor-backdrop")) {
        closeEditor();
        return;
      }
      if (target.closest("#save-editor")) {
        void saveEditorImage();
        return;
      }
      if (target.closest("#editor-more-menu")) {
        editorMenuOpen = !editorMenuOpen;
        const popover = editorHost.querySelector<HTMLElement>(".editor-menu-popover");
        const button = editorHost.querySelector<HTMLButtonElement>("#editor-more-menu");
        if (popover) popover.hidden = !editorMenuOpen;
        if (button) button.setAttribute("aria-expanded", String(editorMenuOpen));
        return;
      }
      const blackAndWhiteMode = target.closest<HTMLButtonElement>("[data-bw-mode]")?.dataset.bwMode as EditorAdjustments["blackAndWhite"] | undefined;
      if (blackAndWhiteMode) {
        editorAdjustments.blackAndWhite = blackAndWhiteMode;
        applyEditorPreview();
        return;
      }
      const frameStyle = target.closest<HTMLButtonElement>("[data-frame-style]")?.dataset.frameStyle as EditorAdjustments["frameStyle"] | undefined;
      if (frameStyle) {
        editorAdjustments.frameStyle = frameStyle;
        applyEditorPreview();
        return;
      }
      const straightenMode = target.closest<HTMLButtonElement>("[data-straighten-mode]")?.dataset.straightenMode as "horizontal" | "vertical" | undefined;
      if (straightenMode) {
        editorStraightenMode = straightenMode;
        editorStraightenStart = null;
        return;
      }
      const action = target.closest<HTMLButtonElement>("[data-editor-action]")?.dataset.editorAction;
      if (action === "reset") {
        editorAdjustments = defaultEditorAdjustments();
        editorHorizontalRotation = null;
        editorVerticalRotation = null;
        editorHost.querySelector<SVGElement>("#straighten-guide")?.classList.remove("is-visible");
        editorHost.querySelectorAll<HTMLInputElement>("[data-editor-adjustment]").forEach((input) => {
          const name = input.dataset.editorAdjustment as EditorSliderKey;
          input.value = String(editorAdjustments[name]);
          const valueInput = editorHost.querySelector<HTMLInputElement>(`[data-editor-value="${name}"]`);
          if (valueInput) valueInput.value = String(editorAdjustments[name]);
        });
        applyEditorPreview();
      } else if (action === "clear-straighten") {
        editorHost.querySelector<SVGElement>("#straighten-guide")?.classList.remove("is-visible");
        applyEditorPreview();
      } else if (action === "reset-bw") {
        editorAdjustments.blackAndWhite = "none";
        applyEditorPreview();
      } else if (action === "reset-frame") {
        editorAdjustments.frameStyle = "none";
        editorAdjustments.frameSize = 0;
        const sizeSlider = editorHost.querySelector<HTMLInputElement>("[data-editor-adjustment=\"frameSize\"]");
        const sizeValue = editorHost.querySelector<HTMLInputElement>("[data-editor-value=\"frameSize\"]");
        if (sizeSlider) sizeSlider.value = "0";
        if (sizeValue) sizeValue.value = "0";
        applyEditorPreview();
      }
    });
    editorHost.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const name = (target.dataset.editorAdjustment ?? target.dataset.editorValue) as EditorSliderKey | undefined;
      if (!name || !Number.isFinite(Number(target.value))) return;
      editorAdjustments[name] = Number(target.value);
      editorSavedOutputPath = null;
      editorSaveError = null;
      if (name === "frameSize" && editorAdjustments[name] > 0) {
        window.localStorage.setItem(editorFrameSizeStorageKey, String(editorAdjustments[name]));
      }
      const counterpart = target.dataset.editorAdjustment
        ? editorHost.querySelector<HTMLInputElement>(`[data-editor-value="${name}"]`)
        : editorHost.querySelector<HTMLInputElement>(`[data-editor-adjustment="${name}"]`);
      if (counterpart) counterpart.value = String(editorAdjustments[name]);
      applyEditorPreview();
    });
    editorHost.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.editorAdjustment) return;
      const name = target.dataset.editorAdjustment as EditorSliderKey;
      const neutral = defaultEditorAdjustments()[name];
      target.value = String(neutral);
      editorAdjustments[name] = neutral;
      const valueInput = editorHost.querySelector<HTMLInputElement>(`[data-editor-value="${name}"]`);
      if (valueInput) valueInput.value = String(neutral);
      applyEditorPreview();
    });
    editorHost.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "clipping-indicator-toggle") {
        clippingIndicatorEnabled = target.checked;
        window.localStorage.setItem(editorClippingStorageKey, String(clippingIndicatorEnabled));
        applyEditorPreview();
      } else if (target instanceof HTMLInputElement && target.id === "reveal-saved-file-toggle") {
        editorRevealSavedFile = target.checked;
        window.localStorage.setItem(editorRevealSavedStorageKey, String(editorRevealSavedFile));
      } else if (target instanceof HTMLInputElement && target.name === "save-original-strategy") {
        const strategy = target.value;
        if (strategy === "originals-subfolder" || strategy === "filename-original" || strategy === "overwrite") {
          editorSaveOriginalStrategy = strategy;
          try {
            window.localStorage.setItem(editorSaveOriginalStorageKey, strategy);
          } catch (error) {
            console.warn("Could not save editor export preference", error);
          }
        }
      }
    });
    editorHost.addEventListener("toggle", (event) => {
      const target = event.target;
      if (target instanceof HTMLDetailsElement && target.dataset.editorSection) {
        saveEditorSectionState(target.dataset.editorSection, target.open);
      }
    }, true);
    editorHost.addEventListener("pointerdown", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.dataset.editorAdjustment) {
        editorAltClippingPreview = event.altKey;
        applyEditorPreview();
      }
    });
    editorHost.addEventListener("pointerup", () => {
      if (editorAltClippingPreview) {
        editorAltClippingPreview = false;
        applyEditorPreview();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!editorMenuOpen || !(event.target instanceof Element) || event.target.closest(".editor-menu")) return;
      editorMenuOpen = false;
      const popover = editorHost.querySelector<HTMLElement>(".editor-menu-popover");
      const button = editorHost.querySelector<HTMLButtonElement>("#editor-more-menu");
      if (popover) popover.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
    });
    editorHost.addEventListener("keydown", (event) => {
      if (event.altKey && event.target instanceof HTMLInputElement && event.target.dataset.editorAdjustment) {
        editorAltClippingPreview = true;
        applyEditorPreview();
      }
    });
    editorHost.addEventListener("keyup", () => {
      if (editorAltClippingPreview) {
        editorAltClippingPreview = false;
        applyEditorPreview();
      }
    });
    editorHost.addEventListener("pointerdown", (event) => {
      if (!editorStraightenMode || !(event.target instanceof Element) || !event.target.closest("#editor-media")) return;
      const point = editorGuidePoint(event);
      if (!point) return;
      event.preventDefault();
      editorStraightenStart = point;
      drawStraightenGuide(point, point);
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    });
    editorHost.addEventListener("pointermove", (event) => {
      if (!editorStraightenStart) return;
      const point = editorGuidePoint(event);
      if (point) drawStraightenGuide(editorStraightenStart, point);
    });
    editorHost.addEventListener("pointerup", (event) => {
      if (!editorStraightenStart) return;
      const point = editorGuidePoint(event);
      if (point) commitStraightenGuide(point);
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
        const card = target.closest<HTMLElement>("[data-thumbnail-index]");
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
      const card = target.closest<HTMLElement>("[data-thumbnail-index]");
      const index = Number(card?.dataset.thumbnailIndex);
      const filtered = getFilteredThumbnails();
      const thumbnail = Number.isInteger(index) ? filtered[index] : undefined;
      if (thumbnail) {
        event.preventDefault();
        openViewer(thumbnail.sourcePath);
      }
    });

    let activeDragIcon: HTMLElement | null = null;
    let lastDragTarget: HTMLElement | null = null;

    document.addEventListener("dragstart", (event) => {
      void invoke("print_log", { msg: "dragstart fired" });
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLElement>(".thumbnail-card");
      if (!card) {
        void invoke("print_log", { msg: "dragstart: card not found" });
        return;
      }
      const path = card.dataset.thumbnailPath;
      if (!path) {
        void invoke("print_log", { msg: "dragstart: path not found on card" });
        return;
      }

      const pathsToDrag = selectedThumbnailPaths.has(path)
        ? Array.from(selectedThumbnailPaths)
        : [path];

      void invoke("print_log", { msg: `dragstart: starting drag of ${pathsToDrag.length} files` });

      if (event.dataTransfer) {
        event.dataTransfer.clearData();
        event.dataTransfer.setData("text/plain", `pm-move:${JSON.stringify(pathsToDrag)}`);
        event.dataTransfer.effectAllowed = "all";

        // Create custom drag feedback element
        const dragIcon = document.createElement("div");
        dragIcon.className = "drag-feedback-icon";
        dragIcon.style.position = "absolute";
        dragIcon.style.top = "-9999px";
        dragIcon.style.left = "-9999px";
        dragIcon.style.background = "#dca461";
        dragIcon.style.color = "#302113";
        dragIcon.style.padding = "6px 12px";
        dragIcon.style.borderRadius = "20px";
        dragIcon.style.fontWeight = "bold";
        dragIcon.style.fontSize = "12px";
        dragIcon.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
        dragIcon.style.display = "flex";
        dragIcon.style.alignItems = "center";
        dragIcon.style.gap = "6px";
        dragIcon.style.zIndex = "9999";
        
        const count = pathsToDrag.length;
        dragIcon.innerHTML = `
          <span style="font-size: 14px;">🗂️</span>
          <span>${count} photo${count === 1 ? "" : "s"}</span>
        `;
        
        document.body.appendChild(dragIcon);
        event.dataTransfer.setDragImage(dragIcon, 40, 15);
        activeDragIcon = dragIcon;
      }

      card.classList.add("is-dragging");
      document.body.classList.add("is-dragging-files");
    });

    document.addEventListener("dragend", (event) => {
      void invoke("print_log", { msg: "dragend fired" });
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = target.closest<HTMLElement>(".thumbnail-card");
      card?.classList.remove("is-dragging");
      if (lastDragTarget) {
        lastDragTarget.classList.remove("drag-over");
        lastDragTarget = null;
      }
      if (activeDragIcon) {
        activeDragIcon.remove();
        activeDragIcon = null;
      }
      document.body.classList.remove("is-dragging-files");
    });

    document.addEventListener("dragenter", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const folder = target.closest<HTMLElement>("[data-folder-path]");
      if (folder && folder.dataset.selectFolder !== ALL_FOLDERS) {
        event.preventDefault(); // Crucial for Safari/WebKit drop
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      }
    });

    document.addEventListener("dragover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const folder = target.closest<HTMLElement>("[data-folder-path]");
      if (!folder || folder.dataset.selectFolder === ALL_FOLDERS) {
        if (lastDragTarget) {
          lastDragTarget.classList.remove("drag-over");
          lastDragTarget = null;
        }
        return;
      }

      event.preventDefault(); // Crucial for Safari/WebKit drop
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      if (lastDragTarget !== folder) {
        if (lastDragTarget) {
          lastDragTarget.classList.remove("drag-over");
        }
        folder.classList.add("drag-over");
        lastDragTarget = folder;
        void invoke("print_log", { msg: `dragover: hovered folder ${folder.dataset.folderPath}` });
      }
    });

    document.addEventListener("dragleave", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const folder = target.closest<HTMLElement>("[data-folder-path]");
      if (folder && lastDragTarget === folder) {
        const related = (event as any).relatedTarget as HTMLElement;
        if (!related || !folder.contains(related)) {
          folder.classList.remove("drag-over");
          lastDragTarget = null;
        }
      }
    });

    document.addEventListener("drop", async (event) => {
      void invoke("print_log", { msg: "drop fired" });
      if (lastDragTarget) {
        lastDragTarget.classList.remove("drag-over");
        lastDragTarget = null;
      }
      document.body.classList.remove("is-dragging-files");

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const folder = target.closest<HTMLElement>("[data-folder-path]");
      if (!folder) {
        void invoke("print_log", { msg: "drop: target folder not found" });
        return;
      }

      const targetFolderPath = folder.dataset.folderPath;
      if (!targetFolderPath || targetFolderPath === ALL_FOLDERS) {
        void invoke("print_log", { msg: `drop: target folder invalid: ${targetFolderPath}` });
        return;
      }

      event.preventDefault();

      let dataStr = event.dataTransfer?.getData("text/plain");
      if (!dataStr) {
        dataStr = event.dataTransfer?.getData("text");
      }
      void invoke("print_log", { msg: `drop: raw payload received: ${dataStr}` });
      if (!dataStr) {
        return;
      }

      let pathsToMove: string[] = [];
      if (dataStr.startsWith("pm-move:")) {
        try {
          pathsToMove = JSON.parse(dataStr.substring(8));
        } catch (e) {
          void invoke("print_log", { msg: `drop: json parse error on pm-move: ${e}` });
        }
      } else if (dataStr.startsWith("[")) {
        try {
          pathsToMove = JSON.parse(dataStr);
        } catch (e) {
          void invoke("print_log", { msg: `drop: json parse error: ${e}` });
        }
      } else {
        pathsToMove = dataStr.split("\n").filter(Boolean);
      }

      void invoke("print_log", { msg: `drop: parsed paths to move: ${JSON.stringify(pathsToMove)}` });

      if (pathsToMove.length === 0) {
        return;
      }

      await moveFilesToFolder(pathsToMove, targetFolderPath);
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
      const card = target.closest<HTMLElement>("[data-thumbnail-index]");
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
      if (folderCreateState) {
        if (event.key === "Escape") {
          event.preventDefault();
          dismissFolderCreateDialog();
        }
        return;
      }
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
      if (editorSourcePath) {
        if (event.key === "Alt") {
          editorAltClippingPreview = true;
          applyEditorPreview();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeEditor();
        } else if (!isFormControl(event.target) && event.key.toLowerCase() === "j") {
          event.preventDefault();
          clippingIndicatorEnabled = !clippingIndicatorEnabled;
          window.localStorage.setItem(editorClippingStorageKey, String(clippingIndicatorEnabled));
          const toggle = editorHost.querySelector<HTMLInputElement>("#clipping-indicator-toggle");
          if (toggle) toggle.checked = clippingIndicatorEnabled;
          applyEditorPreview();
        }
        return;
      }
      if (viewerSourcePath) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeViewer();
        } else if (!isFormControl(event.target) && event.key.toLowerCase() === "e") {
          event.preventDefault();
          openEditor();
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
    document.addEventListener("keyup", (event) => {
      if (editorSourcePath && event.key === "Alt" && editorAltClippingPreview) {
        editorAltClippingPreview = false;
        applyEditorPreview();
      }
    });
    await listen<ScanProgress>("scan-progress", (event) => {
      scanProgress = event.payload;
      if (isScanning) {
        scheduleProgressRender();
      }
    });
    await listen<ThumbnailProgress>("thumbnail-progress", (event) => {
      if (isRefreshingSavedCatalogue) return;
      thumbnailProgress = event.payload;
      isScanning = false;
      isGeneratingThumbnails = true;
      scheduleProgressRender();
    });
    await listen("catalogue-updated", async () => {
      if (isRefreshingSavedCatalogue) return;
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
    hideEmptyFolders = settings.hideEmptyFolders;
    hideOriginals = settings.hideOriginals;
    await loadFolderTrees();
    render();

    if (settings.watchedFolders.length) {
      const savedFolder = settings.selectedFolder;
      const isValid = savedFolder && (savedFolder === ALL_FOLDERS || settings.watchedFolders.some((root) => isSameOrNestedPath(savedFolder, root)));
      activeFolder = isValid ? savedFolder : ALL_FOLDERS;

      settings.watchedFolders.forEach((folder) => expandedFolders.add(folder));
      if (activeFolder && activeFolder !== ALL_FOLDERS) {
        let current = parentPath(activeFolder);
        while (current && current !== activeFolder) {
          expandedFolders.add(current);
          const next = parentPath(current);
          if (next === current) break;
          current = next;
        }
      }
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
