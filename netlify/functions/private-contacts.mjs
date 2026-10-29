import {createPrivateContacts} from '../../server/private-contacts.mjs';
export default createPrivateContacts();
export const config={path:'/api/private-contacts',rateLimit:{windowLimit:5,windowSize:60,aggregateBy:['ip','domain']}};
