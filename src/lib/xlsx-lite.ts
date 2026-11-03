// 가벼운 엑셀(.xlsx) 쓰기/읽기 — 관리자 브라우저에서만 사용 (상품 엑셀 내려받기 · 일괄 수정)
// 엑셀/구글시트/한셀이 저장한 파일(공유 문자열, 인라인 문자열, 숫자 모두)을 읽을 수 있습니다.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type Cell = string | number | null | undefined;

function esc(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colIndex(ref: string) {
  const letters = (/^[A-Z]+/.exec(ref.toUpperCase()) ?? [""])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type SheetSpec = {
  name: string;
  rows: Cell[][];
  widths?: number[];
  /** 첫 줄(제목)을 굵게 + 고정 */
  header?: boolean;
  /** 회색 배경으로 표시할 열 (수정하지 말아야 할 열) */
  lockedColumns?: number[];
};

function sheetXml(sheet: SheetSpec) {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const pane = sheet.header
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const locked = new Set(sheet.lockedColumns ?? []);
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const style = sheet.header && r === 0 ? ' s="1"' : locked.has(c) ? ' s="2"' : "";
      if (value === null || value === undefined || value === "") return style ? `<c r="${ref}"${style}/>` : "";
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** 시트 여러 장짜리 .xlsx 만들기 */
export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F4EA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fillId="3" applyFill="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet)); });
  return zipSync(files, { level: 6 });
}

function textOf(node: Element | null | undefined): string {
  if (!node) return "";
  // <si><t>..</t></si> 또는 서식 있는 <si><r><t>..</t></r>...</si>
  const ts = Array.from(node.getElementsByTagName("t"));
  return ts.length ? ts.map((t) => t.textContent ?? "").join("") : (node.textContent ?? "");
}

/** 첫 번째 시트를 문자열 2차원 배열로 읽기 */
export function readXlsx(data: ArrayBuffer | Uint8Array): string[][] {
  const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  const parser = new DOMParser();
  const xml = (path: string) => (files[path] ? parser.parseFromString(strFromU8(files[path]), "application/xml") : null);

  // 첫 시트 경로 찾기 (workbook.xml → rels)
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const firstSheet = workbook?.getElementsByTagName("sheet")[0];
  const rid = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (rid && rels) {
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target") ?? "";
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  if (!files[sheetPath]) {
    const any = Object.keys(files).find((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p));
    if (!any) throw new Error("엑셀 시트를 찾을 수 없습니다.");
    sheetPath = any;
  }

  const shared = xml("xl/sharedStrings.xml");
  const strings = shared ? Array.from(shared.getElementsByTagName("si")).map((si) => textOf(si)) : [];
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error("엑셀 시트를 읽을 수 없습니다.");

  const out: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const r = Number(row.getAttribute("r") ?? out.length + 1) - 1;
    const values: string[] = [];
    let next = 0;
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r");
      const index = ref ? colIndex(ref) : next;
      next = index + 1;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value = "";
      if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(c.getElementsByTagName("is")[0]);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v;
      values[index] = value;
    }
    out[r] = Array.from(values, (value) => value ?? "");
  }
  return Array.from(out, (row) => row ?? []);
}

/** 브라우저에서 파일 내려받기 */
export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
