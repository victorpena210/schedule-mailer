import {getStore} from '@netlify/blobs';

export default async () => {
  if (process.env.CONTEXT !== 'production') return;
  const store = getStore({name: 'schedule-mailer-private-v2', consistency: 'strong'});
  let removed = 0;
  for await (const page of store.list({paginate: true})) {
    for (const entry of page.blobs) {
      // Retention applies only to immutable/expiring record families, not mailbox or settings.
      if (!/^(session|limit)\//.test(entry.key)) continue;
      const m = await store.getMetadata(entry.key, {consistency: 'strong'});
      if (m?.metadata.expiresAt > 0 && m.metadata.expiresAt < Date.now() - 86400000) {
        await store.delete(entry.key); removed++;
      }
      if (removed >= 200) return;
    }
  }
};
export const config = {schedule: '0 9 * * *'};
