mod db;
mod scanner;
mod settings;
mod thumbnails;

use scanner::{FolderEntry, ScanProgress, ScanResult};
use settings::AppSettings;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use thumbnails::{ThumbnailProgress, ThumbnailResult};

pub struct DbState(pub Mutex<rusqlite::Connection>);

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

/// Wipe the entire catalogue and re-register watched folders so a fresh
/// rescan picks up everything from scratch.  Temporary dev helper.
#[tauri::command]
fn reset_catalogue(app: AppHandle, db_state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = db_state
        .0
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    db::reset_catalogue(&conn).map_err(|err| err.to_string())?;
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
    perform_scan_and_sync(app, db_state, folder).await
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

        let mut indexed_files = Vec::new();

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
            let metadata = tauri::async_runtime::spawn_blocking(move || {
                get_image_metadata_internal(&metadata_path).ok()
            })
            .await
            .map_err(|err| format!("Image metadata worker failed: {err}"))?;

            indexed_files.push(db::IndexedFile {
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
            });

            emit_thumbnail_progress(
                &app_clone,
                &ThumbnailProgress {
                    completed: index + 1,
                    total,
                },
            );
        }

        // Save batch to DB
        let mut conn = conn_mutex
            .lock()
            .map_err(|_| "Failed to lock database".to_string())?;
        db::save_files_batch(&mut conn, &indexed_files, folder_id)
            .map_err(|err| err.to_string())?;
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
async fn get_image_metadata(path: String) -> Result<ImageMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || get_image_metadata_internal(&path))
        .await
        .map_err(|error| format!("Photo metadata lookup could not finish: {error}"))?
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

fn get_image_metadata_internal(path: &str) -> Result<ImageMetadata, String> {
    let file_path = Path::new(path);
    let metadata = std::fs::metadata(file_path)
        .map_err(|err| format!("Could not read file metadata: {err}"))?;
    let file_size = metadata.len();

    let (width, height) = image::image_dimensions(file_path)
        .map_err(|err| format!("Could not read image dimensions: {err}"))?;

    let format = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("unknown")
        .to_uppercase();

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

    if let Ok(file) = std::fs::File::open(file_path) {
        let mut bufreader = std::io::BufReader::new(&file);
        let exifreader = exif::Reader::new();
        if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
            let make = exif
                .get_field(exif::Tag::Make, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string());
            let model = exif
                .get_field(exif::Tag::Model, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string());
            camera = match (make, model) {
                (Some(mk), Some(md)) => {
                    let mk_clean = mk.trim_matches('"');
                    let md_clean = md.trim_matches('"');
                    if md_clean.starts_with(mk_clean) {
                        Some(md_clean.to_string())
                    } else {
                        Some(format!("{} {}", mk_clean, md_clean))
                    }
                }
                (Some(mk), None) => Some(mk.trim_matches('"').to_string()),
                (None, Some(md)) => Some(md.trim_matches('"').to_string()),
                _ => None,
            };

            // Parse Lens Model
            if let Some(field) = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
                lens = Some(
                    field
                        .display_value()
                        .to_string()
                        .trim_matches('"')
                        .to_string(),
                );
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
                shutter_speed = Some(format!("{}s", field.display_value()));
            }

            if let Some(field) = exif.get_field(exif::Tag::ISOSpeed, exif::In::PRIMARY) {
                if let exif::Value::Short(ref values) = field.value {
                    if let Some(&val) = values.first() {
                        iso = Some(val as u32);
                    }
                }
            }

            if let Some(field) = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY) {
                focal_length = Some(format!("{} mm", field.display_value()));
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
            copy_image_to_clipboard,
            get_catalogued_files,
            remove_from_catalogue,
            delete_from_disk,
            set_photo_rating,
            log_frontend_error,
            show_item_in_file_manager,
            set_photo_keywords,
            get_all_catalog_tags
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
            get_image_metadata_internal(&test_file_path.to_string_lossy()).expect("Read metadata");
        let kws = meta.keywords.expect("Keywords must exist");

        assert_eq!(kws.len(), 2);
        assert!(kws.contains(&"nature".to_string()));
        assert!(kws.contains(&"hiking".to_string()));

        // Clean up
        let _ = fs::remove_file(&test_file_path);
    }
}
