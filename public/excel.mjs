import {read, utils, SSF} from './vendor/xlsx-0.20.3.mjs';
import {organizeRecords} from './core.mjs';

const MAX_ROWS = 50000, MAX_COLUMNS = 256;
const meaningful = cell => cell && (cell.f || (cell.v !== undefined && cell.v !== null && String(cell.v).trim()));

export function openWorkbook(buffer) {
  const bytes = new Uint8Array(buffer);
  if(bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) {
    throw new Error('This is not a readable .xlsx workbook. In Excel, save a copy as Excel Workbook (.xlsx), without password protection. Renaming a file does not convert it.');
  }
  let workbook;
  try {
    workbook = read(bytes, {type:'array', cellDates:false, cellNF:true, cellHTML:false, sheetRows:MAX_ROWS+1});
  } catch {
    throw new Error('This Excel workbook could not be opened. Save a new, unprotected .xlsx copy of the original weekly report and try again.');
  }
  const sheets = workbook.SheetNames.filter(name => {
    const sheet = workbook.Sheets[name];
    return sheet && Object.keys(sheet).some(key => !key.startsWith('!') && meaningful(sheet[key]));
  });
  if(!sheets.length) throw new Error('This Excel workbook has no populated worksheets. Export the original weekly schedule report and try again.');
  return {workbook, sheets};
}

export function organizeWorksheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  if(!workbook.SheetNames.includes(name) || !sheet) throw new Error('Choose a worksheet from this workbook.');
  const entries = Object.entries(sheet).filter(([key,cell]) => !key.startsWith('!') && meaningful(cell));
  const range = utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if(range.e.r >= MAX_ROWS) throw new Error('This worksheet has too many rows. Export a single schedule period with fewer than 50,000 rows.');
  let firstColumn = Infinity, lastColumn = 0;
  const rows = new Map();
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  for(const [address,cell] of entries) {
    const {r,c} = utils.decode_cell(address);
    firstColumn = Math.min(firstColumn,c); lastColumn = Math.max(lastColumn,c);
    if(lastColumn-firstColumn >= MAX_COLUMNS) throw new Error('This worksheet has too many columns. Choose the original weekly schedule worksheet.');
    if(cell.f) throw new Error(`Worksheet “${name}” contains a formula at ${address}. Use the original report export, or save a copy with calculated values pasted as values before importing.`);
    if(cell.t === 'e') throw new Error(`Worksheet “${name}” contains an Excel error at ${address}. Correct the source report before importing.`);
    let value = String(cell.v ?? '');
    // Calendar dates must have four-digit years regardless of Excel's display format.
    // Read the serial directly so both Excel date systems work without timezone shifts.
    if(cell.t === 'n' && cell.z && SSF.is_date(cell.z)) {
      const date = SSF.parse_date_code(cell.v,{date1904});
      if(date && /[dy]/i.test(cell.z.replace(/"[^"]*"|\[[^\]]*\]/g,''))) {
        value = `${date.m}/${date.d}/${date.y}`;
      } else value = utils.format_cell(cell);
    }
    if(!rows.has(r)) rows.set(r, new Map());
    rows.get(r).set(c,value);
  }
  const records = [...rows].sort(([a],[b])=>a-b).map(([r,cells])=>({
    line:r+1,
    cells:Array.from({length:lastColumn-firstColumn+1},(_,i)=>cells.get(firstColumn+i)||'')
  }));
  return organizeRecords(records);
}
