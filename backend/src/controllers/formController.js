const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const formService = require('../services/formService');

class FormController {
  saveFormContext = asyncHandler(async (req, res) => {
    const { domain, formUrl, formIdentifier, fields } = req.body;
    const formContext = await formService.saveFormContext({
      domain,
      formUrl,
      formIdentifier,
      fields,
    });
    res.status(201).json(new ApiResponse(201, formContext, 'Form context saved successfully'));
  });

  getFormContext = asyncHandler(async (req, res) => {
    const { domain, formIdentifier } = req.query;
    const formContext = await formService.getFormContext(domain, formIdentifier);
    res.status(200).json(new ApiResponse(200, formContext, 'Form context fetched successfully'));
  });

  requestAiFill = asyncHandler(async (req, res) => {
    const { domain, formIdentifier, userIntent, fields } = req.body;
    const predictions = await formService.processAiFillRequest(req.user.id, {
      domain,
      formIdentifier,
      userIntent,
      fields,
    });
    res.status(200).json(new ApiResponse(200, predictions, 'AI form field suggestions generated successfully'));
  });

  createSession = asyncHandler(async (req, res) => {
    const { formContextId } = req.body;
    const session = await formService.createFormSession(req.user.id, formContextId);
    res.status(201).json(new ApiResponse(201, session, 'Form session created successfully'));
  });

  updateSession = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, filledValues } = req.body;
    const session = await formService.updateFormSession(id, req.user.id, { status, filledValues });
    res.status(200).json(new ApiResponse(200, session, 'Form session updated successfully'));
  });
}

module.exports = new FormController();
