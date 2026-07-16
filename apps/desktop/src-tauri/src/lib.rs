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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub file_size: u64,
    pub dimensions: (u32, u32),
    pub format: String,
    pub camera: Option<String>,
    pub date_taken: Option<String>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub iso: Option<u32>,
    pub focal_length: Option<String>,
    pub rating: Option<u16>,
    pub keywords: Option<Vec<String>>,
}

#[tauri::command]
fn get_image_metadata(path: String) -> Result<ImageMetadata, String> {
    let file_path = Path::new(&path);
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

    Ok(ImageMetadata {
        file_size,
        dimensions: (width, height),
        format,
        camera,
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
        .invoke_handler(tauri::generate_handler![
            load_settings,
            add_watched_folder,
            remove_watched_folder,
            discover_folders,
            scan_folder,
            scan_folders,
            generate_thumbnails,
            thumbnail_cache_size,
            get_image_metadata,
            copy_image_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running Peter's Photo Manager");
}
