import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySettings,parseSettings,departmentBatches,assignDepartment} from '../public/routing.mjs';
import {emailHtml,emailText,toCsv} from '../public/core.mjs';

function settings() {
  const s=emptySettings();
  for(const g of s.groups)g.contacts=[{name:g.label,email:g.id+'@example.com'}];
  return parseSettings(s);
}
const rows=[
  {name:'Retail Example',department:'Merchandise',location:'Gift Shop',date:'2026-10-31',end:'4:00 PM'},
  {name:'Food Example',department:'Food & Beverage',location:'Cafe',date:'2026-10-31',end:'5:00 PM'},
  {name:'Gate Example',department:'Admissions',location:'Gate',date:'2026-10-31',end:'6:00 PM'},
  {name:'Sunday Example',department:'Merchandise',location:'Gift Shop',date:'2026-11-01',end:'3:00 PM'},
  {name:'Unassigned Example',department:'Unknown',location:'Other',date:'2026-10-31',end:'7:00 PM'}
];
test('each department gets only its selected-date rows and recipients in all email formats',()=>{
  const {batches,held}=departmentBatches(rows,settings(),new Set(['2026-10-31']));
  assert.deepEqual(held.map(r=>r.name),['Unassigned Example']);
  for(const batch of batches) {
    assert.equal(batch.rows.length,1);
    assert.deepEqual(batch.to,[batch.id+'@example.com']);
    assert.equal(batch.ready,true);
    for(const rendered of [emailHtml(batch.rows,'Schedule','Sender'),emailText(batch.rows,'Schedule','Sender'),toCsv(batch.rows)]) {
      assert.ok(rendered.includes(batch.rows[0].name));
      for(const other of rows.filter(r=>r!==batch.rows[0]))assert.ok(!rendered.includes(other.name));
    }
  }
});
test('an unassigned source department stays excluded until explicitly mapped to one group',()=>{
  const s=settings();
  assignDepartment(s,'Unknown','admissions');
  const b=departmentBatches(rows,s,new Set(['2026-10-31']));
  assert.equal(b.held.length,0);
  assert.equal(b.batches.find(g=>g.id==='admissions').rows.length,2);
  assignDepartment(s,'Unknown','retail');
  const next=departmentBatches(rows,s,new Set(['2026-10-31']));
  assert.equal(next.batches.find(g=>g.id==='admissions').rows.length,1);
  assert.equal(next.batches.find(g=>g.id==='retail').rows.length,2);
});
test('missing or malformed recipient addresses block preparation; ambiguous mappings are rejected',()=>{
  const s=settings();
  s.groups[0].contacts.push({name:'Incomplete contact',email:''});
  assert.equal(departmentBatches(rows,s).batches[0].ready,false);
  s.groups[0].contacts[1].email='invalid-address';
  assert.throws(()=>parseSettings(s),/email/);
  const duplicate=settings();duplicate.groups[0].departments.push('Admissions');
  assert.throws(()=>parseSettings(duplicate),/more than one/);
});
