# Test fixtures

All color patterns were generated locally for this project; no personal or downloaded photos are included.

- `colors.png`: 240×160 color blocks, a 50% alpha patch and a transparent patch.
- `colors.jpg`: opaque version of the pattern.
- `colors.webp`: opaque WebP version.
- `portrait-exif.jpg`: JPEG with EXIF orientation 6. Stored 240×160, displayed 160×240.
- `colors.heic`: SDR HEIC encoded from colors.jpg using macOS `sips -s format heic`.
- `broken.png`: valid PNG signature with no image data; must fail gracefully.

These fixtures do not represent an actual iPhone HDR/gain-map HEIC. HDR/P3 visual matching with Photos is not a verified capability; see the decoder limitations in docs/ios-porting.md.
