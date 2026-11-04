"""Write the example MB workbooks in examples/ (formulas only; GridCraft then calculates and saves them).

Usage (from the repository root):
  python3 -I tools/make-mb-examples.py <work dir>
  gridcraft-cli convert <work dir>/MB_example_raw.xlsx examples/MB_example.xlsx
  gridcraft-cli run --in examples/MB_example.xlsx --cmd 'cell.set={"sheet":"MB_calc","cell":"D4","input":"1000"}' --out examples/MB_example_v2.xlsx
  gridcraft-cli convert <work dir>/MB_example_errors_raw.xlsx examples/MB_example_errors.xlsx

The stream IDs match examples/example-process.pcs.json and the material codes match the app's
18 sample materials (MAT-0001 Basal Medium, MAT-0002 Feed Medium A, kg).
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

CALC = "MB_calc"
Q = CALC

HEAD_FILL = PatternFill("solid", fgColor="1F3A5F")
HEAD_FONT = Font(bold=True, color="FFFFFF")
INPUT_FILL = PatternFill("solid", fgColor="FFF4CC")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# (label, unit, sending, receiving, note, number format)   rows 4..10
INPUTS = [
    ("Working volume, 100L stage", "L", 100, 500, "Input: scale", "0"),
    ("Basal medium fraction", "%", 0.85, "=C5", "Receiving = Sending", "0%"),
    ("Inoculum fraction (from 10L)", "%", 0.10, "=C6", "", "0%"),
    ("Feed A fraction", "%", 0.05, "=C7", "", "0%"),
    ("Basal Medium powder", "g/L", 17.5, "=C8", "Powder per litre of medium", "0.0"),
    ("Feed Medium A powder", "g/L", 124, "=C9", "Powder per litre of feed", "0.0"),
    ("Seed medium fraction (10L)", "%", 0.90, "=C10", "Rest is the flask inoculum", "0%"),
]
# rows 13..20
RESULTS = [
    ("Basal medium volume", "L", "=C4*C5", "=D4*D5", "ST-100L-001"),
    ("Inoculum transfer volume", "L", "=C4*C6", "=D4*D6", "ST-10L-100L"),
    ("Feed A volume", "L", "=C4*C7", "=D4*D7", "ST-100L-002"),
    ("Basal Medium powder, 100L", "kg", "=C13*C8/1000", "=D13*D8/1000", "MAT-0001 in 100L"),
    ("Feed Medium A powder", "kg", "=C15*C9/1000", "=D15*D9/1000", "MAT-0002 in 100L"),
    ("Seed medium volume, 10L", "L", "=C14*C10", "=D14*D10", "ST-10L-001"),
    ("Basal Medium powder, 10L", "kg", "=C18*C8/1000", "=D18*D8/1000", "MAT-0001 in 10L"),
    ("Check: 100L volumes = working volume", "L", "=C13+C14+C15", "=D13+D14+D15", "No losses assumed"),
]

LINK_HEAD = ["StreamID", "MatCode", "Unit", "Sending", "Receiving", "Note"]
LINK_ROWS = [
    ("ST-10L-001", None, "L", f"={Q}!C18", f"={Q}!D18", "Seed medium"),
    ("ST-10L-001", "MAT-0001", "kg", f"={Q}!C19", f"={Q}!D19", "Basal Medium powder for the seed medium"),
    ("ST-10L-100L", None, "L", f"={Q}!C14", f"={Q}!D14", "Inoculum transfer"),
    ("ST-100L-001", None, "L", f"={Q}!C13", f"={Q}!D13", "Basal medium"),
    ("ST-100L-001", "MAT-0001", "kg", f"={Q}!C16", f"={Q}!D16", "Basal Medium powder"),
    ("ST-100L-002", None, "L", f"={Q}!C15", f"={Q}!D15", "Feed A"),
    ("ST-100L-002", "MAT-0002", "kg", f"={Q}!C17", f"={Q}!D17", "Feed Medium A powder"),
]
# One mistake per row, for trying the checks.
ERROR_ROWS = [
    ("ST-10L-001", None, "L", f"={Q}!C18", f"={Q}!D18", "OK"),
    ("ST-10L-001", None, "L", 9, 45, "V4: a second flow row for the same stream"),
    ("ST-10L-100L", None, "L", -10, 50, "V5: negative value"),
    ("ST-100L-001", None, "L", f"={Q}!C13", "about 425", "V5: text instead of a number"),
    ("ST-100L-001", "MAT-0001", "g", f"={Q}!C16*1000", f"={Q}!D16*1000", "V7: grams, but the material list counts kg"),
    ("ST-100L-002", "MAT-9999", "kg", 1, 5, "V6: material code not in the list"),
    ("ST-100L-009", None, "L", 1, 5, "V2: no such stream on the PFD"),
    ("ST-100L-002", None, "", f"={Q}!C15", f"={Q}!D15", "V1: Unit is empty"),
]


def header(ws, row, n):
    for c in range(1, n + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill, cell.font, cell.border = HEAD_FILL, HEAD_FONT, BOX
        cell.alignment = Alignment(horizontal="center")


def build_calc(ws):
    ws.title = CALC
    ws["A1"] = "Example mass balance: 10L seed and 100L fed-batch (Sending 100 L, Receiving 500 L)"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = "Yellow cells are inputs. The PCS_LINK sheet refers to the results below."
    ws["A2"].font = Font(italic=True, color="666666")
    for i, h in enumerate(["Item", "Unit", "Sending", "Receiving", "Note"], 1):
        ws.cell(row=3, column=i, value=h)
    header(ws, 3, 5)
    for r, (label, unit, s, rv, note, fmt) in enumerate(INPUTS, start=4):
        for c, v in enumerate((label, unit, s, rv, note), start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BOX
        ws.cell(row=r, column=3).fill = INPUT_FILL
        if r == 4:
            ws.cell(row=r, column=4).fill = INPUT_FILL
        ws.cell(row=r, column=3).number_format = fmt
        ws.cell(row=r, column=4).number_format = fmt
    for i, h in enumerate(["Result", "Unit", "Sending", "Receiving", "Goes to"], 1):
        ws.cell(row=12, column=i, value=h)
    header(ws, 12, 5)
    for r, (label, unit, s, rv, note) in enumerate(RESULTS, start=13):
        for c, v in enumerate((label, unit, s, rv, note), start=1):
            ws.cell(row=r, column=c, value=v).border = BOX
        ws.cell(row=r, column=3).number_format = "0.000"
        ws.cell(row=r, column=4).number_format = "0.000"
    for col, w in zip("ABCDE", (36, 7, 12, 12, 26)):
        ws.column_dimensions[col].width = w


def build_link(ws, rows):
    ws.title = "PCS_LINK"
    for i, h in enumerate(LINK_HEAD, 1):
        ws.cell(row=1, column=i, value=h)
    header(ws, 1, len(LINK_HEAD))
    for r, row in enumerate(rows, start=2):
        for c, v in enumerate(row, start=1):
            if v is None:
                continue
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BOX
            if c in (4, 5):
                cell.number_format = "0.000"
    for col, w in zip("ABCDEF", (14, 11, 7, 12, 12, 44)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"


def build(path, rows):
    wb = Workbook()
    wb.properties.creator = "PCS Platform example"
    build_calc(wb.active)
    build_link(wb.create_sheet(), rows)
    wb.save(path)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    build(out / "MB_example_raw.xlsx", LINK_ROWS)
    build(out / "MB_example_errors_raw.xlsx", ERROR_ROWS)
    print("ok", sorted(p.name for p in out.iterdir()))


if __name__ == "__main__":
    main()
