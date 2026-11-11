/**
 * Text of the in-app guide, in English and Korean: the seven linking steps (why, how, where to go),
 * help for each screen, and the rules on one page. Keep both languages saying the same thing.
 */
import type { Bilingual, StepId, StepState } from "./status";

export type Lang = "en" | "ko";
export type GoTarget = "materials" | "map" | "pfd" | "operations" | "mb" | "bom" | "link";
export type Screen = "pfd" | "operations" | "mb" | "bom" | "materials";

const b = (en: string, ko: string): Bilingual => ({ en, ko });

export const UI = {
  title: b("Guide", "가이드"),
  steps: b("Linking steps", "연동 절차"),
  screen: b("This screen", "이 화면"),
  rules: b("Rules", "규칙"),
  close: b("Close the guide", "가이드 닫기"),
  next: b("Next", "다음"),
  progress: b("{n} of 7 done", "7단계 중 {n}단계 완료"),
  allDone: b("All seven steps are done: PFD, Mass Balance and BOM are linked.", "7단계를 모두 마쳤습니다. PFD·Mass Balance·BOM이 연동되어 있습니다."),
  intro: b(
    "The PFD makes the Stream IDs, the MB workbook gives a value per Stream ID, the material list gives codes and units, and the BOM adds them up. Work through the steps in order; each one shows what the project has now.",
    "PFD가 Stream ID를 만들고, MB 워크북이 Stream ID마다 값을 주고, 자재 목록이 코드와 단위를 주면, BOM이 합산합니다. 순서대로 진행하세요. 단계마다 지금 프로젝트 상태가 표시됩니다.",
  ),
  how: b("How", "방법"),
} as const;

export const STATE_LABEL: Record<StepState, Bilingual> = {
  done: b("Done", "완료"),
  todo: b("To do", "할 일"),
  check: b("Check", "확인"),
  wait: b("Waiting", "대기"),
};

export interface StepText { title: Bilingual; why: Bilingual; how: Bilingual[]; go: { label: Bilingual; to: GoTarget } }

