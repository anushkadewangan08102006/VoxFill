const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/authService');

class AuthController {
  register = asyncHandler(async (req, res) => {
    const { email, password, fullName } = req.body;
    const result = await authService.registerUser({ email, password, fullName });
    res.status(201).json(new ApiResponse(201, result, 'User registered successfully'));
  });

  login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.loginUser({ email, password });
    res.status(200).json(new ApiResponse(200, result, 'User logged in successfully'));
  });
}

module.exports = new AuthController();
