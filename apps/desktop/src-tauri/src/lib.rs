mod db;
mod scanner;
mod settings;
mod thumbnails;

use scanner::{FolderEntry, ScanProgress, ScanResult};
use settings::AppSettings;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use thumbnails::{ThumbnailProgress, ThumbnailResult};
use image::ImageDecoder;

pub struct DbState(pub Mutex<rusqlite::Connection>);

pub struct RawRenderingQueue {
    pub pending: std::sync::Mutex<std::collections::VecDeque<String>>,
    pub active: std::sync::atomic::AtomicBool,
}

pub struct RawRenderingState(pub std::sync::Arc<RawRenderingQueue>);

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    settings::load(&app)
}

#[tauri::command]
fn save_display_preferences(
    app: AppHandle,
    thumbnail_size: u16,
    thumbnail_sort_key: String,
    thumbnail_sort_ascending: bool,
) -> Result<AppSettings, String> {
    if !(120..=300).contains(&thumbnail_size) {
        return Err("Thumbnail size must be between 120 and 300 pixels.".to_string());
    }
    if !matches!(
        thumbnail_sort_key.as_str(),
        "name" | "dateTaken" | "lastModified" | "fileSize"
    ) {
        return Err("Thumbnail sort key is not supported.".to_string());
    }

    let mut settings = settings::load(&app)?;
    settings.thumbnail_size = thumbnail_size;
    settings.thumbnail_sort_key = thumbnail_sort_key;
    settings.thumbnail_sort_ascending = thumbnail_sort_ascending;
    settings::save(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn add_watched_folder(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    folder: String,
) -> Result<AppSettings, String> {
    if !Path::new(&folder).is_dir() {
        return Err(format!("{folder} is not a readable folder."));
    }
    let mut settings = settings::load(&app)?;
    if !settings.watched_folders.contains(&folder) {
        settings.watched_folders.push(folder.clone());
        settings.watched_folders.sort();
        settings::save(&app, &settings)?;

        // Sync folder path to database
        let conn = db_state
            .0
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        db::add_folder(&conn, &folder).map_err(|err| err.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
fn remove_watched_folder(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    folder: String,
) -> Result<AppSettings, String> {
    let mut settings = settings::load(&app)?;
    settings.watched_folders.retain(|saved| saved != &folder);
    settings::save(&app, &settings)?;

    // Sync removal from database (cascades and deletes files)
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    db::remove_folder(&conn, &folder).map_err(|err| err.to_string())?;
    Ok(settings)
}

#[tauri::command]
fn remove_folder_from_browser(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    folder: String,
) -> Result<AppSettings, String> {
    let mut settings = settings::load(&app)?;
    let path = Path::new(&folder);
    let root = settings
        .watched_folders
        .iter()
        .find(|watched| path.starts_with(Path::new(watched)))
        .cloned()
        .ok_or_else(|| "That folder is not managed by this catalogue.".to_string())?;

    if root == folder {
        settings
            .watched_folders
            .retain(|watched| watched != &folder);
    } else if !settings.excluded_folders.contains(&folder) {
        settings.excluded_folders.push(folder.clone());
        settings.excluded_folders.sort();
    }
    settings::save(&app, &settings)?;

    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    if root == folder {
        db::remove_folder(&conn, &folder).map_err(|err| err.to_string())?;
    } else {
        db::remove_files_in_path(&conn, path).map_err(|err| err.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
fn open_folder_in_file_manager(path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("{path} is not an available folder."));
    }

    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = Command::new("xdg-open");

    command.arg(&path).spawn().map_err(|error| {
        format!("Could not open the folder in the system file manager: {error}")
    })?;
    Ok(())
}

#[tauri::command]
fn show_item_in_file_manager(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("{path} does not exist."));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(file_path)
            .spawn()
            .map_err(|error| format!("Could not reveal the file in Finder: {error}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = file_path.to_string_lossy().replace("/", "\\");
        Command::new("explorer")
            .arg(format!("/select,\"{}\"", win_path))
            .spawn()
            .map_err(|error| format!("Could not reveal the file in Explorer: {error}"))?;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(parent) = file_path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|error| format!("Could not open the parent folder: {error}"))?;
        }
    }

    Ok(())
}

/// Wipe the entire catalogue, clear cached thumbnail files, and re-register
/// watched folders so a fresh rescan picks up everything from scratch.
#[tauri::command]
fn reset_catalogue(app: AppHandle, db_state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    db::reset_catalogue(&conn).map_err(|err| err.to_string())?;

    // Wipe cached thumbnail files as well so orientation fixes can refresh
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let thumbnails_dir = cache_dir.join("thumbnails");
        let _ = std::fs::remove_dir_all(&thumbnails_dir);
    }

    // Re-register all watched folders so subsequent scans can find them
    if let Ok(settings) = settings::load(&app) {
        for folder in &settings.watched_folders {
            let _ = db::add_folder(&conn, folder);
        }
    }
    Ok(())
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
    db_state: tauri::State<'_, DbState>,
    folder: String,
) -> Result<ScanResult, String> {
    let res = perform_scan_and_sync(app.clone(), db_state, folder).await;
    if res.is_ok() {
        let _ = enqueue_unrendered_raw_files(&app);
    }
    res
}

#[tauri::command]
async fn scan_folders(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    folders: Vec<String>,
) -> Result<ScanResult, String> {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut scanned_entries = 0_usize;
    let mut unreadable_entries = 0_usize;

    for folder in folders {
        match perform_scan_and_sync(app.clone(), db_state.clone(), folder).await {
            Ok(result) => {
                scanned_entries += result.scanned_entries;
                unreadable_entries += result.unreadable_entries;
                files.extend(result.files);
                errors.extend(result.errors);
            }
            Err(error) => errors.push(error),
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    let _ = enqueue_unrendered_raw_files(&app);
    Ok(ScanResult {
        files,
        scanned_entries,
        unreadable_entries,
        errors,
    })
}

#[tauri::command]
async fn generate_thumbnails(
    app: AppHandle,
    files: Vec<scanner::ImageFile>,
) -> Result<ThumbnailResult, String> {
    // Retain compatibility with frontend thumbnail calls if any remain
    tauri::async_runtime::spawn_blocking(move || {
        thumbnails::generate(&app, files, |progress| {
            emit_thumbnail_progress(&app, progress)
        })
    })
    .await
    .map_err(|error| format!("Thumbnail generation could not finish: {error}"))?
}

#[tauri::command]
fn get_catalogued_files(
    db_state: tauri::State<'_, DbState>,
    folder: Option<String>,
) -> Result<Vec<db::IndexedFile>, String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let files = match folder.as_deref() {
        Some("__all_folders__") | None => db::get_active_files(&conn, None),
        Some(path) => db::get_active_files_in_path(&conn, Path::new(path)),
    }
    .map_err(|err| err.to_string())?;
    Ok(files)
}

#[tauri::command]
fn remove_from_catalogue(db_state: tauri::State<'_, DbState>, path: String) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    db::mark_file_ignored(&conn, &path).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_from_disk(db_state: tauri::State<'_, DbState>, path: String) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;

    // Find and delete thumbnail file
    if let Some(record) = db::get_file_record(&conn, &path).map_err(|err| err.to_string())? {
        if let Some(thumb_path) = record.thumbnail_path {
            let _ = std::fs::remove_file(Path::new(&thumb_path));
        }
    }

    // Remove image file from disk
    let file_path = Path::new(&path);
    if file_path.is_file() {
        std::fs::remove_file(file_path)
            .map_err(|err| format!("Could not delete file from disk: {err}"))?;
    }

    // Remove record from database
    db::delete_file_record(&conn, &path).map_err(|err| err.to_string())?;
    Ok(())
}

fn write_metadata_rating(photo_path: &Path, rating: Option<u16>) -> Result<(), String> {
    let mut et = exiftool_rs::ExifTool::new();
    let rating_val = rating.map(|r| r.to_string());
    et.set_new_value("IFD0:Rating", rating_val.as_deref());
    et.set_new_value("xmp:Rating", rating_val.as_deref());
    et.set_new_value("Rating", rating_val.as_deref());

    let parent = photo_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let file_name = photo_path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temp_name = format!("{}.tmp", file_name.to_string_lossy());
    let temp_path = parent.join(temp_name);

    et.write_info(photo_path, &temp_path)
        .map_err(|e| format!("Failed to write metadata: {:?}", e))?;

    std::fs::rename(&temp_path, photo_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to overwrite original file: {}", e)
    })?;

    Ok(())
}

#[tauri::command]
fn log_frontend_error(msg: String) {
    eprintln!("FRONTEND ERROR: {}", msg);
    let _ = std::fs::write("frontend_error.log", msg);
}

#[tauri::command]
fn set_photo_rating(
    db_state: tauri::State<'_, DbState>,
    path: String,
    rating: Option<u16>,
) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;

    let photo_path = Path::new(&path);
    if !photo_path.exists() {
        return Err("Photo file does not exist on disk".to_string());
    }

    write_metadata_rating(photo_path, rating)?;

    db::update_file_rating(&conn, &path, rating).map_err(|err| err.to_string())?;

    Ok(())
}

fn write_metadata_keywords(photo_path: &Path, keywords: &[String]) -> Result<(), String> {
    let mut et = exiftool_rs::ExifTool::new();

    // IPTC stores each keyword separately, while XMP expects one comma-delimited bag.
    for kw in keywords {
        et.set_new_value("IPTC:Keywords", Some(kw));
    }
    let xmp_subject = keywords.join(", ");
    et.set_new_value(
        "XMP:Subject",
        (!xmp_subject.is_empty()).then_some(xmp_subject.as_str()),
    );

    let parent = photo_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let file_name = photo_path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temp_name = format!("{}.tmp", file_name.to_string_lossy());
    let temp_path = parent.join(temp_name);

    et.write_info(photo_path, &temp_path)
        .map_err(|e| format!("Failed to write metadata: {:?}", e))?;

    std::fs::rename(&temp_path, photo_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to overwrite original file: {}", e)
    })?;

    Ok(())
}

