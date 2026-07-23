/**
 * VoxFill call-server/controllers/callController.js
 *
 * Validates outbound call requests and uses Twilio Voice to call the user.
 * The TwiML greeting is intentionally simple and isolated so the browser-side
 * VoxFill conversation manager remains the source of truth for form filling.
 */
const twilio = require('twilio');

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const VOXFILL_GREETING =
  'Hello. Welcome to VoxFill. I will help you complete your form today. Let us begin.';

function validatePhone(phone) {
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return 'Phone number is required.';
  }

  if (!E164_PHONE_PATTERN.test(phone.trim())) {
    return 'Phone number must be in E.164 format, for example +919876543210.';
  }

  return null;
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return {
      error: 'Twilio credentials are not configured on the server.',
    };
  }

  if (!E164_PHONE_PATTERN.test(fromNumber)) {
    return {
      error: 'TWILIO_PHONE_NUMBER must be in E.164 format.',
    };
  }

  return { accountSid, authToken, fromNumber };
}

function buildGreetingTwiml() {
  const voiceResponse = new twilio.twiml.VoiceResponse();

  voiceResponse.say(
    {
      voice: 'alice',
      language: 'en-IN',
    },
    VOXFILL_GREETING
  );

  return voiceResponse.toString();
}

async function startCall(req, res) {
  const { phone, pageTitle } = req.body || {};
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : phone;
  const phoneError = validatePhone(normalizedPhone);

  if (phoneError) {
    return res.status(400).json({
      success: false,
      error: phoneError,
    });
  }

  const twilioConfig = getTwilioConfig();
  if (twilioConfig.error) {
    return res.status(500).json({
      success: false,
      error: twilioConfig.error,
    });
  }

  try {
    const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
    const call = await client.calls.create({
      to: normalizedPhone,
      from: twilioConfig.fromNumber,
      twiml: buildGreetingTwiml(),
    });

    console.log('VoxFill outbound call initiated', {
      callSid: call.sid,
      to: normalizedPhone,
      pageTitle: pageTitle || 'Unknown page',
    });

    return res.status(201).json({
      success: true,
      callSid: call.sid,
    });
  } catch (error) {
    console.error('Twilio call initiation failed:', error);
    return res.status(502).json({
      success: false,
      error: 'Twilio could not initiate the outbound call.',
      details: error.message,
    });
  }
}

module.exports = {
  startCall,
  validatePhone,
  buildGreetingTwiml,
};
