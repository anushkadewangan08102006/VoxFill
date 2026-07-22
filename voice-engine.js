/**
 * VoxFill - voice-engine.js
 *
 * Handles speech recognition and speech synthesis.
 */
(function () {
  const VF = (window.VoxFill = window.VoxFill || {});

  const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let listening = false;

  // Selected language yahan globally store hogi
  let currentLanguage = 'en-IN';

  function setLanguage(language) {
    currentLanguage = language || 'en-IN';
  }

  function isSupported() {
    return !!SpeechRecognitionImpl && 'speechSynthesis' in window;
  }

  function createRecognition() {
    const r = new SpeechRecognitionImpl();

    // Recognition selected language me listen karega
    r.lang = currentLanguage;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    return r;
  }

  function listenOnce(timeoutMs) {
    timeoutMs = timeoutMs || 9000;

    return new Promise((resolve, reject) => {
      if (!SpeechRecognitionImpl) {
        reject(new Error('speech-recognition-unsupported'));
        return;
      }

      recognition = createRecognition();
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;

        settled = true;

        try {
          recognition.stop();
        } catch (e) {
          // Ignore error
        }

        reject(new Error('timeout'));
      }, timeoutMs);

      recognition.onresult = (event) => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);

        const transcript =
          event.results[0][0].transcript.trim();

        resolve(transcript);
      };

      recognition.onerror = (event) => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);

        reject(
          new Error(event.error || 'recognition-error')
        );
      };

      recognition.onend = () => {
        listening = false;

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('no-speech'));
        }
      };

      try {
        listening = true;
        recognition.start();
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function stopListening() {
    if (recognition && listening) {
      try {
        recognition.stop();
      } catch (e) {
        // Ignore error
      }
    }

    listening = false;
  }

  function speak(text, opts) {
    opts = opts || {};

    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);

      utter.rate = opts.rate || 1;
      utter.pitch = opts.pitch || 1;

      // Speech selected language me hoga
      utter.lang = currentLanguage;

      utter.onend = () => resolve();
      utter.onerror = () => resolve();

      window.speechSynthesis.speak(utter);
    });
  }

  function cancelSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  VF.voice = {
    isSupported,
    listenOnce,
    stopListening,
    speak,
    cancelSpeech,
    setLanguage
  };
})();