# ES30 Cafe advertising slide

- `es30-cafe-slide.png` — 1920 x 1080, for a lecture projector or a screen.
- `es30-cafe-slide.pdf` — the same slide at 13.333 x 7.5 in, for printing.
- `slide.html` — the source. Edit it, then rebuild:

      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
        --window-size=1920,1080 --screenshot=es30-cafe-slide.png slide.html

- `qr.png` — the code on the slide. It points at https://es30-cafe.onrender.com/
  and is drawn at error-correction level Q, so it still reads with a quarter of
  it obscured or the projector out of focus.
