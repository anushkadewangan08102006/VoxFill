const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

class AuthService {
  generateToken(userId, role) {
    return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
  }

  async registerUser({ email, password, fullName }) {
    // 1. Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new ApiError(400, 'User with this email already exists');
    }

    // 2. Create user record
    const user = await userRepository.create({ email, password, fullName });

    // 3. Generate Auth JWT Token
    const token = this.generateToken(user._id, user.role);

    return {
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      token,
    };
  }

  async loginUser({ email, password }) {
    // 1. Fetch user by email including hashed password field
    const user = await userRepository.findByEmail(email, true);
    if (!user) {
      throw new ApiError(401, 'Invalid email or password');
    }

    // 2. Compare password hash
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new ApiError(401, 'Invalid email or password');
    }

    // 3. Generate Auth JWT Token
    const token = this.generateToken(user._id, user.role);

    return {
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      token,
    };
  }
}

module.exports = new AuthService();
