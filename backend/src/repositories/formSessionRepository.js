const FormSession = require('../models/formSessionModel');

class FormSessionRepository {
  async create(sessionData) {
    return await FormSession.create(sessionData);
  }

  async findById(id) {
    return await FormSession.findById(id)
      .populate('formContextId')
      .populate('userId', 'email fullName')
      .exec();
  }

  async findByUserId(userId) {
    return await FormSession.find({ userId })
      .populate('formContextId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateSession(id, updateData) {
    return await FormSession.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).exec();
  }
}

module.exports = new FormSessionRepository();