export const STEPS: Record<StepId, StepText> = {
  materials: {
    title: b("List the materials", "자재 목록 만들기"),
    why: b(
      "Every material has one code and one unit. The MB workbook (MatCode), the PFD links and the BOM all find a material by its code, in its unit.",
      "자재마다 코드 하나와 단위 하나를 정합니다. MB 워크북(MatCode), PFD 연결, BOM이 모두 이 코드와 단위로 자재를 찾습니다.",
    ),
    how: [
      b("Materials › Import Excel/CSV (or Add material). A code used twice turns red: fix it.", "Materials › Import Excel/CSV(또는 Add material). 두 번 쓰인 코드는 빨간색이 되니 고칩니다."),
      b("A buffer or medium made in-house: + Recipe, with its components per 1,000 L.", "직접 만드는 버퍼·배지: + Recipe에서 1,000 L당 성분을 적습니다."),
      b("Made in bags or tank batches: set the Batch size and count the bag or filter “per batch”. The BOM rounds the number of batches up.", "Bag이나 탱크 배치로 만들면: Batch size를 넣고 Bag·필터는 “per batch”로 셉니다. BOM이 배치 수를 올림으로 계산합니다."),
      b("One composition, several ways of preparing it: keep one code for the solution and one code per way (e.g. BUF-1001-B in bags, BUF-1001-T in a tank) whose recipe uses the solution.", "조성은 같고 준비 방식만 다르면: 용액 코드 하나 + 방식별 코드(예: Bag용 BUF-1001-B, 탱크용 BUF-1001-T)를 두고, 방식별 레시피가 용액을 성분으로 씁니다."),
      b("Another supplier for the same material: + Backup (listed, never added to the totals).", "같은 자재의 다른 공급처: + Backup(목록에만 나오고 합계에는 더하지 않음)."),
    ],
    go: { label: b("Open Materials", "Materials 열기"), to: "materials" },
  },
  map: {
    title: b("Draw the process map", "공정 맵 그리기"),
    why: b(
      "Each box is a unit operation with a code (PROA, CEX …). An arrow between two boxes is a transfer, ST-PROA-CEX; materials on a transfer count for the receiving unit operation.",
      "상자 하나가 단위공정(코드: PROA, CEX …)입니다. 상자 사이 화살표는 이송(ST-PROA-CEX)이고, 이송에 연결된 자재는 받는 단위공정에 집계됩니다.",
    ),
    how: [
      b("PFD › Process map: place the boxes from left to right in process order. Tabs, BOM sections and slides follow this order.", "PFD › Process map: 상자를 공정 순서대로 왼쪽→오른쪽에 놓습니다. 탭·BOM 구역·슬라이드 순서가 이를 따릅니다."),
      b("Draw an arrow from a box to the next one: it gets its Stream ID by itself, and both drawings get a connector.", "상자에서 다음 상자로 화살표를 그리면 Stream ID가 자동으로 붙고, 양쪽 도면에 연결 기호가 생깁니다."),
      b("Check codes and names in the Units tab (or double-click a box: first line the code, then the name).", "Units 탭에서 코드·이름을 확인합니다(상자 더블클릭: 첫 줄 코드, 다음 줄 이름)."),
    ],
    go: { label: b("Open the process map", "공정 맵 열기"), to: "map" },
  },
  drawings: {
    title: b("Draw each unit operation", "단위공정 도면 그리기"),
    why: b(
      "Arrows inside a unit operation get IDs like ST-PROA-001. These IDs are the key the MB workbook uses to give values.",
      "단위공정 안의 화살표는 ST-PROA-001 같은 ID를 받습니다. MB 워크북은 이 ID로 값을 연결합니다.",
    ),
    how: [
      b("Open the unit operation's tab, place symbols from the Symbols tab and draw the stream arrows between them.", "단위공정 탭을 열고 Symbols 탭에서 심볼을 놓은 뒤 그 사이에 스트림 화살표를 그립니다."),
      b("Select an arrow to give it a Stream name. Arrows that are only drawing: tick “Not a process stream”.", "화살표를 선택해 Stream name을 적습니다. 그림일 뿐인 화살표는 “Not a process stream”에 체크합니다."),
      b("Parts you count in pieces (filters, bags, lines): select the symbol or arrow › Linked materials.", "개수로 세는 자재(필터, Bag, 라인): 심볼이나 화살표를 선택 › Linked materials."),
      b("Streams tab › Copy list gives the IDs for your PCS_LINK sheet.", "Streams 탭 › Copy list로 PCS_LINK에 넣을 ID 목록을 복사합니다."),
      b("Deleted an arrow by mistake? Ctrl+Z brings it back with the same ID.", "화살표를 잘못 지웠다면 Ctrl+Z로 같은 ID와 함께 되돌립니다."),
    ],
    go: { label: b("Open the PFD", "PFD 열기"), to: "pfd" },
  },
  workbook: {
    title: b("Fill PCS_LINK in the MB workbook", "MB 워크북에 PCS_LINK 채우기"),
    why: b(
      "The app reads one sheet of your workbook, PCS_LINK, with one row per value. Your own calculation sheets stay as they are.",
      "앱은 워크북에서 PCS_LINK 시트 하나만 읽습니다(값 하나에 한 행). 계산 시트는 그대로 둡니다.",
    ),
    how: [
      b("Mass Balance › New workbook in GridCraft, or Download PCS_LINK sheet and copy it into your Excel file.", "Mass Balance › New workbook in GridCraft, 또는 Download PCS_LINK sheet로 받아 내 Excel 파일에 넣습니다."),
      b("Columns: StreamID, MatCode, Unit, Sending, Receiving, Note.", "열: StreamID, MatCode, Unit, Sending, Receiving, Note."),
      b("Flow row: MatCode empty, one per stream (for the PFD label). Material row: MatCode filled in (for the BOM).", "흐름 행: MatCode 비움, 스트림마다 1개(PFD 라벨용). 물질 행: MatCode 기입(BOM용)."),
      b("Values can be formulas, e.g. =MB_calc!D12. Material rows use the unit of the material list.", "값은 수식도 됩니다(예: =MB_calc!D12). 물질 행의 단위는 자재 목록과 같아야 합니다."),
      b("Merged cells: StreamID, MatCode or Unit merged down is read on every row; quantities are not merged (each row its own number); a formula points to the top-left cell of merged cells. A title row above the headers is fine.", "셀 병합: StreamID·MatCode·Unit을 세로 병합하면 각 행에 같은 값으로 읽힙니다. 수량은 병합하지 않습니다(행마다 따로). 수식은 병합된 칸의 왼쪽 위 칸을 가리킵니다. 헤더 위의 제목 행은 괜찮습니다."),
      b("GridCraft: Ctrl+S saves and checks. Excel: save, then Upload Excel workbook… or Replace….", "GridCraft: Ctrl+S로 저장과 검사. Excel: 저장한 뒤 Upload Excel workbook… 또는 Replace…."),
    ],
    go: { label: b("Open Mass Balance", "Mass Balance 열기"), to: "mb" },
  },
  apply: {
    title: b("Check, then apply", "검사 후 적용"),
    why: b(
      "Saving the workbook does not change the PFD labels or the BOM. They change when you apply its values.",
      "워크북을 저장해도 PFD 라벨과 BOM은 바뀌지 않습니다. 값을 적용해야 바뀝니다.",
    ),
    how: [
      b("Check of PCS_LINK: fix every error; the Cell column says where.", "Check of PCS_LINK: 오류를 모두 고칩니다. Cell 열이 위치를 알려 줍니다."),
      b("Changes against the applied values: see what will change before it does.", "Changes against the applied values: 무엇이 바뀔지 미리 확인합니다."),
      b("Apply to PFD and BOM. History keeps a line for each application.", "Apply to PFD and BOM. History에 적용할 때마다 한 줄씩 남습니다."),
    ],
    go: { label: b("Open Mass Balance", "Mass Balance 열기"), to: "mb" },
  },
  bom: {
    title: b("Check the BOM", "BOM 확인"),
    why: b(
      "Each line counts one source: MB (default), PFD counts or Manual. Quantity = source value × (1 + overage %).",
      "줄마다 출처 하나를 셉니다: MB(기본), PFD 개수, Manual. 수량 = 출처 값 × (1 + 여유율 %).",
    ),
    how: [
      b("Orange text under a line is to check: no value, a manual line without a reason, an MB value left out.", "줄 아래 주황 글자가 확인할 것입니다: 값 없음, 사유 없는 수동 줄, 빠진 MB 값."),
      b("↳ Recipe rows are the components of a prepared material; a material made in batches shows the batches, rounded up.", "↳ Recipe 줄은 만드는 자재의 성분입니다. 배치로 만드는 자재는 배치 수(올림)가 표시됩니다."),
      b("⇄ Backup rows are alternates, kept out of the totals.", "⇄ Backup 줄은 대체 자재로, 합계에서 제외됩니다."),
      b("Totals per material = what to buy; Prepared in-house = what to make. Export to Excel for the sheets.", "Totals per material = 살 것, Prepared in-house = 만들 것. Export to Excel로 엑셀 시트를 받습니다."),
      b("Before you hand the BOM over: Save revision… (Rev A). Later changes are marked on the lines, and Revisions compares any two.", "BOM을 넘기기 전에 Save revision…(Rev A)으로 저장합니다. 이후 바뀐 줄이 표시되고, Revisions에서 아무 두 리비전이나 비교합니다."),
    ],
    go: { label: b("Open BOM", "BOM 열기"), to: "bom" },
  },
  linked: {
    title: b("Keep it linked", "연동 유지"),
    why: b(
      "The link status (title bar, top right) checks the PFD, the Mass Balance, the BOM and the material list all the time. Values that no longer match are left out of the BOM, and it says why.",
      "연동 표시(제목 표시줄 오른쪽 위)가 PFD·Mass Balance·BOM·자재 목록을 계속 점검합니다. 더 이상 맞지 않는 값은 BOM에서 빠지고 이유가 표시됩니다.",
    ),
    how: [
      b("Changed the MB: save it, then apply again.", "MB를 고쳤으면: 저장한 뒤 다시 적용합니다."),
      b("Deleted a stream on the PFD: Ctrl+Z, or remove its rows from PCS_LINK and apply.", "PFD에서 스트림을 지웠으면: Ctrl+Z, 또는 PCS_LINK에서 그 행을 지우고 적용합니다."),
      b("Changed a material code: “Update the MB workbook too” on Materials changes PCS_LINK for you. Changed a unit: change PCS_LINK yourself, then apply.", "자재 코드를 바꿨으면: Materials의 “Update the MB workbook too”가 PCS_LINK를 대신 고칩니다. 단위를 바꿨으면 PCS_LINK를 직접 고치고 적용합니다."),
      b("A material to phase out: Replace… (or set it Obsolete first to see where it is still used).", "단계적으로 없앨 자재: Replace…(먼저 Obsolete로 표시하면 아직 쓰이는 곳이 표시됩니다)."),
      b("“Link check: n to fix” in orange: click it, then Open … next to each item.", "주황색 “Link check: n to fix”: 눌러서 항목마다 Open …으로 고칠 화면에 갑니다."),
      b("Changing or replacing a material: click its code (BOM) or its Used count (Materials) to see every place that uses it first.", "자재를 바꾸거나 교체할 때: 먼저 코드(BOM)나 Used 숫자(Materials)를 눌러 쓰이는 곳을 모두 확인합니다."),
    ],
    go: { label: b("Open the link check", "연동 점검 열기"), to: "link" },
  },
};

