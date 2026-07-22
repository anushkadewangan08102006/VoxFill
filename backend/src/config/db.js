const mongoose = require('mongoose');

/**
 * Connects to MongoDB database using Mongoose ORM.
 * Implements robust connection handling and error listeners.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: process.env.NODE_ENV === 'development', // Build indexes in dev mode only
    });

    console.log(`🍃 MongoDB Connected Successfully: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.error(`💥 MongoDB Connection Error: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

// Event Listeners for MongoDB connection lifecycle
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB connection lost. Attempting to reconnect...');
});

mongoose.connection.on('error', (err) => {
  console.error(`💥 MongoDB Connection Runtime Error: ${err.message}`);
});

module.exports = connectDB;
