use std::env;
use std::fs;
use std::path::Path;

fn main() {
    build_dng_writer();
    tauri_build::build()
}

fn build_dng_writer() {
    println!("cargo:rustc-check-cfg=cfg(ppm_embedded_dng_writer)");
    if env::var("TARGET").as_deref() != Ok("aarch64-apple-darwin") {
        return;
    }
    let source_dir = Path::new("third-party/adobe-dng-sdk/source");
    let jxl_dir = Path::new("third-party/adobe-dng-sdk/libjxl");
    let xmp_dir = Path::new("third-party/adobe-dng-sdk/xmp");
    if !source_dir.is_dir()
        || !jxl_dir.join("macos/arm64/libjxl_release.a").is_file()
        || !xmp_dir.join("macos/arm64/libXMPCoreStatic_Release.a").is_file()
        || !xmp_dir.join("macos/arm64/libXMPFilesStatic_Release.a").is_file()
    {
        println!("cargo:warning=Adobe DNG SDK is not installed; rendered DNG saving is disabled for this build.");
        return;
    }
    println!("cargo:rustc-cfg=ppm_embedded_dng_writer");
    let mut build = cc::Build::new();
    build.cpp(true);
    build.include(source_dir);
    build.include(jxl_dir.join("libjxl/lib/include"));
    build.include(jxl_dir.join("client_projects/include"));
    build.include(xmp_dir.join("include"));
    build.include("native");
    build.define("qDNGUseLibJPEG", "0");
    build.define("qDNGValidate", "0");
    build.define("qMacOS", "1");
    build.flag_if_supported("-std=c++17");

    for entry in fs::read_dir(source_dir).expect("Adobe DNG SDK source is missing") {
        let path = entry.expect("Could not inspect Adobe DNG SDK source").path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("cpp")
            && path.file_name().and_then(|name| name.to_str()) != Some("dng_validate.cpp")
        {
            println!("cargo:rerun-if-changed={}", path.display());
            build.file(path);
        }
    }
    println!("cargo:rerun-if-changed=native/dng_writer.cpp");
    build.file("native/dng_writer.cpp");
    build.compile("peters_photo_manager_dng_writer");

    let library_dir = xmp_dir.join("macos/arm64");
    println!("cargo:rustc-link-search=native={}", library_dir.display());
    println!("cargo:rustc-link-search=native={}", jxl_dir.join("macos/arm64").display());
    println!("cargo:rustc-link-lib=static=XMPFilesStatic_Release");
    println!("cargo:rustc-link-lib=static=XMPCoreStatic_Release");
    println!("cargo:rustc-link-lib=static=jxl_release");
    println!("cargo:rustc-link-lib=c++");
    println!("cargo:rustc-link-lib=z");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
}
