using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace Proofmark
{
    /// <summary>A small log in %LOCALAPPDATA%\Proofmark\log.txt for troubleshooting.</summary>
    internal static class Log
    {
        private static readonly object gate = new object();
        public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Proofmark");
        private static readonly string FilePath = Path.Combine(Dir, "log.txt");

        public static void Write(string message)
        {
            try
            {
                lock (gate)
                {
                    Directory.CreateDirectory(Dir);
                    var fi = new FileInfo(FilePath);
                    if (fi.Exists && fi.Length > 512 * 1024) fi.Delete();
                    File.AppendAllText(FilePath, $"{DateTime.Now:HH:mm:ss} {message}{Environment.NewLine}");
                }
            }
            catch { }
        }
    }

    /// <summary>Settings saved in %APPDATA%\Proofmark\settings.json.</summary>
    public sealed class AppSettings
    {
        public bool Paused { get; set; }
        /// <summary>"none", "openai" (Ollama, LM Studio or any OpenAI-compatible server) or "claude".</summary>
        public string Provider { get; set; } = "none";
        public string OaiBase { get; set; } = "http://localhost:11434/v1";
        public string OaiModel { get; set; } = "llama3.2";
        public string OaiKey { get; set; } = "";
        public string ClaudeKey { get; set; } = "";
        public string ClaudeModel { get; set; } = "claude-sonnet-5-5";
        public string WorkspaceId { get; set; } = "";
        /// <summary>Backup OpenAI-compatible engine, used when the main one is busy, rate-limited or unreachable.</summary>
        public string BackupBase { get; set; } = "";
        public string BackupModel { get; set; } = "";
        public string BackupKey { get; set; } = "";
        /// <summary>Words Proofmark never flags (names, product names, terms of art). Stored lowercase.</summary>
        public List<string> IgnoredWords { get; set; } = new List<string>();
        public bool LanguageTool { get; set; }
        public string LtUrl { get; set; } = "https://api.languagetool.org";
        public bool Correctness { get; set; } = true;
        public bool Clarity { get; set; } = true;
        public bool Style { get; set; } = true;
        public bool Tone { get; set; } = true;
        /// <summary>Process names Proofmark ignores. Browsers are skipped because the browser extension covers them.</summary>
        public string SkipApps { get; set; } = "chrome, msedge, brave, opera, vivaldi, firefox, code, devenv, windowsterminal, cmd, powershell, pwsh, conhost";

        private static readonly string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Proofmark", "settings.json");
        private static readonly JsonSerializerOptions Opts = new JsonSerializerOptions { WriteIndented = true };

        public HashSet<string> SkipSet() =>
            new HashSet<string>(SkipApps.Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(s => s.Trim().ToLowerInvariant().Replace(".exe", "")));

        public bool CategoryOn(string cat) => cat switch
        {
            "correctness" => Correctness,
            "clarity" => Clarity,
            "style" => Style,
            "tone" => Tone,
            _ => true
        };

        public bool HasLlm => Provider == "openai" ? (OaiBase.Length > 0 && OaiModel.Length > 0) : Provider == "claude" && ClaudeKey.Length > 0;
        public bool HasDeep => HasLlm || LanguageTool;
        public bool HasBackup => BackupBase.Length > 0 && BackupModel.Length > 0;

        public string BackupName() => BackupBase.Contains("groq.com") ? "Groq" : BackupBase.Contains("googleapis.com") ? "Gemini"
            : BackupBase.Contains(":11434") ? "Ollama" : BackupBase.Contains(":1234") ? "LM Studio" : BackupModel;

        public bool IsIgnored(string word) => IgnoredWords.Contains(word.Trim().ToLowerInvariant());

        public string EngineName()
        {
            if (Provider == "claude") return "Claude";
            if (Provider == "openai")
            {
                if (OaiBase.Contains(":11434")) return "Ollama";
                if (OaiBase.Contains(":1234")) return "LM Studio";
                return OaiModel.Length > 20 ? OaiModel.Substring(0, 20) : OaiModel;
            }
            return "";
        }

        public static AppSettings Load()
        {
            try
            {
                if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
            }
            catch (Exception ex) { Log.Write("settings load: " + ex.Message); }
            return new AppSettings();
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Opts));
            }
            catch (Exception ex) { Log.Write("settings save: " + ex.Message); }
        }
    }

    /// <summary>One suggestion from the shared engine (same shape as in engine.js).</summary>
    public sealed class Suggestion
    {
        public string Id { get; set; } = "";
        public string Source { get; set; } = "rules";
        public string Rule { get; set; } = "";
        public string Cat { get; set; } = "clarity";
        public string Mark { get; set; } = "";
        public string Title { get; set; } = "";
        public string Why { get; set; } = "";
        public int Start { get; set; }
        public int End { get; set; }
        public string Original { get; set; } = "";
        public string? Replacement { get; set; }
        public string? Engine { get; set; }

        public string DismissKey => $"{Rule}|{Original.ToLowerInvariant()}|{Replacement ?? "null"}";
    }

    /// <summary>Text helpers shared by the controller.</summary>
    internal static class TextOps
    {
        public static string Norm(string s) => s.Replace("\r\n", "\n").Replace('\r', '\n');

        /// <summary>Maps a position in the normalized text (\r\n turned into \n) back to the app's own text.</summary>
        public static int NormToRaw(string raw, int normIndex)
        {
            int n = 0;
            for (int i = 0; i < raw.Length; i++)
            {
                if (n == normIndex) return i;
                if (raw[i] == '\r' && i + 1 < raw.Length && raw[i + 1] == '\n') i++;
                n++;
            }
            return raw.Length;
        }

        /// <summary>How many non-overlapping copies of s appear before position start.</summary>
        public static int Occurrence(string text, string s, int start)
        {
            if (s.Length == 0) return 0;
            int n = 0, i = 0;
            while (true)
            {
                int j = text.IndexOf(s, i, StringComparison.Ordinal);
                if (j < 0 || j >= start) return n;
                n++;
                i = j + s.Length;
            }
        }

        /// <summary>Shifts suggestions past an edit and drops any the edit touched (same rule as the extension).</summary>
        public static List<Suggestion> Rebase(List<Suggestion> list, string before, string after)
        {
            int max = Math.Min(before.Length, after.Length), p = 0, s = 0;
            while (p < max && before[p] == after[p]) p++;
            while (s < max - p && before[before.Length - 1 - s] == after[after.Length - 1 - s]) s++;
            int del = before.Length - p - s, ins = after.Length - p - s, editEnd = p + del, delta = ins - del;
            string inserted = after.Substring(p, ins);
            bool wordIns = inserted.Any(char.IsLetterOrDigit);
            var kept = new List<Suggestion>();
            foreach (Suggestion g in list)
            {
                bool overlaps = p < g.End && editEnd > g.Start;
                bool adjacent = del == 0 && ins > 0 && wordIns && (p == g.End || p == g.Start);
                if (overlaps || adjacent) continue;
                if (g.Start >= editEnd && delta != 0) { g.Start += delta; g.End += delta; }
                kept.Add(g);
            }
            return kept;
        }
    }
}
