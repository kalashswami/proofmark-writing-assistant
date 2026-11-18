using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Proofmark
{
    /// <summary>
    /// Windows' built-in spell checker (the Spell Checking API in Windows 8 and later), the same dictionary
    /// Windows apps use. Free, offline, and it knows the words you've added to your Windows dictionary.
    /// </summary>
    internal sealed class SpellCheck
    {
        private readonly ISpellChecker? checker;
        public bool Available => checker != null;

        public SpellCheck(string language = "en-US")
        {
            try
            {
                Type? t = Type.GetTypeFromCLSID(new Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC"));
                if (t == null) return;
                var factory = (ISpellCheckerFactory)Activator.CreateInstance(t)!;
                string lang = factory.IsSupported(language) != 0 ? language : factory.IsSupported("en-GB") != 0 ? "en-GB" : "";
                if (lang.Length > 0) checker = factory.CreateSpellChecker(lang);
                else Log.Write("spell: no English dictionary installed");
            }
            catch (Exception ex) { Log.Write("spell: " + ex.Message); }
        }

        /// <summary>Misspelled words with a suggested fix. Skips names in ALL CAPS, words with digits, links and emails.</summary>
        public List<(int Start, int Length, string Word, string Fix)> Check(string text)
        {
            var found = new List<(int, int, string, string)>();
            if (checker == null || text.Length == 0) return found;
            try
            {
                IEnumSpellingError errors = checker.Check(text);
                for (int guard = 0; guard < 400; guard++)
                {
                    ISpellingError? e = errors.Next();
                    if (e == null) break;
                    int start = (int)e.StartIndex, len = (int)e.Length;
                    if (start < 0 || len <= 0 || start + len > text.Length) continue;
                    string word = text.Substring(start, len);
                    if (Skip(text, start, len, word)) continue;
                    string fix = "";
                    if (e.CorrectiveAction == CorrectiveAction.Replace) fix = e.Replacement ?? "";
                    else if (e.CorrectiveAction == CorrectiveAction.GetSuggestions) fix = FirstSuggestion(word);
                    else continue; // "Delete" means a repeated word; the rules engine handles those
                    if (fix.Length > 0 && fix != word) found.Add((start, len, word, fix));
                }
            }
            catch (Exception ex) { Log.Write("spell check: " + ex.Message); }
            return found;
        }

        private static bool Skip(string text, int start, int len, string word)
        {
            if (word.Length < 2) return true;
            bool allCaps = true, hasDigit = false;
            foreach (char c in word) { if (char.IsLower(c)) allCaps = false; if (char.IsDigit(c)) hasDigit = true; }
            if (allCaps || hasDigit) return true;
            // camelCase or PascalCase words with capitals inside (FieldWatcher, iPhone) are names, not typos
            for (int i = 1; i < word.Length; i++) if (char.IsUpper(word[i])) return true;
            // A capitalized word in the middle of a sentence is almost always a name (Proofmark, Glassdoor)
            if (char.IsUpper(word[0]))
            {
                int k = start - 1;
                while (k >= 0 && (text[k] == ' ' || text[k] == '\t' || text[k] == '"' || text[k] == '“' || text[k] == '(')) k--;
                bool sentenceStart = k < 0 || text[k] == '.' || text[k] == '!' || text[k] == '?' || text[k] == '\n' || text[k] == '\r' || text[k] == ':';
                if (!sentenceStart) return true;
            }
            // Inside a link, email address or file path
            int a = start; while (a > 0 && !char.IsWhiteSpace(text[a - 1])) a--;
            int b = start + len; while (b < text.Length && !char.IsWhiteSpace(text[b])) b++;
            string token = text.Substring(a, b - a);
            string core = token.TrimEnd('.', ',', '!', '?', ';', ':', ')', '"', '”', '’', '\'');
            return token.Contains('@') || token.Contains("://") || token.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
                || token.Contains('\\') || token.Contains('/') || token.Contains('_') || core.Contains('.');   // file names like engine.js
        }

        private string FirstSuggestion(string word)
        {
            try
            {
                IEnumString list = checker!.Suggest(word);
                var one = new string[1];
                if (list.Next(1, one, IntPtr.Zero) == 0 && !string.IsNullOrEmpty(one[0])) return one[0];
            }
            catch { }
            return "";
        }

        // ---- COM definitions for the Windows Spell Checking API (spellcheck.h) ----
        private enum CorrectiveAction { None = 0, GetSuggestions = 1, Replace = 2, Delete = 3 }

        [ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ISpellCheckerFactory
        {
            IEnumString SupportedLanguages { get; }
            int IsSupported([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
            ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
        }

        [ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ISpellChecker
        {
            string LanguageTag { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
            IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text);
            IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
        }

        [ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IEnumSpellingError
        {
            ISpellingError? Next();
        }

        [ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ISpellingError
        {
            uint StartIndex { get; }
            uint Length { get; }
            CorrectiveAction CorrectiveAction { get; }
            string? Replacement { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
        }
    }
}
