import test from 'node:test';
import assert from 'node:assert/strict';
import {organize} from '../public/core.mjs';
import {openWorkbook,organizeWorksheet} from '../public/excel.mjs';
import {utils,write} from '../public/vendor/xlsx-0.20.3.mjs';

const lines = [
  'SF/FT/OPS/MDSE/Sample Shop',
  'Employee,Primary Job,Saturday',
  ',,10/31/2026',
  '"Example, Retail",Attendant,9:00 AM - 12:00 PM',
  ',,Sample Shop/Attendant',
  ',,12:30 PM - 4:00 PM',
  ',,Final Gift Shop/Attendant',
  'SF/FT/OPS/FB/Sample Cafe',
  'Employee,Primary Job,Saturday',
  ',,10/31/2026',
  '"Example, Food",Attendant,10:00 AM - 5:00 PM',
  ',,Final Cafe/Attendant'
].join('\n');
test('original weekly CSV retains department and final segment location/end time', () => {
  const r=organize(lines); assert.deepEqual(r.errors,[]); assert.equal(r.rows.length,2);
  const retail=r.rows.find(x=>x.department==='Merchandise'); assert.equal(retail.name,'Retail Example'); assert.equal(retail.location,'Final Gift Shop'); assert.equal(retail.end,'4:00 PM');
});
test('XLSX selects one worksheet and produces the same schedule as CSV', () => {
  const book=utils.book_new();
  const values=[['SF/FT/OPS/ADM/Sample Gate'],['Employee','Primary Job','Saturday'],['','','10/31/2026'],['Example, Gate','Attendant','9:00 AM - 4:00 PM'],['','','Final Gate/Attendant']];
  utils.book_append_sheet(book,utils.aoa_to_sheet(values),'Schedule'); utils.book_append_sheet(book,utils.aoa_to_sheet([['Unrelated data']]),'Notes');
  const loaded=openWorkbook(write(book,{type:'array',bookType:'xlsx'}));
  assert.equal(loaded.sheets.length,2);
  const r=organizeWorksheet(loaded.workbook,'Schedule'); assert.deepEqual(r.errors,[]); assert.equal(r.rows[0].department,'Admissions'); assert.equal(r.rows[0].location,'Final Gate');
  loaded.workbook.Sheets.Schedule.A4.f='1+1'; assert.throws(()=>organizeWorksheet(loaded.workbook,'Schedule'),/formula/);
});
