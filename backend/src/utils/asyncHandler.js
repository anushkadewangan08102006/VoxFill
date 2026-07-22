/**
 * Async handler wrapper to catch unhandled promise rejections in controller functions
 * and automatically forward them to Express global error handling middleware.
 */
const asyncHandler = (requestHandler) => {
  return (req, res, next) => {
    Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
  };
};

module.exports = asyncHandler;
