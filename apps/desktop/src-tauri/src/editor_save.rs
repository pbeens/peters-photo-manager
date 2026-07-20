use crate::thumbnails;
#[cfg(all(target_os = "macos", target_arch = "aarch64", ppm_embedded_dng_writer))]
use crate::dng_writer;
use image::{codecs::jpeg::JpegEncoder, ColorType, ImageBuffer, ImageEncoder, ImageFormat, Rgba, RgbaImage};
use serde::Deserialize;
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAdjustments {
    pub brightness: f32,
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub vibrance: f32,
    pub saturation: f32,
    pub vignette_amount: f32,
    pub vignette_size: f32,
    pub vignette_feather: f32,
    pub frame_size: f32,
    pub black_and_white: String,
    pub frame_style: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub output_path: String,
    pub archived_original_path: Option<String>,
}

fn clamp(value: f32) -> f32 { value.clamp(0.0, 1.0) }

fn load_source(path: &Path) -> Result<RgbaImage, String> {
    if thumbnails::is_raw_file(path) {
        let source = path.to_string_lossy();
        let export = quickraw::Export::new(
            quickraw::Input::ByFile(&source),
            quickraw::Output::new(
                quickraw::DemosaicingMethod::Linear,
                quickraw::data::XYZ2SRGB,
                quickraw::data::GAMMA_SRGB,
                quickraw::OutputType::Raw8,
                false,
                false,
            ),
        ).map_err(|error| format!("Could not render RAW source {}: {error}", path.display()))?;
        let (rgb, width, height) = export.export_8bit_image();
        let pixels = width.checked_mul(height).and_then(|count| count.checked_mul(3))
            .ok_or_else(|| "RAW image dimensions are too large.".to_string())?;
        if rgb.len() != pixels { return Err("RAW renderer returned incomplete pixel data.".to_string()); }
        let mut rgba = Vec::with_capacity(width * height * 4);
        for channels in rgb.chunks_exact(3) { rgba.extend_from_slice(&[channels[0], channels[1], channels[2], 255]); }
        ImageBuffer::from_raw(width as u32, height as u32, rgba)
            .ok_or_else(|| "Could not create the rendered RAW image.".to_string())
    } else {
        thumbnails::open_with_orientation(path).map(|image| image.to_rgba8())
    }
}

fn apply_tone(image: &mut RgbaImage, values: &EditorAdjustments) {
    let exposure = 2_f32.powf(values.exposure.clamp(-5.0, 5.0));
    let contrast = 1.0 + values.contrast.clamp(-100.0, 100.0) / 100.0;
    let saturation = 1.0 + values.saturation.clamp(-100.0, 100.0) / 100.0;
    for pixel in image.pixels_mut() {
        let original = [pixel[0] as f32 / 255.0, pixel[1] as f32 / 255.0, pixel[2] as f32 / 255.0];
        let luminance = original[0] * 0.2126 + original[1] * 0.7152 + original[2] * 0.0722;
        let shadow_mask = (1.0 - luminance).powi(3);
        let highlight_mask = luminance.powi(3);
        let black_mask = (1.0 - luminance).powi(8);
        let white_mask = luminance.powi(8);
        let tonal_offset = values.brightness / 400.0
            + values.shadows / 100.0 * shadow_mask * 0.35
            + values.highlights / 100.0 * highlight_mask * 0.35
            + values.blacks / 100.0 * black_mask * 0.45
            + values.whites / 100.0 * white_mask * 0.45;
        let target_luminance = clamp((luminance * exposure + tonal_offset - 0.5) * contrast + 0.5);
        let scale = if luminance > 0.0001 { target_luminance / luminance } else { target_luminance };
        let mut channels = [clamp(original[0] * scale), clamp(original[1] * scale), clamp(original[2] * scale)];
        let neutral = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        let chroma = ((channels[0] - neutral).abs() + (channels[1] - neutral).abs() + (channels[2] - neutral).abs()) / 3.0;
        let vibrance = 1.0 + values.vibrance.clamp(-100.0, 100.0) / 100.0 * (1.0 - chroma * 2.0).clamp(0.0, 1.0);
        let colour = (saturation * vibrance).max(0.0);
        channels = channels.map(|channel| clamp(neutral + (channel - neutral) * colour));
        if values.black_and_white != "none" {
            let mut mono = neutral;
            if values.black_and_white == "contrast" { mono = clamp((mono - 0.5) * 1.35 + 0.5); }
            if values.black_and_white == "matte" { mono = mono * 0.8 + 0.1; }
            if values.black_and_white == "soft" { mono = clamp((mono - 0.5) * 0.72 + 0.54); }
            channels = [mono, mono, mono];
        }
        pixel[0] = (channels[0] * 255.0).round() as u8;
        pixel[1] = (channels[1] * 255.0).round() as u8;
        pixel[2] = (channels[2] * 255.0).round() as u8;
    }
}

