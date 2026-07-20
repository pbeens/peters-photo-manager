# Optional Adobe DNG SDK Setup

Rendered DNG saving is an optional macOS Apple Silicon development capability. It is intentionally not bundled in this repository because the Adobe SDK source, JPEG XL source tree, and generated static libraries add more than 1,100 files and roughly 169 MB to a checkout.

The normal application builds and runs without these files. In that build, attempting to save a camera RAW image as DNG returns a clear unavailable message; JPEG, PNG, and WebP saving remains available.

To enable the native writer locally, install the approved Adobe DNG SDK toolchain beneath:

```text
apps/desktop/src-tauri/third-party/adobe-dng-sdk/
```

The build expects:

- Adobe DNG SDK source files in `source/`.
- JPEG XL headers in `libjxl/libjxl/lib/include/` and `libjxl/client_projects/include/`.
- Apple Silicon `libjxl_release.a` in `libjxl/macos/arm64/`.
- Adobe XMP headers in `xmp/include/`.
- Apple Silicon `libXMPCoreStatic_Release.a` and `libXMPFilesStatic_Release.a` in `xmp/macos/arm64/`.

`build.rs` detects this toolchain. If any required component is absent, it omits the native writer instead of making the whole app fail to compile. This setup remains developer-only until the rendered-DNG workflow has passed image-quality and interoperability validation.
