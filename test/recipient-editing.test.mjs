import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySettings,editGroupRecipient,departmentBatches} from '../public/routing.mjs';
const rows=[{department:'Food & Beverage',date:'2026-10-31'},{department:'Admissions',date:'2026-10-31'}];
test('draft recipient additions and removals update only that department’s outgoing addresses',()=>{
 const settings=emptySettings();
 settings.groups[0].contacts=[{name:'First',email:'first@example.com'}];
 settings.groups[1].contacts=[{name:'Gate',email:'gate@example.com'}];
 const other=structuredClone(settings.groups[1]);
 editGroupRecipient(settings,'food-beverage','to','add','Second@Example.com');
 editGroupRecipient(settings,'food-beverage','cc','add','copy@example.com');
 editGroupRecipient(settings,'food-beverage','to','remove',0);
 const batch=departmentBatches(rows,settings).batches[0];
 assert.deepEqual(batch.to,['second@example.com']);assert.deepEqual(batch.cc,['copy@example.com']);assert.equal(batch.ready,true);
 assert.deepEqual(settings.groups[1],other);
 editGroupRecipient(settings,'food-beverage','cc','remove',0);
 editGroupRecipient(settings,'food-beverage','to','remove',0);
 const empty=departmentBatches(rows,settings).batches[0];
 assert.equal(empty.ready,false);assert.deepEqual(empty.to,[]);assert.deepEqual(empty.cc,[]);
});
test('recipient editing rejects invalid, duplicate and excessive addresses without changing settings',()=>{
 const settings=emptySettings();settings.groups[0].contacts=[{name:'First',email:'first@example.com'}];
 const before=structuredClone(settings);
 for(const address of ['','not-an-email','one@example.com;two@example.com','first@EXAMPLE.com','first@example.com\r\nBcc: other@example.com']) {
  assert.throws(()=>editGroupRecipient(settings,'food-beverage','cc','add',address));assert.deepEqual(settings,before);
 }
 settings.groups[0].contacts=Array.from({length:50},(_,i)=>({name:'',email:`test${i}@example.com`}));
 assert.throws(()=>editGroupRecipient(settings,'food-beverage','cc','add','extra@example.com'),/50 recipients/);
 assert.throws(()=>editGroupRecipient(settings,'food-beverage','to','remove',-1));
});
