'use strict';

/**
 * prompts/templates.js — Prompt Templates for FormPilot AI
 *
 * WHAT THIS FILE CONTAINS:
 *   Pure functions that return prompt strings for specific situations.
 *   "Pure" means no side effects — given the same inputs, always the same output.
 *   This makes them trivially testable and easy to iterate on.
 *
 * WHY SEPARATE TEMPLATES FROM THE BUILDER:
 *   - Templates are content decisions (what to say to the LLM)
 *   - The builder (index.js) is structural decisions (how to assemble messages)
 *   - Keeping them separate means you can update wording without touching logic
 *
 * PROMPT ENGINEERING PRINCIPLES APPLIED HERE:
 *
 *   1. ROLE ASSIGNMENT
 *      "You are a..." gives the model a clear persona. LLMs follow personas
 *      reliably — it constrains the response style effectively.
 *
 *   2. TASK SCOPING
 *      Explicitly state what the model should NOT do (lengthy explanations,
 *      unsolicited advice) alongside what it SHOULD do.
 *
 *   3. FORMAT CONSTRAINTS
 *      Voice TTS has strict requirements: no markdown, no lists, no asterisks.
 *      These symbols make Piper say "asterisk asterisk bold asterisk asterisk".
 *      Explicitly forbid them in the system prompt.
 *
 *   4. FEW-SHOT EXAMPLES
 *      Two or three examples in the system prompt dramatically improve output
 *      consistency. The model pattern-matches to the examples.
 *
 *   5. CONTEXT INJECTION
 *      Current field name + validation rules are injected per call so the
 *      model gives field-specific guidance rather than generic help.
 */

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt — Core AI Persona
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The system prompt establishes who the AI is and how it must behave.
 * This is sent as the first message in every conversation.
 *
 * It is designed to be sent ONCE at the start of a session, not repeated
 * every turn (the session manager handles this — see session/index.js).
 *
 * @returns {string} The system prompt text
 */
function systemPrompt() {
  return `You are FormPilot, an AI voice assistant that helps users fill online forms over a phone call.

Your job is to guide the user through filling one form field at a time using natural spoken conversation.

STRICT RULES — follow these without exception:
1. Keep every response to 1 or 2 short sentences. Maximum 30 words. Voice is not a reading medium.
2. NEVER use markdown: no asterisks, no hyphens as bullets, no headers, no backticks.
3. Speak in plain English as if talking to a person on the phone.
4. If the user gives a valid value, confirm it and move on. Do not ask for it again.
5. If the user gives an invalid value, explain why briefly and ask again.
6. If the user is confused, rephrase the question more simply. Do not repeat the same wording.
7. Do not introduce yourself more than once per session.
8. Do not suggest the user contact support or visit a website.

EXAMPLES OF GOOD RESPONSES:
  User: "my name is john"    → "Got it, John. Now, what is your date of birth?"
  User: "I don't understand" → "Sure. What year were you born?"
  User: "skip this field"    → "Alright, moving to the email address field. What is your email?"

EXAMPLES OF BAD RESPONSES (never do this):
  "**Name**: John Doe" (markdown)
  "I'd be happy to help you fill out this form today!" (too wordy)
  "Please provide your name in the format: First Last" (robotic)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Context Prompt — Injected When Active Field Changes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describes the current form field the user needs to fill.
 * Injected as a system message when the active field changes.
 *
 * This tells the model exactly what it needs to collect from the user
 * and what constraints apply — so it can validate the response correctly.
 *
 * @param {object} fieldContext - Field information from the Chrome Extension
 * @param {string} fieldContext.label       - Human-readable field name ("Date of Birth")
 * @param {string} [fieldContext.type]      - Input type ("text", "email", "date", "tel", "number")
 * @param {string} [fieldContext.placeholder] - Placeholder text from the form
 * @param {boolean}[fieldContext.required]  - Is this field required?
 * @param {string} [fieldContext.pattern]   - Validation pattern description (plain English)
 * @param {string} [fieldContext.currentValue] - Any value already in the field
 *
 * @returns {string} A concise field context description for the system message
 */
function fieldContextPrompt(fieldContext) {
  const {
    label        = 'Unknown Field',
    type         = 'text',
    placeholder  = '',
    required     = false,
    pattern      = '',
    currentValue = '',
  } = fieldContext;

  const lines = [
    `CURRENT FIELD: "${label}"`,
    `Type: ${type}`,
  ];

  if (placeholder) lines.push(`Placeholder hint: "${placeholder}"`);
  if (required)    lines.push(`This field is REQUIRED.`);
  if (pattern)     lines.push(`Validation rule: ${pattern}`);
  if (currentValue) {
    lines.push(`Current value in field: "${currentValue}" — confirm with user or update.`);
  }

  lines.push(
    '',
    'Your task: Ask the user for this value if not already provided,',
    'validate what they say against the type and rules above,',
    'and confirm back to them before proceeding.',
  );

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeting Prompt — First Turn of a Session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The opening message FormPilot says when a call connects.
 * Short, friendly, sets expectations immediately.
 *
 * @param {string} [formName] - Name of the form (e.g. "Admission Application")
 * @returns {string}
 */
function greetingPrompt(formName) {
  const form = formName
    ? `the ${formName}`
    : 'this form';

  return (
    `The user has just connected to a voice call to fill ${form}. ` +
    `Greet them briefly, tell them you will guide them through the form, ` +
    `and ask for the first field value. Keep it under 20 words.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Recovery Prompt — When STT Fails or Audio Is Unclear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Used when Whisper returns an empty transcript or very low-confidence result.
 * Asks the model to prompt the user to repeat themselves.
 *
 * @returns {string}
 */
function clarificationPrompt() {
  return (
    `The user's voice was not understood clearly. ` +
    `Politely ask them to repeat what they said. ` +
    `Keep your response under 10 words.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion Prompt — All Fields Filled
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tells the model that all fields have been collected.
 * Generates a closing message to end the call gracefully.
 *
 * @returns {string}
 */
function completionPrompt() {
  return (
    `All form fields have been successfully filled. ` +
    `Thank the user, let them know the form is complete, ` +
    `and say goodbye. Keep it under 15 words.`
  );
}

module.exports = {
  systemPrompt,
  fieldContextPrompt,
  greetingPrompt,
  clarificationPrompt,
  completionPrompt,
};
