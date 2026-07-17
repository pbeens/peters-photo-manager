use rusqlite::{params, Connection};
use std::path::Path;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFile {
    pub path: String,
    pub name: String,
    pub file_size: u64,
    pub format: String,
    pub width: u32,
    pub height: u32,
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
    pub thumbnail_path: Option<String>,
    pub last_modified: u64,
    pub status: String, // 'active' or 'ignored'
}

pub fn init_db<P: AsRef<Path>>(db_path: P) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Create folders table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            last_scanned TEXT
        );",
        [],
    )?;

    // Create files table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            format TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            camera TEXT,
            lens TEXT,
            latitude REAL,
            longitude REAL,
            gps_altitude REAL,
            location_country TEXT,
            location_state TEXT,
            location_city TEXT,
            date_taken TEXT,
            aperture TEXT,
            shutter_speed TEXT,
            iso INTEGER,
            focal_length TEXT,
            rating INTEGER,
            keywords TEXT,
            thumbnail_path TEXT,
            last_modified INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ignored'))
        );",
        [],
    )?;

    Ok(conn)
}

pub fn add_folder(conn: &Connection, path: &str) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO folders (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
        params![path],
    )?;
    let id = conn.query_row(
        "SELECT id FROM folders WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn remove_folder(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM folders WHERE path = ?1", params![path])?;
    Ok(())
}

pub fn remove_files_in_path(conn: &Connection, path: &Path) -> Result<(), rusqlite::Error> {
    let path = path.to_string_lossy();
    let separator = if cfg!(target_os = "windows") {
        "\\"
    } else {
        "/"
    };
    conn.execute(
        "DELETE FROM files WHERE path = ?1 OR path LIKE ?2",
        params![path, format!("{path}{separator}%")],
    )?;
    Ok(())
}

/// Wipe all catalogue data and recreate empty tables.  
/// Used by the developer "Reset & Rescan" button during early testing.
pub fn reset_catalogue(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS files;
         DROP TABLE IF EXISTS folders;",
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            last_scanned TEXT
        );",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            format TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            camera TEXT,
            lens TEXT,
            latitude REAL,
            longitude REAL,
            gps_altitude REAL,
            location_country TEXT,
            location_state TEXT,
            location_city TEXT,
            date_taken TEXT,
            aperture TEXT,
            shutter_speed TEXT,
            iso INTEGER,
            focal_length TEXT,
            rating INTEGER,
            keywords TEXT,
            thumbnail_path TEXT,
            last_modified INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ignored'))
        );",
        [],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_folders(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT path FROM folders")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    let mut paths = Vec::new();
    for path in rows {
        paths.push(path?);
    }
    Ok(paths)
}

