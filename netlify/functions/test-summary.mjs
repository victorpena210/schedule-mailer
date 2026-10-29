import {createMailer} from '../../server/mailer.mjs';

export default createMailer({mode:'test-summary'});
export const config = {
  path:'/api/test-summary',
  rateLimit:{windowLimit:5, windowSize:60, aggregateBy:['ip','domain']}
};
