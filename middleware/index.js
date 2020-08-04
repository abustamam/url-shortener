import nextConnect from 'next-connect';
import database from './database';
import cors from './cors';

const middleware = nextConnect();
middleware.use(database).use(cors);

export default middleware