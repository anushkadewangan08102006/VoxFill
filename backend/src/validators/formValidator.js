const Joi = require('joi');

const saveFormContextSchema = {
  body: Joi.object({
    domain: Joi.string().required(),
    formUrl: Joi.string().uri().allow('').optional(),
    formIdentifier: Joi.string().required(),
    fields: Joi.array()
      .items(
        Joi.object({
          fieldId: Joi.string().required(),
          fieldType: Joi.string().default('text'),
          label: Joi.string().allow('').optional(),
          placeholder: Joi.string().allow('').optional(),
          isRequired: Joi.boolean().default(false),
          options: Joi.array().items(Joi.string()).optional(),
        })
      )
      .min(1)
      .required(),
  }),
};

const aiFillRequestSchema = {
  body: Joi.object({
    domain: Joi.string().required(),
    formIdentifier: Joi.string().required(),
    userIntent: Joi.string().allow('').optional(),
    fields: Joi.array().items(Joi.object()).required(),
  }),
};

module.exports = {
  saveFormContextSchema,
  aiFillRequestSchema,
};
