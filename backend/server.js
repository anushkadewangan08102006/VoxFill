const dotenv = require('dotenv');

// Handle uncaught exceptions before loading app dependencies
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down server gracefully...');
  console.error(err.name, err.message, err.stack);
  process.exit(1);
});

// Load environment variables from .env file
dotenv.config({ path: './.env' });

const connectDB = require('./src/config/db');
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

// Connect to MongoDB then bootstrap HTTP Server
const startServer = async () => {
  try {
    // 1. Establish Database Connection
    await connectDB();

    // 2. Start HTTP Listener
    const server = app.listen(PORT, () => {
      console.log(`🚀 FormPilot AI Backend Server running in [${process.env.NODE_ENV || 'development'}] mode on port ${PORT}`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.error('💥 UNHANDLED REJECTION! Shutting down server gracefully...');
      console.error(err);
      server.close(() => {
        process.exit(1);
      });
    });

    // Handle SIGTERM signal
    process.on('SIGTERM', () => {
      console.log('👋 SIGTERM RECEIVED. Shutting down HTTP server gracefully...');
      server.close(() => {
        console.log('💥 Process terminated!');
      });
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
