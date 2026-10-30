import {createEmailHistory} from '../../server/email-history.mjs';
import {createHistoryStore} from '../../server/history-store.mjs';
export default createEmailHistory({history:createHistoryStore()});
export const config={path:'/api/email-history',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