pub fn save_files_batch(
    conn: &mut Connection,
    files: &[IndexedFile],
    folder_id: i64,
) -> Result<(), rusqlite::Error> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO files (folder_id, path, name, file_size, format, width, height, camera, lens, latitude, longitude, gps_altitude, location_country, location_state, location_city, date_taken, aperture, shutter_speed, iso, focal_length, rating, keywords, thumbnail_path, last_modified, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
             ON CONFLICT(path) DO UPDATE SET
                file_size = excluded.file_size,
                width = excluded.width,
                height = excluded.height,
                camera = excluded.camera,
                lens = excluded.lens,
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                gps_altitude = excluded.gps_altitude,
                location_country = excluded.location_country,
                location_state = excluded.location_state,
                location_city = excluded.location_city,
                date_taken = excluded.date_taken,
                aperture = excluded.aperture,
                shutter_speed = excluded.shutter_speed,
                iso = excluded.iso,
                focal_length = excluded.focal_length,
                rating = excluded.rating,
                keywords = excluded.keywords,
                thumbnail_path = excluded.thumbnail_path,
                last_modified = excluded.last_modified,
                status = CASE WHEN files.status = 'ignored' THEN 'ignored' ELSE excluded.status END"
        )?;

        for file in files {
            let keywords_str = file.keywords.as_ref().map(|list| list.join(";"));
            stmt.execute(params![
                folder_id,
                file.path,
                file.name,
                file.file_size as i64,
                file.format,
                file.width as i32,
                file.height as i32,
                file.camera,
                file.lens,
                file.latitude,
                file.longitude,
                file.gps_altitude,
                file.location_country,
                file.location_state,
                file.location_city,
                file.date_taken,
                file.aperture,
                file.shutter_speed,
                file.iso.map(|i| i as i32),
                file.focal_length,
                file.rating.map(|r| r as i32),
                keywords_str,
                file.thumbnail_path,
                file.last_modified as i64,
                file.status
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn get_active_files(
    conn: &Connection,
    folder_id: Option<i64>,
) -> Result<Vec<IndexedFile>, rusqlite::Error> {
    let mut query = "SELECT path, name, file_size, format, width, height, camera, lens, latitude, longitude, gps_altitude, location_country, location_state, location_city, date_taken, aperture, shutter_speed, iso, focal_length, rating, keywords, thumbnail_path, last_modified, status FROM files WHERE status = 'active'".to_string();

    let mut results = Vec::new();
    if let Some(fid) = folder_id {
        query.push_str(" AND folder_id = ?1");
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map(params![fid], map_row)?;
        for row in rows {
            match row {
                Ok(f) => results.push(f),
                Err(e) => {
                    eprintln!("Row mapping error for active files: {:?}", e);
                    return Err(e);
                }
            }
        }
    } else {
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map([], map_row)?;
        for row in rows {
            match row {
                Ok(f) => results.push(f),
                Err(e) => {
                    eprintln!("Row mapping error for all active files: {:?}", e);
                    return Err(e);
                }
            }
        }
    }
    Ok(results)
}

/// Return catalogue entries within a selected folder.  Folder ownership is
/// intentionally not used for this lookup: a file may be encountered first
/// while scanning either a watched root or one of its child folders.
pub fn get_active_files_in_path(
    conn: &Connection,
    folder: &Path,
) -> Result<Vec<IndexedFile>, rusqlite::Error> {
    let files = get_active_files(conn, None)?;
    Ok(files
        .into_iter()
        .filter(|file| Path::new(&file.path).starts_with(folder))
        .collect())
}

pub fn get_file_record(
    conn: &Connection,
    path: &str,
) -> Result<Option<IndexedFile>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, file_size, format, width, height, camera, lens, latitude, longitude, gps_altitude, location_country, location_state, location_city, date_taken, aperture, shutter_speed, iso, focal_length, rating, keywords, thumbnail_path, last_modified, status FROM files WHERE path = ?1"
    )?;
    let mut rows = stmt.query_map(params![path], map_row)?;
    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn mark_file_ignored(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE files SET status = 'ignored' WHERE path = ?1",
        params![path],
    )?;
    Ok(())
}

pub fn delete_file_record(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM files WHERE path = ?1", params![path])?;
    Ok(())
}

#[allow(dead_code)]
pub fn update_file_rating(
    conn: &Connection,
    path: &str,
    rating: Option<u16>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE files SET rating = ?1 WHERE path = ?2",
        params![rating.map(|r| r as i32), path],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn update_file_keywords(
    conn: &Connection,
    path: &str,
    keywords: Option<&[String]>,
) -> Result<(), rusqlite::Error> {
    let keywords_str = keywords.map(|list| list.join(";"));
    conn.execute(
        "UPDATE files SET keywords = ?1 WHERE path = ?2",
        params![keywords_str, path],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> Result<IndexedFile, rusqlite::Error> {
    let keywords_str: Option<String> = row.get(20)?;
    let keywords = keywords_str.map(|s| {
        s.split(';')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect()
    });

    Ok(IndexedFile {
        path: row.get(0)?,
        name: row.get(1)?,
        file_size: row.get::<_, i64>(2)? as u64,
        format: row.get(3)?,
        width: row.get::<_, i32>(4)? as u32,
        height: row.get::<_, i32>(5)? as u32,
        camera: row.get(6)?,
        lens: row.get(7)?,
        latitude: row.get(8)?,
        longitude: row.get(9)?,
        gps_altitude: row.get(10)?,
        location_country: row.get(11)?,
        location_state: row.get(12)?,
        location_city: row.get(13)?,
        date_taken: row.get(14)?,
        aperture: row.get(15)?,
        shutter_speed: row.get(16)?,
        iso: row.get::<_, Option<i32>>(17)?.map(|i| i as u32),
        focal_length: row.get(18)?,
        rating: row.get::<_, Option<i32>>(19)?.map(|r| r as u16),
        keywords,
        thumbnail_path: row.get(21)?,
        last_modified: row.get::<_, i64>(22)? as u64,
        status: row.get(23)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_setup_and_crud() {
        let mut conn = init_db(":memory:").expect("Initialize in-memory database");

        // Test folders CRUD
        let folder_path = "/Users/test/photos";
        let folder_id = add_folder(&conn, folder_path).expect("Add folder");
        assert_eq!(folder_id, 1);

        let folder_id_dup = add_folder(&conn, folder_path).expect("Add duplicate folder");
        assert_eq!(folder_id_dup, 1);

        let registered = get_folders(&conn).expect("Retrieve watched folders");
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0], folder_path);

        // Test files CRUD and transactions
        let mut test_files = vec![
            IndexedFile {
                path: "/Users/test/photos/beach.jpg".to_string(),
                name: "beach.jpg".to_string(),
                file_size: 1024,
                format: "JPG".to_string(),
                width: 1920,
                height: 1080,
                camera: Some("Canon EOS R5".to_string()),
                lens: Some("RF 50mm F1.2 L USM".to_string()),
                latitude: Some(43.6532),
                longitude: Some(-79.3832),
                gps_altitude: Some(76.0),
                location_country: Some("Canada".to_string()),
                location_state: Some("Ontario".to_string()),
                location_city: Some("Toronto".to_string()),
                date_taken: Some("2026:07:16 12:00:00".to_string()),
                aperture: Some("f/2.8".to_string()),
                shutter_speed: Some("1/125s".to_string()),
                iso: Some(100),
                focal_length: Some("50 mm".to_string()),
                rating: Some(5),
                keywords: Some(vec!["travel".to_string(), "beach".to_string()]),
                thumbnail_path: Some("/Users/test/cache/1.jpg".to_string()),
                last_modified: 12345678,
                status: "active".to_string(),
            },
            IndexedFile {
                path: "/Users/test/photos/nested/forest.png".to_string(),
                name: "forest.png".to_string(),
                file_size: 2048,
                format: "PNG".to_string(),
                width: 800,
                height: 600,
                camera: None,
                lens: None,
                latitude: None,
                longitude: None,
                gps_altitude: None,
                location_country: None,
                location_state: None,
                location_city: None,
                date_taken: None,
                aperture: None,
                shutter_speed: None,
                iso: None,
                focal_length: None,
                rating: None,
                keywords: None,
                thumbnail_path: None,
                last_modified: 87654321,
                status: "active".to_string(),
            },
        ];

        save_files_batch(&mut conn, &test_files, folder_id).expect("Save batch");

        let active = get_active_files(&conn, Some(folder_id)).expect("Retrieve active files");
        assert_eq!(active.len(), 2);
        assert_eq!(active[0].name, "beach.jpg");
        assert_eq!(active[1].name, "forest.png");

        // Verify keyword semicolon separation
        assert_eq!(active[0].keywords.as_ref().unwrap().len(), 2);
        assert!(active[0]
            .keywords
            .as_ref()
            .unwrap()
            .contains(&"travel".to_string()));

        // Verify lens and GPS coordinates
        assert_eq!(active[0].lens.as_deref(), Some("RF 50mm F1.2 L USM"));
        assert_eq!(active[0].latitude, Some(43.6532));

        // Test ignoring a file (Remove Reference)
        mark_file_ignored(&conn, "/Users/test/photos/beach.jpg").expect("Ignore file");

        let active_after_ignore =
            get_active_files(&conn, Some(folder_id)).expect("Retrieve active files");
        assert_eq!(active_after_ignore.len(), 1);
        assert_eq!(active_after_ignore[0].name, "forest.png");

        // Verify status conflict behavior: scan sync should keep ignored status
        test_files[0].last_modified = 12345679; // update modtime
        save_files_batch(&mut conn, &test_files, folder_id).expect("Save duplicate batch");

        let active_after_sync =
            get_active_files(&conn, Some(folder_id)).expect("Retrieve active files");
        assert_eq!(active_after_sync.len(), 1); // beach.jpg should STILL be ignored!

        // A selected child folder must work even if the files were indexed
        // while its watched parent was scanned.
        let child_files = get_active_files_in_path(&conn, Path::new("/Users/test/photos"))
            .expect("Retrieve files by path");
        assert_eq!(child_files.len(), 1);
        assert_eq!(child_files[0].name, "forest.png");

        // Test delete file record
        delete_file_record(&conn, "/Users/test/photos/nested/forest.png").expect("Delete file");
        let active_after_delete =
            get_active_files(&conn, Some(folder_id)).expect("Retrieve active files");
        assert!(active_after_delete.is_empty());
    }
}
