# Builds the two fonts the PDF report embeds: ElamxSans-Regular.ttf and
# ElamxSans-Bold.ttf. See README.md next to this file for why and how.
#
# jsPDF has no per-glyph fallback: a character the embedded font lacks is
# dropped from the PDF without a word. So the one font it gets must hold every
# character a report can write - umlauts, Greek, sub- and superscripts, the
# operators of the explanations (<= sum perp par) and the few symbols the
# charts draw (the critical-ply marker, a check mark). Noto Sans has the text,
# Noto Sans Math the operators, Noto Sans Symbols 2 the symbols; each is cut to
# what is needed and the three are merged per weight.
#
# The glyph test (fonts.test.ts) checks the result against de.ts and en.ts.
import os
import sys
from fontTools import subset
from fontTools.merge import Merger

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")

# Latin with its supplements, combining marks (Q with a bar, D with a tilde),
# Greek, phonetic subscripts (n with a subscript y), general punctuation,
# super- and subscripts, the euro sign and letterlike symbols.
TEXT = ",".join([
    "U+0020-007E", "U+00A0-017F", "U+0300-036F", "U+0370-03FF", "U+1D62-1D6A",
    "U+2000-206F", "U+2070-209F", "U+20AC", "U+2100-214F",
])
# Arrows, mathematical operators, angle brackets.
MATH = "U+2190-21FF,U+2200-22FF,U+27E8-27E9"
# The critical-ply marker, the Mac modifier keys a shortcut can show, check
# and cross marks, the warning sign, and geometric shapes for legends.
SYMBOLS = "U+2316,U+2318,U+2325,U+2713-2718,U+26A0,U+25A0-25FF"


def sub(src, dst, unicodes):
    subset.main([
        os.path.join(SRC, src),
        f"--unicodes={unicodes}",
        "--no-hinting",
        "--layout-features=",
        "--drop-tables+=GSUB,GPOS,GDEF,MATH,vhea,vmtx,gasp",
        # All names, so the copyright and the licence travel with the font.
        "--name-IDs=*",
        f"--output-file={os.path.join(HERE, dst)}",
    ])


def main():
    missing = [f for f in ("NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSansMath-Regular.ttf",
                           "NotoSansSymbols2-Regular.ttf") if not os.path.exists(os.path.join(SRC, f))]
    if missing:
        sys.exit(f"missing source fonts in {SRC}: {', '.join(missing)} (see README.md)")
    parts = []
    sub("NotoSansMath-Regular.ttf", "math.sub.ttf", MATH)
    sub("NotoSansSymbols2-Regular.ttf", "symbols.sub.ttf", SYMBOLS)
    parts += ["math.sub.ttf", "symbols.sub.ttf"]
    for weight in ("Regular", "Bold"):
        text = f"text-{weight}.sub.ttf"
        sub(f"NotoSans-{weight}.ttf", text, TEXT)
        # The first font wins where two map the same character, so the text
        # font's own glyphs are kept wherever it has them.
        font = Merger().merge([os.path.join(HERE, f) for f in (text, *parts)])
        font.save(os.path.join(HERE, f"ElamxSans-{weight}.ttf"))
        os.remove(os.path.join(HERE, text))
    for f in parts:
        os.remove(os.path.join(HERE, f))
    for f in ("ElamxSans-Regular.ttf", "ElamxSans-Bold.ttf"):
        print(f, os.path.getsize(os.path.join(HERE, f)))


if __name__ == "__main__":
    main()