#[tauri::command]
fn set_photo_keywords(
    db_state: tauri::State<'_, DbState>,
    path: String,
    keywords: Vec<String>,
) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;

    let photo_path = Path::new(&path);
    if !photo_path.exists() {
        return Err("Photo file does not exist on disk".to_string());
    }

    write_metadata_keywords(photo_path, &keywords)?;

    db::update_file_keywords(
        &conn,
        &path,
        if keywords.is_empty() {
            None
        } else {
            Some(&keywords)
        },
    )
    .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_rating_for_multiple_photos(
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
    rating: Option<u16>,
) -> Result<(), String> {
    use rayon::prelude::*;

    // 1. Perform metadata updates in parallel using rayon
    let results: Vec<Result<String, String>> = paths
        .into_par_iter()
        .map(|path| {
            let photo_path = Path::new(&path);
            if !photo_path.exists() {
                return Err(format!("Photo file does not exist: {}", path));
            }
            write_metadata_rating(photo_path, rating)?;
            Ok(path)
        })
        .collect();

    // 2. Report any failures before updating the DB
    for res in &results {
        if let Err(err) = res {
            return Err(err.clone());
        }
    }

    // 3. Batch write database ratings inside a single SQLite transaction
    let mut conn_guard = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = &mut *conn_guard;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for res in results {
        let path = res?;
        db::update_file_rating(&tx, &path, rating).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_tag_to_multiple_photos(
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
    tag: String,
) -> Result<(), String> {
    use rayon::prelude::*;

    // 1. Sequentially read current keywords from DB
    let mut path_keywords = Vec::with_capacity(paths.len());
    {
        let conn = db_state
            .0
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        for path in &paths {
            if let Some(record) = db::get_file_record(&conn, path).map_err(|e| e.to_string())? {
                path_keywords.push((path.clone(), record.keywords.unwrap_or_default()));
            } else {
                return Err(format!("No catalog record found for path: {}", path));
            }
        }
    }

    // 2. Perform metadata modifications in parallel using rayon
    let results: Vec<Result<(String, Vec<String>), String>> = path_keywords
        .into_par_iter()
        .map(|(path, mut keywords)| {
            let photo_path = Path::new(&path);
            if !photo_path.exists() {
                return Err(format!("Photo file does not exist: {}", path));
            }

            // Case-insensitive check
            if !keywords.iter().any(|k| k.to_lowercase() == tag.to_lowercase()) {
                keywords.push(tag.clone());
                write_metadata_keywords(photo_path, &keywords)?;
            }

            Ok((path, keywords))
        })
        .collect();

    // 3. Report any failures before updating the DB
    for res in &results {
        if let Err(err) = res {
            return Err(err.clone());
        }
    }

    // 4. Batch write database tags inside a single transaction
    let mut conn_guard = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = &mut *conn_guard;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for res in results {
        let (path, keywords) = res?;
        db::update_file_keywords(&tx, &path, Some(&keywords)).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_tag_from_multiple_photos(
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
    tag: String,
) -> Result<(), String> {
    use rayon::prelude::*;

    // 1. Sequentially read current keywords from DB
    let mut path_keywords = Vec::with_capacity(paths.len());
    {
        let conn = db_state
            .0
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        for path in &paths {
            if let Some(record) = db::get_file_record(&conn, path).map_err(|e| e.to_string())? {
                path_keywords.push((path.clone(), record.keywords.unwrap_or_default()));
            } else {
                return Err(format!("No catalog record found for path: {}", path));
            }
        }
    }

    // 2. Perform metadata modifications in parallel using rayon
    let results: Vec<Result<(String, Vec<String>), String>> = path_keywords
        .into_par_iter()
        .map(|(path, keywords)| {
            let photo_path = Path::new(&path);
            if !photo_path.exists() {
                return Err(format!("Photo file does not exist: {}", path));
            }

            let updated: Vec<String> = keywords.into_iter().filter(|k| k != &tag).collect();
            write_metadata_keywords(photo_path, &updated)?;

            Ok((path, updated))
        })
        .collect();

    // 3. Check for failures
    for res in &results {
        if let Err(err) = res {
            return Err(err.clone());
        }
    }

    // 4. Batch write database tags inside a single transaction
    let mut conn_guard = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = &mut *conn_guard;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for res in results {
        let (path, keywords) = res?;
        db::update_file_keywords(&tx, &path, Some(&keywords)).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_all_catalog_tags(db_state: tauri::State<'_, DbState>) -> Result<Vec<String>, String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;

    db::get_unique_keywords(&conn).map_err(|err| err.to_string())
}

async fn perform_scan_and_sync(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    folder: String,
) -> Result<ScanResult, String> {
    // 1. Scan directory on disk
    let folder_path = folder.clone();
    let app_clone = app.clone();
    let mut scan_res = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_directory(Path::new(&folder_path), true, |progress| {
            emit_scan_progress(&app_clone, progress);
        })
    })
    .await
    .map_err(|error| format!("The background scan could not finish: {error}"))??;

    let excluded_folders = settings::load(&app)?.excluded_folders;
    scan_res.files.retain(|file| {
        !excluded_folders
            .iter()
            .any(|excluded| Path::new(&file.path).starts_with(Path::new(excluded)))
    });

    // 2. Open DB and query folder index & existing catalogued files
    let conn_mutex = &db_state.0;

    let (folder_id, catalogued_map) = {
        let conn = conn_mutex
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        let folder_id = db::add_folder(&conn, &folder).map_err(|err| err.to_string())?;
        let catalogued = db::get_active_files_in_path(&conn, Path::new(&folder))
            .map_err(|err| err.to_string())?;
        use std::collections::HashMap;
        let map: HashMap<String, db::IndexedFile> = catalogued
            .into_iter()
            .map(|f| (f.path.clone(), f))
            .collect();
        (folder_id, map)
    };

    let mut files_to_process = Vec::new();
    let mut active_paths = std::collections::HashSet::new();

    // Check files logic and clean up missing entries
    {
        let conn = conn_mutex
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        for disk_file in &scan_res.files {
            active_paths.insert(disk_file.path.clone());

            // Check if file is ignored or exists in db
            if let Some(existing) =
                db::get_file_record(&conn, &disk_file.path).map_err(|err| err.to_string())?
            {
                if existing.status == "ignored" {
                    continue;
                }
                if existing.file_size == disk_file.file_size
                    && existing.last_modified == disk_file.last_modified
                    && existing
                        .thumbnail_path
                        .as_deref()
                        .map(|p| !p.is_empty())
                        .unwrap_or(false)
                {
                    // File exists, hasn't changed, and already has a thumbnail. Skip.
                    continue;
                }
            }

            // Needs metadata/thumbnail extraction
            files_to_process.push(disk_file.clone());
        }

        // Find and delete missing files (exist in catalogued_map but not in active_paths)
        for path in catalogued_map.keys() {
            if !active_paths.contains(path) {
                let _ = db::delete_file_record(&conn, path);
            }
        }
    }

    // 3. Process new/modified files (no DB locks held across awaits!)
    if !files_to_process.is_empty() {
        let total = files_to_process.len();
        let app_clone = app.clone();
        let cache_directory = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Could not resolve thumbnail cache: {error}"))?
            .join("thumbnails");
        std::fs::create_dir_all(&cache_directory)
            .map_err(|error| format!("Could not create thumbnail cache: {error}"))?;


        for (index, disk_file) in files_to_process.into_iter().enumerate() {
            let file_path_str = disk_file.path.clone();
            let file_name_str = disk_file.name.clone();
            let file_size = disk_file.file_size;
            let file_last_modified = disk_file.last_modified;
            let cache_dir_clone = cache_directory.clone();

            let thumbnail_path = tauri::async_runtime::spawn_blocking(move || {
                let temp_file = scanner::ImageFile {
                    name: file_name_str,
                    path: file_path_str,
                    file_size,
                    last_modified: file_last_modified,
                };
                thumbnails::thumbnail_for(&temp_file, &cache_dir_clone)
            })
            .await
            .map_err(|err| format!("Thumbnail generation thread failed: {err}"))?
            .ok()
            .map(|p| p.to_string_lossy().into_owned());

            // Extract image dimensions and EXIF on a blocking worker so the
            // async command runtime stays available for UI requests.
            let metadata_path = disk_file.path.clone();
            let app_handle_for_meta = app.clone();
            let metadata = tauri::async_runtime::spawn_blocking(move || {
                get_image_metadata_internal(Some(&app_handle_for_meta), &metadata_path).ok()
            })
            .await
            .map_err(|err| format!("Image metadata worker failed: {err}"))?;

            let file_record = db::IndexedFile {
                path: disk_file.path.clone(),
                name: disk_file.name.clone(),
                file_size: disk_file.file_size,
                format: disk_file
                    .path
                    .split('.')
                    .next_back()
                    .unwrap_or("")
                    .to_uppercase(),
                width: metadata.as_ref().map(|m| m.dimensions.0).unwrap_or(0),
                height: metadata.as_ref().map(|m| m.dimensions.1).unwrap_or(0),
                camera: metadata.as_ref().and_then(|m| m.camera.clone()),
                lens: metadata.as_ref().and_then(|m| m.lens.clone()),
                latitude: metadata.as_ref().and_then(|m| m.latitude),
                longitude: metadata.as_ref().and_then(|m| m.longitude),
                gps_altitude: metadata.as_ref().and_then(|m| m.gps_altitude),
                location_country: metadata.as_ref().and_then(|m| m.location_country.clone()),
                location_state: metadata.as_ref().and_then(|m| m.location_state.clone()),
                location_city: metadata.as_ref().and_then(|m| m.location_city.clone()),
                date_taken: metadata.as_ref().and_then(|m| m.date_taken.clone()),
                aperture: metadata.as_ref().and_then(|m| m.aperture.clone()),
                shutter_speed: metadata.as_ref().and_then(|m| m.shutter_speed.clone()),
                iso: metadata.as_ref().and_then(|m| m.iso),
                focal_length: metadata.as_ref().and_then(|m| m.focal_length.clone()),
                rating: metadata.as_ref().and_then(|m| m.rating),
                keywords: metadata.as_ref().and_then(|m| m.keywords.clone()),
                thumbnail_path,
                last_modified: disk_file.last_modified,
                status: "active".to_string(),
            };

            // Save immediately to DB
            {
                let mut conn = conn_mutex
                    .lock()
                    .map_err(|_| "Failed to lock database".to_string())?;
                db::save_files_batch(&mut conn, &[file_record], folder_id)
                    .map_err(|err| err.to_string())?;
            }

            // Notify the frontend that new catalogue entries are available
            let _ = app_clone.emit("catalogue-updated", ());

            emit_thumbnail_progress(
                &app_clone,
                &ThumbnailProgress {
                    completed: index + 1,
                    total,
                },
            );
        }
    }

    // 4. Return all active files in DB for this folder as ScanResult
    let final_files = {
        let conn = conn_mutex
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        db::get_active_files_in_path(&conn, Path::new(&folder)).map_err(|err| err.to_string())?
    };

    let image_files = final_files
        .into_iter()
        .map(|f| scanner::ImageFile {
            name: f.name,
            path: f.path,
            file_size: f.file_size,
            last_modified: f.last_modified,
        })
        .collect();

    Ok(ScanResult {
        files: image_files,
        scanned_entries: scan_res.scanned_entries,
        unreadable_entries: scan_res.unreadable_entries,
        errors: scan_res.errors,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub file_size: u64,
    pub dimensions: (u32, u32),
    pub format: String,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub gps_altitude: Option<f64>,
    pub location_country: Option<String>,
    pub location_state: Option<String>,
    pub location_city: Option<String>,
    pub date_taken: Option<String>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub iso: Option<u32>,
    pub focal_length: Option<String>,
    pub rating: Option<u16>,
    pub keywords: Option<Vec<String>>,
}

#[tauri::command]
async fn get_image_metadata(app: AppHandle, path: String) -> Result<ImageMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || get_image_metadata_internal(Some(&app), &path))
        .await
        .map_err(|error| format!("Photo metadata lookup could not finish: {error}"))?
}

fn round_mm_in_string(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let num_str: String = chars[start..i].iter().collect();
            
            let mut space_count = 0;
            while i + space_count < chars.len() && chars[i + space_count] == ' ' {
                space_count += 1;
            }
            
            if i + space_count + 1 < chars.len() 
               && chars[i + space_count] == 'm' 
               && chars[i + space_count + 1] == 'm' 
            {
                if let Ok(val) = num_str.parse::<f64>() {
                    result.push_str(&format!("{}", val.round() as u32));
                } else {
                    result.push_str(&num_str);
                }
                i += space_count + 2;
                result.push_str(" mm");
            } else {
                result.push_str(&num_str);
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

fn clean_lens_model(s: &str) -> String {
    let rounded = round_mm_in_string(s);
    let chars: Vec<char> = rounded.chars().collect();
    let mut result = String::new();
    let mut i = 0;
    while i < chars.len() {
        let is_f_aperture = if i < chars.len() && (chars[i] == 'f' || chars[i] == 'F') {
            let mut offset = 1;
            if i + 1 < chars.len() && chars[i + 1] == '/' {
                offset = 2;
            }
            if i + offset < chars.len() && chars[i + offset].is_ascii_digit() {
                true
            } else {
                false
            }
        } else {
            false
        };

        if is_f_aperture {
            if chars[i + 1] == '/' {
                i += 2;
            } else {
                i += 1;
            }
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            // Strip range aperture suffixes (e.g. -6.3)
            let mut offset = 0;
            if i < chars.len() && chars[i] == '-' {
                offset += 1;
            }
            if i + offset < chars.len() && chars[i + offset].is_ascii_digit() {
                i += offset;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result.trim()
        .replace("  ", " ")
        .trim_end_matches(' ')
        .trim_end_matches('-')
        .trim_end_matches('•')
        .trim()
        .to_string()
}

fn get_ascii_field(field: &exif::Field) -> Option<String> {
    if let exif::Value::Ascii(ref vec) = field.value {
        for bytes in vec {
            if let Ok(s) = std::str::from_utf8(bytes) {
                let trimmed = s.trim().trim_matches('\0').trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    let s = field.display_value().to_string();
    let clean = s.trim().trim_matches('"').trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean.to_string())
    }
}

fn parse_gps_coordinate(field: &exif::Field) -> Option<f64> {
    if let exif::Value::Rational(ref rationals) = field.value {
        if rationals.len() >= 3 {
            let deg = rationals[0].num as f64 / rationals[0].denom as f64;
            let min = rationals[1].num as f64 / rationals[1].denom as f64;
            let sec = rationals[2].num as f64 / rationals[2].denom as f64;
            return Some(deg + min / 60.0 + sec / 3600.0);
        }
    }
    None
}

fn read_oriented_dimensions(path: &Path) -> Option<(u32, u32)> {
    if let Ok(reader) = image::ImageReader::open(path) {
        if let Ok(mut decoder) = reader.into_decoder() {
            let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
            let (mut w, mut h) = decoder.dimensions();
            if matches!(
                orientation,
                image::metadata::Orientation::Rotate90
                    | image::metadata::Orientation::Rotate270
                    | image::metadata::Orientation::Rotate90FlipH
                    | image::metadata::Orientation::Rotate270FlipH
            ) {
                std::mem::swap(&mut w, &mut h);
            }
            return Some((w, h));
        }
    }
    None
}

fn get_image_metadata_internal(app: Option<&AppHandle>, path: &str) -> Result<ImageMetadata, String> {
    let file_path = Path::new(path);
    let metadata = std::fs::metadata(file_path)
        .map_err(|err| format!("Could not read file metadata: {err}"))?;
    let file_size = metadata.len();

    let format = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("unknown")
        .to_uppercase();

    let mut width = 0;
    let mut height = 0;
    let mut camera = None;
    let mut lens = None;
    let mut latitude = None;
    let mut longitude = None;
    let mut gps_altitude = None;
    let location_country = None;
    let location_state = None;
    let location_city = None;
    let mut date_taken = None;
    let mut aperture = None;
    let mut shutter_speed = None;
    let mut iso = None;
    let mut focal_length = None;
    let mut rating = None;
    let mut keywords = None;

    let is_raw = thumbnails::is_raw_file(file_path);

    if let Ok(file) = std::fs::File::open(file_path) {
        let mut bufreader = std::io::BufReader::new(&file);
        let exifreader = exif::Reader::new();
        if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
            // Read width/height from EXIF
            let mut exif_width = None;
            let mut exif_height = None;

            if let Some(field) = exif.get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY) {
                if let exif::Value::Long(ref values) = field.value {
                    exif_width = values.first().copied();
                } else if let exif::Value::Short(ref values) = field.value {
                    exif_width = values.first().map(|&v| v as u32);
                }
            }
            if let Some(field) = exif.get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY) {
                if let exif::Value::Long(ref values) = field.value {
                    exif_height = values.first().copied();
                } else if let exif::Value::Short(ref values) = field.value {
                    exif_height = values.first().map(|&v| v as u32);
                }
            }

            if exif_width.is_none() || exif_height.is_none() {
                if let Some(field) = exif.get_field(exif::Tag::ImageWidth, exif::In::PRIMARY) {
                    if let exif::Value::Long(ref values) = field.value {
                        exif_width = values.first().copied();
                    } else if let exif::Value::Short(ref values) = field.value {
                        exif_width = values.first().map(|&v| v as u32);
                    }
                }
                if let Some(field) = exif.get_field(exif::Tag::ImageLength, exif::In::PRIMARY) {
                    if let exif::Value::Long(ref values) = field.value {
                        exif_height = values.first().copied();
                    } else if let exif::Value::Short(ref values) = field.value {
                        exif_height = values.first().map(|&v| v as u32);
                    }
                }
            }

            let mut orientation_val = 1_u32;
            if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
                if let exif::Value::Short(ref values) = field.value {
                    if let Some(&val) = values.first() {
                        orientation_val = val as u32;
                    }
                }
            }

            if let (Some(mut w), Some(mut h)) = (exif_width, exif_height) {
                if w >= 500 && h >= 500 {
                    if matches!(orientation_val, 5 | 6 | 7 | 8) {
                        std::mem::swap(&mut w, &mut h);
                    }
                    width = w;
                    height = h;
                }
            }

            let make = exif
                .get_field(exif::Tag::Make, exif::In::PRIMARY)
                .and_then(|f| get_ascii_field(f));
            let model = exif
                .get_field(exif::Tag::Model, exif::In::PRIMARY)
                .and_then(|f| get_ascii_field(f));
            camera = match (make, model) {
                (Some(mk), Some(md)) => {
                    if md.starts_with(&mk) {
                        Some(md)
                    } else {
                        Some(format!("{} {}", mk, md))
                    }
                }
                (Some(mk), None) => Some(mk),
                (None, Some(md)) => Some(md),
                _ => None,
            };

            // Parse Lens Model
            if let Some(field) = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
                if let Some(lens_raw) = get_ascii_field(field) {
                    lens = Some(clean_lens_model(&lens_raw));
                }
            }

            // Parse GPS Latitude
            if let Some(field) = exif.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY) {
                if let Some(val) = parse_gps_coordinate(field) {
                    let is_south = exif
                        .get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY)
                        .map(|f| f.display_value().to_string().contains('S'))
                        .unwrap_or(false);
                    latitude = Some(if is_south { -val } else { val });
                }
            }

            // Parse GPS Longitude
            if let Some(field) = exif.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY) {
                if let Some(val) = parse_gps_coordinate(field) {
                    let is_west = exif
                        .get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY)
                        .map(|f| f.display_value().to_string().contains('W'))
                        .unwrap_or(false);
                    longitude = Some(if is_west { -val } else { val });
                }
            }

            // Parse GPS Altitude
            if let Some(field) = exif.get_field(exif::Tag::GPSAltitude, exif::In::PRIMARY) {
                if let exif::Value::Rational(ref rationals) = field.value {
                    if let Some(r) = rationals.first() {
                        let alt = r.num as f64 / r.denom as f64;
                        let is_below = exif
                            .get_field(exif::Tag::GPSAltitudeRef, exif::In::PRIMARY)
                            .map(|f| f.display_value().to_string().contains('1')) // 1 = below sea level
                            .unwrap_or(false);
                        gps_altitude = Some(if is_below { -alt } else { alt });
                    }
                }
            }

            if let Some(field) = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
                date_taken = Some(
                    field
                        .display_value()
                        .to_string()
                        .trim_matches('"')
                        .to_string(),
                );
            }

            if let Some(field) = exif.get_field(exif::Tag::FNumber, exif::In::PRIMARY) {
                aperture = Some(format!("f/{}", field.display_value()));
            }

            if let Some(field) = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY) {
                let mut exposure_time: Option<f64> = None;
                match field.value {
                    exif::Value::Rational(ref rationals) => {
                        if let Some(r) = rationals.first() {
                            if r.denom != 0 {
                                exposure_time = Some(r.num as f64 / r.denom as f64);
                            }
                        }
                    }
                    exif::Value::SRational(ref rationals) => {
                        if let Some(r) = rationals.first() {
                            if r.denom != 0 {
                                exposure_time = Some(r.num as f64 / r.denom as f64);
                            }
                        }
                    }
                    exif::Value::Float(ref floats) => {
                        if let Some(&f) = floats.first() {
                            exposure_time = Some(f as f64);
                        }
                    }
                    exif::Value::Double(ref doubles) => {
                        if let Some(&d) = doubles.first() {
                            exposure_time = Some(d);
                        }
                    }
                    _ => {}
                }

                if let Some(exp) = exposure_time {
                    if exp >= 1.0 {
                        if exp == exp.round() {
                            shutter_speed = Some(format!("{}s", exp as u32));
                        } else {
                            shutter_speed = Some(format!("{:.1}s", exp));
                        }
                    } else {
                        let denom = 1.0 / exp;
                        shutter_speed = Some(format!("1/{}s", denom.round() as u32));
                    }
                } else {
                    shutter_speed = Some(format!("{}s", field.display_value()));
                }
            }

            if let Some(field) = exif.get_field(exif::Tag::ISOSpeed, exif::In::PRIMARY) {
                if let exif::Value::Short(ref values) = field.value {
                    if let Some(&val) = values.first() {
                        iso = Some(val as u32);
                    }
                }
            }

            if let Some(field) = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY) {
                let mut val_mm: Option<u32> = None;
                match field.value {
                    exif::Value::Rational(ref rationals) => {
                        if let Some(r) = rationals.first() {
                            if r.denom != 0 {
                                val_mm = Some((r.num as f64 / r.denom as f64).round() as u32);
                            }
                        }
                    }
                    exif::Value::SRational(ref rationals) => {
                        if let Some(r) = rationals.first() {
                            if r.denom != 0 {
                                val_mm = Some((r.num as f64 / r.denom as f64).round() as u32);
                            }
                        }
                    }
                    exif::Value::Float(ref floats) => {
                        if let Some(&f) = floats.first() {
                            val_mm = Some(f.round() as u32);
                        }
                    }
                    exif::Value::Double(ref doubles) => {
                        if let Some(&d) = doubles.first() {
                            val_mm = Some(d.round() as u32);
                        }
                    }
                    _ => {}
                }
                if let Some(mm) = val_mm {
                    focal_length = Some(format!("{} mm", mm));
                } else {
                    focal_length = Some(format!("{} mm", field.display_value()));
                }
            }

            if let Some(field) =
                exif.get_field(exif::Tag(exif::Context::Tiff, 0x4746), exif::In::PRIMARY)
            {
                if let exif::Value::Short(ref values) = field.value {
                    rating = values.first().copied();
                }
            }

            if let Some(field) =
                exif.get_field(exif::Tag(exif::Context::Tiff, 0x9c9e), exif::In::PRIMARY)
            {
                if let exif::Value::Byte(ref bytes) = field.value {
                    let utf16_units: Vec<u16> = bytes
                        .chunks_exact(2)
                        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                        .collect();
                    if let Ok(s) = String::from_utf16(&utf16_units) {
                        let cleaned: String = s.chars().filter(|&c| c != '\0').collect();
                        let list: Vec<String> = cleaned
                            .split(';')
                            .map(|item| item.trim().to_string())
                            .filter(|item| !item.is_empty())
                            .collect();
                        if !list.is_empty() {
                            keywords = Some(list);
                        }
                    }
                }
            }
        }
    }

    // Fallback: if rating is None, extract it using exiftool-rs
    if rating.is_none() {
        let et = exiftool_rs::ExifTool::new();
        if let Ok(tags) = et.extract_info(file_path) {
            for tag in &tags {
                if tag.name == "Rating" {
                    if let Ok(r) = tag.print_value.parse::<u16>() {
                        rating = Some(r);
                        break;
                    }
                }
            }
        }
    }

    // Fallback: if keywords is None, extract them using exiftool-rs.
    if keywords.is_none() {
        let et = exiftool_rs::ExifTool::new();
        if let Ok(tags) = et.extract_info(file_path) {
            let mut extracted_keywords = Vec::new();
            for tag in &tags {
                if tag.name == "Keywords" || tag.name == "Subject" {
                    extracted_keywords.extend(
                        tag.print_value
                            .split(',')
                            .map(str::trim)
                            .filter(|item| !item.is_empty())
                            .map(ToOwned::to_owned),
                    );
                }
            }
            extracted_keywords.sort();
            extracted_keywords.dedup();
            if !extracted_keywords.is_empty() {
                keywords = Some(extracted_keywords);
            }
        }
    }

    // Fallback for dimensions
    if width == 0 || height == 0 {
        if is_raw {
            if let Some(app_handle) = app {
                if let Ok(cache_dir) = app_handle.path().app_cache_dir() {
                    let cache_directory = cache_dir.join("thumbnails");
                    let _ = std::fs::create_dir_all(&cache_directory);

                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let modified = metadata.modified().ok();
                    let mut hasher = DefaultHasher::new();
                    file_path.hash(&mut hasher);
                    file_size.hash(&mut hasher);
                    modified.hash(&mut hasher);
                    let hash_val = hasher.finish();
                    let preview_path = cache_directory.join(format!("{:016x}_preview.jpg", hash_val));

                    // If preview doesn't exist, extract it
                    if !preview_path.is_file() {
                        let source_str = file_path.to_string_lossy();
                        let preview_path_str = preview_path.to_string_lossy();
                        let _ = quickraw::Export::export_thumbnail_to_file(&source_str, &preview_path_str);
                    }

                    // Read dimensions from preview image, correcting for orientation
                    if let Some((w, h)) = read_oriented_dimensions(&preview_path) {
                        width = w;
                        height = h;
                    }
                }
            }
        } else if let Some((w, h)) = read_oriented_dimensions(file_path) {
            width = w;
            height = h;
        }
    }

    if width == 0 || height == 0 {
        return Err(format!("Could not read image dimensions for {}", file_path.display()));
    }

    Ok(ImageMetadata {
        file_size,
        dimensions: (width, height),
        format,
        camera,
        lens,
        latitude,
        longitude,
        gps_altitude,
        location_country,
        location_state,
        location_city,
        date_taken,
        aperture,
        shutter_speed,
        iso,
        focal_length,
        rating,
        keywords,
    })
}

