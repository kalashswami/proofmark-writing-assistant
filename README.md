# Proofmark — a free, open-source writing assistant

Proofmark checks your spelling, grammar and style as you type, in the spirit of Grammarly. It comes in two parts:

| Part | Works in | Platforms |
| --- | --- | --- |
| **Browser extension** | Any text box on the web: Gmail, Outlook on the web, WhatsApp Web, Slack, Discord, search boxes, comment fields, forms | Chrome, Microsoft Edge, Brave, Arc (Windows, macOS, Linux, ChromeOS) |
| **Desktop app** | Text boxes in desktop apps: the Claude desktop app, WhatsApp, Outlook, Teams, Slack, Discord, Notepad, Word and others | Windows 10 and 11 (64-bit) |

A small floating button sits in the corner of the text box you're typing in. Underlines show what to fix; hover one to see the suggestion and click **Accept**. Click the button for the full list, **Deep check**, **Rewrite** (concise, formal, friendly, confident) and **Pause**.

The instant checks run entirely on your computer and need no account or setup. Optional AI checks can use free engines (Chrome's built-in AI, Ollama, LM Studio, LanguageTool, free cloud tiers) or your own paid Claude API key.

**Website:** https://kalashswami.github.io/proofmark-writing-assistant/

> Proofmark is an independent project. It is not affiliated with, endorsed by, or built from the code of Grammarly, Inc.

---

## Download

Go to the **[Releases page](https://github.com/kalashswami/proofmark-writing-assistant/releases/latest)** and download:

- `proofmark-extension.zip` — the browser extension
- `Proofmark-Desktop-win-x64.zip` — the Windows desktop app (no .NET install needed)

You can install either one or both. They don't depend on each other.

---

## Install the browser extension

Works in Chrome, Edge, Brave and Arc on any operating system. Proofmark isn't in the Chrome Web Store, so it's installed in developer mode. This is safe and takes about a minute.

1. Download `proofmark-extension.zip` from the [Releases page](https://github.com/kalashswami/proofmark-writing-assistant/releases/latest).
2. Unzip it. On Windows, right-click the file → **Extract All…** → **Extract**. On a Mac, double-click it. You now have a folder named `proofmark-extension`.
3. Move that folder somewhere permanent, such as your Documents folder. The browser loads the extension from this folder every time it starts, so don't delete it.
4. Open the extensions page by typing this in the address bar and pressing Enter:
   - Chrome, Brave, Arc: `chrome://extensions`
   - Edge: `edge://extensions`
5. Turn on **Developer mode** (top-right in Chrome; left sidebar in Edge).
6. Click **Load unpacked** and choose the `proofmark-extension` folder (the one that contains `manifest.json`).
7. Click the puzzle-piece icon in the toolbar and pin **Proofmark**.
8. Refresh any tabs that were already open. Click into a text box and start typing.

To try it on sample fields, click the Proofmark icon and choose **Open test page**.

Chrome may show a "Disable developer mode extensions" notice when it starts. Click the X to keep Proofmark running.

**Update:** download the new zip, replace the contents of your `proofmark-extension` folder, then click the ↻ reload icon on Proofmark's card in `chrome://extensions`.

**Remove:** click **Remove** on Proofmark's card in `chrome://extensions`, then delete the folder.

Firefox: not packaged. Advanced users can change `"background"` in `manifest.json` to `{"scripts": ["background.js"]}` and load it as a temporary add-on.

---

## Install the desktop app (Windows)

Needs Windows 10 or 11, 64-bit. Nothing else to install: the download includes everything it needs.

1. Download `Proofmark-Desktop-win-x64.zip` from the [Releases page](https://github.com/kalashswami/proofmark-writing-assistant/releases/latest).
2. Right-click the zip → **Extract All…** → **Extract**. Running it from inside the zip won't work.
3. Open the extracted `Proofmark-Desktop` folder and double-click **ProofmarkDesktop.exe**.
4. Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info** → **Run anyway**. This only appears the first time.
5. Proofmark starts in the system tray next to the clock (click the **^** arrow if you don't see it). Click into a text box in any app and start typing.

Keep `ProofmarkDesktop.exe` and the `engine` folder next to it together; the app needs both.

**Start automatically at login:** press **Win+R**, type `shell:startup`, press Enter, and put a shortcut to `ProofmarkDesktop.exe` in the folder that opens.

**Tray menu:** right-click the Proofmark tray icon for **Pause**, **Settings**, **What Proofmark sees** and **Quit**.

**Requirement — Microsoft Edge WebView2 Runtime:** Proofmark's checking engine runs in WebView2, which comes with Windows 11 and up-to-date Windows 10. If the app reports that WebView2 is missing, install the **Evergreen Bootstrapper** from [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/) and start Proofmark again.

**Remove:** choose **Quit** from the tray menu, then delete the `Proofmark-Desktop` folder. Settings live in `%APPDATA%\Proofmark` and logs in `%LOCALAPPDATA%\Proofmark`; delete those folders too if you want a clean removal.

### If an app doesn't show the Proofmark button

- Open **What Proofmark sees** from the tray while your cursor is in that app's text box. It tells you whether the app exposes its text to Windows accessibility.
- Electron apps (Claude desktop, Slack, Discord): if nothing appears, quit the app and start it once with accessibility switched on. Press **Win+R** and run the app's exe followed by `--force-renderer-accessibility`, for example
  `"%LOCALAPPDATA%\AnthropicClaude\claude.exe" --force-renderer-accessibility` (the path can differ on your PC).
- Apps running as administrator can't be read by a normal app. Run Proofmark as administrator only if you need this.
- Browsers, code editors and terminals are skipped on purpose (the extension covers browsers). You can change the list in Settings.
- Logs: `%LOCALAPPDATA%\Proofmark\log.txt`.

---

## Optional: smarter AI checks (free options available)

Instant checks need nothing. **Deep check**, **Rewrite** and sentence simplification use an AI engine you choose:

- Extension: click the Proofmark icon → **Smart checks and rewrites** → pick an engine → **Save**, then refresh your tabs.
- Desktop app: tray icon → **Settings**.

| Engine | Cost | Where your text goes |
| --- | --- | --- |
| Chrome's built-in AI (Gemini Nano) — extension only, Chrome 138+ | Free | Stays on your computer |
| Ollama or LM Studio (a model on your computer) | Free | Stays on your computer |
| LanguageTool grammar pass | Free | LanguageTool's server, or your own server |
| Free cloud tiers (Groq, Google Gemini, other OpenAI-compatible services) | Free with limits | That service |
| Claude API | Paid, your own key | Anthropic |

Quick start with Ollama (free, private):

1. Install Ollama from [ollama.com](https://ollama.com).
2. In PowerShell or Terminal run: `ollama pull llama3.2`
3. **Extension only:** allow extensions to reach Ollama.
   - Windows: quit Ollama from the tray, search the Start menu for **"Edit environment variables for your account"**, add a variable named `OLLAMA_ORIGINS` with the value `chrome-extension://*`, then start Ollama again.
   - macOS: run `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`, then quit and reopen Ollama (repeat after each restart).
   - The desktop app doesn't need this step.
4. Choose Ollama in Proofmark's settings, enter the model name `llama3.2`, and click **Save**:
   - Extension: **Free AI model** → App: **Ollama (on this computer)**.
   - Desktop app: **A model on this computer (free)** → **Ollama (on this PC)**.

Step-by-step setup for every engine is in [extension/README.md](extension/README.md) and [desktop/README.md](desktop/README.md).

**Privacy:** text leaves your computer only if you choose a cloud engine, and only for Deep check, Rewrite or the optional "check with AI as I write" feature. API keys are stored locally: in your browser profile for the extension, and unencrypted in `%APPDATA%\Proofmark\settings.json` for the desktop app. Prefer the free local engines, or use a key you can revoke.

---

## Build from source

Clone the repository:

```
git clone https://github.com/kalashswami/proofmark-writing-assistant.git
cd proofmark-writing-assistant
```

**Extension:** there is no build step. Follow the extension install steps above, but in step 6 choose the `extension` folder of the clone.

**Desktop app:** needs Windows and the [.NET SDK](https://dotnet.microsoft.com/download) 7 or newer (check with `dotnet --version`).

- Build and run: double-click `desktop\run.cmd`, or run `dotnet run -c Release --project desktop\ProofmarkDesktop.csproj`
- Standalone copy that still needs the .NET Desktop Runtime: `desktop\publish.cmd` (output in `desktop\publish\`)
- Fully self-contained copy for other PCs: `desktop\share.cmd` (output in `desktop\Proofmark-Desktop-for-sharing.zip`)

**Releases:** [the release workflow](.github/workflows/release.yml) builds the self-contained Windows app on GitHub's servers, zips the extension, and attaches both to a new release. Start it either by pushing a tag such as `v0.6.1`, or from the **Actions** tab → **Build and release** → **Run workflow**, entering the version (for example `v0.6.1`). Leave the version empty to only build the zips as downloadable build artifacts.

---

## Repository layout

```
extension/   Chrome/Edge extension (Manifest V3) — see extension/README.md
desktop/     Windows desktop app (C#, WPF, UI Automation, WebView2) — see desktop/README.md
.github/     Release build workflow
```

`engine.js` is the shared checking engine. The extension and the desktop app each carry a copy (`extension/engine.js`, `desktop/engine/engine.js`).

## How it works

Proofmark follows the approach Grammarly has described publicly in its engineering blog and research (the GECToR paper), written from scratch:

- Suggestions are a text span plus one edit (keep, delete, append, replace).
- On websites, underlines are drawn in an overlay layer instead of inside the page's text box, and fixes are applied as normal edits so the site's undo still works.
- On Windows, the desktop app reads the focused text box through UI Automation, measures word positions on screen, draws underlines in a transparent click-through window, and types accepted fixes.

Details are in [extension/README.md](extension/README.md) and [desktop/README.md](desktop/README.md).

## Known limits

- Google Docs isn't supported (it draws text on a canvas that extensions can't read).
- The desktop app is Windows-only; there is no macOS desktop app yet (the browser extension works on macOS).
- Multiple monitors with different display scaling can put underlines slightly off on the second monitor.
- Fields over 30,000 characters aren't checked.

## License

Proofmark is free software, licensed under the [GNU General Public License v3.0](LICENSE). You can use, study, share and modify it; if you distribute a modified version, it must also be released under GPL-3.0 with its source code.

Third-party material is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
