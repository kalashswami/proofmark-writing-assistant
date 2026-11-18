using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Proofmark
{
    /// <summary>Settings: smart-check engine, LanguageTool, categories and apps to skip.</summary>
    internal sealed class SettingsWindow : Window
    {
        private readonly AppSettings s;
        private readonly ComboBox provider = new ComboBox();
        private readonly ComboBox preset = new ComboBox();
        private readonly TextBox oaiBase = new TextBox(), oaiModel = new TextBox(), workspace = new TextBox(), ltUrl = new TextBox(), skip = new TextBox();
        private readonly PasswordBox oaiKey = new PasswordBox(), claudeKey = new PasswordBox();
        private readonly ComboBox claudeModel = new ComboBox();
        private readonly ComboBox backupPreset = new ComboBox();
        private readonly TextBox backupBase = new TextBox(), backupModel = new TextBox(), ignored = new TextBox();
        private readonly PasswordBox backupKey = new PasswordBox();
        private readonly StackPanel backupPanel = new StackPanel();
        private readonly CheckBox lt = new CheckBox { Content = "Add a LanguageTool grammar pass (free)" };
        private readonly CheckBox cCorrect = new CheckBox { Content = "Correctness" }, cClarity = new CheckBox { Content = "Clarity" },
            cStyle = new CheckBox { Content = "Style" }, cTone = new CheckBox { Content = "Tone" };
        private readonly StackPanel oaiPanel = new StackPanel(), claudePanel = new StackPanel();
        private readonly TextBlock keyLabel = Label("API key"), keyHint = Hint("");
        public event Action? Saved;

        public SettingsWindow(AppSettings settings)
        {
            s = settings;
            Title = "Proofmark settings";
            Width = 460; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = Theme.UiFont; FontSize = 13; Background = Theme.Bg;

            var root = new StackPanel { Margin = new Thickness(20, 16, 20, 18) };
            root.Children.Add(Heading("Smart checks and rewrites"));
            root.Children.Add(Hint("Used only when you press Deep check or Rewrite in the Proofmark panel. Instant checks always run on this PC."));
            provider.Items.Add("Off");
            provider.Items.Add("A model on this computer (free): Ollama, LM Studio or similar");
            provider.Items.Add("Claude API (paid, your own key)");
            provider.SelectedIndex = s.Provider == "openai" ? 1 : s.Provider == "claude" ? 2 : 0;
            provider.SelectionChanged += (_, _) => Sync();
            root.Children.Add(provider);

            preset.Items.Add("Ollama (on this PC)"); preset.Items.Add("LM Studio (on this PC)");
            preset.Items.Add("Google Gemini (cloud, free tier)"); preset.Items.Add("Groq (cloud, free tier)");
            preset.Items.Add("Other OpenAI-compatible server");
            preset.SelectedIndex = s.OaiBase.Contains(":11434") ? 0 : s.OaiBase.Contains(":1234") ? 1
                : s.OaiBase.Contains("generativelanguage.googleapis.com") ? 2 : s.OaiBase.Contains("api.groq.com") ? 3 : 4;
            preset.SelectionChanged += (_, _) =>
            {
                switch (preset.SelectedIndex)
                {
                    case 0: oaiBase.Text = "http://localhost:11434/v1"; oaiModel.Text = "llama3.2:3b"; break;
                    case 1: oaiBase.Text = "http://localhost:1234/v1"; break;
                    case 2: oaiBase.Text = "https://generativelanguage.googleapis.com/v1beta/openai/"; oaiModel.Text = "gemini-3.8-flash"; break;
                    case 3: oaiBase.Text = "https://api.groq.com/openai/v1"; break;
                }
                SyncKeyHint();
            };
            oaiBase.Text = s.OaiBase; oaiModel.Text = s.OaiModel; oaiKey.Password = s.OaiKey;
            oaiPanel.Children.Add(Label("App")); oaiPanel.Children.Add(preset);
            oaiPanel.Children.Add(Label("Server address")); oaiPanel.Children.Add(oaiBase);
            oaiPanel.Children.Add(Label("Model name (for Ollama, type a name from: ollama list)")); oaiPanel.Children.Add(oaiModel);
            oaiPanel.Children.Add(keyLabel); oaiPanel.Children.Add(oaiKey);
            oaiPanel.Children.Add(keyHint);
            root.Children.Add(oaiPanel);

            claudeKey.Password = s.ClaudeKey; workspace.Text = s.WorkspaceId;
            claudeModel.Items.Add("claude-sonnet-5-5"); claudeModel.Items.Add("claude-haiku-5-5");
            claudeModel.SelectedItem = s.ClaudeModel == "claude-haiku-5-5" ? "claude-haiku-5-5" : "claude-sonnet-5-5";
            claudePanel.Children.Add(Label("Claude API key")); claudePanel.Children.Add(claudeKey);
            claudePanel.Children.Add(Label("Workspace ID (only if your key isn't tied to a workspace)")); claudePanel.Children.Add(workspace);
            claudePanel.Children.Add(Label("Model for deep checks")); claudePanel.Children.Add(claudeModel);
            root.Children.Add(claudePanel);

            root.Children.Add(Heading("Backup engine"));
            root.Children.Add(Hint("Used automatically when the main engine is busy, rate-limited or unreachable. Groq's free tier makes a good backup for Gemini."));
            foreach (string item in new[] { "None", "Groq (cloud, free tier)", "Google Gemini (cloud, free tier)", "Ollama (on this PC)", "LM Studio (on this PC)", "Other OpenAI-compatible server" })
                backupPreset.Items.Add(item);
            backupBase.Text = s.BackupBase; backupModel.Text = s.BackupModel; backupKey.Password = s.BackupKey;
            backupPreset.SelectedIndex = s.BackupBase.Length == 0 ? 0 : s.BackupBase.Contains("groq.com") ? 1 : s.BackupBase.Contains("googleapis.com") ? 2
                : s.BackupBase.Contains(":11434") ? 3 : s.BackupBase.Contains(":1234") ? 4 : 5;
            backupPreset.SelectionChanged += (_, _) =>
            {
                switch (backupPreset.SelectedIndex)
                {
                    case 0: backupBase.Text = ""; backupModel.Text = ""; break;
                    case 1: backupBase.Text = "https://api.groq.com/openai/v1"; backupModel.Text = "llama-3.3-70b-versatile"; break;
                    case 2: backupBase.Text = "https://generativelanguage.googleapis.com/v1beta/openai/"; backupModel.Text = "gemini-3.8-flash"; break;
                    case 3: backupBase.Text = "http://localhost:11434/v1"; backupModel.Text = "llama3.2:3b"; break;
                    case 4: backupBase.Text = "http://localhost:1234/v1"; break;
                }
                backupPanel.Visibility = backupPreset.SelectedIndex == 0 ? Visibility.Collapsed : Visibility.Visible;
            };
            root.Children.Add(backupPreset);
            backupPanel.Children.Add(Label("Server address")); backupPanel.Children.Add(backupBase);
            backupPanel.Children.Add(Label("Model name")); backupPanel.Children.Add(backupModel);
            backupPanel.Children.Add(Label("API key (Groq: console.groq.com/keys, Gemini: aistudio.google.com/apikey; none for Ollama or LM Studio)")); backupPanel.Children.Add(backupKey);
            backupPanel.Visibility = backupPreset.SelectedIndex == 0 ? Visibility.Collapsed : Visibility.Visible;
            root.Children.Add(backupPanel);

            root.Children.Add(Heading("Grammar engine"));
            lt.IsChecked = s.LanguageTool; lt.Margin = new Thickness(0, 2, 0, 4);
            root.Children.Add(lt);
            root.Children.Add(Label("LanguageTool server (the free public one sends text to LanguageTool, up to 20 checks a minute)"));
            ltUrl.Text = s.LtUrl;
            root.Children.Add(ltUrl);

            root.Children.Add(Heading("Instant checks"));
            var cats = new WrapPanel();
            foreach (var (box, on) in new[] { (cCorrect, s.Correctness), (cClarity, s.Clarity), (cStyle, s.Style), (cTone, s.Tone) })
            {
                box.IsChecked = on; box.Margin = new Thickness(0, 2, 16, 2); cats.Children.Add(box);
            }
            root.Children.Add(cats);

            root.Children.Add(Heading("Words Proofmark never flags"));
            root.Children.Add(Hint("Names and terms you chose to ignore everywhere, separated by commas. Delete a word here to have it checked again."));
            ignored.Text = string.Join(", ", s.IgnoredWords); ignored.TextWrapping = TextWrapping.Wrap;
            root.Children.Add(ignored);

            root.Children.Add(Heading("Apps to skip"));
            root.Children.Add(Hint("Process names, separated by commas. Browsers are skipped because the Proofmark browser extension covers them."));
            skip.Text = s.SkipApps; skip.TextWrapping = TextWrapping.Wrap;
            root.Children.Add(skip);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 4, 14, 4), Margin = new Thickness(0, 0, 8, 0), IsCancel = true };
            var save = new Button { Content = "Save", Padding = new Thickness(18, 4, 18, 4), IsDefault = true };
            cancel.Click += (_, _) => Close();
            save.Click += (_, _) => Save();
            buttons.Children.Add(cancel); buttons.Children.Add(save);
            root.Children.Add(buttons);

            Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = SystemParameters.WorkArea.Height - 80 };
            Sync();
        }

        private static TextBlock Heading(string t) => new TextBlock { Text = t, FontWeight = FontWeights.SemiBold, FontSize = 14, Margin = new Thickness(0, 14, 0, 4), Foreground = Theme.Ink };
        private static TextBlock Hint(string t) => new TextBlock { Text = t, TextWrapping = TextWrapping.Wrap, Foreground = Theme.Ink3, FontSize = 12, Margin = new Thickness(0, 0, 0, 6) };
        private static TextBlock Label(string t) => new TextBlock { Text = t, TextWrapping = TextWrapping.Wrap, Foreground = Theme.Ink2, FontSize = 12, Margin = new Thickness(0, 8, 0, 3) };

        private bool IsLocal(string url) => url.Contains("localhost") || url.Contains("127.0.0.1");

        private void SyncKeyHint()
        {
            int i = preset.SelectedIndex;
            keyLabel.Text = IsLocal(oaiBase.Text) ? "API key (not needed for Ollama or LM Studio)" : "API key (required)";
            keyHint.Text = i == 2 ? "Get a free key at aistudio.google.com/apikey and paste it here."
                : i == 3 ? "Get a free key at console.groq.com/keys, and enter a model name from console.groq.com/docs/models."
                : "";
            keyHint.Visibility = keyHint.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void Sync()
        {
            SyncKeyHint();
            oaiPanel.Visibility = provider.SelectedIndex == 1 ? Visibility.Visible : Visibility.Collapsed;
            claudePanel.Visibility = provider.SelectedIndex == 2 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void Save()
        {
            if (provider.SelectedIndex == 1 && (!oaiBase.Text.Trim().StartsWith("http") || oaiModel.Text.Trim().Length == 0))
            { MessageBox.Show(this, "Enter the server address (starting with http) and a model name.", "Proofmark"); return; }
            if (backupPreset.SelectedIndex > 0 && (!backupBase.Text.Trim().StartsWith("http") || backupModel.Text.Trim().Length == 0))
            { MessageBox.Show(this, "Enter the backup engine's server address and model name, or set the backup to None.", "Proofmark"); return; }
            if (backupPreset.SelectedIndex > 0 && !IsLocal(backupBase.Text) && backupKey.Password.Trim().Length == 0)
            { MessageBox.Show(this, "The backup engine is a cloud service, so it needs its own API key.", "Proofmark"); return; }
            if (provider.SelectedIndex == 1 && !IsLocal(oaiBase.Text) && oaiKey.Password.Trim().Length == 0)
            { MessageBox.Show(this, "Cloud services like Gemini and Groq need an API key. Paste yours in the API key box.", "Proofmark"); return; }
            if (provider.SelectedIndex == 2 && !claudeKey.Password.Trim().StartsWith("sk-ant-"))
            { MessageBox.Show(this, "Paste a Claude API key (it starts with sk-ant-), or pick a free engine.", "Proofmark"); return; }
            s.Provider = provider.SelectedIndex == 1 ? "openai" : provider.SelectedIndex == 2 ? "claude" : "none";
            s.OaiBase = oaiBase.Text.Trim(); s.OaiModel = oaiModel.Text.Trim(); s.OaiKey = oaiKey.Password.Trim();
            s.ClaudeKey = claudeKey.Password.Trim(); s.WorkspaceId = workspace.Text.Trim();
            s.ClaudeModel = claudeModel.SelectedItem as string ?? "claude-sonnet-5-5";
            s.LanguageTool = lt.IsChecked == true;
            s.LtUrl = ltUrl.Text.Trim().Length > 0 ? ltUrl.Text.Trim() : "https://api.languagetool.org";
            s.Correctness = cCorrect.IsChecked == true; s.Clarity = cClarity.IsChecked == true; s.Style = cStyle.IsChecked == true; s.Tone = cTone.IsChecked == true;
            s.SkipApps = skip.Text.Trim();
            if (backupPreset.SelectedIndex == 0) { s.BackupBase = ""; s.BackupModel = ""; s.BackupKey = ""; }
            else { s.BackupBase = backupBase.Text.Trim(); s.BackupModel = backupModel.Text.Trim(); s.BackupKey = backupKey.Password.Trim(); }
            s.IgnoredWords = ignored.Text.Split(new[] { ',', ';', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(w => w.Trim().ToLowerInvariant()).Where(w => w.Length > 0).Distinct().ToList();
            s.Save();
            Saved?.Invoke();
            Close();
        }
    }
}