#[tauri::command]
fn get_viewer_path(app: AppHandle, path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    if thumbnails::is_raw_file(file_path) {
        let metadata = std::fs::metadata(file_path)
            .map_err(|error| format!("Could not read {}: {error}", file_path.display()))?;
        let file_size = metadata.len();
        let modified = metadata.modified().ok();

        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        file_path.hash(&mut hasher);
        file_size.hash(&mut hasher);
        modified.hash(&mut hasher);
        let hash_val = hasher.finish();

        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Could not resolve thumbnail cache: {error}"))?
            .join("thumbnails");
        let preview_path = cache_dir.join(format!("{:016x}_preview.jpg", hash_val));

        // If preview doesn't exist, extract it on-the-fly
        if !preview_path.is_file() {
            let source_str = file_path.to_string_lossy();
            let preview_path_str = preview_path.to_string_lossy();
            let _ = std::fs::create_dir_all(&cache_dir);
            quickraw::Export::export_thumbnail_to_file(&source_str, &preview_path_str)
                .map_err(|error| format!("Could not extract RAW preview for {}: {error}", file_path.display()))?;
        }

        Ok(preview_path.to_string_lossy().into_owned())
    } else {
        Ok(path)
    }
}

#[tauri::command]
async fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file_path = Path::new(&path);
        let img = image::open(file_path)
            .map_err(|err| format!("Could not open image {}: {err}", file_path.display()))?;

        let img_rgba = img.to_rgba8();
        let (width, height) = img_rgba.dimensions();

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|err| format!("Could not initialize system clipboard: {err}"))?;

        let image_data = arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::from(img_rgba.into_raw()),
        };

        clipboard
            .set_image(image_data)
            .map_err(|err| format!("Could not write image to system clipboard: {err}"))?;

        Ok(())
    })
    .await
    .map_err(|error| format!("Background clipboard task failed: {error}"))?
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

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn start_raw_rendering_worker(app: AppHandle, raw_queue: std::sync::Arc<RawRenderingQueue>) {
    if raw_queue.active.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("raw-rendering-status", true);

        let cache_directory = match app.path().app_cache_dir() {
            Ok(dir) => dir.join("thumbnails"),
            Err(_) => {
                raw_queue.active.store(false, std::sync::atomic::Ordering::Relaxed);
                let _ = app.emit("raw-rendering-status", false);
                return;
            }
        };

        loop {
            let next_path = {
                let mut pending = raw_queue.pending.lock().unwrap();
                pending.pop_front()
            };

            let path = match next_path {
                Some(p) => p,
                None => {
                    break;
                }
            };

            let photo_path = Path::new(&path);
            if photo_path.exists() {
                let cache_dir_clone = cache_directory.clone();
                let path_clone = photo_path.to_path_buf();
                
                let render_result = tauri::async_runtime::spawn_blocking(move || {
                    thumbnails::render_raw_sensor_data(&path_clone, &cache_dir_clone)
                }).await;

                match render_result {
                    Ok(Ok(_)) => {
                        let _ = app.emit("catalogue-updated", ());
                    }
                    Ok(Err(err)) => {
                        eprintln!("Error rendering RAW sensor data in background for {}: {}", path, err);
                    }
                    Err(err) => {
                        eprintln!("Worker thread join error for RAW rendering: {}", err);
                    }
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        raw_queue.active.store(false, std::sync::atomic::Ordering::Relaxed);
        let _ = app.emit("raw-rendering-status", false);
    });
}

#[tauri::command]
fn prioritize_raw_rendering_for_folder(
    raw_state: tauri::State<'_, RawRenderingState>,
    folder: String,
) -> Result<(), String> {
    let mut pending = raw_state.0.pending.lock().map_err(|_| "Failed to lock queue".to_string())?;
    
    let mut matching = Vec::new();
    let mut non_matching = Vec::new();
    
    for path in pending.drain(..) {
        if path.starts_with(&folder) {
            matching.push(path);
        } else {
            non_matching.push(path);
        }
    }
    
    for path in matching {
        pending.push_back(path);
    }
    for path in non_matching {
        pending.push_back(path);
    }
    
    Ok(())
}

fn enqueue_unrendered_raw_files(app: &AppHandle) -> Result<(), String> {
    let db_state = app.state::<DbState>();
    let raw_state = app.state::<RawRenderingState>();
    let conn = db_state.0.lock().map_err(|_| "Failed to lock database".to_string())?;

    let all_files = db::get_active_files(&conn, None).map_err(|e| e.to_string())?;
    
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve app cache: {error}"))?
        .join("thumbnails");

    let mut unrendered = Vec::new();
    for file in all_files {
        let source_path = Path::new(&file.path);
        if thumbnails::is_raw_file(source_path) {
            let metadata = match fs::metadata(source_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified = metadata.modified().ok();
            let mut hasher = DefaultHasher::new();
            source_path.hash(&mut hasher);
            metadata.len().hash(&mut hasher);
            modified.hash(&mut hasher);
            let hash_val = hasher.finish();
            let marker_path = cache_directory.join(format!("{:016x}.raw_rendered", hash_val));
            
            if !marker_path.exists() {
                unrendered.push(file.path);
            }
        }
    }

    if !unrendered.is_empty() {
        let mut pending = raw_state.0.pending.lock().unwrap();
        for p in unrendered {
            if !pending.contains(&p) {
                pending.push_back(p);
            }
        }
        
        start_raw_rendering_worker(app.clone(), raw_state.0.clone());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|err| {
                eprintln!("Failed to get app data directory: {err}");
                err
            })?;
            std::fs::create_dir_all(&app_data_dir).map_err(|err| {
                eprintln!("Failed to create app data directory: {err}");
                err
            })?;
            let db_path = app_data_dir.join("catalogue.db");
            let conn = db::init_db(&db_path).map_err(|err| {
                eprintln!("Failed to initialize database: {err}");
                err
            })?;

            // Proactively sync all watched folders in settings.json to the folders table
            if let Ok(settings) = settings::load(app.handle()) {
                for folder in settings.watched_folders {
                    let _ = db::add_folder(&conn, &folder);
                }
            }

            app.manage(DbState(Mutex::new(conn)));

            let raw_queue = std::sync::Arc::new(RawRenderingQueue {
                pending: std::sync::Mutex::new(std::collections::VecDeque::new()),
                active: std::sync::atomic::AtomicBool::new(false),
            });
            app.manage(RawRenderingState(raw_queue));

            let _ = enqueue_unrendered_raw_files(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_display_preferences,
            add_watched_folder,
            remove_watched_folder,
            remove_folder_from_browser,
            open_folder_in_file_manager,
            reset_catalogue,
            discover_folders,
            scan_folder,
            scan_folders,
            generate_thumbnails,
            thumbnail_cache_size,
            get_image_metadata,
            get_viewer_path,
            copy_image_to_clipboard,
            get_catalogued_files,
            remove_from_catalogue,
            delete_from_disk,
            set_photo_rating,
            set_rating_for_multiple_photos,
            add_tag_to_multiple_photos,
            remove_tag_from_multiple_photos,
            log_frontend_error,
            show_item_in_file_manager,
            set_photo_keywords,
            get_all_catalog_tags,
            get_app_version,
            prioritize_raw_rendering_for_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Peter's Photo Manager");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_write_metadata_keywords() {
        let minimal_png: &[u8] = &[
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 96, 0, 2, 0,
            0, 5, 0, 1, 226, 38, 5, 155, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ];

        let temp_dir = std::env::temp_dir();
        let test_file_path =
            temp_dir.join(format!("test_metadata_keywords_{}.png", std::process::id()));
        fs::write(&test_file_path, minimal_png).expect("Write test image");

        // Write tags
        let tags = vec!["nature".to_string(), "hiking".to_string()];
        write_metadata_keywords(&test_file_path, &tags).expect("Write keywords");

        // Verify using get_image_metadata_internal (which uses the fallback ExifTool parser)
        let meta =
            get_image_metadata_internal(None, &test_file_path.to_string_lossy()).expect("Read metadata");
        let kws = meta.keywords.expect("Keywords must exist");

        assert_eq!(kws.len(), 2);
        assert!(kws.contains(&"nature".to_string()));
        assert!(kws.contains(&"hiking".to_string()));

        // Clean up
        let _ = fs::remove_file(&test_file_path);
    }

    #[test]
    fn test_clean_lens_model() {
        let lens = "NIKKOR Z 180-600 mm f/5.6-6.3 VR";
        assert_eq!(clean_lens_model(lens), "NIKKOR Z 180-600 mm VR");
    }
}
