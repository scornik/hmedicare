# Noto Sans Bengali — vendored for prescription PDF rendering

Required by RX-005: a prescription PDF must be able to print Bangla instructions. `pdfmake` embeds
TTF or OTF, and its bundled Roboto has no Bengali glyphs — a Bangla instruction would render as blank
boxes, which is worse than failing, so the font is a correctness requirement rather than a nicety.

## Files

| File | SHA-256 | Bytes |
|---|---|---|
| `NotoSansBengali-Regular.ttf` | `b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193` | 143,072 |
| `NotoSansBengali-Bold.ttf` | `923c6a4c2eb618a57ed83f4bca855b4f5287b87906a4d9df40a2ffa8ebd8c2e8` | 144,828 |

Verified as real TrueType by their `00 01 00 00` version tag, not by their file extension.

## Source

Downloaded on 2026-10-06 from the Noto project's own build output:

```
https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf
https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Bold.ttf
```

The static hinted builds, not the variable font Google Fonts ships, because `fontkit` (which `pdfkit`
and therefore `pdfmake` use for embedding) handles a static face without an instancing step.

Version `3.011;GOOG;NotoSansBengali-Regular`, read from the font's own name table.

**No font is copied from a reference repository** (RX-005 explicitly forbids it). These came from
upstream.

## Licence

**SIL Open Font License, Version 1.1.** `OFL.txt` beside this file.

The authority is the font binary itself: its name table carries

- ID 13: "This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is
  available with a FAQ at: https://openfontlicense.org"
- ID 14: `https://openfontlicense.org/`
- ID 0: "Copyright 2025 The Noto Project Authors (https://github.com/notofonts/bengali)"

That matters because the `notofonts.github.io` repository's root `LICENSE` is **Apache-2.0**, which
covers that repository's tooling and not the font binaries. Shipping it beside these files would have
mislabelled them, so it was not used.

The `OFL.txt` here is the same OFL 1.1 text already vetted in this workspace through
`@fontsource/noto-sans-bengali@5.3.0`, which the web client depends on for the same typeface. One
licence, one text, two consumers.

OFL 1.1 permits embedding in a document ("the Font Software may be embedded in a document"), which is
what a rendered PDF does. The reserved font name clause is respected: these files are unmodified and
keep their original names.
