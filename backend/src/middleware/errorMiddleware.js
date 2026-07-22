const ApiError = require('../utils/ApiError');

/**
 * Centralized Operational Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || error.status ? 400 : 500;
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, [], err.stack);
  }

  const response = {
    status: error.status,
    message: error.message,
    errors: error.errors,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  };

  if (process.env.NODE_ENV === 'development') {
    console.error('💥 [ERROR]:', error);
  }

  res.status(error.statusCode).json(response);
};

module.exports = { errorHandler };
