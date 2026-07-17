use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

fn default_thumbnail_size() -> u16 {
    180
}

fn default_thumbnail_sort_key() -> String {
    "name".to_string()
}

fn default_thumbnail_sort_ascending() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub watched_folders: Vec<String>,
    #[serde(default)]
    pub selected_folder: Option<String>,
    #[serde(default)]
    pub excluded_folders: Vec<String>,
    #[serde(default = "default_thumbnail_size")]
    pub thumbnail_size: u16,
    #[serde(default = "default_thumbnail_sort_key")]
    pub thumbnail_sort_key: String,
    #[serde(default = "default_thumbnail_sort_ascending")]
    pub thumbnail_sort_ascending: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            watched_folders: Vec::new(),
            selected_folder: None,
            excluded_folders: Vec::new(),
            thumbnail_size: default_thumbnail_size(),
            thumbnail_sort_key: default_thumbnail_sort_key(),
            thumbnail_sort_ascending: default_thumbnail_sort_ascending(),
        }
    }
}

pub fn load(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;

    let mut settings: AppSettings = serde_json::from_str(&contents)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;

    if settings.watched_folders.is_empty() {
        if let Some(folder) = settings.selected_folder.take() {
            settings.watched_folders.push(folder);
            save(app, &settings)?;
        }
    }

    Ok(settings)
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Could not prepare settings: {error}"))?;

    fs::write(&path, contents)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the settings directory: {error}"))?;

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;

    Ok(directory.join(SETTINGS_FILE))
}
