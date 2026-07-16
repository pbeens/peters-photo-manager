# Phase 1 Folder Scanning

## Decision

Use Tauri’s native dialog plugin to choose one local folder. Keep the selected folder path in a small JSON settings file in the application configuration directory.

Scan JPEG, PNG, and WebP filenames recursively in a Rust background task. Report progress to the interface through Tauri events and return only filenames and paths in this phase.

## Rationale

This meets the first folder-browser milestone without introducing a catalogue database, thumbnail cache, image decoder, or filesystem-monitoring dependency.

## Consequences

- The selected folder persists across application restarts.
- Original photographs are not modified.
- The interface remains responsive during scans.
- Thumbnail generation, metadata extraction, and multiple watched folders remain later work.
