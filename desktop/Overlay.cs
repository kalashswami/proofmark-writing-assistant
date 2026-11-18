using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace Proofmark
{
    internal static class Theme
    {
        public static readonly FontFamily UiFont = new FontFamily("Segoe UI Variable Text, Segoe UI");
        public static readonly FontFamily Mono = new FontFamily("Cascadia Mono, Consolas");
        public static readonly SolidColorBrush Bg = B("#FFFFFF"), Bg2 = B("#F4F6F8"), Ink = B("#17202A"), Ink2 = B("#4B5764"),
            Ink3 = B("#7E8994"), Rule = B("#D9DFE4"), Accent = B("#243746"), Good = B("#17845A"), Brand = B("#C2402A"), White = B("#FFFFFF");

        public static readonly SolidColorBrush Highlight = B("#E5484D"), HighlightFill = B("#40E5484D");

        public static SolidColorBrush B(string hex)
        {
            var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }

        public static SolidColorBrush Cat(string cat) => cat switch
        {
            "correctness" => B("#C2402A"),
            "clarity" => B("#2460C4"),
            "style" => B("#17845A"),
            "tone" => B("#7445C2"),
            _ => B("#2460C4")
        };

        public static SolidColorBrush Tint(string cat, byte alpha)
        {
            Color c = Cat(cat).Color;
            var b = new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B));
            b.Freeze();
            return b;
        }

        public static string Label(string cat) => cat switch
        {
            "correctness" => "Correctness", "clarity" => "Clarity", "style" => "Style", "tone" => "Tone", _ => "Suggestion"
        };

        public static Effect Shadow() => new DropShadowEffect { BlurRadius = 18, ShadowDepth = 3, Direction = 270, Opacity = 0.22, Color = Colors.Black };

        public static TextBlock Text(string text, double size = 13, Brush? fg = null, FontWeight? weight = null, bool wrap = false)
        {
            return new TextBlock
            {
                Text = text, FontFamily = UiFont, FontSize = size, Foreground = fg ?? Ink,
                FontWeight = weight ?? FontWeights.Normal, TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
                TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis
            };
        }

        /// <summary>A flat clickable button that doesn't take focus away from the app you're typing in.</summary>
        public static Border Button(string text, Action onClick, Brush? bg = null, Brush? fg = null, Brush? border = null, bool enabled = true)
        {
            var b = new Border
            {
                Child = Text(text, 12.5, fg ?? Ink, FontWeights.SemiBold),
                Background = bg ?? Bg, BorderBrush = border ?? Rule, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6), Padding = new Thickness(11, 5, 11, 5), Margin = new Thickness(0, 0, 6, 6),
                Cursor = enabled ? Cursors.Hand : Cursors.Arrow, Opacity = enabled ? 1 : 0.5, Focusable = false
            };
            if (enabled) b.MouseLeftButtonUp += (_, e) => { e.Handled = true; onClick(); };
            return b;
        }

        public static Border MarkTag(Suggestion g)
        {
            return new Border
            {
                BorderBrush = Cat(g.Cat), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 1), MinWidth = 34, VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = g.Mark, FontFamily = Mono, FontSize = 11, Foreground = Cat(g.Cat), HorizontalAlignment = HorizontalAlignment.Center }
            };
        }

        private static string Trunc(string s, int n) => s.Length > n ? s.Substring(0, n - 1).TrimEnd() + "…" : s;

        /// <summary>The fix written like a proof correction: struck-through original, then the replacement.</summary>
        public static TextBlock Fix(Suggestion g, double size = 14)
        {
            var tb = new TextBlock { FontFamily = UiFont, FontSize = size, Foreground = Ink, TextWrapping = TextWrapping.Wrap };
            string o = g.Original;
            Brush c = Cat(g.Cat);
            Run Strike(string s) => new Run(Trunc(s, 60)) { Foreground = Ink3, TextDecorations = TextDecorations.Strikethrough };
            Run Note(string s) => new Run("  " + s) { Foreground = Ink3, FontSize = size - 2 };
            if (g.Replacement == null) { tb.Inlines.Add(new Run("“" + Trunc(o, 96) + "”") { Foreground = Ink2, FontStyle = FontStyles.Italic }); return tb; }
            string r = g.Replacement;
            if (o.Trim().Length == 0) { tb.Inlines.Add(Note(r.Length == 0 ? "remove the space" : $"{o.Length} spaces → 1")); return tb; }
            if (r.Length == 0) { tb.Inlines.Add(Strike(o.Trim())); tb.Inlines.Add(Note("remove")); return tb; }
            if (r.StartsWith(o, StringComparison.Ordinal))
            {
                string added = r.Substring(o.Length);
                tb.Inlines.Add(new Run(Trunc(o, 60)));
                if (added.Trim().Length == 0) tb.Inlines.Add(Note("add a space after"));
                else tb.Inlines.Add(new Run(added) { Foreground = c, FontWeight = FontWeights.SemiBold });
                return tb;
            }
            tb.Inlines.Add(Strike(o));
            tb.Inlines.Add(new Run("  →  ") { Foreground = Ink3 });
            tb.Inlines.Add(new Run(Trunc(r, 120)) { Foreground = c, FontWeight = FontWeights.SemiBold });
            return tb;
        }
    }

    /// <summary>A pending question about a suggestion: change or ignore every copy of it, or just this one.</summary>
    internal sealed record Question(string Id, string Mode, int Count, bool IsWord);

    internal static class Ui
    {
        /// <summary>The "all of them, or just this one?" row shown on a card or panel item.</summary>
        public static StackPanel QuestionBlock(Suggestion g, Question q, Action<bool> answer)
        {
            var sp = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            string word = g.Original.Trim();
            string ask = q.Mode == "accept"
                ? $"“{word}” appears {q.Count} times. Change all of them?"
                : q.IsWord
                    ? (q.Count > 1 ? $"“{word}” appears {q.Count} times. Stop flagging it everywhere?" : $"Stop flagging “{word}” everywhere?")
                    : $"This appears {q.Count} times. Dismiss all of them?";
            sp.Children.Add(Theme.Text(ask, 12.5, Theme.Ink, FontWeights.SemiBold, wrap: true));
            var row = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            string allLabel = q.Mode == "accept" ? $"Change all {q.Count}" : q.IsWord ? "Ignore everywhere" : $"Dismiss all {q.Count}";
            Brush c = Theme.Cat(g.Cat);
            row.Children.Add(Theme.Button(allLabel, () => answer(true), q.Mode == "accept" ? c : Theme.Accent, Theme.White, q.Mode == "accept" ? c : Theme.Accent));
            row.Children.Add(Theme.Button("Just this one", () => answer(false)));
            sp.Children.Add(row);
            if (q.Mode == "dismiss" && q.IsWord)
                sp.Children.Add(Theme.Text("Ignored words are listed in Settings, where you can remove them.", 11.5, Theme.Ink3, null, true));
            return sp;
        }
        /// <summary>A borderless, always-on-top window that never takes focus from the app you're typing in.</summary>
        public static Window ToolWindow(bool clickThrough)
        {
            var w = new Window
            {
                WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
                ShowInTaskbar = false, Topmost = true, ShowActivated = false, ResizeMode = ResizeMode.NoResize,
                Focusable = false, Left = -32000, Top = -32000, Width = 10, Height = 10, SizeToContent = SizeToContent.Manual
            };
            w.SourceInitialized += (_, _) =>
            {
                IntPtr h = new WindowInteropHelper(w).Handle;
                Native.AddExStyle(h, Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | (clickThrough ? Native.WS_EX_TRANSPARENT : 0));
            };
            return w;
        }

        /// <summary>Shows a window at an exact position and size in physical pixels.</summary>
        public static void Place(Window w, double x, double y, double width, double height)
        {
            IntPtr h = new WindowInteropHelper(w).EnsureHandle();
            if (!w.IsVisible) w.Show();
            Native.SetWindowPos(h, Native.HWND_TOPMOST, (int)Math.Round(x), (int)Math.Round(y),
                Math.Max(1, (int)Math.Ceiling(width)), Math.Max(1, (int)Math.Ceiling(height)), Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
        }

        /// <summary>The usable area (physical pixels) of the monitor containing a point.</summary>
        public static Rect WorkArea(double x, double y)
        {
            var wa = System.Windows.Forms.Screen.FromPoint(new System.Drawing.Point((int)x, (int)y)).WorkingArea;
            return new Rect(wa.X, wa.Y, wa.Width, wa.Height);
        }

        /// <summary>Lays out an element at a given width in device-independent units and returns its height.</summary>
        public static Size Measure(FrameworkElement el, double width)
        {
            el.Measure(new Size(width, double.PositiveInfinity));
            return el.DesiredSize;
        }
    }

    /// <summary>Click-through window over the text box that draws the underlines.</summary>
    internal sealed class UnderlineLayer
    {
        private readonly Window w = Ui.ToolWindow(clickThrough: true);
        private readonly Canvas canvas = new Canvas { ClipToBounds = true, IsHitTestVisible = false };

        public UnderlineLayer() { w.Content = canvas; w.IsHitTestVisible = false; }

        public void Draw(Rect field, IReadOnlyList<Suggestion> sugs, IReadOnlyDictionary<string, Rect[]> rects, string? activeId)
        {
            Rect vis = Rect.Intersect(field, Native.VirtualScreen());
            if (vis.IsEmpty || vis.Width < 2 || vis.Height < 2 || sugs.Count == 0 || rects.Count == 0) { Hide(); return; }
            vis.Inflate(4, 4);   // room for the highlight box around words at the edge
            vis = Rect.Intersect(vis, Native.VirtualScreen());
            double s = Native.ScaleAt(vis.X + vis.Width / 2, vis.Y + vis.Height / 2);
            canvas.Children.Clear();
            foreach (Suggestion g in sugs)
            {
                if (!rects.TryGetValue(g.Id, out Rect[]? rs)) continue;
                Brush brush = Theme.Cat(g.Cat);
                foreach (Rect r in rs)
                {
                    if (r.IsEmpty || r.Height <= 0) continue;
                    double x = (r.X - vis.X) / s, y = (r.Y - vis.Y) / s, wd = Math.Max(r.Width / s, 0), ht = r.Height / s;
                    if (g.Id == activeId)
                    {
                        // The suggestion you're pointing at in the panel or card: a bold red box so it's easy to find.
                        // Spaces are narrow, so the box is never thinner than 8 px.
                        double bw = Math.Max(wd, 8), bx = x - (bw - wd) / 2;
                        var hl = new Rectangle
                        {
                            Width = bw + 4, Height = ht + 4, Fill = Theme.HighlightFill, Stroke = Theme.Highlight,
                            StrokeThickness = 2, RadiusX = 3, RadiusY = 3
                        };
                        Canvas.SetLeft(hl, bx - 2); Canvas.SetTop(hl, y - 2); canvas.Children.Add(hl);
                    }
                    if (wd <= 0) continue;
                    Shape u = g.Replacement == null
                        ? new Line { X1 = 0, Y1 = 1, X2 = wd, Y2 = 1, Stroke = brush, StrokeThickness = 2, StrokeDashArray = new DoubleCollection { 1, 1.5 } }
                        : new Rectangle { Width = wd, Height = 2, Fill = brush, RadiusX = 1, RadiusY = 1 };
                    Canvas.SetLeft(u, x); Canvas.SetTop(u, y + ht - 2); canvas.Children.Add(u);
                }
            }
            Ui.Place(w, vis.X, vis.Y, vis.Width, vis.Height);
        }

        public void Hide() { if (w.IsVisible) w.Hide(); }
    }

    /// <summary>The floating button in the corner of the text box.</summary>
    internal sealed class WidgetWindow
    {
        private readonly Window w = Ui.ToolWindow(clickThrough: false);
        private readonly Border circle;
        private readonly System.Windows.Shapes.Path caret;
        private readonly Border badge;
        private readonly TextBlock badgeText;
        public event Action? Clicked;
        public Rect BoundsPx { get; private set; } = Rect.Empty;

        public WidgetWindow()
        {
            caret = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M 2,12.5 L 8,2 L 14,12.5"), Stroke = Theme.Ink, StrokeThickness = 2.4,
                StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round,
                Width = 16, Height = 14, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                LayoutTransform = new ScaleTransform(0.78, 0.78)
            };
            circle = new Border
            {
                Width = 28, Height = 28, CornerRadius = new CornerRadius(14), Background = Theme.Bg, BorderBrush = Theme.Rule,
                BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(2, 0, 0, 2), Effect = Theme.Shadow(), Child = caret, Cursor = Cursors.Hand
            };
            badgeText = new TextBlock { FontFamily = Theme.UiFont, FontSize = 10.5, FontWeight = FontWeights.Bold, Foreground = Theme.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            badge = new Border
            {
                MinWidth = 18, Height = 18, CornerRadius = new CornerRadius(9), Padding = new Thickness(4, 0, 4, 0), Child = badgeText,
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, BorderBrush = Theme.Bg,
                BorderThickness = new Thickness(2), Visibility = Visibility.Collapsed
            };
            var grid = new Grid { Width = 40, Height = 36, Background = Brushes.Transparent };
            grid.Children.Add(circle);
            grid.Children.Add(badge);
            grid.MouseLeftButtonUp += (_, e) => { e.Handled = true; Clicked?.Invoke(); };
            w.Content = grid;
        }

        /// <summary>state: "checking", "issues", "clean" or "off".</summary>
        public void Show(Rect field, string state, int count, string worstCat, string tooltip)
        {
            caret.Stroke = state switch { "clean" => Theme.Good, "off" => Theme.Ink3, "checking" => Theme.Ink3, _ => Theme.Ink };
            if (state != "off" && count > 0)
            {
                badgeText.Text = count > 99 ? "99+" : count.ToString();
                badge.Background = Theme.Cat(worstCat);
                badge.Visibility = Visibility.Visible;
            }
            else badge.Visibility = Visibility.Collapsed;
            circle.ToolTip = tooltip;

            Rect vis = Rect.Intersect(field, Native.VirtualScreen());
            if (vis.IsEmpty || field.Width < 120 || field.Height < 16) { Hide(); return; }
            double s = Native.ScaleAt(vis.X + vis.Width / 2, vis.Y + vis.Height / 2);
            double wpx = 40 * s, hpx = 36 * s;
            bool small = field.Height < 52 * s;
            double x = vis.Right - wpx - 4 * s;
            double y = small ? field.Top + (field.Height - hpx) / 2 : vis.Bottom - hpx - 4 * s;
            Rect wa = Ui.WorkArea(x, y);
            x = Math.Min(Math.Max(x, wa.Left), wa.Right - wpx);
            y = Math.Min(Math.Max(y, wa.Top), wa.Bottom - hpx);
            BoundsPx = new Rect(x, y, wpx, hpx);
            Ui.Place(w, x, y, wpx, hpx);
        }

        public void Hide() { BoundsPx = Rect.Empty; if (w.IsVisible) w.Hide(); }
    }

    /// <summary>The card that appears when you hover an underline.</summary>
    internal sealed class CardWindow
    {
        private readonly Window w = Ui.ToolWindow(clickThrough: false);
        private readonly Border root;
        public Suggestion? Current { get; private set; }
        public event Action<Suggestion>? Accept, Dismiss;
        public event Action<Suggestion, bool>? Answer;
        public bool IsVisible => w.IsVisible;
        public bool IsMouseOver => w.IsVisible && w.IsMouseOver;

        public CardWindow()
        {
            root = new Border
            {
                Background = Theme.Bg, BorderBrush = Theme.Rule, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10),
                Padding = new Thickness(14, 12, 14, 8), Margin = new Thickness(10), Width = 300, Effect = Theme.Shadow()
            };
            w.Content = root;
        }

        public void Show(Suggestion g, Rect anchorPx, Question? q)
        {
            Current = g;
            var stack = new StackPanel();
            var head = new DockPanel { Margin = new Thickness(0, 0, 0, 6), LastChildFill = true };
            head.Children.Add(Theme.MarkTag(g));
            if (g.Source != "rules" && !string.IsNullOrEmpty(g.Engine))
            {
                var src = Theme.Text(g.Engine!.ToUpperInvariant(), 9.5, Theme.Ink2, FontWeights.SemiBold);
                src.Margin = new Thickness(6, 0, 0, 0); src.VerticalAlignment = VerticalAlignment.Center;
                DockPanel.SetDock(src, Dock.Right);
                head.Children.Add(src);
            }
            var title = Theme.Text(g.Title, 13, Theme.Ink, FontWeights.SemiBold);
            title.Margin = new Thickness(8, 0, 0, 0); title.VerticalAlignment = VerticalAlignment.Center;
            head.Children.Add(title);
            stack.Children.Add(head);
            stack.Children.Add(Theme.Fix(g));
            if (g.Why.Length > 0)
            {
                var why = Theme.Text(g.Why, 12.5, Theme.Ink2, null, wrap: true);
                why.Margin = new Thickness(0, 6, 0, 0);
                stack.Children.Add(why);
            }
            if (q != null && q.Id == g.Id)
            {
                var block = Ui.QuestionBlock(g, q, all => Answer?.Invoke(g, all));
                block.Margin = new Thickness(0, 10, 0, 4);
                stack.Children.Add(block);
            }
            else
            {
                var actions = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
                if (g.Replacement != null)
                    actions.Children.Add(Theme.Button(g.Replacement.Length == 0 ? "Remove" : "Accept", () => Accept?.Invoke(g), Theme.Cat(g.Cat), Theme.White, Theme.Cat(g.Cat)));
                actions.Children.Add(Theme.Button("Dismiss", () => Dismiss?.Invoke(g), Brushes.Transparent, Theme.Ink2, Brushes.Transparent));
                stack.Children.Add(actions);
            }
            root.Child = stack;

            Size dip = Ui.Measure(root, 320);
            double s = Native.ScaleAt(anchorPx.X, anchorPx.Y);
            double wpx = dip.Width * s, hpx = dip.Height * s;
            Rect wa = Ui.WorkArea(anchorPx.X, anchorPx.Y);
            double x = anchorPx.X - 24 * s, y = anchorPx.Bottom - 6 * s;
            if (y + hpx > wa.Bottom) y = anchorPx.Top - hpx + 6 * s;
            x = Math.Min(Math.Max(x, wa.Left), wa.Right - wpx);
            y = Math.Max(y, wa.Top);
            Ui.Place(w, x, y, wpx, hpx);
        }

        public void Hide() { Current = null; if (w.IsVisible) w.Hide(); }
    }

    /// <summary>Everything the panel shows; rebuilt on each update.</summary>
    internal sealed class PanelState
    {
        public string App = "";
        public bool Paused;
        public IReadOnlyList<Suggestion> Sugs = Array.Empty<Suggestion>();
        public IReadOnlyList<string> Tone = Array.Empty<string>();
        public bool HasDeep, HasRewrite, DeepBusy, LanguageTool, NoUnderlines, Applying;
        public string DeepLabel = "";
        public string Status = "";
        public string Filter = "all";
        public RewriteJob? Rewrite;
        public Question? Question;
    }

    internal sealed class RewriteJob
    {
        public string Goal = "", Segment = "", RawSegment = "", Result = "", Note = "";
        public bool Whole, Busy = true;
    }

    /// <summary>The panel opened from the floating button: suggestion list, deep check, rewrite and pause.</summary>
    internal sealed class PanelWindow
    {
        private readonly Window w = Ui.ToolWindow(clickThrough: false);
        private readonly Border root;
        private ScrollViewer? scroller;
        public bool IsVisible => w.IsVisible;
        public event Action<Suggestion>? Accept, Dismiss;
        public event Action<IReadOnlyList<Suggestion>>? AcceptAll;
        public event Action<Suggestion, bool>? Answer;
        public event Action<Suggestion?>? Hover;
        public event Action<string>? Filter, RewriteGoal;
        public event Action? Close, Deep, UseRewrite, DiscardRewrite, PauseApp, OpenSettings;

        public PanelWindow()
        {
            root = new Border
            {
                Background = Theme.Bg, BorderBrush = Theme.Rule, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10),
                Margin = new Thickness(10), Width = 340, Effect = Theme.Shadow()
            };
            w.Content = root;
        }

        private static readonly string[] Goals = { "concise", "formal", "friendly", "confident" };

        public void Show(PanelState st, Rect anchorPx, Rect fieldPx)
        {
            double keep = scroller?.VerticalOffset ?? 0;
            var outer = new DockPanel { LastChildFill = true };

            // Header
            var head = new DockPanel { Margin = new Thickness(14, 10, 8, 10) };
            var close = Theme.Text("×", 18, Theme.Ink2);
            close.Cursor = Cursors.Hand; close.Padding = new Thickness(6, 0, 4, 0);
            close.MouseLeftButtonUp += (_, e) => { e.Handled = true; Close?.Invoke(); };
            DockPanel.SetDock(close, Dock.Right);
            head.Children.Add(close);
            var brand = new StackPanel { Orientation = Orientation.Horizontal };
            brand.Children.Add(Theme.Text("Proofmark", 13.5, Theme.Ink, FontWeights.Bold));
            int n = st.Sugs.Count;
            var count = Theme.Text(st.Paused ? "  Paused" : n > 0 ? $"  {n} suggestion{(n == 1 ? "" : "s")}" : "  No issues", 12.5, Theme.Ink3);
            count.VerticalAlignment = VerticalAlignment.Center;
            brand.Children.Add(count);
            head.Children.Add(brand);
            var headWrap = new Border { BorderBrush = Theme.Rule, BorderThickness = new Thickness(0, 0, 0, 1), Child = head };
            DockPanel.SetDock(headWrap, Dock.Top);
            outer.Children.Add(headWrap);

            // Footer
            var foot = new StackPanel { Margin = new Thickness(14, 10, 14, 10) };
            if (!st.Paused)
            {
                if (st.HasDeep)
                {
                    var row = new WrapPanel();
                    row.Children.Add(Theme.Button(st.DeepBusy ? "Checking…" : $"Deep check · {st.DeepLabel}", () => Deep?.Invoke(), Theme.Accent, Theme.White, Theme.Accent, !st.DeepBusy));
                    foot.Children.Add(row);
                    if (st.HasRewrite)
                    {
                        var goals = new WrapPanel();
                        var lbl = Theme.Text("REWRITE", 10.5, Theme.Ink3, FontWeights.Bold);
                        lbl.Margin = new Thickness(0, 6, 8, 0);
                        goals.Children.Add(lbl);
                        foreach (string g in Goals)
                        {
                            string goal = g;
                            goals.Children.Add(Theme.Button(char.ToUpperInvariant(g[0]) + g.Substring(1), () => RewriteGoal?.Invoke(goal), null, null, null, st.Rewrite == null || !st.Rewrite.Busy));
                        }
                        foot.Children.Add(goals);
                    }
                    if (st.LanguageTool) foot.Children.Add(Theme.Text("Grammar checks by LanguageTool (languagetool.org)", 11.5, Theme.Ink3));
                }
                else
                {
                    var off = new DockPanel();
                    var btn = Theme.Button("Settings", () => OpenSettings?.Invoke());
                    DockPanel.SetDock(btn, Dock.Right);
                    off.Children.Add(btn);
                    off.Children.Add(Theme.Text("Turn on a free engine (Ollama, LM Studio or LanguageTool) in Settings for deep checks and rewrites.", 12, Theme.Ink2, null, true));
                    foot.Children.Add(off);
                }
            }
            if (st.Status.Length > 0) { var t = Theme.Text(st.Status, 12, Theme.Ink2, null, true); t.Margin = new Thickness(0, 4, 0, 4); foot.Children.Add(t); }
            var site = new DockPanel { Margin = new Thickness(0, 4, 0, 0) };
            var pause = Theme.Button(st.Paused ? "Resume" : "Pause in this app", () => PauseApp?.Invoke(), Brushes.Transparent, Theme.Ink2, Theme.Rule);
            pause.Margin = new Thickness(0);
            DockPanel.SetDock(pause, Dock.Right);
            site.Children.Add(pause);
            var where = Theme.Text((st.Paused ? "Paused in " : "Checking ") + st.App, 12, Theme.Ink3);
            where.VerticalAlignment = VerticalAlignment.Center;
            site.Children.Add(where);
            foot.Children.Add(site);
            var footWrap = new Border { BorderBrush = Theme.Rule, BorderThickness = new Thickness(0, 1, 0, 0), Child = foot };
            DockPanel.SetDock(footWrap, Dock.Bottom);
            outer.Children.Add(footWrap);

            // Body
            var body = new StackPanel();
            if (st.Tone.Count > 0)
            {
                var tone = new WrapPanel { Margin = new Thickness(14, 10, 14, 0) };
                var lbl = Theme.Text("SOUNDS", 10.5, Theme.Ink3, FontWeights.Bold); lbl.Margin = new Thickness(0, 2, 8, 0);
                tone.Children.Add(lbl);
                foreach (string t in st.Tone)
                    tone.Children.Add(new Border { BorderBrush = Theme.Rule, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(9), Padding = new Thickness(8, 0, 8, 1), Margin = new Thickness(0, 0, 5, 4), Child = Theme.Text(t, 12) });
                body.Children.Add(tone);
            }
            if (st.Rewrite != null) body.Children.Add(RewriteBlock(st.Rewrite));
            if (st.NoUnderlines && n > 0)
                body.Children.Add(new Border { Margin = new Thickness(14, 10, 14, 0), Child = Theme.Text("This app doesn't report where words are on screen, so there are no underlines here. Fixes still work.", 11.5, Theme.Ink3, null, true) });
            if (st.Paused)
                body.Children.Add(Empty("Paused in " + st.App, "Proofmark isn't checking text in this app."));
            else if (n == 0)
                body.Children.Add(Empty("No issues found", st.HasDeep ? "The instant checks are clear. A deep check can catch grammar and tone the rules miss." : "The instant checks are clear."));
            else
            {
                var tabs = new WrapPanel { Margin = new Thickness(14, 10, 14, 4) };
                foreach (string k in new[] { "all", "correctness", "clarity", "style", "tone" })
                {
                    int c = 0; foreach (Suggestion g in st.Sugs) if (k == "all" || g.Cat == k) c++;
                    if (k != "all" && c == 0) continue;
                    bool on = st.Filter == k;
                    string key = k;
                    var chip = Theme.Button($"{(k == "all" ? "All" : Theme.Label(k))} {c}", () => Filter?.Invoke(key), on ? Theme.Ink : Theme.Bg, on ? Theme.White : (k == "all" ? Theme.Ink2 : Theme.Cat(k)), on ? Theme.Ink : Theme.Rule);
                    chip.CornerRadius = new CornerRadius(12); chip.Padding = new Thickness(9, 2, 9, 3);
                    tabs.Children.Add(chip);
                }
                body.Children.Add(tabs);
                var shown = new List<Suggestion>();
                foreach (Suggestion g in st.Sugs) if (st.Filter == "all" || g.Cat == st.Filter) shown.Add(g);
                int fixable = 0; foreach (Suggestion g in shown) if (g.Replacement != null) fixable++;
                if (fixable > 1)
                {
                    var bulk = new WrapPanel { Margin = new Thickness(14, 2, 14, 6) };
                    string what = st.Filter == "all" ? "" : " " + Theme.Label(st.Filter).ToLowerInvariant();
                    bulk.Children.Add(Theme.Button($"Accept all {fixable}{what} fixes", () => AcceptAll?.Invoke(shown), Theme.Accent, Theme.White, Theme.Accent, !st.Applying));
                    if (fixable < shown.Count)
                    {
                        var note = Theme.Text($"{shown.Count - fixable} need a rewrite and stay listed", 11.5, Theme.Ink3);
                        note.Margin = new Thickness(2, 5, 0, 0);
                        bulk.Children.Add(note);
                    }
                    body.Children.Add(bulk);
                }
                foreach (Suggestion g in shown) body.Children.Add(Item(g, st.Question));
            }
            scroller = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 330, Focusable = false };
            scroller.MouseLeave += (_, _) => Hover?.Invoke(null);
            outer.Children.Add(scroller);
            root.Child = outer;

            Size dip = Ui.Measure(root, 360);
            double s = Native.ScaleAt(anchorPx.X, anchorPx.Y);
            double wpx = dip.Width * s, hpx = dip.Height * s;
            Rect wa = Ui.WorkArea(anchorPx.X, anchorPx.Y);
            double x, y;
            // Prefer the side of the text box, so the panel never covers the words it's pointing at
            if (wa.Right - fieldPx.Right >= wpx) { x = fieldPx.Right - 4 * s; y = anchorPx.Bottom - hpx + 10 * s; }
            else if (fieldPx.Left - wa.Left >= wpx) { x = fieldPx.Left - wpx + 4 * s; y = anchorPx.Bottom - hpx + 10 * s; }
            else
            {
                y = anchorPx.Top - hpx + 6 * s;
                if (y < wa.Top) y = anchorPx.Bottom - 6 * s;
                x = anchorPx.Right - wpx + 10 * s;
            }
            x = Math.Min(Math.Max(x, wa.Left), wa.Right - wpx);
            y = Math.Min(Math.Max(y, wa.Top), wa.Bottom - hpx);
            Ui.Place(w, x, y, wpx, hpx);
            scroller.ScrollToVerticalOffset(keep);
        }

        private static Border Empty(string title, string text)
        {
            var sp = new StackPanel { Margin = new Thickness(16, 18, 16, 18) };
            sp.Children.Add(Theme.Text(title, 13.5, Theme.Ink, FontWeights.SemiBold));
            var t = Theme.Text(text, 12.5, Theme.Ink2, null, true); t.Margin = new Thickness(0, 4, 0, 0);
            sp.Children.Add(t);
            return new Border { Child = sp };
        }

        private Border RewriteBlock(RewriteJob rw)
        {
            var sp = new StackPanel();
            var head = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            var scope = Theme.Text(rw.Whole ? "Whole field" : "Selection", 11.5, Theme.Ink3);
            DockPanel.SetDock(scope, Dock.Right); head.Children.Add(scope);
            head.Children.Add(Theme.Text("REWRITE · " + rw.Goal.ToUpperInvariant(), 10.5, Theme.Ink3, FontWeights.Bold));
            sp.Children.Add(head);
            var text = new TextBox
            {
                Text = rw.Busy ? "Thinking…" : rw.Result, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(0),
                Background = Brushes.Transparent, FontFamily = Theme.UiFont, FontSize = 13, MaxHeight = 160,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Foreground = rw.Busy ? Theme.Ink3 : Theme.Ink, Focusable = false
            };
            sp.Children.Add(text);
            var actions = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            actions.Children.Add(Theme.Button("Replace", () => UseRewrite?.Invoke(), Theme.Accent, Theme.White, Theme.Accent, !rw.Busy && rw.Result.Length > 0));
            actions.Children.Add(Theme.Button("Discard", () => DiscardRewrite?.Invoke(), Brushes.Transparent, Theme.Ink2, Brushes.Transparent));
            sp.Children.Add(actions);
            if (rw.Note.Length > 0) sp.Children.Add(Theme.Text(rw.Note, 12, Theme.Ink2, null, true));
            return new Border { Margin = new Thickness(14, 10, 14, 0), Padding = new Thickness(10, 8, 10, 4), Background = Theme.Bg2, BorderBrush = Theme.Rule, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Child = sp };
        }

        private Border Item(Suggestion g, Question? q)
        {
            var sp = new StackPanel();
            var head = new DockPanel();
            head.Children.Add(Theme.MarkTag(g));
            var title = Theme.Text(g.Title + (g.Source != "rules" && !string.IsNullOrEmpty(g.Engine) ? "  ·  " + g.Engine : ""), 12.5, Theme.Ink, FontWeights.SemiBold);
            title.Margin = new Thickness(8, 0, 0, 0); title.VerticalAlignment = VerticalAlignment.Center;
            head.Children.Add(title);
            sp.Children.Add(head);
            var fix = Theme.Fix(g, 13.5); fix.Margin = new Thickness(0, 4, 0, 0);
            sp.Children.Add(fix);
            if (g.Why.Length > 0) { var why = Theme.Text(g.Why, 12, Theme.Ink2, null, true); why.Margin = new Thickness(0, 3, 0, 0); sp.Children.Add(why); }
            if (q != null && q.Id == g.Id)
            {
                var block = Ui.QuestionBlock(g, q, all => Answer?.Invoke(g, all));
                block.Margin = new Thickness(0, 8, 0, 6);
                sp.Children.Add(block);
            }
            else
            {
                var actions = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
                if (g.Replacement != null)
                    actions.Children.Add(Theme.Button(g.Replacement.Length == 0 ? "Remove" : "Accept", () => Accept?.Invoke(g), Theme.Cat(g.Cat), Theme.White, Theme.Cat(g.Cat)));
                actions.Children.Add(Theme.Button("Dismiss", () => Dismiss?.Invoke(g), Brushes.Transparent, Theme.Ink2, Brushes.Transparent));
                sp.Children.Add(actions);
            }
            var item = new Border { Padding = new Thickness(14, 10, 14, 4), BorderBrush = Theme.Rule, BorderThickness = new Thickness(0, 1, 0, 0), Child = sp, Background = Theme.Bg };
            item.MouseEnter += (_, _) => { item.Background = Theme.Tint(g.Cat, 16); Hover?.Invoke(g); };
            item.MouseLeave += (_, _) => { item.Background = Theme.Bg; };
            return item;
        }

        public void Hide() { if (w.IsVisible) w.Hide(); }
    }

    /// <summary>A short message near the text box.</summary>
    internal sealed class ToastWindow
    {
        private readonly Window w = Ui.ToolWindow(clickThrough: true);
        private readonly Border root;
        private readonly System.Windows.Threading.DispatcherTimer timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };

        public ToastWindow()
        {
            root = new Border { Background = Theme.Ink, CornerRadius = new CornerRadius(7), Padding = new Thickness(12, 7, 12, 8), Margin = new Thickness(8), MaxWidth = 340, Effect = Theme.Shadow() };
            w.Content = root;
            timer.Tick += (_, _) => { timer.Stop(); w.Hide(); };
        }

        public void Show(string message, Rect anchorPx)
        {
            root.Child = Theme.Text(message, 12.5, Theme.White, null, true);
            Size dip = Ui.Measure(root, 356);
            double s = Native.ScaleAt(anchorPx.X, anchorPx.Y);
            Rect wa = Ui.WorkArea(anchorPx.X, anchorPx.Y);
            double wpx = dip.Width * s, hpx = dip.Height * s;
            double x = Math.Min(Math.Max(anchorPx.X + (anchorPx.Width - wpx) / 2, wa.Left), wa.Right - wpx);
            double y = Math.Min(anchorPx.Bottom + 4 * s, wa.Bottom - hpx);
            Ui.Place(w, x, y, wpx, hpx);
            timer.Stop(); timer.Start();
        }
    }
}