export const SCREENS: Record<Screen, { title: Bilingual; items: Bilingual[] }> = {
  pfd: {
    title: b("PFD", "PFD"),
    items: [
      b("Tabs: Process map, one tab per unit operation, + Unit operation. Fit, Step view and Export to PowerPoint… are in the ribbon.", "탭: Process map, 단위공정마다 탭 하나, + Unit operation. Fit, Step view, Export to PowerPoint…는 리본에 있습니다."),
      b("Side panel: Symbols, Units, Streams. Drag its left edge to make it wider; double-click for the default width.", "오른쪽 패널: Symbols, Units, Streams. 왼쪽 경계를 끌어 넓히고, 더블클릭하면 기본 너비."),
      b("Units: ⧉ duplicates a unit operation (drawing, steps, BOM lines, equipment with new tags); transfers are drawn again on the map.", "Units: ⧉로 단위공정 복제(도면·단계·BOM 줄·새 태그의 장비). 이송은 공정 맵에서 다시 그립니다."),
      b("Select an arrow: Stream ID, route, MB values, Stream name, and lines or parts linked on it.", "화살표 선택: Stream ID, 경로, MB 값, Stream name, 화살표에 연결한 라인·부품."),
      b("Select a symbol: Linked materials, counted in pieces for the BOM of this unit operation.", "심볼 선택: Linked materials. 이 단위공정 BOM에 개수로 들어갑니다."),
      b("Select a valve, pump or agitator: Equipment tag (XV-101 …). The tag becomes the first line of its label and links it to the steps on Operations.", "밸브·펌프·교반기 선택: Equipment tag(XV-101 등). 태그가 라벨 첫 줄에 쓰이고 Operations의 단계와 연결됩니다."),
      b("Step view (ribbon, on a unit operation's drawing): pick a step; tagged valves show open (green) or closed (grey), ▶ = switched in that step, the step's streams in blue.", "Step view(리본, 단위공정 도면에서): 단계를 고르면 태그가 붙은 밸브가 열림(초록)·닫힘(회색)으로, ▶ = 그 단계에서 바뀐 것, 그 단계의 스트림은 파란색으로 보입니다."),
      b("Labels show ID / name / value; what the value line shows is set on Mass Balance › PFD labels show.", "라벨은 ID / 이름 / 값 3줄. 값 줄의 표시 방식은 Mass Balance › PFD labels show에서 정합니다."),
      b("Click the drawing once, then Ctrl+Z / Ctrl+Y to undo or redo.", "도면을 한 번 클릭한 뒤 Ctrl+Z / Ctrl+Y로 되돌리기·다시."),
      b("Start here (an empty project): Open a project file…, Add a unit operation, or Open the example (view only). The example has a yellow bar and is not saved: Close example (or a reload) brings your project back as it was, Keep as my project… keeps the example. New offers it too.", "Start here(빈 프로젝트): Open a project file…, Add a unit operation, 또는 Open the example (view only). 예제는 노란 막대와 함께 열리고 저장되지 않습니다: Close example(또는 새로고침)로 내 프로젝트가 그대로 돌아오고, Keep as my project…를 누르면 예제를 내 프로젝트로 씁니다. New 창에서도 열 수 있습니다."),
    ],
  },
  operations: {
    title: b("Operations", "Operations"),
    items: [
      b("Sheets at the bottom: one per unit operation (from the PFD) and Equipment. Each unit operation has its steps, in order.", "아래 시트 탭: 단위공정마다 한 장(PFD에서 옴)과 Equipment. 단위공정마다 단계를 순서대로 적습니다."),
      b("Ribbon: + Step, or Add steps from a template (chromatography, UF/DF, virus filtration, buffer preparation …) and change them to fit; Steps & actions / State table; Show on PFD.", "리본: + Step, 또는 템플릿(크로마토그래피·UF/DF·바이러스 여과·버퍼 조제 등)으로 시작한 뒤 맞게 고칩니다. Steps & actions / State table 전환, Show on PFD."),
      b("Steps & actions: per step its minutes, the Stream IDs that flow (with the applied MB value) and the actions, each one line as in Excel. Click the cell or its ▾ (or select it and press Alt+↓ or F2) for the list: + Stream, + Action › tag › Open/Close or Start/Stop, × to remove. Esc or a click elsewhere closes it.", "Steps & actions: 단계마다 시간(분), 흐르는 Stream ID(적용된 MB 값과 함께), 동작이 Excel처럼 한 줄로 나옵니다. 칸이나 ▾를 누르면(또는 칸을 고르고 Alt+↓ / F2) 목록이 열립니다: + Stream, + Action › 태그 › Open/Close 또는 Start/Stop, ×로 빼기. Esc나 다른 곳을 누르면 닫힙니다."),
      b("State table: equipment × steps. Click a cell to switch Open/Closed or On/Off; bold = an action in that step, grey = kept from the step before. Double-click for a value (50 %, 150 rpm).", "State table: 설비 × 단계. 칸을 누르면 Open/Closed, On/Off가 바뀝니다. 굵게 = 그 단계의 동작, 회색 = 앞 단계 상태 유지. 더블클릭하면 값(50 %, 150 rpm) 입력."),
      b("Equipment: tags from the PFD come in by themselves; add others here. A tag changed here changes on the PFD label too.", "Equipment: PFD에서 준 태그는 저절로 들어오고, 그 밖의 설비는 여기서 추가합니다. 여기서 태그를 바꾸면 PFD 라벨도 바뀝니다."),
      b("Show on PFD: the drawing with the step view. ‹ › on an action (in the Actions list) move it earlier or later in its step.", "Show on PFD: 단계 보기가 켜진 도면으로 갑니다. Actions 목록에서 동작의 ‹ ›로 단계 안 순서를 바꿉니다."),
      b("Export to Excel: Equipment, Steps, Actions and a States sheet per unit operation. Import from Excel reads them back (Korean words like 열림/닫힘 work).", "Export to Excel: Equipment, Steps, Actions와 단위공정별 States 시트. Import from Excel로 다시 읽습니다(열림/닫힘 같은 한국어도 됨)."),
    ],
  },
  mb: {
    title: b("Mass Balance", "Mass Balance"),
    items: [
      b("Ribbon › Workbook: Edit in GridCraft, Replace…, Download, Download PCS_LINK sheet, Remove. The bar under the title says the file's state: applied, changes to apply, or errors.", "리본 › Workbook: Edit in GridCraft, Replace…, Download, Download PCS_LINK sheet, Remove. 제목 아래 막대가 파일 상태(적용됨, 적용할 변경, 오류)를 알려 줍니다."),
      b("Sheets at the bottom, as in Excel: Streams, Material totals, Check, Changes, History. Click a value: the formula bar shows its PCS_LINK cell and formula (e.g. =MB_calc!C57).", "아래쪽 시트 탭(Excel처럼): Streams, Material totals, Check, Changes, History. 값을 클릭하면 수식 입력줄에 그 값의 PCS_LINK 칸과 수식(예: =MB_calc!C57)이 나옵니다."),
      b("Check sheet: errors V1–V8 with their cell. Apply stays off while there are errors.", "Check 시트: V1~V8 오류와 셀 위치. 오류가 있으면 Apply가 막힙니다."),
      b("Changes sheet (changed values in yellow), then Apply to PFD and BOM in the ribbon.", "Changes 시트(바뀐 값은 노란 칸)를 확인한 뒤 리본의 Apply to PFD and BOM."),
      b("Ribbon › Apply: PFD labels (and Active scenario), Your name, Scenarios…. Streams and Material totals sheets: the applied values (In the BOM: counted, or left out and why).", "리본 › Apply: PFD labels(와 Active scenario), Your name, Scenarios…. Streams·Material totals 시트: 적용된 값(In the BOM: 집계됨 또는 빠짐과 이유)."),
      b("History: one line per application, with the name in Your name.", "History: 적용할 때마다 한 줄, Your name의 이름이 함께 기록됩니다."),
      b("Scenarios…: add a scenario (e.g. a clinical batch), rename it, order them, set its PCS_LINK column; apply the workbook again to read a new column.", "Scenarios…: 시나리오 추가(예: 임상 배치), 이름·순서·PCS_LINK 열 변경. 새 열은 워크북을 다시 Apply해야 읽힙니다."),
    ],
  },
  bom: {
    title: b("BOM", "BOM"),
    items: [
      b("Sheets at the bottom: All (every unit operation and the totals), one per unit operation, Totals. In All, ▾ folds a unit operation (Fold all / Unfold all in the ribbon). Find, category and To check / Manual / Changed filters are in the ribbon.", "아래 시트 탭: All(모든 단위공정과 합계), 단위공정마다 한 장, Totals. All에서 ▾로 단위공정 접기(리본의 Fold all / Unfold all). 찾기·카테고리·To check / Manual / Changed 필터는 리본에."),
      b("Save revision… keeps the BOM as it is; lines changed since then show ▲/▼, New or Replaces (a material replaced with Replace…), removed lines stay in red. Revisions compares any two (lines, totals, and what changed on the materials, before → after) and exports the changes.", "Save revision…으로 지금 BOM을 저장하면, 이후 바뀐 줄에 ▲/▼·New·Replaces(Replace…로 교체한 자재)가 붙고 빠진 줄은 빨간 줄로 남습니다. Revisions에서 두 리비전을 비교(줄·합계·자재 변경 이전 → 이후)하고 변경 내역을 내보냅니다."),
      b("Click a material code: the material view — its facts, quantities per unit operation and scenario (total, packs, batches), and Where used (BOM, recipes, MB rows, PFD links, backups) with a button to each place.", "자재 코드를 누르면 자재 보기: 자재 정보, 단위공정·시나리오별 수량(합계·포장 수·배치 수), Where used(BOM·레시피·MB 행·PFD 연결·대체 자재)와 각 위치로 가는 버튼."),
      b("Source: MB, PFD, Manual or Not counted. Overage % empty = the material's default.", "Source: MB, PFD, Manual, Not counted. Overage % 빈칸 = 자재 기본값."),
      b("Each line is one row, as in Excel: what does not fit is cut off at the cell's edge. A corner mark means there is more to read (red: to fix, blue: changed since the revision, grey: a note); hover for all of it, or click the cell and read it in the formula bar.", "줄마다 Excel처럼 한 행: 칸에 다 안 들어가는 글은 칸 끝에서 잘립니다. 칸 오른쪽 위 삼각형은 더 읽을 내용이 있다는 표시(빨강: 고칠 것, 파랑: 리비전 이후 바뀜, 회색: 참고). 마우스를 올리거나 칸을 눌러 수식 입력줄에서 전부 봅니다."),
      b("A prepared material shows its recipe rows (↳); when made in batches, the Batches column shows them per scenario (10 / 0 × 200 L = Sending 10, Receiving 0 batches of 200 L).", "만드는 자재는 레시피 줄(↳)을 보여 주고, 배치로 만들면 Batches 열에 시나리오별 배치 수가 나옵니다(10 / 0 × 200 L = Sending 10, Receiving 0배치, 배치당 200 L)."),
      b("Hover a line for + Backup at the end of its Material cell. An obsolete material shows Replace… first in the cell. Reset = back to the automatic source and overage.", "줄에 마우스를 올리면 Material 칸 끝에 + Backup. 단종 자재는 칸 맨 앞에 Replace…. Reset = 자동 출처와 기본 여유율로."),
      b("Totals sheet (and the end of All): Totals per material, Prepared in-house (with batches), Backup materials. Drag a header edge to resize columns.", "Totals 시트(All의 끝에도): Totals per material, Prepared in-house(배치 수 포함), Backup materials. 머리글 경계를 끌어 열 너비 조절."),
    ],
  },
  materials: {
    title: b("Materials", "Materials"),
    items: [
      b("Sheets at the bottom: Material list, Recipes, Backups (the last two as the Excel export lists them, Edit… opens each). Code and unit are the keys of the links; a code used twice turns red.", "아래 시트 탭: Material list, Recipes, Backups(뒤의 둘은 Excel 내보내기와 같은 모양, Edit…로 열어 고침). 코드와 단위가 연동의 열쇠이고, 두 번 쓰인 코드는 빨간색."),
      b("Used: how many places use the material; click it for Where used before you change or delete it.", "Used: 자재를 쓰는 곳의 수. 바꾸거나 지우기 전에 눌러서 Where used를 확인합니다."),
      b("Status: In use, Under review or Obsolete. An obsolete material still used is flagged on the BOM and in the link check.", "Status: In use(사용 중), Under review(검토 중), Obsolete(단종). 단종 자재가 쓰이면 BOM과 연동 점검에 표시됩니다."),
      b("Replace…: use another material everywhere (BOM, recipes, PFD links, backups, the MB workbook when the units match); the old one becomes obsolete, replaced by the new one. The change log and the BOM revisions then say what replaced what.", "Replace…: 다른 자재로 한 번에 교체(BOM·레시피·PFD 연결·대체 목록, 단위가 같으면 MB 워크북까지). 옛 자재는 단종·교체됨으로 표시되고, 변경 이력과 BOM 리비전 비교에 무엇이 무엇으로 바뀌었는지 남습니다."),
      b("Changed a code? The yellow bar offers to change it in the MB workbook too, so the BOM keeps counting it.", "코드를 바꾸면 노란 막대가 MB 워크북도 함께 바꿀지 묻습니다. 그래야 BOM이 계속 집계합니다."),
      b("Import Excel/CSV shows a preview first, and also reads Recipes and Backups sheets. Export to Excel writes all three.", "Import Excel/CSV는 먼저 미리보기를 보여 주고 Recipes·Backups 시트도 읽습니다. Export to Excel은 세 시트를 씁니다."),
      b("Recipe: components per amount; Batch size and “per batch” for bags and filters; Try it shows what the BOM will count.", "Recipe: 기준량당 성분, Bag·필터는 Batch size와 “per batch”. Try it이 BOM 계산 결과를 미리 보여 줍니다."),
      b("Backups: alternates with a ratio. Delete also takes the material out of recipes and backup lists.", "Backups: 비율과 함께 대체 자재. Delete는 레시피·대체 목록에서도 함께 지웁니다."),
      b("Purchasing (ribbon › Find and filter, with Find and Status): supplier, part no. and pack size; the BOM totals then show whole packs to order.", "Purchasing(리본 › Find and filter, 찾기·Status와 함께): 공급사, 품번, 포장 단위. BOM 합계에 주문할 포장 수(올림)가 나옵니다."),
      b("Tick rows (the box after the row number) to edit them together or delete them; ↶ takes it back. Click a cell: the formula bar shows all of it, and a text cell can be edited there.", "행 번호 옆 칸을 체크하면 여러 자재를 한 번에 고치거나 지울 수 있습니다. ↶로 되돌립니다. 칸을 누르면 수식 입력줄에 전체 내용이 나오고, 글자 칸은 거기서도 고칩니다."),
    ],
  },
};

