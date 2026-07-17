use crate::scanner::ImageFile;
use image::ImageFormat;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const THUMBNAIL_EDGE: u32 = 300;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub name: String,
    pub source_path: String,
    pub thumbnail_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailProgress {
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub thumbnails: Vec<Thumbnail>,
    pub errors: Vec<String>,
}

pub fn cache_size(app: &AppHandle) -> Result<u64, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve thumbnail cache: {error}"))?
        .join("thumbnails");

    directory_size(&directory)
}

pub fn generate<F>(
    app: &AppHandle,
    files: Vec<ImageFile>,
    report: F,
) -> Result<ThumbnailResult, String>
where
    F: FnMut(&ThumbnailProgress) + Send + Sync,
{
    // Resolve cache directory
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve thumbnail cache: {error}"))?
        .join("thumbnails");
    fs::create_dir_all(&cache_directory)
        .map_err(|error| format!("Could not create thumbnail cache: {error}"))?;

    let total = files.len();
    // Shared progress reporter for parallel threads
    let progress = std::sync::Arc::new(std::sync::Mutex::new(report));

    // Parallel processing: collect all results first, then split successes from errors
    type TaskResult = Result<(ImageFile, PathBuf), String>;
    let results: Vec<(usize, TaskResult)> = files
        .into_par_iter()
        .enumerate()
        .map(|(index, file)| {
            let result = thumbnail_for(&file, &cache_directory);
            // Report progress safely across threads
            if let Ok(mut rep) = progress.lock() {
                rep(&ThumbnailProgress {
                    completed: index + 1,
                    total,
                });
            }
            (index, result.map(|path| (file, path)))
        })
        .collect();

    // Split into successes and errors
    let mut thumbnails = Vec::with_capacity(results.len());
    let mut errors = Vec::new();
    for (_, outcome) in results {
        match outcome {
            Ok((file, path)) => thumbnails.push(Thumbnail {
                name: file.name,
                source_path: file.path,
                thumbnail_path: path.to_string_lossy().into_owned(),
            }),
            Err(err) => errors.push(err),
        }
    }

    Ok(ThumbnailResult { thumbnails, errors })
}

pub fn thumbnail_for(file: &ImageFile, cache_directory: &Path) -> Result<PathBuf, String> {
    let source = Path::new(&file.path);
    let metadata = fs::metadata(source)
        .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
    let modified = metadata.modified().ok();
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    let cache_path = cache_directory.join(format!("{:016x}.jpg", hasher.finish()));

    if cache_path.is_file() {
        return Ok(cache_path);
    }

    let image = image::open(source)
        .map_err(|error| format!("Could not decode {}: {error}", source.display()))?;
    image
        .thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE)
        .save_with_format(&cache_path, ImageFormat::Jpeg)
        .map_err(|error| {
            format!(
                "Could not write thumbnail for {}: {error}",
                source.display()
            )
        })?;

    Ok(cache_path)
}

fn directory_size(directory: &Path) -> Result<u64, String> {
    if !directory.exists() {
        return Ok(0);
    }

    let mut total = 0_u64;
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read thumbnail cache: {error}"))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not inspect thumbnail cache: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect cached thumbnail: {error}"))?;

        if file_type.is_file() {
            total += entry
                .metadata()
                .map_err(|error| format!("Could not read cached thumbnail metadata: {error}"))?
                .len();
        } else if file_type.is_dir() {
            total += directory_size(&entry.path())?;
        }
    }

    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::thumbnail_for;
    use crate::scanner::ImageFile;
    use image::RgbImage;
    use std::fs;

    #[test]
    fn creates_and_reuses_a_cached_thumbnail() {
        let root = std::env::temp_dir().join(format!(
            "peters-photo-manager-thumbnail-test-{}",
            std::process::id()
        ));
        let cache = root.join("cache");
        let source = root.join("source.png");
        fs::create_dir_all(&cache).expect("create cache folder");
        RgbImage::new(640, 480)
            .save(&source)
            .expect("write source image");

        let file = ImageFile {
            name: "source.png".to_owned(),
            path: source.to_string_lossy().into_owned(),
            file_size: 0,
            last_modified: 0,
        };
        let first = thumbnail_for(&file, &cache).expect("create thumbnail");
        let second = thumbnail_for(&file, &cache).expect("reuse thumbnail");

        assert!(first.is_file());
        assert_eq!(first, second);

        fs::remove_dir_all(root).expect("remove test folders");
    }
}
