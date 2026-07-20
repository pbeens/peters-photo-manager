# Rendered DNG RAW Save Workflow

## Decision

When a user saves edits for a RAW photo using the **Originals subfolder** strategy, move the untouched source RAW file into an `Originals/` subfolder and write a newly rendered DNG beside it using the same base filename (for example, `photo.nef` becomes `photo.dng`).

The rendered DNG is the editable-photo result shown by the catalogue. The archived RAW remains untouched and is retained for a future restore-original command.

## Scope

- JPEG, PNG, and WebP save rendered pixels in their original file format.
- RAW inputs, including DNG, save rendered pixels as a new DNG.
- The catalogue must record the original path, archived path, rendered path, source file facts, and save strategy so restoration can be implemented safely later.
- Original restoration is explicitly deferred; no automatic restoration behavior is implied.

## Rationale

This gives a simple visible result in the managed folder while preserving the camera source. A rendered DNG can carry processed pixel data, but it is not the original camera mosaic RAW file. The `Originals/` archive preserves that source for reprocessing or a later restore operation.

## Implementation Requirements

- Use a compliant native DNG writer capable of creating a rendered/linear DNG, rather than renaming a JPEG or TIFF to `.dng`.
- The first native writer is Adobe DNG SDK 1.7.1 on macOS Apple Silicon. Its generated 16-bit RGB fixture is validated by Adobe's `dng_validate`; Windows packaging remains a separate native-build task.
- Render all supported editor adjustments through one deterministic image pipeline before writing the output.
- Perform the archive move and DNG write as a recoverable transaction: render to a temporary file, verify it, move the original, atomically place the DNG, then update the catalogue.
- Require a non-skippable confirmation for the overwrite-original strategy.
- Do not begin writing files until the DNG writer and rendered-image pipeline are validated with controlled RAW fixtures.
