"""Write the downstream example files in examples/:

  downstream-materials.xlsx   material list with Recipes and Backups sheets (Materials › Import)
  MB_downstream_raw.xlsx      the mass balance with formulas only (MB_calc + PCS_LINK)

The raw workbook has no calculated values yet; LibreOffice (or GridCraft) calculates and saves it:
  python3 -I tools/make-downstream-examples.py <work dir>
  soffice --headless --calc --convert-to xlsx --outdir <out dir> <work dir>/MB_downstream_raw.xlsx
  (then rename <out dir>/MB_downstream_raw.xlsx to examples/MB_downstream.xlsx)

Process: 15,000 L (Receiving) or 2,000 L (Sending) of harvested culture fluid (HCCF) through
Protein A capture with low-pH viral inactivation and depth filtration (PROA), cation exchange (CEX),
mixed-mode flow-through (MMC), virus filtration (VF), UF/DF with excipient spike (UFDF), bulk fill into
bottles (FILL) and storage at -70 C (STOR). Stream IDs match examples/example-downstream.pcs.json.
Step yields are not modelled (the app does not use yields); all numbers are made-up examples.
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HEAD_FILL = PatternFill("solid", fgColor="1F3A5F")
HEAD_FONT = Font(bold=True, color="FFFFFF")
SECTION_FONT = Font(bold=True, color="1F3A5F")
INPUT_FILL = PatternFill("solid", fgColor="FFF4CC")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ---- materials -------------------------------------------------------------------------------------------
MATERIALS = [
    # code, name, unit, category, spec, overage %
    ("CHM-0001", "Tris base", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0002", "Sodium chloride", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0003", "Acetic acid, glacial", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0004", "Sodium acetate trihydrate", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0005", "Sodium hydroxide, pellets", "kg", "Chemical", "EP", 5),
    ("CHM-0006", "L-Histidine", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0007", "L-Histidine monohydrochloride monohydrate", "kg", "Chemical", "USP/EP", 5),
    ("CHM-0008", "Sucrose", "kg", "Chemical", "Low endotoxin", 5),
    ("CHM-0009", "Polysorbate 80", "kg", "Chemical", "HP grade", 10),
    ("CHM-0102", "Sodium chloride (supplier B)", "kg", "Chemical", "USP/EP", None),
    ("CHM-0109", "Polysorbate 80 (supplier B)", "kg", "Chemical", "HP grade", None),
    ("UTL-0001", "Water for injection", "L", "Utility", None, None),
    ("BUF-1001", "ProA equilibration buffer (20 mM Tris, 150 mM NaCl, pH 7.4)", "L", "Buffer", "Made in-house", None),
    ("BUF-1001-B", "ProA equilibration buffer, filled in 200 L bags", "L", "Buffer", "Made in-house", None),
    ("BUF-1001-T", "ProA equilibration buffer, 2,000 L tank batch, 0.2 µm filtered", "L", "Buffer", "Made in-house", None),
    ("BUF-1002", "ProA wash buffer (20 mM Tris, 500 mM NaCl, pH 7.4)", "L", "Buffer", "Made in-house", None),
    ("BUF-1003", "ProA elution buffer (50 mM acetate, pH 3.5)", "L", "Buffer", "Made in-house", None),
    ("BUF-1004", "VI titrant (1 M acetic acid)", "L", "Buffer", "Made in-house", None),
    ("BUF-1005", "Neutralization buffer (1 M Tris)", "L", "Buffer", "Made in-house", None),
    ("BUF-1006", "Sanitization solution (0.5 M NaOH)", "L", "Buffer", "Made in-house", None),
    ("BUF-2001", "CEX equilibration buffer (50 mM acetate, pH 5.0)", "L", "Buffer", "Made in-house", None),
    ("BUF-2002", "CEX elution buffer (50 mM acetate, 250 mM NaCl, pH 5.0)", "L", "Buffer", "Made in-house", None),
    ("BUF-2003", "CEX strip (2 M NaCl)", "L", "Buffer", "Made in-house", None),
    ("BUF-3001", "MMC equilibration buffer (25 mM Tris, 50 mM NaCl, pH 7.5)", "L", "Buffer", "Made in-house", None),
    ("BUF-5001", "DF buffer (20 mM histidine, pH 6.0)", "L", "Buffer", "Made in-house", None),
    ("BUF-5002", "Excipient stock (50 % sucrose, 0.125 % PS80, 20 mM histidine)", "L", "Buffer", "Made in-house", None),
    ("RES-0001", "Protein A resin", "L", "Resin", None, None),
    ("RES-0101", "Protein A resin (alternate)", "L", "Resin", None, None),
    ("RES-0002", "Cation exchange resin", "L", "Resin", None, None),
    ("RES-0003", "Mixed-mode resin", "L", "Resin", None, None),
    ("FLT-0001", "Depth filter capsule (1.1 m²)", "EA", "Filter", None, None),
    ("FLT-0002", "Sterile filter capsule 0.2 µm (10\")", "EA", "Filter", None, None),
    ("FLT-0003", "Virus prefilter capsule (3.3 m²)", "EA", "Filter", None, None),
    ("FLT-0004", "Virus filter capsule (3.3 m²)", "EA", "Filter", None, None),
    ("FLT-0104", "Virus filter capsule, alternate vendor (1.1 m²)", "EA", "Filter", None, None),
    ("FLT-0005", "UF cassette 30 kDa (2.5 m²)", "EA", "Filter", None, None),
    ("FLT-0006", "Bulk fill filter 0.2 µm (5\")", "EA", "Filter", "Sterilizing grade", None),
    ("FLT-0007", "Buffer filter capsule 0.2 µm (20\")", "EA", "Filter", "Sterilizing grade", None),
    ("CON-0001", "Bulk DS bottle 2 L (PETG)", "EA", "Consumable", "Fill 1.8 L", None),
    ("CON-0002", "Bulk fill manifold (single-use)", "EA", "Consumable", None, None),
    ("CON-0003", "Temperature data logger", "EA", "Consumable", None, None),
    ("CON-0004", "Buffer bag 200 L, 0.2 µm filter built in", "EA", "Consumable", "Single-use", None),
    ("LIN-0001", "Transfer line 1.5\", 2 m", "EA", "Line", "1.5\", 2 m", None),
]

# Per 1000 L of buffer. WFI is counted as the full volume ("to volume"); acid/base for pH adjustment is not listed.
RECIPES = {
    "BUF-1001": ([("CHM-0001", 2.423), ("CHM-0002", 8.766), ("UTL-0001", 1000)], "20 mM Tris, 150 mM NaCl; adjust to pH 7.4; WFI to volume"),
    "BUF-1002": ([("CHM-0001", 2.423), ("CHM-0002", 29.22), ("UTL-0001", 1000)], "20 mM Tris, 500 mM NaCl; adjust to pH 7.4; WFI to volume"),
    "BUF-1003": ([("CHM-0003", 2.846), ("CHM-0004", 0.354), ("UTL-0001", 1000)], "47.4 mM acetic acid + 2.6 mM sodium acetate (pH 3.5); WFI to volume"),
    "BUF-1004": ([("CHM-0003", 60.05), ("UTL-0001", 1000)], "1 M acetic acid; WFI to volume"),
    "BUF-1005": ([("CHM-0001", 121.14), ("UTL-0001", 1000)], "1 M Tris base; WFI to volume"),
    "BUF-1006": ([("CHM-0005", 20.0), ("UTL-0001", 1000)], "0.5 M NaOH; WFI to volume"),
    "BUF-2001": ([("CHM-0004", 4.321), ("CHM-0003", 1.096), ("UTL-0001", 1000)], "31.7 mM sodium acetate + 18.3 mM acetic acid (pH 5.0); WFI to volume"),
    "BUF-2002": ([("CHM-0004", 4.321), ("CHM-0003", 1.096), ("CHM-0002", 14.61), ("UTL-0001", 1000)], "50 mM acetate pH 5.0, 250 mM NaCl; WFI to volume"),
    "BUF-2003": ([("CHM-0002", 116.88), ("UTL-0001", 1000)], "2 M NaCl; WFI to volume"),
    "BUF-3001": ([("CHM-0001", 3.029), ("CHM-0002", 2.922), ("UTL-0001", 1000)], "25 mM Tris, 50 mM NaCl; adjust to pH 7.5; WFI to volume"),
    "BUF-5001": ([("CHM-0006", 1.552), ("CHM-0007", 2.096), ("UTL-0001", 1000)], "10 mM L-histidine + 10 mM L-histidine HCl (pH 6.0); WFI to volume"),
    "BUF-5002": ([("CHM-0008", 500), ("CHM-0009", 1.25), ("CHM-0006", 1.552), ("CHM-0007", 2.096), ("UTL-0001", 690)],
                 "Spiked 1 + 5 into the UF retentate: about 8 % sucrose, 0.02 % PS80 in the drug substance"),
}

# One buffer, two ways of preparing it (the same solution BUF-1001 in both):
#   BUF-1001-B  filled in 200 L single-use bags with the filter built in: one bag per batch, no extra filter
#   BUF-1001-T  made in a 2,000 L tank and filtered through one 0.2 µm capsule per batch
# The BOM counts batches = quantity ÷ batch size, rounded up (1,980 L → 10 bags; 14,520 L → 8 filters).
# code: (batch size, whole batches, [(component, quantity, "batch" or None)], note)
BATCH_RECIPES = {
    "BUF-1001-B": (200, False, [("BUF-1001", 1000, None), ("CON-0004", 1, "batch")], "BUF-1001 filled in 200 L bags; the 0.2 µm filter is part of the bag"),
    "BUF-1001-T": (2000, False, [("BUF-1001", 1000, None), ("FLT-0007", 1, "batch")], "BUF-1001 made in a 2,000 L tank, one 0.2 µm capsule per batch"),
}

BACKUPS = [
    # primary, backup, ratio, note
    ("CHM-0002", "CHM-0102", None, "Qualified second source"),
    ("CHM-0009", "CHM-0109", None, "Qualified second source"),
    ("FLT-0004", "FLT-0104", 3, "Three 1.1 m² capsules replace one 3.3 m² capsule"),
    ("RES-0001", "RES-0101", None, "Same packed volume; needs a comparability study"),
]

# ---- mass balance ------------------------------------------------------------------------------------------
# Rows of MB_calc: (key, label, unit, sending, receiving, note, number format). A value is a number or a
# formula with {key} references, written for the scenario's own column; receiving "=" = same as sending.
SECTIONS = [
    ("Inputs (yellow): scale and titer", [
        ("br", "Bioreactor working volume", "L", 2000, 15000, "Sending site / receiving site", "#,##0"),
        ("hccf_f", "HCCF volume per culture volume (with chase)", "L/L", 0.95, "=", "Harvest done upstream", "0.00"),
        ("titer", "Titer", "g/L", 3.0, "=", "", "0.0"),
    ]),
    ("Inputs: Protein A, VI, depth filtration (PROA)", [
        ("pa_cv", "Protein A column volume", "L", 60, 330, "e.g. 45 cm / 100 cm columns", "#,##0"),
        ("pa_dbc", "Protein A loading", "g/L resin", 35, "=", "", "0"),
        ("pa_eq_cv", "Equilibration, post-load wash, re-equilibration", "CV/cycle", 11, "=", "BUF-1001", "0"),
        ("eq_bag", "Equilibration buffer in 200 L bags (1) or a 2,000 L tank (0)", "1 / 0", 1, 0, "BUF-1001-B or BUF-1001-T", "0"),
        ("pa_wash_cv", "Intermediate wash", "CV/cycle", 5, "=", "BUF-1002", "0"),
        ("pa_elu_cv", "Elution", "CV/cycle", 3, "=", "BUF-1003", "0"),
        ("pa_pool_cv", "Eluate pool", "CV/cycle", 2, "=", "Rest of the elution to drain", "0.0"),
        ("pa_naoh_cv", "Sanitization", "CV/cycle", 3, "=", "BUF-1006", "0"),
        ("vi_acid", "VI titrant", "L/L eluate", 0.02, "=", "BUF-1004 to pH 3.5", "0.00"),
        ("vi_base", "Neutralization", "L/L eluate", 0.05, "=", "BUF-1005 to pH 5.0", "0.00"),
        ("df_cap", "Depth filter capacity", "L/m²", 150, "=", "", "0"),
        ("df_area", "Depth filter area per capsule", "m²", 1.1, "=", "FLT-0001", "0.0"),
        ("df_flush", "Depth filter WFI flush", "L/m²", 50, "=", "", "0"),
    ]),
    ("Inputs: cation exchange (CEX)", [
        ("cex_dil", "Load dilution with WFI", "L/L pool", 1.0, "=", "For load conductivity", "0.0"),
        ("cex_cv", "CEX column volume", "L", 50, 300, "", "#,##0"),
        ("cex_dbc", "CEX loading", "g/L resin", 40, "=", "", "0"),
        ("cex_eq_cv", "Equilibration, wash, re-equilibration", "CV/cycle", 13, "=", "BUF-2001", "0"),
        ("cex_elu_cv", "Elution", "CV/cycle", 5, "=", "BUF-2002", "0"),
        ("cex_pool_cv", "Eluate pool", "CV/cycle", 3, "=", "", "0.0"),
        ("cex_strip_cv", "Strip", "CV/cycle", 3, "=", "BUF-2003", "0"),
        ("cex_naoh_cv", "Sanitization", "CV/cycle", 3, "=", "BUF-1006", "0"),
    ]),
    ("Inputs: mixed-mode flow-through (MMC)", [
        ("mmc_adj", "Load pH adjustment", "L/L CEX pool", 0.04, "=", "BUF-1005 to pH 7.5", "0.00"),
        ("mmc_cv", "MMC column volume", "L", 50, 320, "", "#,##0"),
        ("mmc_load_g", "MMC loading (flow-through)", "g/L resin", 150, "=", "", "0"),
        ("mmc_eq_cv", "Equilibration", "CV/cycle", 5, "=", "BUF-3001", "0"),
        ("mmc_chase_cv", "Chase into the pool", "CV/cycle", 3, "=", "BUF-3001", "0"),
        ("mmc_naoh_cv", "Sanitization", "CV/cycle", 3, "=", "BUF-1006", "0"),
    ]),
    ("Inputs: virus filtration (VF)", [
        ("vf_cap", "Virus filter capacity", "L/m²", 250, "=", "", "0"),
        ("vf_area", "Area per capsule (prefilter and virus filter)", "m²", 3.3, "=", "FLT-0003, FLT-0004", "0.0"),
        ("vf_flush", "Flush (to drain)", "L/m²", 20, "=", "BUF-3001", "0"),
        ("vf_chase", "Chase (into the filtrate)", "L/m²", 10, "=", "BUF-3001", "0"),
    ]),
    ("Inputs: UF/DF and bulk fill (UFDF, FILL)", [
        ("uf_c1", "UF1 concentration", "g/L", 50, "=", "", "0"),
        ("uf_dv", "Diafiltration", "diavolumes", 8, "=", "BUF-5001", "0"),
        ("uf_c2", "UF2 concentration", "g/L", 125, "=", "Over-concentrated before the spike", "0"),
        ("uf_chase", "Recovery chase", "L/L UF2", 0.05, "=", "BUF-5001", "0.00"),
        ("uf_spike", "Excipient spike", "L/L retentate", 0.2, "=", "BUF-5002 (1 + 5)", "0.00"),
        ("uf_load", "UF membrane loading", "g/m²", 1000, "=", "", "0"),
        ("uf_area", "Area per cassette", "m²", 2.5, "=", "FLT-0005", "0.0"),
        ("uf_flush", "Flush and equilibration", "L/m²", 20, "=", "BUF-5001", "0"),
        ("uf_naoh", "Sanitization", "L/m²", 20, "=", "BUF-1006", "0"),
        ("fill_flush", "Bulk fill filter flush", "L", 10, "=", "BUF-5001", "0"),
        ("fill_vol", "Fill volume per bottle", "L", 1.8, "=", "CON-0001 (2 L bottle)", "0.0"),
    ]),
    ("Results: PROA", [
        ("mass", "mAb in HCCF", "g", "={br}*{titer}", None, "No step yields (the app does not use them)", "#,##0"),
        ("hccf", "HCCF volume", "L", "={br}*{hccf_f}", None, "ST-PROA-001", "#,##0.0"),
        ("pa_cyc", "Protein A cycles", "cycles", "=ROUNDUP({mass}/({pa_dbc}*{pa_cv}),0)", None, "", "0"),
        ("pa_eq", "Equilibration and wash buffer", "L", "={pa_eq_cv}*{pa_cv}*{pa_cyc}", None, "ST-PROA-002", "#,##0.0"),
        ("pa_eq_bag", "… of it prepared in 200 L bags", "L", "={pa_eq}*{eq_bag}", None, "ST-PROA-002, BUF-1001-B", "#,##0.0"),
        ("pa_eq_tank", "… of it prepared in a 2,000 L tank", "L", "={pa_eq}*(1-{eq_bag})", None, "ST-PROA-002, BUF-1001-T", "#,##0.0"),
        ("pa_wash", "Intermediate wash buffer", "L", "={pa_wash_cv}*{pa_cv}*{pa_cyc}", None, "ST-PROA-003, BUF-1002", "#,##0.0"),
        ("pa_elu", "Elution buffer", "L", "={pa_elu_cv}*{pa_cv}*{pa_cyc}", None, "ST-PROA-004, BUF-1003", "#,##0.0"),
        ("pa_naoh", "Sanitization", "L", "={pa_naoh_cv}*{pa_cv}*{pa_cyc}", None, "ST-PROA-005, BUF-1006", "#,##0.0"),
        ("pa_pool", "Protein A eluate", "L", "={pa_pool_cv}*{pa_cv}*{pa_cyc}", None, "ST-PROA-007", "#,##0.0"),
        ("pa_waste", "Column waste", "L", "={hccf}+{pa_eq}+{pa_wash}+{pa_elu}+{pa_naoh}-{pa_pool}", None, "ST-PROA-006", "#,##0.0"),
        ("vi_acid_v", "VI titrant", "L", "={pa_pool}*{vi_acid}", None, "ST-PROA-008, BUF-1004", "#,##0.0"),
        ("vi_base_v", "Neutralization", "L", "={pa_pool}*{vi_base}", None, "ST-PROA-009, BUF-1005", "#,##0.0"),
        ("vi_pool", "Neutralized VI pool = depth filtrate", "L", "={pa_pool}+{vi_acid_v}+{vi_base_v}", None, "ST-PROA-010, -012, ST-PROA-CEX", "#,##0.0"),
        ("df_n", "Depth filter capsules", "EA", "=ROUNDUP({vi_pool}/{df_cap}/{df_area},0)", None, "FLT-0001", "0"),
        ("df_flush_v", "Depth filter flush", "L", "={df_n}*{df_area}*{df_flush}", None, "ST-PROA-011, WFI", "#,##0.0"),
    ]),
    ("Results: CEX", [
        ("cex_wfi", "Load dilution (WFI)", "L", "={vi_pool}*{cex_dil}", None, "ST-CEX-001", "#,##0.0"),
        ("cex_load", "CEX load", "L", "={vi_pool}+{cex_wfi}", None, "ST-CEX-002", "#,##0.0"),
        ("cex_cyc", "CEX cycles", "cycles", "=ROUNDUP({mass}/({cex_dbc}*{cex_cv}),0)", None, "", "0"),
        ("cex_eq", "Equilibration and wash buffer", "L", "={cex_eq_cv}*{cex_cv}*{cex_cyc}", None, "ST-CEX-003, BUF-2001", "#,##0.0"),
        ("cex_elu", "Elution buffer", "L", "={cex_elu_cv}*{cex_cv}*{cex_cyc}", None, "ST-CEX-004, BUF-2002", "#,##0.0"),
        ("cex_strip", "Strip", "L", "={cex_strip_cv}*{cex_cv}*{cex_cyc}", None, "ST-CEX-005, BUF-2003", "#,##0.0"),
        ("cex_naoh", "Sanitization", "L", "={cex_naoh_cv}*{cex_cv}*{cex_cyc}", None, "ST-CEX-006, BUF-1006", "#,##0.0"),
        ("cex_pool", "CEX pool", "L", "={cex_pool_cv}*{cex_cv}*{cex_cyc}", None, "ST-CEX-MMC", "#,##0.0"),
        ("cex_waste", "Column waste", "L", "={cex_load}+{cex_eq}+{cex_elu}+{cex_strip}+{cex_naoh}-{cex_pool}", None, "ST-CEX-007", "#,##0.0"),
    ]),
    ("Results: MMC", [
        ("mmc_adj_v", "Load pH adjustment", "L", "={cex_pool}*{mmc_adj}", None, "ST-MMC-001, BUF-1005", "#,##0.0"),
        ("mmc_load", "MMC load", "L", "={cex_pool}+{mmc_adj_v}", None, "ST-MMC-002", "#,##0.0"),
        ("mmc_cyc", "MMC cycles", "cycles", "=ROUNDUP({mass}/({mmc_load_g}*{mmc_cv}),0)", None, "", "0"),
        ("mmc_eq", "Equilibration and chase buffer", "L", "=({mmc_eq_cv}+{mmc_chase_cv})*{mmc_cv}*{mmc_cyc}", None, "ST-MMC-003, BUF-3001", "#,##0.0"),
        ("mmc_naoh", "Sanitization", "L", "={mmc_naoh_cv}*{mmc_cv}*{mmc_cyc}", None, "ST-MMC-004, BUF-1006", "#,##0.0"),
        ("mmc_waste", "Column waste", "L", "={mmc_eq_cv}*{mmc_cv}*{mmc_cyc}+{mmc_naoh}", None, "ST-MMC-005", "#,##0.0"),
        ("mmc_pool", "Flow-through pool", "L", "={mmc_load}+{mmc_chase_cv}*{mmc_cv}*{mmc_cyc}", None, "ST-MMC-VF", "#,##0.0"),
    ]),
    ("Results: VF", [
        ("vf_n", "Prefilter and virus filter capsules (each)", "EA", "=ROUNDUP({mmc_pool}/{vf_cap}/{vf_area},0)", None, "FLT-0003, FLT-0004", "0"),
        ("vf_flush_v", "Filter flush (to drain)", "L", "={vf_n}*{vf_area}*{vf_flush}", None, "ST-VF-003", "#,##0.0"),
        ("vf_chase_v", "Chase", "L", "={vf_n}*{vf_area}*{vf_chase}", None, "", "#,##0.0"),
        ("vf_buf", "Flush and chase buffer", "L", "={vf_flush_v}+{vf_chase_v}", None, "ST-VF-002, BUF-3001", "#,##0.0"),
        ("vf_pre", "Prefiltrate (pool, flush and chase)", "L", "={mmc_pool}+{vf_buf}", None, "ST-VF-001", "#,##0.0"),
        ("vf_filtrate", "Virus filtrate", "L", "={mmc_pool}+{vf_chase_v}", None, "ST-VF-UFDF, ST-UFDF-001", "#,##0.0"),
    ]),
    ("Results: UFDF, FILL, STOR", [
        ("uf1", "UF1 retentate", "L", "={mass}/{uf_c1}", None, "", "#,##0.0"),
        ("uf_df", "Diafiltration buffer", "L", "={uf1}*{uf_dv}", None, "ST-UFDF-003, BUF-5001", "#,##0.0"),
        ("uf2", "UF2 retentate", "L", "={mass}/{uf_c2}", None, "", "#,##0.0"),
        ("uf_chase_v", "Recovery chase", "L", "={uf2}*{uf_chase}", None, "", "#,##0.0"),
        ("uf_spike_v", "Excipient spike", "L", "=({uf2}+{uf_chase_v})*{uf_spike}", None, "ST-UFDF-004, BUF-5002", "#,##0.0"),
        ("uf_n", "UF cassettes", "EA", "=ROUNDUP({mass}/{uf_load}/{uf_area},0)", None, "FLT-0005", "0"),
        ("uf_flush_v", "Flush, equilibration and recovery chase", "L", "={uf_n}*{uf_area}*{uf_flush}+{uf_chase_v}", None, "ST-UFDF-005, BUF-5001", "#,##0.0"),
        ("uf_naoh_v", "Sanitization", "L", "={uf_n}*{uf_area}*{uf_naoh}", None, "ST-UFDF-006, BUF-1006", "#,##0.0"),
        ("uf_perm", "Permeate (with flush and sanitization)", "L", "={vf_filtrate}+{uf_df}-{uf2}+{uf_n}*{uf_area}*{uf_flush}+{uf_naoh_v}", None, "ST-UFDF-002", "#,##0.0"),
        ("ds", "Formulated bulk drug substance", "L", "={uf2}+{uf_chase_v}+{uf_spike_v}", None, "ST-UFDF-007 … ST-FILL-STOR", "#,##0.0"),
        ("ds_conc", "Drug substance concentration", "g/L", "={mass}/{ds}", None, "Check", "0.0"),
        ("bottles", "Bulk DS bottles", "EA", "=ROUNDUP({ds}/{fill_vol},0)", None, "CON-0001", "0"),
    ]),
]

# PCS_LINK: (stream, matcode or None, unit, result key, note). Flow rows label the PFD; material rows feed the BOM.
LINK = [
    ("ST-PROA-001", None, "L", "hccf", "HCCF load from harvest"),
    ("ST-PROA-002", None, "L", "pa_eq", "Equilibration and wash buffer"),
    ("ST-PROA-002", "BUF-1001-B", "L", "pa_eq_bag", "Sending site: 200 L bags"),
    ("ST-PROA-002", "BUF-1001-T", "L", "pa_eq_tank", "Receiving site: 2,000 L tank"),
    ("ST-PROA-003", None, "L", "pa_wash", "Intermediate wash buffer"),
    ("ST-PROA-003", "BUF-1002", "L", "pa_wash", ""),
    ("ST-PROA-004", None, "L", "pa_elu", "Elution buffer"),
    ("ST-PROA-004", "BUF-1003", "L", "pa_elu", ""),
    ("ST-PROA-005", None, "L", "pa_naoh", "Sanitization"),
    ("ST-PROA-005", "BUF-1006", "L", "pa_naoh", ""),
    ("ST-PROA-006", None, "L", "pa_waste", "Column waste to drain"),
    ("ST-PROA-007", None, "L", "pa_pool", "Protein A eluate"),
    ("ST-PROA-008", None, "L", "vi_acid_v", "VI titrant"),
    ("ST-PROA-008", "BUF-1004", "L", "vi_acid_v", ""),
    ("ST-PROA-009", None, "L", "vi_base_v", "Neutralization"),
    ("ST-PROA-009", "BUF-1005", "L", "vi_base_v", ""),
    ("ST-PROA-010", None, "L", "vi_pool", "Neutralized VI pool"),
    ("ST-PROA-010", "FLT-0001", "EA", "df_n", "Depth filter capsules"),
    ("ST-PROA-011", None, "L", "df_flush_v", "Depth filter flush"),
    ("ST-PROA-011", "UTL-0001", "L", "df_flush_v", "WFI flush"),
    ("ST-PROA-012", None, "L", "vi_pool", "Depth filtrate"),
    ("ST-PROA-CEX", None, "L", "vi_pool", "Depth filtrate to CEX"),
    ("ST-CEX-001", None, "L", "cex_wfi", "Load dilution"),
    ("ST-CEX-001", "UTL-0001", "L", "cex_wfi", "WFI"),
    ("ST-CEX-002", None, "L", "cex_load", "CEX load"),
    ("ST-CEX-003", None, "L", "cex_eq", "Equilibration and wash buffer"),
    ("ST-CEX-003", "BUF-2001", "L", "cex_eq", ""),
    ("ST-CEX-004", None, "L", "cex_elu", "Elution buffer"),
    ("ST-CEX-004", "BUF-2002", "L", "cex_elu", ""),
    ("ST-CEX-005", None, "L", "cex_strip", "Strip"),
    ("ST-CEX-005", "BUF-2003", "L", "cex_strip", ""),
    ("ST-CEX-006", None, "L", "cex_naoh", "Sanitization"),
    ("ST-CEX-006", "BUF-1006", "L", "cex_naoh", ""),
    ("ST-CEX-007", None, "L", "cex_waste", "Column waste to drain"),
    ("ST-CEX-MMC", None, "L", "cex_pool", "CEX pool to MMC"),
    ("ST-MMC-001", None, "L", "mmc_adj_v", "Load pH adjustment"),
    ("ST-MMC-001", "BUF-1005", "L", "mmc_adj_v", ""),
    ("ST-MMC-002", None, "L", "mmc_load", "MMC load"),
    ("ST-MMC-003", None, "L", "mmc_eq", "Equilibration and chase buffer"),
    ("ST-MMC-003", "BUF-3001", "L", "mmc_eq", ""),
    ("ST-MMC-004", None, "L", "mmc_naoh", "Sanitization"),
    ("ST-MMC-004", "BUF-1006", "L", "mmc_naoh", ""),
    ("ST-MMC-005", None, "L", "mmc_waste", "Column waste to drain"),
    ("ST-MMC-VF", None, "L", "mmc_pool", "Flow-through pool to VF"),
    ("ST-VF-001", None, "L", "vf_pre", "Prefiltrate"),
    ("ST-VF-001", "FLT-0003", "EA", "vf_n", "Prefilter capsules"),
    ("ST-VF-001", "FLT-0004", "EA", "vf_n", "Virus filter capsules"),
    ("ST-VF-002", None, "L", "vf_buf", "Flush and chase buffer"),
    ("ST-VF-002", "BUF-3001", "L", "vf_buf", ""),
    ("ST-VF-003", None, "L", "vf_flush_v", "Filter flush to drain"),
    ("ST-VF-UFDF", None, "L", "vf_filtrate", "Virus filtrate to UF/DF"),
    ("ST-UFDF-001", None, "L", "vf_filtrate", "UF feed"),
    ("ST-UFDF-001", "FLT-0005", "EA", "uf_n", "UF cassettes"),
    ("ST-UFDF-002", None, "L", "uf_perm", "Permeate to drain"),
    ("ST-UFDF-003", None, "L", "uf_df", "Diafiltration buffer"),
    ("ST-UFDF-003", "BUF-5001", "L", "uf_df", ""),
    ("ST-UFDF-004", None, "L", "uf_spike_v", "Excipient spike"),
    ("ST-UFDF-004", "BUF-5002", "L", "uf_spike_v", ""),
    ("ST-UFDF-005", None, "L", "uf_flush_v", "Flush, equilibration, recovery chase"),
    ("ST-UFDF-005", "BUF-5001", "L", "uf_flush_v", ""),
    ("ST-UFDF-006", None, "L", "uf_naoh_v", "Sanitization"),
    ("ST-UFDF-006", "BUF-1006", "L", "uf_naoh_v", ""),
    ("ST-UFDF-007", None, "L", "ds", "Formulated bulk"),
    ("ST-UFDF-FILL", None, "L", "ds", "Formulated bulk to fill"),
    ("ST-UFDF-FILL", "CON-0001", "EA", "bottles", "Bulk DS bottles"),
    ("ST-FILL-001", None, "L", "ds", "Filtered bulk"),
    ("ST-FILL-002", None, "L", "fill_flush", "Filter flush"),
    ("ST-FILL-002", "BUF-5001", "L", "fill_flush", ""),
    ("ST-FILL-003", None, "L", "ds", "Filled bottles"),
    ("ST-FILL-STOR", None, "L", "ds", "Bulk DS to -70 °C storage"),
]


def header(ws, row, n):
    for c in range(1, n + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill, cell.font, cell.border = HEAD_FILL, HEAD_FONT, BOX
        cell.alignment = Alignment(horizontal="center")


def write_materials(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Materials"
    ws.append(["Code", "Name", "Unit", "Category", "Spec", "Overage %", "Note"])
    for code, name, unit, cat, spec, ovg in MATERIALS:
        ws.append([code, name, unit, cat, spec, ovg, None])
    by = {m[0]: m for m in MATERIALS}
    rs = wb.create_sheet("Recipes")
    rs.append(["Code", "Name", "Per", "Unit", "Component code", "Component", "Quantity", "Component unit", "Basis", "Batch size", "Whole batches", "Note"])
    for code, (comps, note) in RECIPES.items():
        for i, (c, q) in enumerate(comps):
            rs.append([code, by[code][1], 1000, by[code][2], c, by[c][1], q, by[c][2], None, None, None, note if i == 0 else None])
    for code, (batch, whole, comps, note) in BATCH_RECIPES.items():
        for i, (c, q, basis) in enumerate(comps):
            rs.append([code, by[code][1], 1000, by[code][2], c, by[c][1], q, by[c][2], "Per batch" if basis else None, batch, "Yes" if whole else None, note if i == 0 else None])
    bs = wb.create_sheet("Backups")
    bs.append(["Code", "Name", "Backup code", "Backup", "Ratio", "Note"])
    for p, b, ratio, note in BACKUPS:
        bs.append([p, by[p][1], b, by[b][1], ratio if ratio is not None else 1, note])
    for sheet, widths in ((ws, (12, 58, 7, 12, 16, 10, 20)), (rs, (12, 50, 7, 6, 15, 36, 10, 14, 11, 11, 13, 60)), (bs, (12, 36, 12, 44, 7, 46))):
        header(sheet, 1, len(widths))
        sheet.freeze_panes = "A2"
        for i, w in enumerate(widths):
            sheet.column_dimensions[chr(65 + i)].width = w
    wb.save(path)


def write_mb(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "MB_calc"
    ws["A1"] = "Example downstream mass balance: mAb, HCCF from 2,000 L (Sending) or 15,000 L (Receiving)"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = "Yellow cells are inputs. Results below feed the PCS_LINK sheet. Made-up numbers; no step yields."
    ws["A2"].font = Font(italic=True, color="666666")
    for i, h in enumerate(["Item", "Unit", "Sending", "Receiving", "Note"], 1):
        ws.cell(row=3, column=i, value=h)
    header(ws, 3, 5)
    rows = {}
    r = 4
    plan = []
    for title, items in SECTIONS:
        plan.append((r, title, None))
        r += 1
        for item in items:
            rows[item[0]] = r
            plan.append((r, None, item))
            r += 1
    for row, title, item in plan:
        if title:
            ws.cell(row=row, column=1, value=title).font = SECTION_FONT
            continue
        key, label, unit, s, rv, note, fmt = item
        is_input = rv is not None
        def formula(v, col):
            if isinstance(v, str) and v.startswith("="):
                return "=" + v[1:].format(**{k: f"{col}{n}" for k, n in rows.items()})
            return v
        sv = formula(s, "C")
        if rv is None:
            dv = formula(s, "D")
        elif rv == "=":
            dv = f"=C{row}"
        else:
            dv = rv
        for c, v in enumerate((label, unit, sv, dv, note), start=1):
            ws.cell(row=row, column=c, value=v).border = BOX
        for c in (3, 4):
            ws.cell(row=row, column=c).number_format = fmt
        if is_input:
            ws.cell(row=row, column=3).fill = INPUT_FILL
            if rv != "=":
                ws.cell(row=row, column=4).fill = INPUT_FILL
    for col, w in zip("ABCDE", (46, 13, 12, 12, 40)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A4"

    link = wb.create_sheet("PCS_LINK")
    head = ["StreamID", "MatCode", "Unit", "Sending", "Receiving", "Note"]
    link.append(head)
    header(link, 1, len(head))
    for i, (sid, mat, unit, key, note) in enumerate(LINK, start=2):
        n = rows[key]
        vals = (sid, mat, unit, f"=MB_calc!C{n}", f"=MB_calc!D{n}", note or None)
        for c, v in enumerate(vals, start=1):
            if v is None:
                continue
            cell = link.cell(row=i, column=c, value=v)
            cell.border = BOX
            if c in (4, 5):
                cell.number_format = "0" if unit == "EA" else "#,##0.0##"
    for col, w in zip("ABCDEF", (14, 11, 6, 12, 12, 40)):
        link.column_dimensions[col].width = w
    link.freeze_panes = "A2"
    wb.save(path)


if __name__ == "__main__":
    work = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    work.mkdir(parents=True, exist_ok=True)
    write_materials(Path("examples/downstream-materials.xlsx"))
    write_mb(work / "MB_downstream_raw.xlsx")
    print("wrote examples/downstream-materials.xlsx and", work / "MB_downstream_raw.xlsx")
