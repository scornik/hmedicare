# Image scanner dependencies

ADR-016 specifies Sharp/libvips for decoding and re-encoding uploaded images. The
baseline adapter pins `sharp@0.35.5`, `file-type@22.1.1` and `pdf-lib@1.17.1`.
These are used unmodified. No binary or parser is sent to a browser/mobile client.

The license gate has two exact package/version/license exceptions, in addition
to its existing MariaDB exception:

| Package | Version | Published license expression |
|---|---|---|
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later |

The Windows package includes the image library and its third-party notices. The
Linux target installs the separately packaged libvips library. Retain their
LICENSE, README, version information and third-party notices in installed and
distributed dependency directories. Do not strip these files, modify/relink the
binaries, or bundle them into proprietary native/mobile binaries under this
exception. The current deployment installs the original npm packages on the
server. The gate continues to reject other copyleft libraries, other versions,
and unreviewed platforms. The exception is tested separately from the scanner.

Upstream references:

- [Sharp licensing and dependency notices](https://github.com/lovell/sharp/tree/v0.35.5/npm/win32-x64)
- [Sharp installation and platform requirements](https://sharp.pixelplumbing.com/install/)
- [libvips distribution](https://github.com/lovell/sharp-libvips/tree/v1.3.4)

Local native loading and fixture tests do not establish hosting compatibility.
HOST-002 still needs a production-host probe before upload activation. In
particular, Linux x64 prebuilt binaries require glibc 2.28 or newer. The scanner
currently fails closed if its parser/image library cannot start; no reduced
assurance mode is enabled automatically.
