const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

class UserService {
  async getUserProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    return user;
  }

  async updateUserProfile(userId, profileData) {
    const updatedUser = await userRepository.updateProfileData(userId, profileData);
    if (!updatedUser) {
      throw new ApiError(404, 'User not found');
    }
    return updatedUser;
  }
}

module.exports = new UserService();
