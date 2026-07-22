const mongoose = require('mongoose');

const formSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID reference is required'],
      index: true,
    },
    formContextId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormContext',
      required: [true, 'FormContext reference is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'in_progress', 'completed', 'failed'],
      default: 'in_progress',
    },
    filledValues: {
      type: Map,
      of: String,
      default: {},
    },
    aiSuggestions: {
      type: Map,
      of: new mongoose.Schema(
        {
          suggestedValue: String,
          confidence: Number,
        },
        { _id: false }
      ),
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const FormSession = mongoose.model('FormSession', formSessionSchema);

module.exports = FormSession;
