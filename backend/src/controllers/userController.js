const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const userService = require('../services/userService');

class UserController {
  getProfile = asyncHandler(async (req, res) => {
    const user = await userService.getUserProfile(req.user.id);
    res.status(200).json(new ApiResponse(200, user, 'User profile fetched successfully'));
  });

  updateProfile = asyncHandler(async (req, res) => {
    const updatedUser = await userService.updateUserProfile(req.user.id, req.body.profileData);
    res.status(200).json(new ApiResponse(200, updatedUser, 'Profile data updated successfully'));
  });
}

module.exports = new UserController();
