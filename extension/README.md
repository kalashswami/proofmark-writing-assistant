# Proofmark for the browser

Proofmark checks your writing in any text box on the web: email drafts, chat boxes, search bars, comment fields, forms. A small floating button sits in the corner of the field you're typing in. Underlines show what to fix, and hovering one shows the suggestion.

## Install (Chrome, Edge, Brave, Arc)

1. Download `proofmark-extension.zip` from the repository's Releases page and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped `proofmark-extension` folder.
5. Pin Proofmark from the puzzle-piece menu.
6. Click the Proofmark icon, then **Open test page** to try it on sample fields.

The instant checks run entirely in your browser and need no setup. **Deep check** and **Rewrite** need an engine, and the free options below cover them without paying for an API.

## Free smart checks (no API billing)

Pick one in Proofmark's settings under **Smart checks and rewrites**, then click **Save** and refresh your tabs.

| Option | Cost | Privacy | Quality | Needs |
| --- | --- | --- | --- | --- |
| Chrome's built-in AI (Gemini Nano) | Free | Text stays on your computer | Good for short messages | Desktop Chrome 138+; about 22 GB free disk; GPU with more than 4 GB of memory **or** 16 GB RAM and 4+ CPU cores |
| Free AI model → Ollama or LM Studio (on this computer) | Free | Text stays on your computer | Good to very good, depending on the model | A one-time install; 8 GB RAM is enough for small models |
| LanguageTool grammar pass | Free | Free server: text goes to LanguageTool. Your own server: stays local | Strong grammar and spelling rules, no rewrites | Nothing for the free server; Java or Docker to run your own |
| Claude API | Paid | Text goes to Anthropic | Most thorough | An API key with credits |

LanguageTool can run together with any of the other engines. Deep check then merges both sets of results, and each suggestion shows which engine found it.

### Chrome's built-in AI

1. In settings, choose **Chrome's built-in AI**.
2. If it says the model needs a download, click **Download the model** and leave the settings tab open until it finishes. It's a one-time download.
3. Click **Save**.

If it says "Not supported on this computer," your machine is below Chrome's hardware minimum. Use a local model or LanguageTool instead.

### Ollama (free, open models on your computer)