fn rotate_clipped(source: &RgbaImage, degrees: f32) -> RgbaImage {
    if degrees.abs() < 0.01 { return source.clone(); }
    let (width, height) = source.dimensions();
    let mut output = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255]));
    let radians = (-degrees).to_radians();
    let (sin, cos) = radians.sin_cos();
    let cx = (width as f32 - 1.0) / 2.0;
    let cy = (height as f32 - 1.0) / 2.0;
    for y in 0..height { for x in 0..width {
        let dx = x as f32 - cx;
        let dy = y as f32 - cy;
        let sx = (dx * cos - dy * sin + cx).round() as i32;
        let sy = (dx * sin + dy * cos + cy).round() as i32;
        if sx >= 0 && sy >= 0 && sx < width as i32 && sy < height as i32 { output.put_pixel(x, y, *source.get_pixel(sx as u32, sy as u32)); }
    }}
    output
}

fn apply_vignette(image: &mut RgbaImage, values: &EditorAdjustments) {
    if values.vignette_amount.abs() < 0.01 { return; }
    let (width, height) = image.dimensions();
    let start = (0.95 - values.vignette_size.clamp(0.0, 100.0) * 0.0055).clamp(0.1, 0.95);
    let end = (start + 0.03 + values.vignette_feather.clamp(0.0, 100.0) * 0.005).min(1.0);
    let strength = values.vignette_amount.abs().min(100.0) / 100.0;
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let nx = (x as f32 / (width.saturating_sub(1).max(1)) as f32 - 0.5) * 2.0;
        let ny = (y as f32 / (height.saturating_sub(1).max(1)) as f32 - 0.5) * 2.0;
        let radius = (nx * nx + ny * ny).sqrt() / 2_f32.sqrt();
        let edge = ((radius - start) / (end - start).max(0.001)).clamp(0.0, 1.0) * strength;
        for channel in 0..3 {
            let value = pixel[channel] as f32 / 255.0;
            pixel[channel] = (if values.vignette_amount >= 0.0 { value * (1.0 - edge) } else { value + (1.0 - value) * edge } * 255.0).round() as u8;
        }
    }
}

fn fill_rect(image: &mut RgbaImage, x0: u32, y0: u32, x1: u32, y1: u32, colour: [u8; 4]) {
    for y in y0.min(image.height())..y1.min(image.height()) { for x in x0.min(image.width())..x1.min(image.width()) { image.put_pixel(x, y, Rgba(colour)); } }
}

fn apply_frame(image: &mut RgbaImage, values: &EditorAdjustments) {
    if values.frame_style == "none" || values.frame_size <= 0.0 { return; }
    let (width, height) = image.dimensions();
    let border = ((width.min(height) as f32) * values.frame_size.clamp(0.0, 100.0) / 400.0).round() as u32;
    if border == 0 { return; }
    let colour = match values.frame_style.as_str() { "gallery" | "film" => [20, 20, 20, 255], _ => [245, 242, 235, 255] };
    fill_rect(image, 0, 0, width, border, colour); fill_rect(image, 0, height.saturating_sub(border), width, height, colour);
    fill_rect(image, 0, 0, border, height, colour); fill_rect(image, width.saturating_sub(border), 0, width, height, colour);
    if values.frame_style == "polaroid" { fill_rect(image, 0, height.saturating_sub(border.saturating_mul(2)), width, height, colour); }
    if values.frame_style == "film" {
        let hole = (border / 2).max(2); let step = hole.saturating_mul(2).max(4);
        for x in (border..width.saturating_sub(border)).step_by(step as usize) {
            fill_rect(image, x, border / 4, x + hole, border.saturating_sub(border / 4), [220, 220, 210, 255]);
            fill_rect(image, x, height.saturating_sub(border).saturating_add(border / 4), x + hole, height.saturating_sub(border / 4), [220, 220, 210, 255]);
        }
    }
}

