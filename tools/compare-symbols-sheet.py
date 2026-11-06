"""Score and show the symbol comparison made by tools/compare-symbols-pptx.mjs.

Each sheet of symbols (sheets.json) is pictured by the app (app/sheet-NN.png) and as a PowerPoint slide
(pptx/slide-N.png). Both are cut into the same grid of cells inside the sheet's light frame. Each symbol's two
pictures are reduced to their dark "ink" (strokes, outlines, text), cropped to it, scaled to the same box and
compared: the score is the share of ink that has ink nearby in the other picture (1.00 = same shape). Writes
report.txt (lowest first) and compare-*.png (app | PowerPoint, 12 symbols each, lowest first).
Usage: python3 -I tools/compare-symbols-sheet.py <out-dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

BOX = 160  # compare in a BOX x BOX square
NEAR = 2   # pixels of tolerance (line widths and anti-aliasing differ a little)


def ink(img: Image.Image) -> Image.Image:
    g = ImageOps.grayscale(img.convert("RGB"))
    return g.point(lambda v: 255 if v < 140 else 0)  # dark strokes and text only, not light fills


def crop_to_ink(img: Image.Image) -> Image.Image | None:
    m = ink(img)
    box = m.getbbox()
    return img.crop(box) if box else None


def norm(img: Image.Image) -> np.ndarray:
    """Ink of the picture, fitted into BOX x BOX keeping proportions, centred."""
    m = ink(img)
    w, h = m.size
    s = (BOX - 8) / max(w, h)
    m = m.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BILINEAR).point(lambda v: 255 if v > 60 else 0)
    canvas = Image.new("L", (BOX, BOX), 0)
    canvas.paste(m, ((BOX - m.size[0]) // 2, (BOX - m.size[1]) // 2))
    return np.array(canvas) > 0


def near(a: np.ndarray) -> np.ndarray:
    img = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(NEAR * 2 + 1))
    return np.array(img) > 0


def score(a: np.ndarray, b: np.ndarray) -> float:
    if not a.any() or not b.any():
        return 0.0
    hit_a = (a & near(b)).sum() / a.sum()
    hit_b = (b & near(a)).sum() / b.sum()
    return float(min(hit_a, hit_b))


def frame_box(img: Image.Image) -> tuple[int, int, int, int]:
    """The light frame around a sheet: the bounding box of everything not white."""
    g = ImageOps.grayscale(img.convert("RGB")).point(lambda v: 255 if v < 235 else 0)
    return g.getbbox()


def cells(img: Image.Image, per_row: int, rows: int, n: int) -> list[Image.Image]:
    x0, y0, x1, y1 = frame_box(img)
    cw, ch = (x1 - x0) / per_row, (y1 - y0) / rows
    out = []
    for i in range(n):
        cx, cy = x0 + (i % per_row) * cw, y0 + (i // per_row) * ch
        inset = 0.03
        out.append(img.crop((int(cx + cw * inset), int(cy + ch * inset), int(cx + cw * (1 - inset)), int(cy + ch * (1 - inset)))))
    return out


def main(out: Path) -> None:
    meta = json.loads((out / "sheets.json").read_text())
    per_row, nrows = meta["perRow"], meta["rows"]
    apps = sorted((out / "app").glob("*.png"))
    slides = sorted((out / "pptx").glob("*.png"), key=lambda p: int(p.stem.split("-")[-1]))
    rows = []
    k = 0
    for si, sheet in enumerate(meta["sheets"]):
        n = len(sheet["ids"])
        app_cells = cells(Image.open(apps[si]), per_row, nrows, n)
        sl = Image.open(slides[si])
        w, h = sl.size
        # The slide's drawing area: below the title rule, above the footer (13.33 x 7.5 in layout).
        sl = sl.crop((int(w * 0.02), int(h * 0.115), int(w * 0.98), int(h * 0.94)))
        ppt_cells = cells(sl, per_row, nrows, n)
        for j in range(n):
            app, ppt = crop_to_ink(app_cells[j]), crop_to_ink(ppt_cells[j])
            sc = score(norm(app), norm(ppt)) if app and ppt else 0.0
            rows.append((sc, k, sheet["ids"][j], sheet["names"][j], app_cells[j], ppt_cells[j]))
            k += 1
    rows.sort(key=lambda r: r[0])
    lines = [f"{sc:.3f}  {i + 1:3d}  {sid:<14} {name}" for sc, i, sid, name, _, _ in rows]
    (out / "report.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:20]))
    print(f"... {len(rows)} symbols; lowest {rows[0][0]:.3f}, median {rows[len(rows) // 2][0]:.3f}, below 0.9: {sum(1 for r in rows if r[0] < 0.9)}")

    cell = 200
    per = 12
    for k in range(0, len(rows), per):
        chunk = rows[k:k + per]
        sheet = Image.new("RGB", (cell * 2 + 220, cell * len(chunk)), "white")
        d = ImageDraw.Draw(sheet)
        for j, (sc, i, sid, name, app, ppt) in enumerate(chunk):
            y = j * cell
            d.text((8, y + 8), f"{name}\n{sid}\nscore {sc:.2f}", fill="black")
            for col, img in ((0, app), (1, ppt)):
                if img is None:
                    continue
                t = img.copy()
                t.thumbnail((cell - 16, cell - 16))
                sheet.paste(t, (220 + col * cell + (cell - t.size[0]) // 2, y + (cell - t.size[1]) // 2))
            d.line((0, y + cell - 1, sheet.size[0], y + cell - 1), fill=(220, 220, 220))
        d.text((220 + 8, 2), "app", fill=(120, 120, 120))
        d.text((220 + cell + 8, 2), "PowerPoint", fill=(120, 120, 120))
        sheet.save(out / f"compare-{k // per + 1:02d}.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
