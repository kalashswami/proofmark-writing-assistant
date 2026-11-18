using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Proofmark
{
    /// <summary>
    /// Talks to the smart-check engine the person picked: a local or cloud OpenAI-compatible server
    /// (Ollama, LM Studio, Gemini, Groq, ...), the Claude API, and optionally LanguageTool. Called only on Deep check or Rewrite.
    /// Busy or rate-limited services are retried, then handed to the backup engine if one is set.
    /// </summary>
    public sealed class AiClient
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        private const string LtPublic = "https://api.languagetool.org";

        /// <summary>Set after each call: the name of the backup engine if it had to step in, otherwise null.</summary>
        public string? LastBackupUsed { get; private set; }
        /// <summary>Why the backup stepped in, phrased to follow the main engine's name ("was busy").</summary>
        public string LastBackupReason { get; private set; } = "was busy";

        /// <summary>The service is overloaded or rate-limited for a moment; worth retrying or trying another engine.</summary>
        private sealed class BusyException : Exception { public BusyException(string m) : base(m) { } }
        /// <summary>A daily (or longer) quota is used up. Retrying is pointless until it resets.</summary>
        private sealed class QuotaException : Exception
        {
            public readonly TimeSpan? ResetsIn;
            public QuotaException(string m, TimeSpan? resetsIn) : base(m) { ResetsIn = resetsIn; }
        }
        private sealed class HttpStatus400 : Exception { public HttpStatus400(string m) : base(m) { } }

        /// <summary>While a main engine's daily quota is used up, go straight to the backup instead of asking again.</summary>
        private static string? quotaKey;
        private static DateTime quotaUntil;
        /// <summary>Ollama model names we had to correct (llama3.2 -> llama3.2:3b), so the lookup happens once.</summary>
        private static readonly Dictionary<string, string> ollamaNames = new Dictionary<string, string>();

        public async Task<string> Complete(AppSettings s, string prompt, bool json, bool fast, int maxTokens)
        {
            LastBackupUsed = null;
            LastBackupReason = "was busy";
            string mainKey = s.Provider + "|" + s.OaiBase + "|" + s.OaiModel;
            Exception mainError;
            try
            {
                if (quotaKey == mainKey && DateTime.UtcNow < quotaUntil)
                    throw new QuotaException(QuotaText(s.EngineName(), quotaUntil - DateTime.UtcNow), quotaUntil - DateTime.UtcNow);
                return await WithRetry(() => Primary(s, prompt, json, fast, maxTokens));
            }
            catch (QuotaException ex)
            {
                if (quotaKey != mainKey || DateTime.UtcNow >= quotaUntil)
                {
                    quotaKey = mainKey;
                    quotaUntil = DateTime.UtcNow + (ex.ResetsIn ?? TimeSpan.FromMinutes(30));
                }
                mainError = new QuotaException(QuotaText(s.EngineName(), quotaUntil - DateTime.UtcNow), null);
                LastBackupReason = "has used up its free daily limit";
            }
            catch (Exception ex) when (ex is BusyException || ex is InvalidOperationException) { mainError = ex; }

            if (!s.HasBackup)
                throw new InvalidOperationException(mainError.Message + (mainError is QuotaException ? " Add a backup engine in Settings, or switch to Groq." : ""));
            Log.Write($"main engine failed ({mainError.Message}); trying backup {s.BackupName()}");
            try
            {
                string reply = await WithRetry(() => OpenAi(s.BackupBase, s.BackupModel, s.BackupKey, prompt, json, maxTokens));
                LastBackupUsed = s.BackupName();
                return reply;
            }
            catch (Exception ex) when (ex is BusyException || ex is QuotaException || ex is InvalidOperationException || ex is HttpStatus400)
            {
                throw new InvalidOperationException($"{mainError.Message} The backup ({s.BackupName()}) didn't work either: {ex.Message}");
            }
        }

        private static string QuotaText(string engine, TimeSpan left)
        {
            string when = left.TotalMinutes < 1 ? "in a minute"
                : left.TotalHours < 1 ? $"in about {Math.Ceiling(left.TotalMinutes)} minutes"
                : $"in about {Math.Round(left.TotalHours)} {(Math.Round(left.TotalHours) == 1 ? "hour" : "hours")}";
            return $"{engine} has used up its free daily limit (it resets {when}).";
        }

        /// <summary>Reads "Please retry in 3h6m43.8s" (Gemini) or "try again in 7m12s" (Groq).</summary>
        private static TimeSpan? RetryAfter(string msg)
        {
            Match m = Regex.Match(msg, @"(?:retry|try again) in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?", RegexOptions.IgnoreCase);
            if (!m.Success || (m.Groups[1].Length + m.Groups[2].Length + m.Groups[3].Length) == 0) return null;
            double h = m.Groups[1].Success ? double.Parse(m.Groups[1].Value) : 0;
            double min = m.Groups[2].Success ? double.Parse(m.Groups[2].Value) : 0;
            double sec = m.Groups[3].Success ? double.Parse(m.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture) : 0;
            return TimeSpan.FromHours(h) + TimeSpan.FromMinutes(min) + TimeSpan.FromSeconds(sec);
        }

        private static bool IsDailyQuota(string msg) =>
            Regex.IsMatch(msg, @"per ?day|PerDay|requests per day|\bRPD\b|daily", RegexOptions.IgnoreCase);

        private static Task<string> Primary(AppSettings s, string prompt, bool json, bool fast, int maxTokens)
        {
            if (s.Provider == "claude") return Claude(s, prompt, fast, maxTokens);
            if (s.Provider == "openai") return OpenAi(s.OaiBase, s.OaiModel, s.OaiKey, prompt, json, maxTokens);
            throw new InvalidOperationException("Choose a smart-check engine in Proofmark settings.");
        }

        /// <summary>Retries a busy service twice, waiting 1.5 s and then 4 s.</summary>
        private static async Task<string> WithRetry(Func<Task<string>> call)
        {
            int[] waits = { 1500, 4000 };
            for (int attempt = 0; ; attempt++)
            {
                try { return await call(); }
                catch (BusyException) when (attempt < waits.Length)
                {
                    await Task.Delay(waits[attempt]);
                }
            }
        }

        private static bool IsOllama(string baseUrl) => baseUrl.Contains(":11434");

        private static async Task<string> OpenAi(string baseUrl, string model, string key, string prompt, bool json, int maxTokens)
        {
            if (IsOllama(baseUrl) && ollamaNames.TryGetValue(model, out string? known)) model = known;
            try { return await OpenAiOnce(baseUrl, model, key, prompt, json, maxTokens); }
            catch (InvalidOperationException ex) when (IsOllama(baseUrl) && ex.Message.Contains("not found"))
            {
                // Ollama only knows exact tags: "llama3.2" isn't found when "llama3.2:3b" was pulled. Use the installed one.
                string? installed = await OllamaMatch(baseUrl, model);
                if (installed == null || installed == model) throw new InvalidOperationException(
                    $"Ollama doesn't have the model \"{model}\". In PowerShell run: ollama pull {model} (or type the exact name from: ollama list in Settings).");
                Log.Write($"ollama: using {installed} for {model}");
                ollamaNames[model] = installed;
                return await OpenAiOnce(baseUrl, installed, key, prompt, json, maxTokens);
            }
        }

        /// <summary>The installed Ollama model that best matches the name in Settings, or null if none is installed.</summary>
        private static async Task<string?> OllamaMatch(string baseUrl, string model)
        {
            string root = Regex.Replace(baseUrl.TrimEnd('/'), @"/v1$", "");
            List<string> names;
            try
            {
                JsonNode? data = JsonNode.Parse(await Http.GetStringAsync(root + "/api/tags"));
                names = (Obj(data)?["models"] as JsonArray ?? new JsonArray())
                    .Select(n => Str(Obj(n), "name") ?? Str(Obj(n), "model") ?? "").Where(n => n.Length > 0).ToList();
            }
            catch (Exception ex) { Log.Write("ollama tags: " + ex.Message); return null; }
            if (names.Count == 0) throw new InvalidOperationException("Ollama has no models yet. In PowerShell run: ollama pull llama3.2:3b");
            string family = model.Split(':')[0];
            return names.FirstOrDefault(n => n.Equals(model, StringComparison.OrdinalIgnoreCase))
                ?? names.FirstOrDefault(n => n.Equals(model + ":latest", StringComparison.OrdinalIgnoreCase))
                ?? names.FirstOrDefault(n => n.Split(':')[0].Equals(family, StringComparison.OrdinalIgnoreCase))
                ?? names.FirstOrDefault(n => n.StartsWith(Regex.Replace(family, @"[\d.]+$", ""), StringComparison.OrdinalIgnoreCase))
                ?? names[0];
        }

        private static async Task<string> OpenAiOnce(string baseUrl, string model, string key, string prompt, bool json, int maxTokens)
        {
            string url = baseUrl.TrimEnd('/') + "/chat/completions";
            var body = new JsonObject
            {
                ["model"] = model,
                ["temperature"] = 0.2,
                ["max_tokens"] = maxTokens,
                ["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = prompt })
            };
            if (json) body["response_format"] = new JsonObject { ["type"] = "json_object" };
            string? bearer = key.Length > 0 ? key : null;
            JsonNode? data;
            try { data = await Post(url, body, bearer, null); }
            catch (HttpStatus400) when (json)
            {
                body.Remove("response_format");
                data = await Post(url, body, bearer, null);
            }
            JsonNode? choice = Obj(data) is JsonObject o && o["choices"] is JsonArray ch && ch.Count > 0 ? ch[0] : null;
            return Str(Obj(Obj(choice)?["message"]), "content") ?? "";
        }

        private static async Task<string> Claude(AppSettings s, string prompt, bool fast, int maxTokens)
        {
            if (s.ClaudeKey.Length == 0) throw new InvalidOperationException("Add your Claude API key in Proofmark settings first.");
            var body = new JsonObject
            {
                ["model"] = fast ? "claude-haiku-5-5" : s.ClaudeModel,
                ["max_tokens"] = maxTokens,
                ["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = prompt })
            };
            var headers = new Dictionary<string, string> { ["anthropic-version"] = "2023-06-01" };
            if (s.WorkspaceId.Length > 0) headers["anthropic-workspace-id"] = s.WorkspaceId;
            JsonNode? data = await Post("https://api.anthropic.com/v1/messages", body, s.ClaudeKey, headers);
            var sb = new StringBuilder();
            if (Obj(data)?["content"] is JsonArray parts)
                foreach (JsonNode? part in parts)
                    if (part is JsonObject po && Str(po, "type") == "text") sb.Append(Str(po, "text"));
            return sb.ToString();
        }

        /// <summary>The node as an object. Some services (Gemini) wrap replies and errors in a one-item array.</summary>
        private static JsonObject? Obj(JsonNode? n)
        {
            if (n is JsonArray a && a.Count > 0) n = a[0];
            return n as JsonObject;
        }

        private static string? Str(JsonObject? o, string key)
        {
            if (o == null || !o.TryGetPropertyValue(key, out JsonNode? v) || v is not JsonValue jv) return null;
            return jv.TryGetValue(out string? s) ? s : jv.ToJsonString();
        }

        private static string ErrorMessage(JsonNode? data)
        {
            JsonObject? root = Obj(data);
            if (root == null) return "";
            if (root["error"] is JsonObject err) return Str(err, "message") ?? Str(err, "status") ?? "";
            return Str(root, "error") ?? Str(root, "message") ?? "";
        }

        private static async Task<JsonNode?> Post(string url, JsonObject body, string? bearer, Dictionary<string, string>? headers)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
            };
            if (bearer != null) req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + bearer);
            if (headers != null) foreach (var kv in headers) req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
            HttpResponseMessage res;
            try { res = await Http.SendAsync(req); }
            catch (HttpRequestException)
            {
                bool local = url.Contains("localhost") || url.Contains("127.0.0.1");
                throw new InvalidOperationException(local
                    ? "Couldn't reach the model on this computer. Make sure Ollama or LM Studio is running."
                    : "Couldn't reach the server. Check the address and your connection.");
            }
            catch (TaskCanceledException) { throw new BusyException("The model took too long to answer."); }
            string text = await res.Content.ReadAsStringAsync();
            JsonNode? data = null;
            try { data = JsonNode.Parse(text); } catch { }
            if (!res.IsSuccessStatusCode)
            {
                string msg = ErrorMessage(data);
                int code = (int)res.StatusCode;
                Log.Write($"ai error {code} from {new Uri(url).Host}: {(text.Length > 600 ? text.Substring(0, 600) : text)}");
                if (code == 429 && IsDailyQuota(msg))
                    throw new QuotaException("This engine has used up its free daily limit.", RetryAfter(msg));
                if (code == 429 || code >= 500 || msg.IndexOf("demand", StringComparison.OrdinalIgnoreCase) >= 0 || msg.IndexOf("overloaded", StringComparison.OrdinalIgnoreCase) >= 0)
                    throw new BusyException(code == 429 ? "The service is rate-limiting you right now." : "The service is busy right now.");
                if (code == 400) throw new HttpStatus400(msg.Length > 0 ? msg : "The server rejected the request.");
                if (code == 401 || code == 403) throw new InvalidOperationException("The API key was rejected. Check it in Proofmark settings.");
                if (code == 404 && msg.Length == 0) msg = "The server address or model name wasn't found. Check both in Proofmark settings.";
                if (msg.IndexOf("workspace", StringComparison.OrdinalIgnoreCase) >= 0)
                    throw new InvalidOperationException("This Claude key isn't tied to a workspace. Add your workspace ID in Proofmark settings.");
                throw new InvalidOperationException(msg.Length > 0 ? msg : $"The server returned an error ({code}).");
            }
            return data;
        }

        /// <summary>LanguageTool matches converted to the engine's issue shape (quote, before, replacement, ...).</summary>
        public async Task<JsonArray> LanguageTool(AppSettings s, string text)
        {
            string baseUrl = (s.LtUrl.Length > 0 ? s.LtUrl : LtPublic).TrimEnd('/');
            bool isPublic = baseUrl == LtPublic;
            string sample = text.Length > (isPublic ? 18000 : 100000) ? text.Substring(0, isPublic ? 18000 : 100000) : text;
            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["text"] = sample, ["language"] = "auto", ["preferredVariants"] = "en-US"
            });
            HttpResponseMessage res;
            try { res = await Http.PostAsync(baseUrl + "/v2/check", form); }
            catch (HttpRequestException)
            {
                throw new InvalidOperationException(isPublic ? "Couldn't reach LanguageTool. Check your connection." : "Couldn't reach your LanguageTool server. Is it running?");
            }
            if ((int)res.StatusCode == 429) throw new InvalidOperationException("LanguageTool's free server is busy for you right now. Wait a minute and try again.");
            if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"LanguageTool returned an error ({(int)res.StatusCode}).");
            JsonNode? data = JsonNode.Parse(await res.Content.ReadAsStringAsync());
            var outList = new JsonArray();
            if (Obj(data)?["matches"] is not JsonArray matches) return outList;
            foreach (JsonNode? node in matches)
            {
                if (node is not JsonObject m) continue;
                int offset = m["offset"] is JsonValue ov && ov.TryGetValue(out int o1) ? o1 : -1;
                int length = m["length"] is JsonValue lv && lv.TryGetValue(out int l1) ? l1 : 0;
                if (offset < 0 || length <= 0 || offset + length > sample.Length) continue;
                string? rep = m["replacements"] is JsonArray reps && reps.Count > 0 && reps[0] is JsonObject r0 ? Str(r0, "value") : null;
                JsonObject? rule = m["rule"] as JsonObject;
                JsonObject? cat = rule?["category"] as JsonObject;
                string shortMsg = Str(m, "shortMessage") ?? "";
                outList.Add(new JsonObject
                {
                    ["quote"] = sample.Substring(offset, length),
                    ["before"] = sample.Substring(Math.Max(0, offset - 20), offset - Math.Max(0, offset - 20)),
                    ["replacement"] = rep,
                    ["category"] = Category(Str(rule, "issueType") ?? "", Str(cat, "id") ?? ""),
                    ["title"] = shortMsg.Length > 0 ? shortMsg : (Str(cat, "name") ?? "Suggestion"),
                    ["why"] = Str(m, "message") ?? "",
                    ["engine"] = "LanguageTool"
                });
            }
            return outList;
        }

        private static string Category(string type, string cat)
        {
            if (type is "misspelling" or "grammar" or "typographical" ||
                cat is "TYPOS" or "GRAMMAR" or "PUNCTUATION" or "CASING" or "CONFUSED_WORDS" or "COMPOUNDING") return "correctness";
            if (cat is "REDUNDANCY" or "PLAIN_ENGLISH" or "WORDINESS") return "clarity";
            return "style";
        }
    }
}