fn output_path(source: &Path) -> Result<PathBuf, String> {
    let parent = source.parent().ok_or_else(|| "The source image has no parent folder.".to_string())?;
    let stem = source.file_stem().ok_or_else(|| "The source image has no filename.".to_string())?;
    Ok(if thumbnails::is_raw_file(source) { parent.join(stem).with_extension("dng") } else { source.to_path_buf() })
}

fn original_archive_path(source: &Path, strategy: &str) -> Result<Option<PathBuf>, String> {
    let parent = source.parent().ok_or_else(|| "The source image has no parent folder.".to_string())?;
    let file_name = source.file_name().ok_or_else(|| "The source image has no filename.".to_string())?;
    match strategy {
        "originals-subfolder" => Ok(Some(parent.join("Originals").join(file_name))),
        "filename-original" => {
            let stem = source.file_stem().ok_or_else(|| "The source image has no filename.".to_string())?;
            let extension = source.extension().map(|item| format!(".{}", item.to_string_lossy())).unwrap_or_default();
            Ok(Some(parent.join(format!("{}_original{}", stem.to_string_lossy(), extension))))
        }
        "overwrite" => Ok(None),
        _ => Err("The selected original-save strategy is not supported.".to_string()),
    }
}

fn encode(image: &RgbaImage, destination: &Path, raw_source: bool) -> Result<(), String> {
    if raw_source {
        #[cfg(all(target_os = "macos", target_arch = "aarch64", ppm_embedded_dng_writer))]
        return dng_writer::write_linear_dng_rgba8(image.as_raw(), image.width(), image.height(), destination);
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64", ppm_embedded_dng_writer)))]
        return Err("Rendered DNG saving is unavailable because this build does not include the optional Adobe DNG SDK toolchain.".to_string());
    }
    let extension = destination.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if extension == "jpg" || extension == "jpeg" {
        let file = fs::File::create(destination).map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
        let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
        JpegEncoder::new_with_quality(BufWriter::new(file), 95).write_image(rgb.as_raw(), rgb.width(), rgb.height(), ColorType::Rgb8.into())
            .map_err(|error| format!("Could not encode JPEG: {error}"))
    } else {
        let format = if extension == "png" { ImageFormat::Png } else if extension == "webp" { ImageFormat::WebP } else { return Err("Only JPEG, PNG, WebP, and RAW sources can be saved from the editor.".to_string()); };
        image.save_with_format(destination, format).map_err(|error| format!("Could not encode edited image: {error}"))
    }
}

