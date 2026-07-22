# VoxFill

VoxFill is a Chrome Extension (Manifest V3) that helps visually impaired users
fill out web forms using voice. It scans the current page for visible form
fields, tells the user what it found, asks for each value out loud, listens
for the spoken answer, and fills the field in — one at a time — until the
form is complete. It reads a summary at the end and **never submits the form
on its own.**

Everything runs locally in the browser using the built‑in Web Speech APIs
(`webkitSpeechRecognition` for input, `speechSynthesis` for output). There is
no backend, no external API, and no API key.

---

## 1. What's in this extension

| File                       | Purpose                                                                 |
|----------------------------|--------------------------------------------------------------------------|
| `manifest.json`             | Manifest V3 configuration                                               |
| `background.js`             | Service worker; updates the toolbar badge while VoxFill is active       |
| `content-script.js`         | Injected into the page; creates the on-page status overlay and routes start/stop messages |
| `form-scanner.js`           | Detects visible form fields and derives a human-readable label for each |
| `form-filler.js`            | Writes recognized speech into the correct field and dispatches `input`/`change` events |
| `voice-engine.js`           | Wraps `webkitSpeechRecognition` and `speechSynthesis` in a small promise API |
| `conversation-manager.js`   | The conversation state machine — asks questions, parses answers, handles voice commands, confirms before "submission" |
| `popup.html` / `.css` / `.js` | The toolbar popup UI (Start/Stop buttons, live status, conversation log) |
| `test-form.html`            | A sample form with every supported field type, for local testing        |
| `icons/`                    | Extension toolbar icons                                                 |

---

## 2. Installation (Load Unpacked)

1. Unzip this folder somewhere on disk (e.g. `~/voxfill`).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `voxfill` folder (the one containing `manifest.json`).
5. VoxFill's microphone icon should appear in your toolbar. Pin it for easy access (puzzle-piece icon → pin).

> VoxFill needs microphone access. The **first time** you click "Start Voice
> Assistant" on a given website, Chrome will show a permission prompt asking
> whether that site can use your microphone — click **Allow**. This is a
> per-site browser permission, not something VoxFill can bypass or store.

---

## 3. Testing it

1. Open the included `test-form.html` in Chrome:
   * Easiest: go to `chrome://extensions`, find VoxFill, and note its ID — or
     simply drag `test-form.html` into a Chrome tab, or open it via
     `File > Open File...` in Chrome.
2. Click the VoxFill toolbar icon, then **Start Voice Assistant**.
3. Allow microphone access if prompted.
4. VoxFill will speak how many fields it found and their names, then ask for
   the first one. Answer out loud after each question — wait for VoxFill to
   finish speaking before you answer.
5. Try the field types in `test-form.html`:
   * **Full Name** – just say your name.
   * **Email Address** – say it like `"priya at gmail dot com"`.
   * **Phone Number** – say the digits one at a time, e.g. `"nine eight seven six five four three two one zero"`.
   * **Date of Birth** – say e.g. `"22 July 1998"` or `"07/22/1998"`.
   * **Preferred Track** (dropdown) – say one of the read-out options, e.g. `"Accessibility"`.
   * **Gender** (radio) – say `"female"`, `"male"`, or `"prefer not to say"`.
   * **Interests** (checkbox group) – say one or more, e.g. `"workshops and keynotes"`.
   * **Subscribe to newsletter** (single checkbox) – say `"yes"` or `"no"`.
   * **Additional Notes** (textarea) – say a sentence.
6. Try the voice commands at any point when VoxFill is listening:
   * *"What is left?"* – lists remaining required fields, then repeats the current question.
   * *"Repeat"* – repeats the current question.
   * *"Change my name"* (or "change my \<field>") – jumps back to that field so you can redo it.
   * *"Skip this field"* – moves on without filling it.
   * *"Read filled details"* – reads back everything filled so far.
   * *"Stop listening"* – ends the session immediately.
7. Once every field has been asked about, VoxFill reads a full summary and
   asks for confirmation. Say **"yes"** to finish (it will *not* click
   submit — you do that yourself), **"no"** to keep editing, or name a field
   to jump back to it.

---

## 4. How field detection works (no hardcoding)

`form-scanner.js` looks at every visible `<input>`, `<select>`, and
`<textarea>` on the page and derives a label using, in order:

1. `<label for="id">` matching the field's `id`
2. A `<label>` element that wraps the field
3. `aria-label`
4. `aria-labelledby` (resolves the referenced element's text)
5. `placeholder`
6. Nearby preceding text / `<legend>` in a `<fieldset>`
7. A "humanized" version of the `name` or `id` attribute (e.g. `full_name` → "Full name")

Radio buttons and checkboxes sharing a `name` are automatically grouped into
a single question with their combined options. Password, hidden, file, and
submit/button inputs are always skipped.

---

## 5. Privacy & safety

* **No backend.** All speech recognition and synthesis happens via the
  browser's built-in Web Speech APIs — nothing is sent to VoxFill's own
  servers (there are none).
* **No API keys, no telemetry.**
* VoxFill **never** fills or asks about password fields, and does not
  collect OTPs or banking details.
* VoxFill **never** clicks a submit button. It always stops after reading a
  final summary and asks you to review and submit yourself.
* VoxFill does not attempt to detect, solve, or bypass CAPTCHAs.

---

## 6. Known limitations (MVP scope)

* Built and tested against plain HTML forms. Highly dynamic single-page-app
  forms (e.g. fields that appear/disappear based on other answers, custom
  React/MUI widgets that don't use real `<input>` elements) may not be fully
  detected yet — `form-filler.js` already uses the native property setter so
  React-controlled `<input>`/`<textarea>` elements pick up the change, but
  custom non-native widgets (e.g. div-based dropdowns) are a good next step.
* Speech recognition quality depends on Chrome's underlying engine, your
  microphone, and accent/background noise — if recognition repeatedly
  mishears you, say **"repeat"** and try again more slowly.
* Only `en-US` is configured by default; language can be changed by editing
  the `lang` values in `voice-engine.js`.
* Works on regular `http(s)` pages; it does not run on internal
  `chrome://` pages.

## 7. Roadmap ideas (not implemented yet)

* Detection for custom-styled dropdowns/comboboxes and date pickers that
  aren't native `<select>`/`<input type="date">` elements.
* MutationObserver-based re-scanning for forms that reveal new fields as the
  user answers (multi-step/conditional forms).
* Multi-language support with a language picker in the popup.
* Keyboard shortcut to start/stop without opening the popup.
