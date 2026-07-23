/**
 * VoxFill services/callService.js
 *
 * Tiny browser-side service for the phone calling feature. It only talks to
 * the isolated backend and does not import or alter the existing assistant,
 * content script, chatbot, or autofill modules.
 */
(function () {
  const CALL_API_URL = 'http://localhost:5001/api/call';
  const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

  function validatePhoneNumber(phoneNumber) {
    if (typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
      return 'Phone number is required.';
    }

    if (!PHONE_PATTERN.test(phoneNumber.trim())) {
      return 'Use E.164 format, for example +919876543210.';
    }

    return null;
  }

  async function startPhoneCall(phoneNumber, pageTitle) {
    const normalizedPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : phoneNumber;
    const phoneError = validatePhoneNumber(normalizedPhone);

    if (phoneError) {
      throw new Error(phoneError);
    }

    const response = await fetch(CALL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: normalizedPhone,
        pageTitle: pageTitle || document.title || 'Untitled page',
      }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('Call server returned an invalid response.');
    }

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Could not start the phone call.');
    }

    return payload;
  }

  window.VoxFillCallService = {
    startPhoneCall,
    validatePhoneNumber,
  };
})();
