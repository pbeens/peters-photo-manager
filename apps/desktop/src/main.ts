import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";

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
let selectedThumbnailPath: string | null = null;
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



function renderDetailsContent(): string {
  const selectedThumbnail = thumbnails.find((thumbnail) => thumbnail.sourcePath === selectedThumbnailPath);
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
      ${metadata.lens ? `
        <div class="details-group">
          <label>Lens</label>
          <p>${escapeHtml(metadata.lens)}</p>
        </div>
      ` : ""}
      ${(metadata.locationCountry || metadata.locationState || metadata.locationCity || metadata.latitude != null) ? `
        <div class="details-group">
          <label>Location</label>
          <p>${[
            [
              metadata.locationCity,
              metadata.locationState,
              metadata.locationCountry
            ].filter(Boolean).join(", "),
            metadata.latitude != null && metadata.longitude != null
              ? `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`
              : ""
          ].filter(Boolean).join(" · ")}</p>
        </div>
      ` : ""}
      ${metadata.dateTaken ? `
        <div class="details-group">
          <label>Date Taken</label>
          <p>${escapeHtml(metadata.dateTaken)}</p>
        </div>
      ` : ""}
      ${(metadata.aperture || metadata.shutterSpeed || metadata.iso || metadata.focalLength) ? `
        <div class="details-group">
          <label>Exposure</label>
          <p>${[
            metadata.focalLength,
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

function wireTagAutocomplete(tagInput: HTMLInputElement, suggestionsHost: HTMLElement, path: string): void {
  let suggestions: string[] = [];
  let activeIndex = 0;

  const metadata = catalogMetadata.get(path) ?? selectedMetadata;
  const currentTags = (): string[] => metadata?.keywords ?? [];

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
      void addPhotoTag(path, selectedTag);
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
  const path = selectedThumbnailPath;
  document.querySelectorAll<HTMLButtonElement>("[data-thumbnail-path]").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.thumbnailPath === path);
  });
  const detailsPanel = document.querySelector<HTMLElement>("#details-panel");
  const detailsBody = detailsPanel?.querySelector<HTMLElement>("#details-body");
  if (detailsBody) {
    detailsBody.innerHTML = renderDetailsContent();

    // Wire up add-tag-input listener
    const tagInput = detailsBody.querySelector<HTMLInputElement>("#add-tag-input");
    const suggestionsHost = detailsBody.querySelector<HTMLElement>("#tag-suggestions");
    if (tagInput && suggestionsHost && path) {
      wireTagAutocomplete(tagInput, suggestionsHost, path);
    }

    // Wire up tag remove buttons
    detailsBody.querySelectorAll<HTMLButtonElement>("[data-remove-tag]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const tagToRemove = btn.dataset.removeTag;
        if (tagToRemove && path) {
          void removePhotoTag(path, tagToRemove);
        }
      });
    });
  }
}

function renderDetailsSupportFooter(): string {
  return `<div class="panel-footer"><a class="app-footer-link" href="https://buymeacoffee.com/pbeens" target="_blank" rel="noopener noreferrer">Buy me a coffee</a></div>`;
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
  if (!thumbnails.length) {
    return;
  }

  const currentIndex = thumbnails.findIndex((thumbnail) => thumbnail.sourcePath === selectedThumbnailPath);
  const nextIndex = currentIndex < 0
    ? 0
    : Math.max(0, Math.min(thumbnails.length - 1, currentIndex + delta));
  const thumbnail = thumbnails[nextIndex];
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
  if (index >= 0 && index < thumbnails.length) {
    viewerSourcePath = thumbnails[index].sourcePath;
    selectedThumbnailPath = viewerSourcePath;
    selectedMetadata = catalogMetadata.get(viewerSourcePath) ?? null;
    metadataError = null;
    updateSelectionUI();
    updateViewerUI();
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
  window.requestAnimationFrame(updateViewerUI);
}

function closeViewer(): void {
  viewerSourcePath = null;
  viewerHost.replaceChildren();
}

function renderViewer(): void {
  const currentIndex = viewerSourcePath
    ? thumbnails.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath)
    : -1;
  const thumbnail = currentIndex >= 0 ? thumbnails[currentIndex] : undefined;

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
          <img id="viewer-preview" src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}" alt="${escapeHtml(thumbnail.name)}" />
          <img id="viewer-image" src="${escapeHtml(convertFileSrc(viewerSourcePath))}" alt="${escapeHtml(thumbnail.name)}" />
        </div>
        <figcaption>
          <span id="viewer-name">${escapeHtml(thumbnail.name)}</span>
          <span id="viewer-position">Original image (${currentIndex + 1} of ${thumbnails.length})</span>
          <span id="viewer-load-state">Loading original image…</span>
        </figcaption>
      </figure>
      <button class="viewer-next" id="viewer-next" type="button" ${currentIndex >= thumbnails.length - 1 ? "disabled" : ""}>&rsaquo;</button>
    </div>`;
}

function updateViewerUI(): void {
  if (!viewerSourcePath) {
    return;
  }
  const viewerImage = viewerHost.querySelector<HTMLImageElement>("#viewer-image");
  if (!viewerImage) {
    renderViewer();
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
  const previewImage = viewerHost.querySelector<HTMLImageElement>("#viewer-preview");
  if (previewImage) {
    previewImage.src = cachedSource;
    previewImage.alt = thumbnail.name;
  }
  viewerImage.classList.remove("is-loaded");
  viewerImage.dataset.sourcePath = path;
  viewerImage.src = convertFileSrc(path);
  viewerImage.alt = thumbnail.name;
  viewerHost.querySelector<HTMLElement>("#viewer-name")!.textContent = thumbnail.name;
  viewerHost.querySelector<HTMLElement>("#viewer-position")!.textContent = `Original image (${currentIndex + 1} of ${thumbnails.length})`;
  viewerHost.querySelector<HTMLElement>("#viewer-load-state")!.textContent = "Loading original image…";
  const previousButton = viewerHost.querySelector<HTMLButtonElement>("#viewer-prev");
  const nextButton = viewerHost.querySelector<HTMLButtonElement>("#viewer-next");
  if (previousButton) previousButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex >= thumbnails.length - 1;

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
                    : `<div class="thumbnail-grid" style="--thumbnail-size: ${thumbnailSize}px">
                      ${thumbnails
                        .map(
                          (thumbnail, index) => `<button class="thumbnail-card ${selectedThumbnailPath === thumbnail.sourcePath ? "is-selected" : ""}" type="button" data-thumbnail-index="${index}" data-thumbnail-path="${escapeHtml(thumbnail.sourcePath)}" title="${escapeHtml(thumbnail.name)}"><img src="${escapeHtml(convertFileSrc(thumbnail.thumbnailPath))}" alt="${escapeHtml(thumbnail.name)}" loading="lazy" /><span>${escapeHtml(thumbnail.name)}</span></button>`,
                        )
                        .join("")}
                    </div>`
          }
        </section>

        ${selectedFolder ? `<footer class="grid-footer"><div class="grid-footer-summary"><div class="thumbnail-sort-control"><span class="thumbnail-count">${thumbnails.length.toLocaleString()} image${thumbnails.length === 1 ? "" : "s"} sorted by</span><select id="thumbnail-sort-key" aria-label="Sort thumbnails by"><option value="name" ${thumbnailSortKey === "name" ? "selected" : ""}>File name</option><option value="dateTaken" ${thumbnailSortKey === "dateTaken" ? "selected" : ""}>Date taken</option><option value="lastModified" ${thumbnailSortKey === "lastModified" ? "selected" : ""}>Date modified</option><option value="fileSize" ${thumbnailSortKey === "fileSize" ? "selected" : ""}>File size</option></select><button id="thumbnail-sort-direction" type="button" aria-pressed="${!thumbnailSortAscending}">${thumbnailSortAscending ? "Ascending ↑" : "Descending ↓"}</button><span class="thumbnail-cache">Cache ${formatBytes(thumbnailCacheBytes)}</span></div></div><label class="thumbnail-size-control" for="thumbnail-size"><span>Small</span><input id="thumbnail-size" type="range" min="120" max="300" step="10" value="${thumbnailSize}" /><span>Large</span><output id="thumbnail-size-value">${thumbnailSize}px</output></label></footer>` : ""}

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
      "This will wipe the entire catalogue and thumbnail records, then rescan all folders from scratch.\n\nCached thumbnail image files will remain on disk.\n\nContinue?",
      { title: "⚠ Reset & Rescan", kind: "warning" }
    );
    if (!confirmed) return;
    try {
      closeViewer();
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
  document.querySelectorAll<HTMLButtonElement>("[data-select-folder]").forEach((button) => button.addEventListener("click", () => { closeViewer(); activeFolder = button.dataset.selectFolder ?? null; scanResult = null; thumbnails = []; selectedThumbnailPath = null; selectedMetadata = null; render(); void scanSelectedFolder(); }));

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
        const currentIndex = thumbnails.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
        void navigateToImage(currentIndex - 1);
        return;
      }
      if (target.closest("#viewer-next")) {
        const currentIndex = thumbnails.findIndex((thumbnail) => thumbnail.sourcePath === viewerSourcePath);
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
        if (rateButton && selectedThumbnailPath) {
          const rating = Number(rateButton.dataset.rateValue);
          void setPhotoRating(selectedThumbnailPath, rating);
          return;
        }

        const clearRatingButton = target.closest<HTMLButtonElement>("#clear-rating");
        if (clearRatingButton && selectedThumbnailPath) {
          void setPhotoRating(selectedThumbnailPath, null);
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
        const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
        if (thumbnail) {
          // Tauri's WebView reliably delivers the second click even when its
          // synthesized dblclick event is delayed or lost during a DOM update.
          if (event.detail >= 2) {
            event.preventDefault();
            event.stopPropagation();
            openViewer(thumbnail.sourcePath);
            return;
          }
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
      const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
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
      const thumbnail = Number.isInteger(index) ? thumbnails[index] : undefined;
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
          const currentIndex = thumbnails.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex > 0) {
            void navigateToImage(currentIndex - 1);
          }
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          const currentIndex = thumbnails.findIndex((t) => t.sourcePath === viewerSourcePath);
          if (currentIndex >= 0 && currentIndex < thumbnails.length - 1) {
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
    settings = await invoke<AppSettings>("load_settings");
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
