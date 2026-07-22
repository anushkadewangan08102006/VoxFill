const express = require('express');
const formController = require('../controllers/formController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { saveFormContextSchema, aiFillRequestSchema } = require('../validators/formValidator');

const router = express.Router();

router.use(protect); // Require authentication for form operations

router.post('/context', validate(saveFormContextSchema), formController.saveFormContext);
router.get('/context', formController.getFormContext);
router.post('/fill-request', validate(aiFillRequestSchema), formController.requestAiFill);
router.post('/sessions', formController.createSession);
router.patch('/sessions/:id', formController.updateSession);

module.exports = router;
