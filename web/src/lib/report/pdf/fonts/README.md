# Report fonts

`ElamxSans-Regular.ttf` and `ElamxSans-Bold.ttf` are the only fonts the PDF
report embeds. jsPDF has no fallback: a character the embedded font does not
have is left out of the PDF without an error, so these two must hold every
character a report can write. `fonts.test.ts` (one directory up) checks them
against `de.ts`, `en.ts` and the report's builders and charts.

They are built from three Noto fonts, cut down to the characters needed and
merged per weight:

- Noto Sans Regular and Bold: Latin, Greek, combining marks, punctuation, super-
  and subscripts;
- Noto Sans Math: arrows and mathematical operators;
- Noto Sans Symbols 2: the critical-ply marker, check marks, the warning sign,
  geometric shapes.

## Regenerating

Needed only when the tests report a missing character. Put the source fonts in
`src/` here (the directory is ignored by git):

- `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` from
  https://github.com/notofonts/latin-greek-cyrillic/releases (full, unhinted TTF)
- `NotoSansMath-Regular.ttf` from https://github.com/notofonts/math/releases
- `NotoSansSymbols2-Regular.ttf` from
  https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSansSymbols2

Then, with Python and fontTools (`pip install fonttools`):

```
python build_fonts.py
```

Add a range to `TEXT`, `MATH` or `SYMBOLS` in the script for a new character.

## Licence

The Noto fonts are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). The copyright and licence notices are kept in
the fonts' name tables, and the merged fonts may be redistributed under the same
licence.
