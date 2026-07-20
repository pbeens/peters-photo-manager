use std::ffi::{c_char, CStr, CString};
use std::path::Path;

#[allow(dead_code)]
const ERROR_BUFFER_SIZE: usize = 512;

unsafe extern "C" {
    fn ppm_write_linear_dng_rgba8(
        rgba: *const u8,
        width: u32,
        height: u32,
        output_path: *const c_char,
        error_output: *mut c_char,
        error_output_size: usize,
    ) -> i32;
}

#[allow(dead_code)]
pub fn write_linear_dng_rgba8(rgba: &[u8], width: u32, height: u32, output_path: &Path) -> Result<(), String> {
    let expected = width.checked_mul(height).and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Rendered DNG dimensions are too large.".to_string())? as usize;
    if rgba.len() != expected {
        return Err("Rendered DNG pixel data does not match its dimensions.".to_string());
    }
    let output_path = CString::new(output_path.to_string_lossy().as_bytes())
        .map_err(|_| "The rendered DNG path contains an unsupported null character.".to_string())?;
    let mut error_output = [0 as c_char; ERROR_BUFFER_SIZE];
    let status = unsafe { ppm_write_linear_dng_rgba8(rgba.as_ptr(), width, height, output_path.as_ptr(), error_output.as_mut_ptr(), error_output.len()) };
    if status == 0 {
        Ok(())
    } else {
        Err(unsafe { CStr::from_ptr(error_output.as_ptr()) }.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::write_linear_dng_rgba8;
    use std::path::Path;

    #[test]
    fn rejects_pixel_data_with_the_wrong_length() {
        assert!(write_linear_dng_rgba8(&[0; 3], 1, 1, Path::new("test.dng")).is_err());
    }

    #[test]
    fn writes_a_linear_dng_file() {
        let output_path = std::env::temp_dir().join(format!(
            "peters-photo-manager-dng-writer-{}.dng",
            std::process::id()
        ));
        let pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
        write_linear_dng_rgba8(&pixels, 2, 2, &output_path).expect("DNG writer should produce a file");
        let bytes = std::fs::read(&output_path).expect("DNG file should be readable");
        assert!(bytes.len() > 1024);
        assert!(bytes.starts_with(b"II") || bytes.starts_with(b"MM"));
        if std::env::var_os("PPM_KEEP_DNG_TEST_OUTPUT").is_none() {
            std::fs::remove_file(output_path).expect("DNG fixture should be removable");
        }
    }
}
