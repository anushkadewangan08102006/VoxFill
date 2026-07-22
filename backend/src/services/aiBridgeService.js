const axios = require('axios');
const ApiError = require('../utils/ApiError');

class AiBridgeService {
  constructor() {
    this.aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    this.timeout = 10000; // 10 seconds timeout for AI microservice responses
  }

  /**
   * Proxies DOM field metadata and user profile context to the AI microservice
   * and retrieves predicted auto-fill values.
   */
  async predictFieldFills(payload) {
    try {
      const response = await axios.post(`${this.aiServiceUrl}/api/v1/predict`, payload, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200 && response.data) {
        return response.data;
      }

      throw new ApiError(502, 'Bad Gateway: Invalid response structure from AI microservice');
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.error(`💥 AI Microservice unreachable at ${this.aiServiceUrl}:`, error.message);
        throw new ApiError(503, 'AI Microservice is currently unavailable. Please try again later.');
      }
      if (error instanceof ApiError) throw error;

      console.error('💥 AI Service Request Error:', error.response?.data || error.message);
      throw new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Failed to communicate with AI microservice'
      );
    }
  }
}

module.exports = new AiBridgeService();
