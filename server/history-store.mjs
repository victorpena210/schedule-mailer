import {getStore} from '@netlify/blobs';

// Only delivery metadata is retained here, never employee rows or email bodies.
export function createHistoryStore(storeFactory=()=>getStore({name:'schedule-mailer-history',consistency:'strong'})) {
  const store=()=>storeFactory();
  const entryKey=record=>`entries/${String(9999999999999-Date.parse(record.createdAt)).padStart(13,'0')}/${record.reference}`;
  async function save(record) {
    const key=record.key||entryKey(record),saved={...record,key};
    await store().setJSON(key,saved);
    if(saved.id)await store().setJSON(`ids/${saved.id}`,{key});
    if(saved.id&&/^[a-f0-9]{64}$/.test(saved.reference))await store().setJSON(`attempts/${saved.reference}`,saved);
    return saved;
  }
  return {
    async begin(reference,record) {
      const key=`attempts/${reference}`;
      const candidate={...record,reference,key:entryKey({...record,reference})};
      const result=await store().setJSON(key,candidate,{onlyIfNew:true});
      const current=result.modified?candidate:await store().get(key,{type:'json'});
      if(!current)throw Error('History record unavailable');
      if(result.modified)await save(current);
      return current;
    },
    async complete(record) {
      const pointer=record.id?await store().get(`ids/${record.id}`,{type:'json'}):null;
      const existing=pointer?await store().get(pointer.key,{type:'json'}):null;
      const saved=await save(existing?{...record,key:existing.key,createdAt:existing.createdAt}:record);
      if(record.key&&record.key!==saved.key)await store().delete(record.key);
      return saved;
    },
    async byId(id) {
      const pointer=await store().get(`ids/${id}`,{type:'json'});
      return pointer?store().get(pointer.key,{type:'json'}):null;
    },
    save,
    async page(cursor='',limit=25) {
      const {blobs}=await store().list({prefix:'entries/'});
      const keys=blobs.map(b=>b.key).filter(key=>!cursor||key>cursor).sort();
      const records=[];
      for(let i=0;i<Math.min(keys.length,limit);i+=5) {
        records.push(...await Promise.all(keys.slice(i,Math.min(i+5,limit)).map(key=>store().get(key,{type:'json'}))));
      }
      return {records:records.filter(Boolean),hasMore:keys.length>limit};
    }
  };
}
