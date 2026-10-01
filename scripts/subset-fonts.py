#!/usr/bin/env python3
"""Subset the OFL Noto fonts to the glyphs SQUAD OF ONE actually renders.

Reads every string from the i18n JSON tables plus a fixed Latin/ASCII coverage
set, then produces WOFF2 subsets in public/fonts. Keeps the bundle tiny while
guaranteeing both scripts (Latin + Devanagari) render with no tofu.

Run: python3 scripts/subset-fonts.py  (fonts downloaded into .fonttmp first)
"""
import json
import os
import sys
import urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(ROOT, ".fonttmp")
OUT = os.path.join(ROOT, "public", "fonts")
I18N = os.path.join(ROOT, "src", "i18n")

# Upstream hinted TTF sources (OFL-1.1). Downloaded on demand (needs network).
SOURCES = {
    "NotoSans.ttf": "https://raw.githubusercontent.com/notofonts/notofonts.github.io/master/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
    "NotoSansDevanagari.ttf": "https://raw.githubusercontent.com/notofonts/notofonts.github.io/master/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf",
    # Orbitron: OFL sci-fi/geometric display face for the Latin headline/title.
    # Variable (wght) upstream; we instance it to a single bold weight below so
    # the subset is a plain static face (no runtime variable-font overhead).
    "Orbitron.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/Orbitron%5Bwght%5D.ttf",
}

# The display font only renders Latin headings/titles (uppercase-leaning), the
# tagline, mode names and digits - never body copy and never Devanagari. We give
# it the full printable-ASCII + common-symbol coverage so any heading key can
# use it without tofu, then subset hard (it stays a few KB).
DISPLAY_CHARS = set(chr(c) for c in range(0x20, 0x7F)) | set("’‘“”–—…•×→←")


def ensure_sources():
    os.makedirs(TMP, exist_ok=True)
    for name, url in SOURCES.items():
        dst = os.path.join(TMP, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 10000:
            continue
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req) as resp, open(dst, "wb") as f:
            f.write(resp.read())
        print(f"downloaded {name} ({os.path.getsize(dst)} bytes)")

# Baseline Latin coverage: ASCII printable + a few common symbols/quotes.
BASE_LATIN = set(chr(c) for c in range(0x20, 0x7F))
BASE_LATIN |= set("’‘“”–—…•×→←")

def strings_from_json(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return "".join(str(v) for v in data.values())


def build_charset():
    text = ""
    for name in os.listdir(I18N):
        if name.endswith(".json"):
            text += strings_from_json(os.path.join(I18N, name))
    return set(text)


def subset_font(src, dst, chars, layout_features):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = layout_features
    opts.name_IDs = ["*"]  # keep name table (license + family) for attribution
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables = []
    font = subset.load_font(src, opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(text="".join(sorted(chars)))
    subsetter.subset(font)
    subset.save_font(font, dst, opts)
    return os.path.getsize(dst)


def instance_variable(src, dst, axes):
    """Pin the variable axes of `src` to fixed values, writing a static TTF."""
    font = TTFont(src)
    if "fvar" in font:
        instancer.instantiateVariableFont(font, axes, inplace=True)
    font.save(dst)


def main():
    os.makedirs(OUT, exist_ok=True)
    ensure_sources()
    charset = build_charset()
    # Split by script: codepoints >= U+0900 are Devanagari.
    latin = {c for c in charset if ord(c) < 0x0900} | BASE_LATIN
    deva = {c for c in charset if ord(c) >= 0x0900}
    # Devanagari needs shaping features (conjuncts, matras).
    deva_features = ["ccmp", "akhn", "rphf", "blwf", "half", "pstf", "vatu",
                     "cjct", "pres", "abvs", "blws", "psts", "haln", "nukt",
                     "akhand", "rkrf", "abvm", "blwm", "dist", "kern", "liga",
                     "calt"]
    latin_features = ["kern", "liga", "calt", "ccmp"]

    latin_size = subset_font(
        os.path.join(TMP, "NotoSans.ttf"),
        os.path.join(OUT, "NotoSans-subset.woff2"),
        latin, latin_features)
    deva_size = subset_font(
        os.path.join(TMP, "NotoSansDevanagari.ttf"),
        os.path.join(OUT, "NotoSansDevanagari-subset.woff2"),
        deva, deva_features)

    # Display headline face (Orbitron): instance the variable font to a bold
    # weight, then subset to the Latin display charset.
    orbitron_static = os.path.join(TMP, "Orbitron-700.ttf")
    instance_variable(
        os.path.join(TMP, "Orbitron.ttf"), orbitron_static, {"wght": 700})
    display_size = subset_font(
        orbitron_static,
        os.path.join(OUT, "Orbitron-subset.woff2"),
        DISPLAY_CHARS, latin_features)

    total = latin_size + deva_size + display_size
    print(f"Latin subset:      {latin_size:>7} bytes  ({len(latin)} chars)")
    print(f"Devanagari subset: {deva_size:>7} bytes  ({len(deva)} chars)")
    print(f"Display subset:    {display_size:>7} bytes  ({len(DISPLAY_CHARS)} chars)")
    print(f"Total fonts:       {total:>7} bytes")
    if total > 400 * 1024:
        print("WARNING: font bundle exceeds 400 KB", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
