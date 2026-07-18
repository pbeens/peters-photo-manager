use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFile {
    pub name: String,
    pub path: String,
    pub file_size: u64,
    pub last_modified: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanned_entries: usize,
    pub images_found: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<ImageFile>,
    pub scanned_entries: usize,
    pub unreadable_entries: usize,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub depth: usize,
    pub contains_images: bool,
}

pub fn discover_folders(root: &Path) -> Result<Vec<FolderEntry>, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a readable folder.", root.display()));
    }

    let mut folders = Vec::new();
    collect_image_folders(root, 0, &mut folders);

    folders.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(folders)
}

fn collect_image_folders(directory: &Path, depth: usize, folders: &mut Vec<FolderEntry>) -> bool {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries.flatten().collect::<Vec<_>>(),
        Err(error) => {
            eprintln!("Could not read {}: {error}", directory.display());
            return false;
        }
    };
    let mut contains_images = entries.iter().any(|entry| {
        entry.file_type().is_ok_and(|kind| kind.is_file()) && is_supported_image(&entry.path())
    });

    for entry in entries {
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let path = entry.path();
            let child_contains_images = collect_image_folders(&path, depth + 1, folders);
            folders.push(FolderEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                depth: depth + 1,
                contains_images: child_contains_images,
            });
            contains_images |= child_contains_images;
        }
    }
    contains_images
}

pub fn scan_directory<F>(
    root: &Path,
    recursive: bool,
    mut report_progress: F,
) -> Result<ScanResult, String>
where
    F: FnMut(&ScanProgress),
{
    if !root.is_dir() {
        return Err(format!("{} is not a readable folder.", root.display()));
    }

    let mut pending_directories = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut scanned_entries = 0_usize;
    let mut unreadable_entries = 0_usize;

    while let Some(directory) = pending_directories.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                unreadable_entries += 1;
                let message = format!("Could not read {}: {error}", directory.display());
                eprintln!("{message}");
                errors.push(message);
                continue;
            }
        };

        for entry in entries {
            scanned_entries += 1;

            match entry {
                Ok(entry) => match entry.file_type() {
                    Ok(file_type) if file_type.is_dir() && recursive => {
                        pending_directories.push(entry.path())
                    }
                    Ok(file_type) if file_type.is_file() && is_supported_image(&entry.path()) => {
                        let path = entry.path();
                        let file_size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let last_modified = entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| {
                                t.duration_since(std::time::SystemTime::UNIX_EPOCH)
                                    .map(|d| d.as_secs())
                                    .ok()
                            })
                            .unwrap_or(0);
                        files.push(ImageFile {
                            name: entry.file_name().to_string_lossy().into_owned(),
                            path: path.to_string_lossy().into_owned(),
                            file_size,
                            last_modified,
                        });
                    }
                    Ok(_) => {}
                    Err(error) => {
                        unreadable_entries += 1;
                        let message =
                            format!("Could not inspect {}: {error}", entry.path().display());
                        eprintln!("{message}");
                        errors.push(message);
                    }
                },
                Err(error) => {
                    unreadable_entries += 1;
                    let message = format!(
                        "Could not read a folder entry in {}: {error}",
                        directory.display()
                    );
                    eprintln!("{message}");
                    errors.push(message);
                }
            }

            if scanned_entries.is_multiple_of(50) {
                report_progress(&ScanProgress {
                    scanned_entries,
                    images_found: files.len(),
                });
            }
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    report_progress(&ScanProgress {
        scanned_entries,
        images_found: files.len(),
    });

    Ok(ScanResult {
        files,
        scanned_entries,
        unreadable_entries,
        errors,
    })
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "nef" | "cr2" | "arw" | "dng" | "orf" | "rw2" | "pef" | "raf"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::scan_directory;
    use std::fs;

    #[test]
    fn test_is_supported_image() {
        use super::is_supported_image;
        use std::path::Path;

        assert!(is_supported_image(Path::new("test.jpg")));
        assert!(is_supported_image(Path::new("test.nef")));
        assert!(is_supported_image(Path::new("test.CR2")));
        assert!(is_supported_image(Path::new("test.dng")));
        assert!(!is_supported_image(Path::new("test.txt")));
        assert!(!is_supported_image(Path::new("test")));
    }

    #[test]
    fn finds_supported_images_recursively() {
        let root = std::env::temp_dir().join(format!(
            "peters-photo-manager-scan-test-{}",
            std::process::id()
        ));
        let nested = root.join("nested");

        fs::create_dir_all(&nested).expect("create test folders");
        fs::write(root.join("beach.JPG"), b"test").expect("write jpg fixture");
        fs::write(nested.join("forest.webp"), b"test").expect("write webp fixture");
        fs::write(root.join("notes.txt"), b"test").expect("write text fixture");

        let result = scan_directory(&root, true, |_| {}).expect("scan test folder");

        assert_eq!(result.files.len(), 2);
        assert!(result.files.iter().any(|file| file.name == "beach.JPG"));
        assert!(result.files.iter().any(|file| file.name == "forest.webp"));
        assert!(result.errors.is_empty());

        fs::remove_dir_all(root).expect("remove test folders");
    }
}
