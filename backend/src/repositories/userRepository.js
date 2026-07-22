const User = require('../models/userModel');

class UserRepository {
  async create(userData) {
    return await User.create(userData);
  }

  async findByEmail(email, includePassword = false) {
    const query = User.findOne({ email });
    if (includePassword) {
      query.select('+password');
    }
    return await query.exec();
  }

  async findById(id) {
    return await User.findById(id).exec();
  }

  async updateProfileData(userId, profileData) {
    return await User.findByIdAndUpdate(
      userId,
      { $set: { profileData } },
      { new: true, runValidators: true }
    ).exec();
  }
}

module.exports = new UserRepository();
