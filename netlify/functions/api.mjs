import {getStore} from '@netlify/blobs';
import {AppError, cryptography, readConfig, Vault} from '../../server/security.mjs';
import {Microsoft} from '../../server/microsoft.mjs';
import {createApp} from '../../server/app.mjs';

export default async function handler(request) {
  try {
    const settings = readConfig(process.env), crypto = cryptography(settings.key);
    const vault = new Vault(getStore({name: 'schedule-mailer-private-v2', consistency: 'strong'}), crypto);
    return await createApp({config: settings, crypto, vault, microsoft: new Microsoft(settings)})(request);
  } catch (error) {
    return new Response(JSON.stringify({configured: false, error: error instanceof AppError ? error.message : 'The sending service is temporarily unavailable.', code: error.code || 'service_unavailable'}),
      {status: error.status || 503, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
  }
}
export const config = {path: '/api/*'};
