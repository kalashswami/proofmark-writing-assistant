# Proofmark Desktop for Windows

Proofmark Desktop brings Proofmark's checks to the text boxes in your desktop apps: the Claude desktop app's message box, WhatsApp, Outlook, Teams, Slack, Discord, Notepad, Word and others. It runs from the system tray. When you click into a text box, the Proofmark button appears in its corner and underlines show what to fix. Hover an underline to see the suggestion, or click the button for the full list.

The browser extension covers websites. This app covers everything outside the browser.

## Build and run

You need the **.NET 7 SDK or newer**. Check by opening PowerShell and running:

```
dotnet --version
```

If that prints 7 or higher, you're set. If not, install the .NET SDK from https://dotnet.microsoft.com/download.

Then, in the `desktop` folder of this repository, double-click **run.cmd**, or run:

```
dotnet run -c Release
```

The first build downloads one package (Microsoft WebView2) and takes a minute. Proofmark then appears in the system tray next to the clock. You may need to click the ^ arrow to see it.

To get a standalone copy you can start without the SDK, double-click **publish.cmd**. The app lands in `publish\ProofmarkDesktop.exe`. To start it at login, press Win+R, type `shell:startup`, and put a shortcut to that exe in the folder that opens.

## Using it

- **Instant checks** run on your PC as you type, with the same rules as the browser extension.
- **Hover an underline** to see the fix, then click **Accept** or **Dismiss**.
- **Accept all** in the panel applies every direct fix in the category you're viewing, one after another. Suggestions that need a rewrite stay listed.
- **Point at a suggestion in the panel** and its word gets a red box in your text. If the word is scrolled out of sight, Proofmark scrolls to it.
- **Repeated words:** when the same fix appears more than once (like "Yagi" all through a document), Accept asks whether to **Change all** or **Just this one**. Dismiss on a word offers **Ignore everywhere**, which adds it to your ignored words (editable in Settings).
- **Scrolling:** underlines disappear the moment the text scrolls and are redrawn on the words, so they never float.
- **Backup engine:** in Settings, pick a backup (for example Groq's free tier). If the main engine is busy or rate-limited, Proofmark retries twice and then hands the request to the backup.
- **Click the floating button** to open the panel. It has every suggestion, plus Deep check, Rewrite (concise, formal, friendly, confident) and **Pause in this app**.
- **Tray icon menu:** Pause, Settings, *What Proofmark sees* and Quit. *What Proofmark sees* tells you whether an app exposes its text box, which helps when something doesn't work.

### Free smart checks

Open **Settings** from the tray icon.
- **A model on this computer:** pick Ollama or LM Studio. With Ollama, run `ollama pull llama3.2` once. The desktop app doesn't need the `OLLAMA_ORIGINS` setting the browser extension needs.
- **LanguageTool:** tick the box to add its free grammar pass.
- **Claude API:** optional and paid.

Text goes to an engine only when you press Deep check or Rewrite.

## How it works

This follows the same approach Grammarly's desktop app uses: Windows accessibility plus a transparent overlay.

1. **Find the text box.** Proofmark asks Windows UI Automation for the focused element every 0.4 seconds. It keeps it if it's an editable text box (an Edit or Document control, not a password field, not read-only). Chromium-based apps, including the Claude desktop app, WhatsApp, the new Outlook, Teams, Slack and Discord, support UI Automation natively since Chromium 126.
2. **Read the text.** It reads the text through `TextPattern`, or `ValuePattern` for simple boxes.
3. **Check it.** Proofmark runs the exact `engine.js` from the browser extension inside a hidden WebView2. The desktop app and the extension always agree.
4. **Measure.** It finds each flagged phrase with `TextPatternRange.FindText` and asks for `GetBoundingRectangles()`, the on-screen boxes in physical pixels.
5. **Draw.** Underlines go in a transparent, click-through window placed exactly over the text box. The button, card and panel are separate windows that never take focus away from the app you're typing in.
6. **Apply.** To accept a fix, Proofmark selects the phrase through UI Automation and checks that the app really selected that text. Only then does it type the replacement, so the app's own undo (Ctrl+Z) works. Line breaks in rewrites are typed as Shift+Enter, so chat apps don't send your message early. If an app won't allow the edit, the fix is copied to your clipboard instead.

## If an app doesn't show the button

- **Check what Proofmark sees.** Click into the app's text box, then open *What Proofmark sees* from the tray. If the app shows up but "Can measure word positions" says no, fixes still work from the panel, but there are no underlines.
- **Electron apps (Claude desktop, Slack, Discord).** If they show nothing at all, quit the app and start it once with accessibility forced on. Press Win+R and enter the app's exe path followed by `--force-renderer-accessibility`, for example:
  `"%LOCALAPPDATA%\AnthropicClaude\claude.exe" --force-renderer-accessibility`
  The install path can differ on your PC.
- **Apps running as administrator.** Windows doesn't let a normal app read them. Run Proofmark as administrator only if you need this.
- **Browsers, VS Code and terminals** are skipped on purpose: the browser extension covers browsers, and code editors aren't prose. Change the list in Settings.
- **Logs** are in `%LOCALAPPDATA%\Proofmark\log.txt`.

## Files

- `FieldWatcher.cs`: UI Automation (find, read, measure, select and replace)
- `EngineHost.cs`: runs `engine/engine.js` in WebView2
- `Overlay.cs`: underline layer, floating button, card and panel
- `Controller.cs`: connects everything, plus the tray icon
- `AiClient.cs`: Ollama, LM Studio, OpenAI-compatible servers, Claude and LanguageTool
- `SettingsWindow.cs`, `Support.cs`, `Native.cs`, `Program.cs`

## Known limits

- **First version.** It was written without access to a Windows PC, so expect some rough edges on the first run. If the build or an app misbehaves, send the error text or the log file.
- **Multiple monitors** with different display scaling can make underlines land slightly off on the secondary monitor.
- **Not supported:** games, remote-desktop windows and apps that draw their own text without accessibility (some older Java apps) show nothing.
- **Plain-text settings:** the Claude key is stored unencrypted in `%APPDATA%\Proofmark\settings.json`. Prefer the free local engines, or use a key you can revoke.
