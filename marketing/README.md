# ES30 Cafe advertising slide

- `es30-cafe-slide.pptx` — one 16:9 PowerPoint slide, ready to drop into a deck.
  The artwork sits on it as a full-bleed picture, because the cafe's two fonts
  live on the website rather than on any laptop; clicking it while presenting
  opens the site.
- `es30-cafe-slide.png` — the same slide at 1920 x 1080, for a screen.
- `es30-cafe-slide.pdf` — and at 13.333 x 7.5 in, for printing.
- `slide.html` — the source. Edit it, then rebuild:

      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
        --window-size=1920,1080 --virtual-time-budget=4000 \
        --screenshot=es30-cafe-slide.png slide.html

  The time budget is not optional: without it the shot can be taken before the
  web fonts arrive, and the slide renders in a fallback face.

  Then rebuild the .pptx around the new picture with `make-pptx.py`.

- `qr.png` — the code on the slide. It points at https://es30-cafe.onrender.com/
  and is drawn at error-correction level Q, so it still reads with a quarter of
  it obscured or the projector out of focus.
