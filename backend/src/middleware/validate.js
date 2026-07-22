const ApiError = require('../utils/ApiError');

/**
 * Higher-order middleware factory that validates request body, query, or params against a Joi schema.
 * @param {Object} schema - Joi validation schema object ({ body, query, params })
 */
const validate = (schema) => (req, res, next) => {
  const keys = Object.keys(schema);

  for (const key of keys) {
    if (!['body', 'query', 'params'].includes(key)) continue;

    const { error, value } = schema[key].validate(req[key], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new ApiError(400, `Validation Error: ${errorMessage}`, error.details));
    }

    req[key] = value; // Replace request object with validated & sanitized value
  }

  return next();
};

module.exports = validate;
