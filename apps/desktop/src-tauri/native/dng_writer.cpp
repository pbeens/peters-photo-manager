/*
 * This product includes DNG technology under license by Adobe.
 */

#include "dng_exceptions.h"
#include "dng_camera_profile.h"
#include "dng_file_stream.h"
#include "dng_host.h"
#include "dng_image_writer.h"
#include "dng_negative.h"
#include "dng_simple_image.h"

#include <cstdint>
#include <cstdio>

namespace {

void write_error(char *output, const size_t output_size, const char *message) {
    if (output != nullptr && output_size > 0) {
        std::snprintf(output, output_size, "%s", message);
    }
}

}  // namespace

extern "C" int ppm_write_linear_dng_rgba8(const uint8_t *rgba,
                                           const uint32_t width,
                                           const uint32_t height,
                                           const char *output_path,
                                           char *error_output,
                                           const size_t error_output_size) {
    if (rgba == nullptr || output_path == nullptr || width == 0 || height == 0) {
        write_error(error_output, error_output_size, "DNG output requires non-empty RGBA pixels and an output path.");
        return 1;
    }
    try {
        dng_host host;
        AutoPtr<dng_negative> negative(dng_negative::Make(host));
        const dng_rect bounds(height, width);
        AutoPtr<dng_image> image(new dng_simple_image(bounds, 3, ttShort, host.Allocator()));
        auto *linear_image = static_cast<dng_simple_image *>(image.Get());
        dng_pixel_buffer pixel_buffer;
        linear_image->GetPixelBuffer(pixel_buffer);
        for (uint32_t row = 0; row < height; ++row) {
            for (uint32_t column = 0; column < width; ++column) {
                const uint8_t *source = rgba + (static_cast<size_t>(row) * width + column) * 4;
                *pixel_buffer.DirtyPixel_uint16(row, column, 0) = static_cast<uint16>(source[0]) * 257;
                *pixel_buffer.DirtyPixel_uint16(row, column, 1) = static_cast<uint16>(source[1]) * 257;
                *pixel_buffer.DirtyPixel_uint16(row, column, 2) = static_cast<uint16>(source[2]) * 257;
            }
        }
        negative->SetModelName("Peter's Photo Manager rendered DNG");
        negative->SetLocalName("Rendered image");
        negative->SetRGB();
        AutoPtr<dng_camera_profile> profile(new dng_camera_profile());
        dng_matrix color_matrix;
        color_matrix.SetIdentity(3);
        profile->SetCalibrationIlluminant1(lsD65);
        profile->SetColorMatrix1(color_matrix);
        negative->AddProfile(profile);
        negative->SetActiveArea(bounds);
        negative->SetDefaultCropSize(width, height);
        negative->SetDefaultCropOrigin(0, 0);
        negative->SetStage3Image(image);
        dng_file_stream stream(output_path, true);
        dng_image_writer writer;
        writer.WriteDNG(host, stream, *negative, nullptr, dngVersion_SaveDefault, true);
        return 0;
    } catch (const dng_exception &error) {
        write_error(error_output, error_output_size, error.what());
        return 1;
    } catch (...) {
        write_error(error_output, error_output_size, "Adobe DNG SDK could not write the rendered DNG.");
        return 1;
    }
}
