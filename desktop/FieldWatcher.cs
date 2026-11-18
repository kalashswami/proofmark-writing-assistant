using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace Proofmark
{
    /// <summary>What Proofmark currently sees: the focused text box in another app.</summary>
    public sealed record FieldSnapshot(int Generation, string Text, Rect Bounds, string Process, string ControlType, string ClassName, bool HasTextPattern, bool Scrolled = false);

    /// <summary>A request to find the screen position of one suggestion: its text and which occurrence of that text.</summary>
    public sealed record Probe(string Id, string Original, int Occurrence, int RawStart);

    /// <summary>
    /// Finds the focused text box in any app through Windows UI Automation, reads its text, measures where words are
    /// on screen and applies edits. All UI Automation calls run on one background thread, as Microsoft recommends for clients.
    /// </summary>
    public sealed class FieldWatcher : IDisposable
    {
        private readonly Thread thread;
        private readonly BlockingCollection<Action> work = new BlockingCollection<Action>();
        private readonly int myPid = Environment.ProcessId;
        private readonly Dictionary<int, string> procNames = new Dictionary<int, string>();
        private volatile bool running = true;

        private AutomationElement? current;
        private IntPtr currentTop;
        private int generation;
        private string? lastText;
        private Rect lastRect = Rect.Empty;
        private string lastView = "";
        private int fastPolls;

        public event Action<FieldSnapshot?>? Changed;
        public Func<string, bool> SkipProcess { get; set; } = _ => false;
        public volatile bool Paused;
        public const int MaxChars = 30000;

        public FieldWatcher()
        {
            thread = new Thread(Loop) { IsBackground = true, Name = "Proofmark UI Automation" };
            thread.SetApartmentState(ApartmentState.MTA);
        }

        /// <summary>Starts watching. Call after subscribing to <see cref="Changed"/>.</summary>
        public void Start() { if (!thread.IsAlive) thread.Start(); }

        public void Dispose() { running = false; work.CompleteAdding(); }

        private void Loop()
        {
            while (running)
            {
                try { Poll(); } catch (Exception ex) { Log.Write("poll: " + ex.Message); }
                try
                {
                    int wait = fastPolls > 0 ? 90 : 400;   // check quickly while the text is scrolling
                    if (fastPolls > 0) fastPolls--;
                    if (work.TryTake(out Action? job, wait))
                    {
                        Run(job!);
                        while (work.TryTake(out Action? more)) Run(more!);
                    }
                }
                catch (InvalidOperationException) { return; }
            }
        }

        private static void Run(Action job)
        {
            try { job(); } catch (Exception ex) { Log.Write("job: " + ex.Message); }
        }

        private void Poll()
        {
            if (Paused) { Lose(); return; }
            IntPtr fg = Native.GetForegroundWindow();
            Native.GetWindowThreadProcessId(fg, out uint fgPid);
            if (fgPid == (uint)myPid) return; // our settings window is in front: keep what we had

            AutomationElement? el;
            try { el = AutomationElement.FocusedElement; } catch { el = null; }
            if (el == null) { Lose(); return; }

            AutomationElement.AutomationElementInformation info;
            try { info = el.Current; } catch { Lose(); return; }
            if (info.ProcessId == myPid) return;

            string proc = ProcName(info.ProcessId);
            if (SkipProcess(proc) || !IsEditable(el, info, out bool hasText)) { Lose(); return; }

            bool same = current != null && SafeCompare(current, el);
            if (!same) { current = el; currentTop = fg; generation++; lastText = null; }

            Rect r = info.BoundingRectangle;
            if (r.IsEmpty || r.Width < 2 || r.Height < 2 || double.IsInfinity(r.Width)) { Lose(); return; }
            string text = ReadText(el, hasText);
            string view = hasText ? ViewSignature(el) : "";

            if (!same || text != lastText || r != lastRect || view != lastView)
            {
                bool scrolled = same && text == lastText && r == lastRect && view != lastView;
                if (scrolled) fastPolls = 15;
                lastText = text;
                lastRect = r;
                lastView = view;
                Changed?.Invoke(new FieldSnapshot(generation, text, r, proc, info.ControlType.ProgrammaticName, info.ClassName ?? "", hasText, scrolled));
            }
        }

        /// <summary>
        /// A cheap fingerprint of what part of the text is on screen: the first visible characters and where they sit.
        /// It changes when the text box scrolls, even though its text and bounds don't.
        /// </summary>
        private static string ViewSignature(AutomationElement el)
        {
            try
            {
                if (!el.TryGetCurrentPattern(TextPattern.Pattern, out object p)) return "";
                TextPatternRange[] visible = ((TextPattern)p).GetVisibleRanges();
                if (visible.Length == 0) return "none";
                TextPatternRange first = visible[0].Clone();
                first.MoveEndpointByRange(TextPatternRangeEndpoint.End, first, TextPatternRangeEndpoint.Start);
                first.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, 16);
                Rect[] rs = first.GetBoundingRectangles();
                string head = first.GetText(16) ?? "";
                return rs.Length > 0 ? $"{head}|{Math.Round(rs[0].X)}|{Math.Round(rs[0].Y)}" : head;
            }
            catch { return ""; }
        }

        private void Lose()
        {
            if (current == null && lastText == null) return;
            current = null; currentTop = IntPtr.Zero; lastText = null; lastRect = Rect.Empty; lastView = "";
            Changed?.Invoke(null);
        }

        private string ProcName(int pid)
        {
            if (procNames.TryGetValue(pid, out string? name)) return name;
            try { name = Process.GetProcessById(pid).ProcessName.ToLowerInvariant(); } catch { name = "unknown"; }
            procNames[pid] = name;
            return name;
        }

        private static bool SafeCompare(AutomationElement a, AutomationElement b)
        {
            try { return Automation.Compare(a, b); } catch { return false; }
        }

        private static bool IsEditable(AutomationElement el, AutomationElement.AutomationElementInformation info, out bool hasText)
        {
            hasText = false;
            if (info.IsPassword || !info.IsEnabled) return false;
            ControlType ct = info.ControlType;
            bool textBox = ct == ControlType.Edit || ct == ControlType.Document;
            // Some web-based chat apps report their message box as a group or custom control; accept those
            // only when they say outright that their text is editable.
            bool maybeBox = ct == ControlType.Group || ct == ControlType.Custom || ct == ControlType.Pane;
            if (!textBox && !maybeBox) return false;
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out object tp))
            {
                hasText = true;
                object? ro = null;
                try { ro = ((TextPattern)tp).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute); } catch { }
                if (ro is bool b) return !b;
                // A web page itself (Chromium reports the whole page as a Document) isn't a text box
                // unless it says outright that it's editable.
                if (ct == ControlType.Document && string.Equals(info.FrameworkId, "Chrome", StringComparison.OrdinalIgnoreCase)) return false;
                return textBox;
            }
            if (!textBox) return false;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object vp))
                return !((ValuePattern)vp).Current.IsReadOnly;
            return false;
        }

        private static string ReadText(AutomationElement el, bool hasText)
        {
            try
            {
                if (hasText && el.TryGetCurrentPattern(TextPattern.Pattern, out object tp))
                    return ((TextPattern)tp).DocumentRange.GetText(MaxChars) ?? "";
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object vp))
                {
                    string v = ((ValuePattern)vp).Current.Value ?? "";
                    return v.Length > MaxChars ? v.Substring(0, MaxChars) : v;
                }
            }
            catch { }
            return "";
        }

        /// <summary>Finds the n-th (0-based, non-overlapping) occurrence of a string in the field.</summary>
        private static TextPatternRange? FindNth(TextPattern tp, string s, int n)
        {
            if (string.IsNullOrEmpty(s)) return null;
            TextPatternRange search = tp.DocumentRange;
            for (int i = 0; i <= n && i < 1000; i++)
            {
                TextPatternRange? found = search.FindText(s, false, false);
                if (found == null) return null;
                if (i == n) return found;
                TextPatternRange rest = tp.DocumentRange.Clone();
                rest.MoveEndpointByRange(TextPatternRangeEndpoint.Start, found, TextPatternRangeEndpoint.End);
                search = rest;
            }
            return null;
        }

        /// <summary>
        /// Finds a suggestion's text in the field. First tries its exact character position (most precise, and works
        /// in Word, where searching for spaces can fail), then falls back to searching for the n-th occurrence.
        /// </summary>
        private static TextPatternRange? FindAt(TextPattern tp, string original, int occurrence, int rawStart, bool log = true)
        {
            if (rawStart >= 0)
            {
                try
                {
                    TextPatternRange r = tp.DocumentRange.Clone();
                    r.MoveEndpointByRange(TextPatternRangeEndpoint.End, r, TextPatternRangeEndpoint.Start);
                    if (rawStart == 0 || r.Move(TextUnit.Character, rawStart) == rawStart)
                    {
                        r.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, original.Length);
                        string got = r.GetText(original.Length + 8) ?? "";
                        if (got == original) return r;
                    }
                }
                catch { }
            }
            TextPatternRange? found = null;
            try { found = FindNth(tp, original, occurrence); } catch { }
            if (found == null && log) Log.Write($"couldn't locate '{(original.Length > 60 ? original.Substring(0, 60) + "…" : original)}' (occurrence {occurrence}, position {rawStart})");
            return found;
        }

        private static int NthIndex(string t, string s, int n)
        {
            int i = 0;
            for (int k = 0; ; k++)
            {
                int j = t.IndexOf(s, i, StringComparison.Ordinal);
                if (j < 0) return -1;
                if (k == n) return j;
                i = j + s.Length;
            }
        }

        private static string Clean(string s) => s.Replace("\r\n", "\n").Replace('\r', '\n').Trim();

        private Task<T> Enqueue<T>(Func<T> fn, T fallback)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            try
            {
                work.Add(() =>
                {
                    try { tcs.TrySetResult(fn()); }
                    catch (Exception ex) { Log.Write("uia: " + ex.Message); tcs.TrySetResult(fallback); }
                });
            }
            catch (InvalidOperationException) { tcs.TrySetResult(fallback); }
            return tcs.Task;
        }

        /// <summary>Screen rectangles (physical pixels) for each suggestion's text.</summary>
        public Task<Dictionary<string, Rect[]>> MeasureAsync(IReadOnlyList<Probe> probes, int gen) =>
            Enqueue(() =>
            {
                var res = new Dictionary<string, Rect[]>();
                AutomationElement? el = current;
                if (el == null || gen != generation || !el.TryGetCurrentPattern(TextPattern.Pattern, out object p)) return res;
                var tp = (TextPattern)p;
                foreach (Probe pr in probes)
                {
                    try
                    {
                        // A suggestion that can't be found isn't really in the text (Word, for one, reports
                        // extra spaces where lines wrap). Leaving it out of the result hides it.
                        TextPatternRange? rg = FindAt(tp, pr.Original, pr.Occurrence, pr.RawStart, log: false);
                        if (rg != null) res[pr.Id] = rg.GetBoundingRectangles() ?? Array.Empty<Rect>();
                    }
                    catch { }
                }
                return res;
            }, new Dictionary<string, Rect[]>());

        /// <summary>Replaces one occurrence of a string in the field. Selects it, checks the selection, then types the fix.</summary>
        public Task<bool> ReplaceAsync(string original, int occurrence, int rawStart, string replacement, int gen) =>
            Enqueue(() =>
            {
                AutomationElement? el = current;
                if (el == null || gen != generation) { Log.Write("replace: the text box changed before the fix ran"); return false; }
                if (el.TryGetCurrentPattern(TextPattern.Pattern, out object p))
                {
                    var tp = (TextPattern)p;
                    TextPatternRange? rg = FindAt(tp, original, occurrence, rawStart);
                    return rg != null && SelectAndType(tp, rg, original, replacement);
                }
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object vp))
                {
                    var v = (ValuePattern)vp;
                    if (v.Current.IsReadOnly) return false;
                    string t = v.Current.Value ?? "";
                    int idx = NthIndex(t, original, occurrence);
                    if (idx < 0) return false;
                    v.SetValue(t.Substring(0, idx) + replacement + t.Substring(idx + original.Length));
                    return true;
                }
                return false;
            }, false);

        /// <summary>
        /// Applies several fixes in a row. Pass them last-to-first in the text, so each occurrence count stays valid.
        /// Returns how many were applied.
        /// </summary>
        public Task<int> ReplaceManyAsync(IReadOnlyList<(string Original, int Occurrence, int RawStart, string Replacement)> fixes, int gen) =>
            Enqueue(() =>
            {
                AutomationElement? el = current;
                if (el == null || gen != generation || !el.TryGetCurrentPattern(TextPattern.Pattern, out object p)) return 0;
                var tp = (TextPattern)p;
                int done = 0;
                foreach (var f in fixes)
                {
                    try
                    {
                        TextPatternRange? rg = FindAt(tp, f.Original, f.Occurrence, f.RawStart);
                        if (rg != null && SelectAndType(tp, rg, f.Original, f.Replacement)) { done++; Thread.Sleep(90); }
                    }
                    catch (Exception ex) { Log.Write("replace many: " + ex.Message); }
                }
                return done;
            }, 0);

        /// <summary>Replaces everything in the field (used by Rewrite when nothing is selected).</summary>
        public Task<bool> ReplaceAllAsync(string replacement, int gen) =>
            Enqueue(() =>
            {
                AutomationElement? el = current;
                if (el == null || gen != generation) return false;
                if (el.TryGetCurrentPattern(TextPattern.Pattern, out object p))
                {
                    var tp = (TextPattern)p;
                    TextPatternRange doc = tp.DocumentRange;
                    string all = doc.GetText(MaxChars) ?? "";
                    return SelectAndType(tp, doc, all, replacement);
                }
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object vp) && !((ValuePattern)vp).Current.IsReadOnly)
                {
                    ((ValuePattern)vp).SetValue(replacement);
                    return true;
                }
                return false;
            }, false);

        /// <summary>Scrolls the field so a suggestion's text is on screen.</summary>
        public Task<bool> ScrollIntoViewAsync(string original, int occurrence, int rawStart, int gen) =>
            Enqueue(() =>
            {
                AutomationElement? el = current;
                if (el == null || gen != generation || !el.TryGetCurrentPattern(TextPattern.Pattern, out object p)) return false;
                TextPatternRange? rg = FindAt((TextPattern)p, original, occurrence, rawStart, log: false);
                if (rg == null) return false;
                rg.ScrollIntoView(false);
                return true;
            }, false);

        /// <summary>The text currently selected in the field, or null when nothing is selected.</summary>
        public Task<string?> GetSelectionAsync(int gen) =>
            Enqueue<string?>(() =>
            {
                AutomationElement? el = current;
                if (el == null || gen != generation || !el.TryGetCurrentPattern(TextPattern.Pattern, out object p)) return null;
                TextPatternRange[] sel = ((TextPattern)p).GetSelection();
                if (sel.Length == 0) return null;
                string s = sel[0].GetText(MaxChars) ?? "";
                return s.Length == 0 ? null : s;
            }, null);

        private bool SelectAndType(TextPattern tp, TextPatternRange range, string expected, string replacement)
        {
            if (currentTop != IntPtr.Zero && Native.GetForegroundWindow() != currentTop) Native.SetForegroundWindow(currentTop);
            range.Select();
            Thread.Sleep(60);
            TextPatternRange[] sel = tp.GetSelection();
            string got = sel.Length > 0 ? (sel[0].GetText(expected.Length + 16) ?? "") : "";
            // Never type unless the app really selected the text we meant to replace
            bool matches = expected.Trim().Length == 0
                ? got.Length > 0 && got.Trim().Length == 0          // spaces: any whitespace selection of some length
                : Clean(got) == Clean(expected);
            if (!matches)
            {
                Log.Write($"selection mismatch: got '{got}' expected '{expected}'");
                return false;
            }
            if (replacement.Length == 0) Native.PressKey(Native.VK_DELETE);
            else Native.TypeText(replacement);
            return true;
        }
    }
}
