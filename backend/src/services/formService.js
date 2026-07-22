const formContextRepository = require('../repositories/formContextRepository');
const formSessionRepository = require('../repositories/formSessionRepository');
const userRepository = require('../repositories/userRepository');
const aiBridgeService = require('./aiBridgeService');
const ApiError = require('../utils/ApiError');

class FormService {
  async saveFormContext({ domain, formUrl, formIdentifier, fields }) {
    if (!domain || !formIdentifier || !fields || !Array.isArray(fields)) {
      throw new ApiError(400, 'Invalid form context metadata payload');
    }
    return await formContextRepository.upsert(domain, formIdentifier, formUrl, fields);
  }

  async getFormContext(domain, formIdentifier) {
    if (!domain) {
      throw new ApiError(400, 'Domain parameter is required');
    }

    if (formIdentifier) {
      const form = await formContextRepository.findByDomainAndIdentifier(domain, formIdentifier);
      if (!form) throw new ApiError(404, 'Form context not found for specified identifier');
      return form;
    }

    return await formContextRepository.findByDomain(domain);
  }

  async processAiFillRequest(userId, { domain, formIdentifier, userIntent, fields }) {
    // 1. Fetch User Profile Facts
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User profile not found');
    }

    // 2. Upsert Form Context DOM schema to database cache
    const formContext = await formContextRepository.upsert(domain, formIdentifier, '', fields);

    // 3. Construct payload for AI Microservice
    const aiPayload = {
      userIntent: userIntent || 'Auto-fill form fields accurately based on profile data',
      userProfile: user.profileData || {},
      fields: fields,
      formIdentifier,
      domain,
    };

    // 4. Send request to AI Microservice via AiBridgeService
    const aiResponse = await aiBridgeService.predictFieldFills(aiPayload);

    // 5. Automatically create a FormSession audit log in DB
    await formSessionRepository.create({
      userId,
      formContextId: formContext._id,
      status: 'in_progress',
      aiSuggestions: aiResponse.predictions || {},
    });

    return {
      formContextId: formContext._id,
      predictions: aiResponse.predictions || {},
    };
  }

  async createFormSession(userId, formContextId) {
    const formContext = await formContextRepository.findById(formContextId);
    if (!formContext) {
      throw new ApiError(404, 'Form context specified does not exist');
    }

    return await formSessionRepository.create({
      userId,
      formContextId,
      status: 'in_progress',
    });
  }

  async updateFormSession(sessionId, userId, { status, filledValues }) {
    const session = await formSessionRepository.findById(sessionId);
    if (!session) {
      throw new ApiError(404, 'Form session not found');
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (filledValues) updateData.filledValues = filledValues;

    return await formSessionRepository.updateSession(sessionId, updateData);
  }
}

module.exports = new FormService();
