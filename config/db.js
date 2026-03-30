const mongoose = require('mongoose');

const connectDB = async () => {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
  });
  console.log('MongoDB Connected');

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] Disconnected — attempting reconnect in 3s...');
    setTimeout(() => {
      connectDB().catch(err => console.error('[DB] Reconnect failed:', err.message));
    }, 3000);
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] Connection error:', err.message);
  });
};

module.exports = connectDB;