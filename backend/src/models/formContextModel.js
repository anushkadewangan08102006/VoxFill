const mongoose = require('mongoose');

const fieldSchema = new mongoose.Schema(
  {
    fieldId: {
      type: String,
      required: true,
      trim: true,
    },
    fieldType: {
      type: String,
      required: true,
      enum: ['text', 'email', 'password', 'number', 'tel', 'select', 'radio', 'checkbox', 'textarea', 'date', 'other'],
      default: 'text',
    },
    label: {
      type: String,
      trim: true,
      default: '',
    },
    placeholder: {
      type: String,
      trim: true,
      default: '',
    },
    isRequired: {
      type: Boolean,
      default: false,
    },
    options: [
      {
        type: String,
      },
    ],
  },
  { _id: false }
);

const formContextSchema = new mongoose.Schema(
  {
    domain: {
      type: String,
      required: [true, 'Domain is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    formUrl: {
      type: String,
      required: [true, 'Form URL is required'],
      trim: true,
    },
    formIdentifier: {
      type: String,
      required: true,
      trim: true,
    },
    fields: [fieldSchema],
  },
  {
    timestamps: true,
  }
);

// Compound index on domain and formIdentifier for fast query lookup
formContextSchema.index({ domain: 1, formIdentifier: 1 }, { unique: true });

const FormContext = mongoose.model('FormContext', formContextSchema);

module.exports = FormContext;
