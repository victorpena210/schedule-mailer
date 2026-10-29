import {createMailer} from '../../server/mailer.mjs';

export default createMailer({mode:'test-summary-preview'});
export const config = {
  path:'/api/test-summary-preview',
  rateLimit:{windowLimit:10, windowSize:60, aggregateBy:['ip','domain']}
};
