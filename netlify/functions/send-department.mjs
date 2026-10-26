import {createMailer} from '../../server/mailer.mjs';

export default createMailer();
export const config = {
  path:'/api/send-department',
  rateLimit:{windowLimit:10, windowSize:60, aggregateBy:['ip','domain']}
};
