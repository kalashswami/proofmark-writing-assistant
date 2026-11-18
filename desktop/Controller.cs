using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace Proofmark
{
    /// <summary>
    /// Wires everything together: what the watcher sees, what the engine flags, what the overlay draws,
    /// and what happens when you accept, dismiss, deep-check or rewrite.
    /// </summary>
    internal sealed class Controller
    {
        private readonly Application app;
        private readonly FieldWatcher watcher = new FieldWatcher();
        private readonly EngineHost engine = new EngineHost();
        private readonly AiClient ai = new AiClient();
        private AppSettings settings = AppSettings.Load();

        private UnderlineLayer layer = null!;
        private WidgetWindow widget = null!;
        private CardWindow card = null!;
        private PanelWindow panel = null!;
        private ToastWindow toast = null!;
        private System.Windows.Forms.NotifyIcon tray = null!;
        private System.Windows.Forms.ToolStripMenuItem pauseItem = null!;

        private FieldSnapshot? field;
        private FieldSnapshot? lastSeen;
        private string text = "", rawText = "";
        private SpellCheck? spell;
        private List<Suggestion> rules = new List<Suggestion>(), aiSugs = new List<Suggestion>(), sugs = new List<Suggestion>();
        private List<string> tone = new List<string>();
        private Dictionary<string, Rect[]> rects = new Dictionary<string, Rect[]>();
        private readonly Dictionary<string, HashSet<string>> dismissed = new Dictionary<string, HashSet<string>>();
        private readonly DispatcherTimer debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        private readonly DispatcherTimer hover = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(90) };
        private readonly DispatcherTimer reveal = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
        private Suggestion? revealTarget;
        private bool checking, deepBusy, panelOpen, applying;
        private string status = "", filter = "all";
        private string? activeId;
        private Question? question;
        private RewriteJob? rewrite;
        private Suggestion? candidate;
        private DateTime candidateSince, hideAt = DateTime.MaxValue;
        private SettingsWindow? settingsWindow;

        public Controller(Application app) { this.app = app; }

        public async Task StartAsync()
        {
            try { await engine.InitAsync(); }
            catch (Exception ex)
            {
                Log.Write("engine: " + ex);
                MessageBox.Show("Proofmark couldn't start its writing engine. It needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and most Windows 10 PCs.\n\n" + ex.Message, "Proofmark");
                app.Shutdown();
                return;
            }
            spell = new SpellCheck();
            if (!spell.Available) Log.Write("Windows spell checker unavailable; using the built-in word list only");
            layer = new UnderlineLayer();
            widget = new WidgetWindow();
            card = new CardWindow();
            panel = new PanelWindow();
            toast = new ToastWindow();

            widget.Clicked += () => { if (panelOpen) ClosePanel(); else OpenPanel(); };
            card.Accept += g => AskOrAccept(g, fromCard: true);
            card.Dismiss += g => AskOrDismiss(g, fromCard: true);
            card.Answer += (g, all) => Answer(g, all);
            panel.Accept += g => AskOrAccept(g, fromCard: false);
            panel.Dismiss += g => AskOrDismiss(g, fromCard: false);
            panel.Answer += (g, all) => Answer(g, all);
            panel.AcceptAll += list => AcceptAll(list);
            panel.Hover += g => OnPanelHover(g);
            panel.Filter += f => { filter = f; RenderPanel(); };
            panel.Close += ClosePanel;
            panel.Deep += () => DeepCheck();
            panel.RewriteGoal += goal => Rewrite(goal);
            panel.UseRewrite += () => UseRewrite();
            panel.DiscardRewrite += () => { rewrite = null; RenderPanel(); };
            panel.PauseApp += PauseCurrentApp;
            panel.OpenSettings += OpenSettings;

            debounce.Tick += async (_, _) => { debounce.Stop(); await Check(); };
            hover.Tick += (_, _) => HoverTick();
            reveal.Tick += async (_, _) => { reveal.Stop(); await RevealIfOffscreen(); };
            hover.Start();

            BuildTray();
            ApplySettings();
            watcher.Changed += snap => app.Dispatcher.BeginInvoke(new Action(() => OnField(snap)));
            watcher.Start();
        }

        // ---------- tray ----------
        private void BuildTray()
        {
            System.Drawing.Icon icon;
            try { icon = new System.Drawing.Icon(System.IO.Path.Combine(AppContext.BaseDirectory, "proofmark.ico")); }
            catch { icon = System.Drawing.SystemIcons.Application; }
            tray = new System.Windows.Forms.NotifyIcon { Icon = icon, Text = "Proofmark", Visible = true };
            var menu = new System.Windows.Forms.ContextMenuStrip();
            pauseItem = new System.Windows.Forms.ToolStripMenuItem("Pause Proofmark", null, (_, _) => TogglePause());
            menu.Items.Add(pauseItem);
            menu.Items.Add("Settings…", null, (_, _) => OpenSettings());
            menu.Items.Add("What Proofmark sees…", null, (_, _) => ShowDiagnostics());
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            menu.Items.Add("Quit Proofmark", null, (_, _) => Quit());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (_, _) => OpenSettings();
            tray.ShowBalloonTip(5000, "Proofmark is running", "Click into a text box in any app. The Proofmark button appears in its corner.", System.Windows.Forms.ToolTipIcon.Info);
        }

        private void ApplySettings()
        {
            HashSet<string> skip = settings.SkipSet();
            watcher.SkipProcess = p => skip.Contains(p);
            watcher.Paused = settings.Paused;
            pauseItem.Text = settings.Paused ? "Resume Proofmark" : "Pause Proofmark";
            if (field != null) { Merge(); _ = MeasureAndRender(); }
        }

        private void TogglePause() { settings.Paused = !settings.Paused; settings.Save(); ApplySettings(); if (settings.Paused) HideAll(); }

        private void PauseCurrentApp()
        {
            if (field == null) return;
            settings.SkipApps = string.Join(", ", settings.SkipSet().Append(field.Process).Distinct());
            settings.Save();
            HideAll();
            ApplySettings();
        }

        private void OpenSettings()
        {
            if (settingsWindow != null) { settingsWindow.Activate(); return; }
            settingsWindow = new SettingsWindow(settings);
            settingsWindow.Saved += () => { settings = AppSettings.Load(); ApplySettings(); };
            settingsWindow.Closed += (_, _) => settingsWindow = null;
            settingsWindow.Show();
            settingsWindow.Activate();
        }

        private void ShowDiagnostics()
        {
            FieldSnapshot? f = field ?? lastSeen;
            string msg = f == null
                ? "Proofmark hasn't found a text box yet. Click into one in another app, then open this again.\n\nIf an app never works, it may not expose its text to Windows accessibility, or it may be running as administrator."
                : $"Last text box seen\n\nApp: {f.Process}\nType: {f.ControlType}  ({f.ClassName})\nCan measure word positions: {(f.HasTextPattern ? "yes" : "no")}\nCharacters: {f.Text.Length}\nSuggestions: {sugs.Count}\nUnderlined: {rects.Count}\n\nLog file: {System.IO.Path.Combine(Log.Dir, "log.txt")}";
            MessageBox.Show(msg, "What Proofmark sees");
        }

        private void Quit()
        {
            tray.Visible = false;
            tray.Dispose();
            watcher.Dispose();
            app.Shutdown();
        }

        // ---------- field updates ----------
        private void OnField(FieldSnapshot? snap)
        {
            if (snap == null) { field = null; HideAll(); return; }
            lastSeen = snap;
            bool newField = field == null || field.Generation != snap.Generation;
            bool textChanged = newField || snap.Text != field!.Text;
            if (newField)
            {
                aiSugs.Clear(); tone.Clear(); status = ""; rewrite = null; activeId = null; filter = "all";
                card.Hide(); ClosePanel(); rects.Clear(); sugs.Clear(); rules.Clear();
            }
            field = snap;
            if (textChanged)
            {
                string norm = TextOps.Norm(snap.Text);
                if (!newField && aiSugs.Count > 0 && norm != text) aiSugs = TextOps.Rebase(aiSugs, text, norm);
                if (!newField && norm != text) { rules = TextOps.Rebase(rules, text, norm); }
                text = norm;
                rawText = snap.Text;
                checking = true;
                card.Hide();
                Merge();
                RenderWidget();
                layer.Hide();
                debounce.Stop(); debounce.Start();
            }
            else
            {
                // The box moved, resized or scrolled. When it scrolled, drop the old underlines at once so they
                // never float over the wrong words, then redraw them where the words are now.
                if (snap.Scrolled) { layer.Hide(); card.Hide(); }
                _ = MeasureAndRender();
            }
        }

        private HashSet<string> Dismissed()
        {
            string key = field?.Process ?? "";
            if (!dismissed.TryGetValue(key, out HashSet<string>? set)) { set = new HashSet<string>(); dismissed[key] = set; }
            return set;
        }

        private async Task Check()
        {
            if (field == null) return;
            int gen = field.Generation;
            string t = text;
            List<Suggestion> found;
            try { found = t.Length >= FieldWatcher.MaxChars ? new List<Suggestion>() : await engine.RunEngine(t, Dismissed()); AddSpelling(found, t); }
            catch (Exception ex) { Log.Write("check: " + ex.Message); found = new List<Suggestion>(); }
            if (field == null || field.Generation != gen || text != t) return; // stale result
            rules = found;
            checking = false;
            Merge();
            await MeasureAndRender();
        }

        /// <summary>Adds Windows spell-checker findings that the rules didn't already flag.</summary>
        private void AddSpelling(List<Suggestion> found, string t)
        {
            if (spell == null || !spell.Available) return;
            HashSet<string> gone = Dismissed();
            foreach (var (start, len, word, fix) in spell.Check(t))
            {
                int end = start + len;
                if (found.Any(g => g.Start < end && g.End > start)) continue;
                var g = new Suggestion
                {
                    Id = $"winspell:{start}:{end}", Source = "rules", Rule = "winspell", Cat = "correctness", Mark = "sp",
                    Title = "Spelling", Why = $"“{word}” isn't in the Windows dictionary. Did you mean “{fix}”?",
                    Start = start, End = end, Original = word, Replacement = fix
                };
                if (!gone.Contains(g.DismissKey) && !settings.IsIgnored(word)) found.Add(g);
            }
            found.Sort((a, b) => a.Start != b.Start ? a.Start.CompareTo(b.Start) : a.End.CompareTo(b.End));
        }

        private void Merge()
        {
            var spans = new HashSet<(int, int)>(rules.Select(g => (g.Start, g.End)));
            sugs = rules.Concat(aiSugs.Where(g => !spans.Contains((g.Start, g.End))))
                .Where(g => settings.CategoryOn(g.Cat) && !(IsWord(g.Original) && settings.IsIgnored(g.Original)))
                .OrderBy(g => g.Start).ThenBy(g => g.End).ToList();
        }

        private async Task MeasureAndRender()
        {
            if (field == null) return;
            int gen = field.Generation;
            string t = text;
            if (field.HasTextPattern && sugs.Count > 0)
            {
                List<Probe> probes = sugs.Take(150).Select(g => new Probe(g.Id, g.Original, TextOps.Occurrence(t, g.Original, g.Start), TextOps.NormToRaw(rawText, g.Start))).ToList();
                Dictionary<string, Rect[]> res = await watcher.MeasureAsync(probes, gen);
                if (field == null || field.Generation != gen || text != t) return;
                rects = res;
                // Hide suggestions the app's text doesn't really contain (Word reports phantom spaces at line wraps)
                var probed = new HashSet<string>(probes.Select(p => p.Id));
                sugs = sugs.Where(g => !probed.Contains(g.Id) || rects.ContainsKey(g.Id)).ToList();
            }
            else rects = new Dictionary<string, Rect[]>();
            RenderAll();
        }

        // ---------- rendering ----------
        private void RenderAll()
        {
            if (field == null) { HideAll(); return; }
            DrawLayer();
            RenderWidget();
            if (panelOpen) RenderPanel();
            if (card.Current != null && !sugs.Contains(card.Current)) card.Hide();
        }

        private void DrawLayer()
        {
            if (field == null) return;
            layer.Draw(field.Bounds, sugs, rects, activeId);
        }

        private void RenderWidget()
        {
            if (field == null) return;
            string state = settings.Paused ? "off" : (checking || deepBusy) ? "checking" : sugs.Count > 0 ? "issues" : "clean";
            string worst = new[] { "correctness", "clarity", "style", "tone" }.FirstOrDefault(c => sugs.Any(g => g.Cat == c)) ?? "correctness";
            string tip = state == "checking" ? "Proofmark is checking" : sugs.Count > 0 ? $"Proofmark: {sugs.Count} suggestion{(sugs.Count == 1 ? "" : "s")}" : "Proofmark: no issues found";
            widget.Show(field.Bounds, state, sugs.Count, worst, tip);
        }

        private void OpenPanel() { if (field == null) return; card.Hide(); panelOpen = true; RenderPanel(); }
        private void ClosePanel() { panelOpen = false; panel.Hide(); activeId = null; DrawLayer(); }

        private void RenderPanel()
        {
            if (!panelOpen || field == null) return;
            var st = new PanelState
            {
                App = field.Process, Paused = settings.Paused, Sugs = sugs, Tone = tone, HasDeep = settings.HasDeep, HasRewrite = settings.HasLlm,
                DeepBusy = deepBusy, Applying = applying, Question = question, LanguageTool = settings.LanguageTool, Status = status, Filter = filter, Rewrite = rewrite,
                NoUnderlines = !field.HasTextPattern,
                DeepLabel = string.Join(" + ", new[] { settings.LanguageTool ? "LanguageTool" : "", settings.HasLlm ? settings.EngineName() : "" }.Where(x => x.Length > 0))
            };
            Rect anchor = widget.BoundsPx.IsEmpty ? new Rect(field.Bounds.Right - 40, field.Bounds.Bottom - 36, 40, 36) : widget.BoundsPx;
            panel.Show(st, anchor, field.Bounds);
        }

        private void HideAll()
        {
            layer.Hide(); widget.Hide(); card.Hide(); panel.Hide(); panelOpen = false; candidate = null;
        }

        private void HoverTick()
        {
            if (field == null || panelOpen || settings.Paused) return;
            if (card.IsMouseOver) { hideAt = DateTime.MaxValue; return; }
            Native.GetCursorPos(out Native.POINT p);
            Suggestion? hit = null; Rect hitRect = Rect.Empty; double best = double.MaxValue;
            foreach (Suggestion g in sugs)
            {
                if (!rects.TryGetValue(g.Id, out Rect[]? rs)) continue;
                foreach (Rect r in rs)
                {
                    if (r.IsEmpty) continue;
                    Rect grow = new Rect(r.X, r.Y, r.Width, r.Height + 4);
                    if (grow.Contains(p.X, p.Y) && r.Width < best) { hit = g; hitRect = r; best = r.Width; }
                }
            }
            DateTime now = DateTime.UtcNow;
            if (hit != null)
            {
                hideAt = DateTime.MaxValue;
                if (card.Current == hit) return;
                if (candidate != hit) { candidate = hit; candidateSince = now; return; }
                if ((now - candidateSince).TotalMilliseconds >= 280)
                {
                    activeId = hit.Id;
                    question = null;
                    card.Show(hit, hitRect, null);
                    DrawLayer();
                }
            }
            else
            {
                candidate = null;
                if (card.IsVisible)
                {
                    if (hideAt == DateTime.MaxValue) hideAt = now.AddMilliseconds(450);
                    else if (now >= hideAt) { card.Hide(); activeId = null; hideAt = DateTime.MaxValue; DrawLayer(); }
                }
            }
        }

        /// <summary>Pointing at a suggestion in the panel highlights its word in red, and scrolls to it if it's off screen.</summary>
        private void OnPanelHover(Suggestion? g)
        {
            activeId = g?.Id;
            DrawLayer();
            revealTarget = g;
            reveal.Stop();
            if (g != null) reveal.Start();
        }

        private async Task RevealIfOffscreen()
        {
            Suggestion? g = revealTarget;
            if (g == null || field == null || !panelOpen || activeId != g.Id) return;
            Rect box = field.Bounds;
            bool visible = rects.TryGetValue(g.Id, out Rect[]? rs) && rs.Any(r => !r.IsEmpty && r.Height > 0 && box.IntersectsWith(r));
            if (visible) return;
            bool moved = await watcher.ScrollIntoViewAsync(g.Original, TextOps.Occurrence(text, g.Original, g.Start), TextOps.NormToRaw(rawText, g.Start), field.Generation);
            if (moved) { await Task.Delay(120); await MeasureAndRender(); }
        }

        private Rect AnchorFor(Suggestion g)
        {
            if (rects.TryGetValue(g.Id, out Rect[]? rs) && rs.Length > 0 && !rs[0].IsEmpty) return rs[0];
            return field?.Bounds ?? Rect.Empty;
        }

        // ---------- actions ----------
        private async void Accept(Suggestion g)
        {
            if (field == null || g.Replacement == null) return;
            Rect anchor = AnchorFor(g);
            card.Hide(); activeId = null;
            int occ = TextOps.Occurrence(text, g.Original, g.Start);
            bool ok = await watcher.ReplaceAsync(g.Original, occ, TextOps.NormToRaw(rawText, g.Start), g.Replacement, field.Generation);
            if (!ok)
            {
                if (g.Replacement.Length > 0)
                {
                    try { Clipboard.SetText(g.Replacement); } catch { }
                    toast.Show($"This app didn't let Proofmark edit the text. “{g.Replacement}” is on your clipboard: select the word and press Ctrl+V.", anchor);
                }
                else toast.Show("This app didn't let Proofmark edit the text. Delete it by hand.", anchor);
                return;
            }
            aiSugs.Remove(g);
            // The watcher sees the new text on its next pass and the checks re-run.
        }

        // ---------- the same word in several places ----------
        private static bool IsWord(string s)
        {
            string w = s.Trim();
            return w.Length > 1 && w.All(c => char.IsLetter(c) || c == '\'' || c == '’' || c == '-');
        }

        private static bool SameFix(Suggestion a, Suggestion b) =>
            string.Equals(a.Original.Trim(), b.Original.Trim(), StringComparison.OrdinalIgnoreCase) &&
            string.Equals(a.Replacement ?? "", b.Replacement ?? "", StringComparison.OrdinalIgnoreCase);

        private List<Suggestion> SameAs(Suggestion g) => sugs.Where(x => SameFix(x, g)).ToList();

        private void ShowQuestion(Suggestion g, string mode, bool fromCard)
        {
            question = new Question(g.Id, mode, SameAs(g).Count, IsWord(g.Original));
            if (fromCard) card.Show(g, AnchorFor(g), question);
            else RenderPanel();
        }

        /// <summary>Accept: if the same fix appears more than once, ask whether to change them all.</summary>
        private void AskOrAccept(Suggestion g, bool fromCard)
        {
            if (g.Replacement == null) return;
            if (SameAs(g).Count > 1) ShowQuestion(g, "accept", fromCard);
            else { question = null; Accept(g); }
        }

        /// <summary>Dismiss: for a word (often a name like "Yagi"), offer to ignore it everywhere.</summary>
        private void AskOrDismiss(Suggestion g, bool fromCard)
        {
            if (SameAs(g).Count > 1 || IsWord(g.Original)) ShowQuestion(g, "dismiss", fromCard);
            else { question = null; Dismiss(g); }
        }

        private void Answer(Suggestion g, bool all)
        {
            Question? q = question;
            question = null;
            if (q == null || q.Id != g.Id) { RenderPanel(); return; }
            if (q.Mode == "accept")
            {
                if (all) AcceptAll(SameAs(g)); else Accept(g);
            }
            else if (all)
            {
                if (q.IsWord) IgnoreWord(g.Original);
                else DismissMany(SameAs(g));
            }
            else Dismiss(g);
            RenderPanel();
        }

        /// <summary>Never flag this word again, in any app. It can be removed in Settings.</summary>
        private async void IgnoreWord(string word)
        {
            string w = word.Trim().ToLowerInvariant();
            if (!settings.IgnoredWords.Contains(w)) { settings.IgnoredWords.Add(w); settings.Save(); }
            card.Hide(); activeId = null;
            aiSugs.RemoveAll(x => string.Equals(x.Original.Trim(), w, StringComparison.OrdinalIgnoreCase));
            status = $"Proofmark won't flag “{word.Trim()}” again. You can change this in Settings.";
            await Check();
        }

        private async void DismissMany(List<Suggestion> list)
        {
            card.Hide(); activeId = null;
            foreach (Suggestion g in list)
            {
                if (g.Source == "rules") Dismissed().Add(g.DismissKey);
                else aiSugs.Remove(g);
            }
            await Check();
        }

        /// <summary>Applies every direct fix in the list, last to first, skipping any that overlap.</summary>
        private async void AcceptAll(IReadOnlyList<Suggestion> list)
        {
            if (field == null || applying) return;
            card.Hide(); activeId = null;
            string t = text;
            var ordered = list.Where(g => g.Replacement != null).OrderByDescending(g => g.Start).ThenByDescending(g => g.End).ToList();
            var fixes = new List<(string Original, int Occurrence, int RawStart, string Replacement)>();
            var applied = new List<Suggestion>();
            int floor = int.MaxValue;
            foreach (Suggestion g in ordered)
            {
                if (g.End > floor || g.End > t.Length || t.Substring(g.Start, g.End - g.Start) != g.Original) continue;
                fixes.Add((g.Original, TextOps.Occurrence(t, g.Original, g.Start), TextOps.NormToRaw(rawText, g.Start), g.Replacement!));
                applied.Add(g);
                floor = g.Start;
            }
            if (fixes.Count == 0) return;
            applying = true; status = $"Applying {fixes.Count} fixes…"; RenderPanel();
            int done = await watcher.ReplaceManyAsync(fixes, field.Generation);
            applying = false;
            foreach (Suggestion g in applied) aiSugs.Remove(g);
            status = done == fixes.Count
                ? $"Applied {done} fix{(done == 1 ? "" : "es")}. Ctrl+Z in the app undoes them one at a time."
                : done == 0 ? "This app didn't let Proofmark edit the text. Use Accept on each fix, or copy them by hand."
                : $"Applied {done} of {fixes.Count} fixes. The rest are still listed.";
            RenderPanel();
            // The watcher sees the new text on its next pass and the checks re-run.
        }

        private async void Dismiss(Suggestion g)
        {
            card.Hide(); activeId = null;
            if (g.Source == "rules") Dismissed().Add(g.DismissKey);
            else aiSugs.Remove(g);
            await Check();
        }

        private async void DeepCheck()
        {
            if (field == null || deepBusy) return;
            if (!settings.HasDeep) { status = "Choose a smart-check engine in Settings first."; RenderPanel(); return; }
            deepBusy = true; status = ""; RenderPanel(); RenderWidget();
            int gen = field.Generation;
            string t = text;
            string? warning = null;
            try
            {
                JsonArray lt = new JsonArray();
                if (settings.LanguageTool)
                {
                    try { lt = await ai.LanguageTool(settings, t); }
                    catch (Exception ex) { warning = ex.Message; }
                }
                string? reply = null;
                if (settings.HasLlm)
                {
                    try
                    {
                        string prompt = await engine.DeepPrompt(t.Length > 24000 ? t.Substring(0, 24000) : t,
                            rules.Select(r => r.Original.Trim()).Where(x => x.Length > 0).Take(40));
                        reply = await ai.Complete(settings, prompt, json: true, fast: false, maxTokens: 4096);
                    }
                    catch (Exception ex) { warning ??= ex.Message; }
                }
                if (reply == null && lt.Count == 0 && warning != null) throw new InvalidOperationException(warning);
                var (found, foundTone) = await engine.MapDeep(reply, lt, t, settings.EngineName());
                if (field == null || field.Generation != gen) return;
                aiSugs = text == t ? found : TextOps.Rebase(found, t, text);
                tone = foundTone;
                status = (aiSugs.Count > 0 ? $"Found {aiSugs.Count} more {(aiSugs.Count == 1 ? "issue" : "issues")}." : "Nothing else to fix.")
                    + (ai.LastBackupUsed != null ? $" {settings.EngineName()} {ai.LastBackupReason}, so {ai.LastBackupUsed} checked it instead." : "")
                    + (warning != null ? $" ({warning})" : "");
            }
            catch (Exception ex) { status = ex.Message; }
            finally
            {
                deepBusy = false;
                Merge();
                await MeasureAndRender();
            }
        }

        private async void Rewrite(string goal)
        {
            if (field == null || !settings.HasLlm) return;
            int gen = field.Generation;
            string? selection = await watcher.GetSelectionAsync(gen);
            bool whole = string.IsNullOrWhiteSpace(selection);
            var job = new RewriteJob { Goal = goal, Whole = whole, RawSegment = whole ? "" : selection!, Segment = whole ? text : TextOps.Norm(selection!) };
            rewrite = job;
            RenderPanel();
            try
            {
                string prompt = await engine.RewritePrompt(job.Segment, goal);
                string reply = await ai.Complete(settings, prompt, json: false, fast: true, maxTokens: 2048);
                job.Result = await engine.CleanOut(reply);
                if (ai.LastBackupUsed != null) job.Note = $"{settings.EngineName()} {ai.LastBackupReason}, so {ai.LastBackupUsed} wrote this.";
                if (job.Result.Length == 0) job.Note = "The model returned nothing. Try again.";
            }
            catch (Exception ex) { job.Note = ex.Message; }
            finally { job.Busy = false; if (rewrite == job) RenderPanel(); }
        }

        private async void UseRewrite()
        {
            RewriteJob? job = rewrite;
            if (job == null || field == null || job.Result.Length == 0) return;
            bool ok = job.Whole
                ? await watcher.ReplaceAllAsync(job.Result, field.Generation)
                : await watcher.ReplaceAsync(job.RawSegment, 0, -1, job.Result, field.Generation);
            if (!ok)
            {
                try { Clipboard.SetText(job.Result); } catch { }
                job.Note = "This app didn't let Proofmark replace the text. The rewrite is on your clipboard: select the text and press Ctrl+V.";
                RenderPanel();
                return;
            }
            rewrite = null;
            RenderPanel();
        }
    }
}