1. Install Ollama from [ollama.com](https://ollama.com).
2. Download a model. In Terminal (Mac) or PowerShell (Windows), run:
   ```
   ollama pull llama3.2
   ```
   `llama3.2` (3B) is fast on most laptops. `qwen2.5:7b` or `gemma3` give better edits if you have 16 GB of RAM.
3. Let Chrome extensions talk to Ollama. By default Ollama blocks requests from extensions.
   - **Mac:** run `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`, then quit and reopen Ollama. Repeat after a restart.
   - **Windows:** quit Ollama from the system tray. Search for "Edit environment variables for your account", add `OLLAMA_ORIGINS` with the value `chrome-extension://*`, then start Ollama again.
4. In settings, choose **Free AI model**, set App to **Ollama (on this computer)**, type the model name you pulled, and click **Save**.

### LM Studio

1. Install LM Studio and download a model from its search tab.
2. Open the **Developer** tab and start the server (default `http://localhost:1234`).
3. In settings, choose **Free AI model**, set App to **LM Studio**, enter the model name LM Studio shows, and click **Save**.

### Free cloud tiers (quickest setup)

In settings, choose **Free AI model**, then pick an app:
- **Groq (cloud, free tier):** about 1,000 checks a day with `llama-3.3-70b-versatile`. Get a key at console.groq.com/keys. The best free choice for most people.
- **Google Gemini (cloud, free tier):** only about 20 checks a day on `gemini-3.8-flash`. Get a key at aistudio.google.com/apikey.

Paste the key, click **Save**, and allow Proofmark to reach the service when Chrome asks. Your text goes to that service when you press Deep check or Rewrite. Check each service's terms, because free tiers can allow your text to be used for training. Any other OpenAI-compatible service works through **Other OpenAI-compatible server**.

### LanguageTool

Tick **Add a LanguageTool grammar pass**.
- **LanguageTool's free server:** no setup. It allows 20 checks a minute and 20 KB of text per check, sends your text to LanguageTool, and isn't meant for heavy automated use.
- **Your own server:** run LanguageTool locally (it's open source) and enter its address, such as `http://localhost:8081`. You get no limits, and your text stays on your computer.

## Paid option: Claude API

Choose **Claude API** and paste a key from the Claude Console. The key is stored only in this browser profile.

## Where it works

| Surface | Field type | Status |
| --- | --- | --- |
| Gmail, Outlook on the web, most webmail | contenteditable | Works |
| WhatsApp Web, Slack, Discord, Teams (web) | contenteditable | Works |
| Google and other search boxes | textarea or input | Works, with a compact button |
| Comment boxes, forms, CMS editors | textarea, input, contenteditable | Works |
| Fields inside iframes | any | Works (the script runs in every frame) |
| Google Docs | canvas rendering | Not supported (no editable text in the page to read) |
| Code editors (VS Code web, CodeMirror, Ace) | — | Skipped on purpose |
| Password and email-address fields | — | Skipped on purpose |
| Outlook and WhatsApp **desktop** apps | native windows | Needs a desktop companion (see below) |

## How it works

This follows Grammarly's published approach for running on any website, from their engineering post "Making Grammarly Feel Native On Every Website". Proofmark is written from scratch, not copied from their code.

1. **Detect.** A `focusin` listener on the document reads the real target through shadow DOM (`event.composedPath()[0]`). It walks up to the editable root: a `<textarea>`, a text or search `<input>`, or the top-most `contenteditable` element. Fields marked `data-proofmark="false"` or `data-gramm="false"` are left alone.
2. **Read.** Inputs give their `value`. Rich editors are walked node by node into plain text: `<br>` and block elements become line breaks. A map links every character back to its DOM text node.
3. **Check.** The shared rules engine (`engine.js`) runs a few hundred milliseconds after typing pauses. Each suggestion is a span plus one edit: keep, delete, append or replace. That is the tagging idea from Grammarly's open-source GECToR paper.
4. **Measure.** `Range.getClientRects()` returns the on-screen boxes for each flagged span. A `<textarea>` can't be measured this way. For those, an invisible mirror `<div>` copies the textarea's font, padding, width and scroll position, and is measured instead.
5. **Draw.** Underlines, the floating button, cards and the panel all live in one closed shadow root appended to `<html>`. The page's own DOM is never modified. Grammarly moved to an overlay like this because injecting markup into fields corrupted text and broke sites. The layer is clipped to the field and any scrolling parent. Positions are stored relative to the field, so page scrolling only moves the layer. Underlines are re-measured only when the text or the field size changes, with a one-second poll as a fallback.
6. **Apply.** Accepting a suggestion selects the span and runs `document.execCommand('insertText')`. The site's editor sees an ordinary edit, its own state stays in sync, and Ctrl+Z still works. If the editor blocks that, Proofmark falls back to the native value setter plus an `input` event.

### The floating button

- It appears in the bottom-right corner of the focused field. On single-line fields it is centered vertically.
- **States:** spinning while checking, a count badge colored by the most serious category, green when clean, grey when paused on the site.
- **Accept all** at the top of the panel applies every suggestion that has a direct fix, in the category you're viewing. Suggestions that need a rewrite, such as passive voice, stay listed. Each Accept button still works on its own.
- **Pointing at a suggestion** in the panel puts a red box around its word in the text box, scrolling to it if needed. The panel opens beside the text box when there is room, so it doesn't cover your words.
- **Spelling:** every word is checked against a full English dictionary (about 163,000 word forms from Hunspell's en_US list, ranked by how common they are), so typos like “provde” or “wark” are caught as you type. Names in the middle of a sentence, acronyms, links and email addresses are skipped.
- **AI as you write:** with an AI engine set up, Proofmark sends the paragraph you're working on to it about two seconds after you stop typing, much like Gmail's built-in suggestions. Rewrites of confusing sentences appear as **Simplify the sentence**. Each paragraph is checked once until you change it, with at least 8 seconds between checks. Free cloud tiers have daily limits, so automatic checks stop at 15 a day on Gemini and 800 a day on Groq, leaving room for Deep check. They never run with the paid Claude API. Untick **Check with AI as I write** in settings to turn them off.
- **Accept all with a sentence rewrite:** when an AI rewrite covers smaller fixes in the same sentence, Accept all uses the rewrite.
- **All caps:** text typed in capitals is flagged as shouting, and Accept converts it to normal sentence case (keeping “I” and common acronyms like USB or PDF). Smaller fixes inside it appear once it's fixed.
- **Repeated words:** Accept asks whether to change every copy of the same fix. Dismiss on a word offers **Ignore everywhere**.
- **Busy AI services** are retried automatically (after 1.5 s, then 4 s).
- **Clicking it** opens the panel. The panel has a filterable list of suggestions, Deep check, Rewrite (concise, formal, friendly, confident), and **Pause on this site**.
- Pressing any Proofmark button keeps the field focused (`mousedown` is cancelled), so your selection is kept for Rewrite.

## Desktop apps (Outlook, WhatsApp)

Desktop apps don't run web pages that an extension can reach. Grammarly's desktop app works through the operating system instead. On a Mac it requires the Accessibility permission, and without it the app can't give writing feedback. A Proofmark desktop companion would work the same way:

- **macOS:** read the focused text element through the Accessibility API (`AXUIElement`: `kAXFocusedUIElementAttribute`, `kAXValueAttribute`, `kAXBoundsForRangeParameterizedAttribute` for underline positions). Draw underlines and the button in a transparent, click-through overlay window.
- **Windows:** use UI Automation (`TextPattern` and `TextRange.GetBoundingRectangles`) for the same job, with a layered topmost window for the overlay.
- Reuse `engine.js` unchanged. It has no DOM dependencies.

## Files

- `manifest.json`: Manifest V3, content script on all sites and frames
- `engine.js`: rules, span rebasing and Claude prompts (pure functions, shared with the Proofmark editor)
- `content.js`: field detection, measuring, overlay, floating button, card and panel
- `host-extension.js`: settings storage and messaging, the only browser-specific part of the content script
- `background.js`: the only code that sends text off the page; routes Deep check, Rewrite and automatic checks to the chosen engine
- `spell.js`, `dict/words.txt`: the spelling dictionary and suggester (runs in the background worker)
- `offscreen.html`, `offscreen.js`: run Chrome's built-in Gemini Nano model
- `popup.html`, `popup.js`, `popup.css`: settings (site toggle, categories, API key, model)
- `test.html`, `lab.js`: the test page

## Possible next upgrade: Harper

[Harper](https://github.com/automattic/harper) is an open-source English grammar checker (Apache-2.0) that runs offline through WebAssembly. Its author says it lints a document in milliseconds. It could replace Proofmark's hand-written rules for instant checks with no AI involved. Adding it means downloading the `harper.js` package with npm and bundling its files into the extension. That download step couldn't be done in the workspace where this version was built.

## Known limits

- **Firefox:** change `"background"` in the manifest to `{"scripts": ["background.js"]}` before loading.
- **Closed shadow roots:** fields inside a site's closed shadow roots can't be reached by any extension.
- **Very long fields:** fields over 30,000 characters are not checked.
