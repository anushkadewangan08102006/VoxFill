const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect); // Require authentication for all user endpoints

router.get('/me', userController.getProfile);
router.put('/me/profile', userController.updateProfile);

module.exports = router;
