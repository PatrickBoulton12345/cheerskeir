# Brand fonts

The site is built per the LFG brand bible:

- **Octarine** (Bold + Light) — headlines, lowercase only except abbreviations
- **DM Sans** (Black + Regular) — body copy, sentence case

DM Sans is loaded from Google Fonts and renders out-of-the-box.

Octarine is licensed and not on a CDN. To enable it:

1. Drop these files into this folder:
   - `Octarine-Bold.otf`
   - `Octarine-Light.otf`

2. That's it. `index.html` already has matching `@font-face` declarations and a font-family stack of `'Octarine', 'DM Sans', system-ui, sans-serif` — the browser will pick up Octarine as soon as the files are present.

Without these files, headlines fall back to DM Sans Black, which is also a brand font and looks close.
