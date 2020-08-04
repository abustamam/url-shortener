import mongoose from 'mongoose';

const database = async (req, res, next) => {
  await mongoose.connect(process.env.MONGO_URI);
  return next();
};

export default database;