export const RULES: { title: Bilingual; rows: [Bilingual, Bilingual][] }[] = [
  {
    title: b("Stream IDs", "Stream ID"),
    rows: [
      [b("ST-PROA-001", "ST-PROA-001"), b("arrow inside PROA (001–999, given as you draw)", "PROA 안의 화살표(001~999, 그리는 순서대로 자동)")],
      [b("ST-PROA-CEX", "ST-PROA-CEX"), b("transfer from PROA to CEX; its materials count for CEX", "PROA → CEX 이송, 자재는 CEX에 집계")],
      [b("ST-PROA-CEX-2", "ST-PROA-CEX-2"), b("second transfer between the same two", "같은 두 단위공정 사이 두 번째 이송")],
      [b("IDs stay", "ID 유지"), b("never reused; a new code does not rename issued IDs; Ctrl+Z restores", "재사용 안 함, 코드를 바꿔도 기존 ID 유지, Ctrl+Z로 복구")],
    ],
  },
  {
    title: b("PCS_LINK", "PCS_LINK"),
    rows: [
      [b("Flow row", "흐름 행"), b("MatCode empty, one per stream → PFD label", "MatCode 비움, 스트림마다 1개 → PFD 라벨")],
      [b("Material row", "물질 행"), b("MatCode filled in, unit of the material list → BOM", "MatCode 기입, 자재 목록 단위 → BOM")],
      [b("Values", "값"), b("numbers or formulas (saved results), 0 or more", "숫자 또는 수식(저장된 결과), 0 이상")],
      [b("Merged cells", "셀 병합"), b("StreamID, MatCode, Unit: read on each row · quantities: an error · formula into merged cells: point to the top-left cell", "StreamID·MatCode·Unit: 각 행에 같은 값 · 수량: 오류 · 병합 칸을 가리키는 수식: 왼쪽 위 칸으로")],
    ],
  },
  {
    title: b("BOM quantities", "BOM 수량"),
    rows: [
      [b("Line", "줄"), b("source value × (1 + overage % ÷ 100)", "출처 값 × (1 + 여유율 % ÷ 100)")],
      [b("Recipe component", "레시피 성분"), b("line quantity × quantity ÷ recipe amount, + the component's overage", "줄 수량 × 성분량 ÷ 기준량, + 성분 자재의 여유율")],
      [b("Batches", "배치 수"), b("⌈line quantity ÷ batch size⌉ per line (rounded up)", "줄마다 ⌈줄 수량 ÷ 배치 크기⌉ (올림)")],
      [b("Per batch component", "배치당 성분"), b("batches × its quantity (e.g. 10 batches → 10 bags)", "배치 수 × 성분량 (예: 10배치 → Bag 10개)")],
      [b("Whole batches", "배치 전량 조제"), b("proportional components for batches × batch size", "비례 성분을 배치 수 × 배치 크기만큼")],
      [b("Backup", "대체 자재"), b("primary quantity × ratio, never in the totals", "주 자재 수량 × 비율, 합계에 넣지 않음")],
    ],
  },
  {
    title: b("Operations", "Operations"),
    rows: [
      [b("Equipment tag", "설비 태그"), b("unique; on one PFD shape (or none); first line of its label", "중복 불가, PFD 도형 하나에(없어도 됨), 라벨 첫 줄")],
      [b("Action", "동작"), b("the state from the start of that step: Open/Closed, On/Off or a value", "그 단계 시작부터의 상태: Open/Closed, On/Off 또는 값")],
      [b("State table", "상태표"), b("valves, pumps, agitators keep their state until the next action; vessels and filters: in that step only", "밸브·펌프·교반기는 다음 동작까지 상태 유지, 용기·필터는 그 단계에만")],
      [b("Streams of a step", "단계의 스트림"), b("Stream IDs of that unit operation, transfers in and out included", "그 단위공정의 Stream ID, 들어오고 나가는 이송 포함")],
    ],
  },
  {
    title: b("Title bar, ribbon and status bar", "제목 표시줄, 리본, 상태 표시줄"),
    rows: [
      [b("Linked", "Linked"), b("everything lines up", "모두 맞음")],
      [b("Linked · n notes", "Linked · n notes"), b("lines up; read the notes", "맞음, 참고 사항 확인")],
      [b("Link check: n to fix", "Link check: n to fix"), b("something does not line up; its values are left out of the BOM", "맞지 않는 것이 있음, 그 값은 BOM에서 빠짐")],
      [b("Save · ↶ ↷ (top left)", "저장 · ↶ ↷ (왼쪽 위)"), b("Save to file (Ctrl+S); undo / redo on Materials, BOM, Operations, Mass Balance (Ctrl+Z / Ctrl+Y outside the drawing); the drawing has its own undo", "Save to file(Ctrl+S). Materials·BOM·Operations·Mass Balance 되돌리기·다시(도면 밖에서 Ctrl+Z / Ctrl+Y). 도면은 자체 되돌리기 사용")],
      [b("Ribbon", "리본"), b("File (New, Open, Save to file), the open screen's buttons, History; the arrow at the right of the tabs makes it one line", "File(New, Open, Save to file), 열린 화면의 버튼, History. 탭 오른쪽 화살표로 한 줄로 줄임")],
      [b("Status bar", "상태 표시줄"), b("click a table cell, Shift+click or drag to another: Average, Count and Sum, as in Excel; Ctrl+C copies the cells for Excel; zoom at the right. Keys: arrows, Tab and Enter move, Shift+arrows extend, F2 or typing edits, ↑ ↓ in a field go to the field above or below, Ctrl+F finds", "표의 칸을 클릭하고 Shift+클릭 또는 끌기: Excel처럼 평균·개수·합계. Ctrl+C로 칸을 복사해 Excel에 붙여넣기. 오른쪽은 확대/축소. 키: 방향키·Tab·Enter로 이동, Shift+방향키로 범위, F2나 바로 입력으로 편집, 입력 칸에서 ↑ ↓는 위아래 칸으로, Ctrl+F는 검색")],
      [b("Changes", "Changes"), b("who changed what, when; saved with the project, exported to Excel", "누가 언제 무엇을 바꿨는지. 프로젝트에 저장, Excel로 내보내기")],
    ],
  },
];

export const t = (x: Bilingual, lang: Lang) => x[lang];
