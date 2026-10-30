import {createMailer} from '../../server/mailer.mjs';
import {createHistoryStore} from '../../server/history-store.mjs';

export default createMailer({history:createHistoryStore()});
export const config = {
  path:'/api/send-department',
  rateLimit:{windowLimit:60, windowSize:60, aggregateBy:['ip','domain']}
};
