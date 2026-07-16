mod scanner;
mod settings;
mod thumbnails;

use scanner::{FolderEntry, ScanProgress, ScanResult};
use settings::AppSettings;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use thumbnails::{ThumbnailProgress, ThumbnailResult};

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    settings::load(&app)
}

#[tauri::command]
fn add_watched_folder(app: AppHandle, folder: String) -> Result<AppSettings, String> {
    if !Path::new(&folder).is_dir() {
        return Err(format!("{folder} is not a readable folder."));
    }
    let mut settings = settings::load(&app)?;
    if !settings.watched_folders.contains(&folder) {
        settings.watched_folders.push(folder);
        settings.watched_folders.sort();
        settings::save(&app, &settings)?;
    }
    Ok(settings)
}

#[tauri::command]
fn remove_watched_folder(app: AppHandle, folder: String) -> Result<AppSettings, String> {
    let mut settings = settings::load(&app)?;
    settings.watched_folders.retain(|saved| saved != &folder);
    settings::save(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
async fn discover_folders(folder: String) -> Result<Vec<FolderEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::discover_folders(Path::new(&folder)))
        .await
        .map_err(|error| format!("Folder discovery could not finish: {error}"))?
}

#[tauri::command]
async fn scan_folder(
    app: AppHandle,
    folder: String,
    recursive: bool,
) -> Result<ScanResult, String> {
    let folder_path = folder.clone();

    tauri::async_runtime::spawn_blocking(move || {
        eprintln!("Scanning selected folder: {folder_path}");
        scanner::scan_directory(Path::new(&folder_path), recursive, |progress| {
            emit_scan_progress(&app, progress);
        })
    })
    .await
    .map_err(|error| format!("The background scan could not finish: {error}"))?
}

#[tauri::command]
async fn scan_folders(folders: Vec<String>) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let mut errors = Vec::new();
        let mut scanned_entries = 0_usize;
        let mut unreadable_entries = 0_usize;
        for folder in folders {
            let result = scanner::scan_directory(Path::new(&folder), true, |_| {})?;
            scanned_entries += result.scanned_entries;
            unreadable_entries += result.unreadable_entries;
            files.extend(result.files);
            errors.extend(result.errors);
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(ScanResult {
            files,
            scanned_entries,
            unreadable_entries,
            errors,
        })
    })
    .await
    .map_err(|error| format!("The combined background scan could not finish: {error}"))?
}

#[tauri::command]
async fn generate_thumbnails(
    app: AppHandle,
    files: Vec<scanner::ImageFile>,
) -> Result<ThumbnailResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        thumbnails::generate(&app, files, |progress| {
            emit_thumbnail_progress(&app, progress)
        })
    })
    .await
    .map_err(|error| format!("Thumbnail generation could not finish: {error}"))?
}

#[tauri::command]
fn thumbnail_cache_size(app: AppHandle) -> Result<u64, String> {
    thumbnails::cache_size(&app)
}

fn emit_scan_progress(app: &AppHandle, progress: &ScanProgress) {
    if let Err(error) = app.emit("scan-progress", progress) {
        eprintln!("Could not report scan progress: {error}");
    }
}

fn emit_thumbnail_progress(app: &AppHandle, progress: &ThumbnailProgress) {
    if let Err(error) = app.emit("thumbnail-progress", progress) {
        eprintln!("Could not report thumbnail progress: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            add_watched_folder,
            remove_watched_folder,
            discover_folders,
            scan_folder,
            scan_folders,
            generate_thumbnails,
            thumbnail_cache_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running Peter's Photo Manager");
}
