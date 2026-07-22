const express = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const formRoutes = require('./formRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/forms', formRoutes);

module.exports = router;