pub fn save(source: &Path, values: &EditorAdjustments, rotation: f32, strategy: &str) -> Result<SaveResult, String> {
    if !source.is_file() { return Err(format!("The original image is no longer available: {}", source.display())); }
    let destination = output_path(source)?;
    let archive = original_archive_path(source, strategy)?;
    if destination != source && destination.exists() { return Err(format!("Refusing to replace existing output {}.", destination.display())); }
    if let Some(path) = &archive { if path.exists() { return Err(format!("Refusing to replace existing original archive {}.", path.display())); } }
    let mut image = load_source(source)?;
    apply_tone(&mut image, values);
    image = rotate_clipped(&image, rotation);
    apply_vignette(&mut image, values);
    apply_frame(&mut image, values);
    let temporary_stem = destination.file_stem().unwrap_or_default().to_string_lossy();
    let temporary_extension = destination.extension().and_then(|value| value.to_str()).unwrap_or("tmp");
    let temp = destination.with_file_name(format!(".{temporary_stem}.ppm-editing.{temporary_extension}"));
    if temp.exists() { fs::remove_file(&temp).map_err(|error| format!("Could not clear an old temporary file: {error}"))?; }
    encode(&image, &temp, thumbnails::is_raw_file(source))?;
    if fs::metadata(&temp).map_err(|error| format!("Could not validate saved output: {error}"))?.len() == 0 { let _ = fs::remove_file(&temp); return Err("The rendered output was empty.".to_string()); }
    let mut moved_archive = false;
    if let Some(path) = &archive {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| format!("Could not create Originals folder: {error}"))?; }
        if let Err(error) = fs::rename(source, path) { let _ = fs::remove_file(&temp); return Err(format!("Could not archive original image: {error}")); }
        moved_archive = true;
    }
    let overwrite_backup = if archive.is_none() && destination == source {
        let backup = destination.with_file_name(format!(".{}.ppm-original-backup", destination.file_name().unwrap_or_default().to_string_lossy()));
        if backup.exists() { let _ = fs::remove_file(&temp); return Err(format!("Refusing to replace existing temporary backup {}.", backup.display())); }
        if let Err(error) = fs::rename(source, &backup) { let _ = fs::remove_file(&temp); return Err(format!("Could not prepare the original for replacement: {error}")); }
        Some(backup)
    } else { None };
    if let Err(error) = fs::rename(&temp, &destination) {
        if let Some(backup) = &overwrite_backup { let _ = fs::rename(backup, source); }
        if moved_archive { if let Some(path) = &archive { let _ = fs::rename(path, source); } }
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not put rendered image in place: {error}"));
    }
    if let Some(backup) = overwrite_backup { fs::remove_file(backup).map_err(|error| format!("Rendered image was saved, but the temporary original backup could not be removed: {error}"))?; }
    if archive.is_none() && destination != source { fs::remove_file(source).map_err(|error| format!("Rendered DNG was created, but the original could not be removed: {error}"))?; }
    Ok(SaveResult { output_path: destination.to_string_lossy().into_owned(), archived_original_path: archive.map(|path| path.to_string_lossy().into_owned()) })
}

#[cfg(test)]
mod tests {
    use super::{save, EditorAdjustments};
    use image::{Rgb, RgbImage};

    fn defaults() -> EditorAdjustments {
        EditorAdjustments {
            brightness: 0.0, exposure: 0.0, contrast: 0.0, highlights: 0.0, shadows: 0.0,
            whites: 0.0, blacks: 0.0, vibrance: 0.0, saturation: 0.0, vignette_amount: 0.0,
            vignette_size: 50.0, vignette_feather: 50.0, frame_size: 0.0,
            black_and_white: "none".to_string(), frame_style: "none".to_string(),
        }
    }

    #[test]
    fn archives_and_replaces_raster_edits_in_their_original_format() {
        let directory = std::env::temp_dir().join(format!("peters-photo-manager-editor-save-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("test directory should be created");
        for extension in ["png", "jpg", "webp"] {
            let source = directory.join(format!("photo.{extension}"));
            RgbImage::from_pixel(8, 6, Rgb([100, 120, 140])).save(&source).expect("source should be written");
            let mut adjustments = defaults();
            adjustments.brightness = 40.0;
            let result = save(&source, &adjustments, 0.0, "originals-subfolder").expect("save should succeed");
            assert_eq!(std::path::Path::new(&result.output_path), source.as_path());
            let archived = directory.join("Originals").join(format!("photo.{extension}"));
            assert!(archived.is_file());
            assert!(source.is_file());
            let edited_pixel = image::open(&source).expect("saved output should be readable").to_rgb8().get_pixel(0, 0).0;
            let original_pixel = image::open(&archived).expect("archived original should be readable").to_rgb8().get_pixel(0, 0).0;
            assert_ne!(edited_pixel, original_pixel);
            std::fs::remove_file(&source).expect("saved output should be removable");
        }
        std::fs::remove_dir_all(directory).expect("test directory should be removable");
    }
}
