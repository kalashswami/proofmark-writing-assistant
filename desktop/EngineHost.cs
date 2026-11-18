using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Proofmark
{
    /// <summary>
    /// Runs the shared engine.js (the same file the browser extension uses) inside a hidden WebView2,
    /// so the desktop app and the extension always flag exactly the same things.
    /// </summary>
    public sealed class EngineHost
    {
        private readonly Window host = new Window
        {
            Width = 2, Height = 2, Left = -32000, Top = -32000,
            ShowInTaskbar = false, WindowStyle = WindowStyle.None, ShowActivated = false, ResizeMode = ResizeMode.NoResize
        };
        private WebView2? view;

        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        public async Task InitAsync()
        {
            view = new WebView2();
            host.Content = view;
            host.SourceInitialized += (_, _) => Native.AddExStyle(new WindowInteropHelper(host).Handle, Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE);
            host.Show();
            string dataDir = Path.Combine(Log.Dir, "WebView2");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await view.EnsureCoreWebView2Async(env);
            string js = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "engine", "engine.js"));
            var loaded = new TaskCompletionSource<bool>();
            view.CoreWebView2.NavigationCompleted += (_, e) => loaded.TrySetResult(e.IsSuccess);
            view.CoreWebView2.NavigateToString("<!doctype html><meta charset=\"utf-8\"><script>" + js + "</script>");
            if (!await loaded.Task) throw new InvalidOperationException("The writing engine didn't load.");
            string ok = await Eval("typeof ProofmarkEngine");
            if (!ok.Contains("object")) throw new InvalidOperationException("The writing engine didn't start.");
        }

        private static string Lit(object? value) => JsonSerializer.Serialize(value, Json);

        /// <summary>Evaluates a JS expression and returns its value as JSON text.</summary>
        private async Task<string> Eval(string expression)
        {
            string wrapped = "(() => { try { return JSON.stringify(" + expression + "); } catch (e) { return JSON.stringify({ __error: String(e && e.message || e) }); } })()";
            string raw = await view!.CoreWebView2.ExecuteScriptAsync(wrapped);
            string json = JsonSerializer.Deserialize<string>(raw) ?? "null";
            if (json.StartsWith("{\"__error\"", StringComparison.Ordinal))
                throw new InvalidOperationException(JsonNode.Parse(json)?["__error"]?.GetValue<string>() ?? "Engine error");
            return json;
        }

        public async Task<List<Suggestion>> RunEngine(string text, IEnumerable<string> dismissed)
        {
            string json = await Eval($"ProofmarkEngine.runEngine({Lit(text)}, new Set({Lit(dismissed.ToArray())}))");
            return JsonSerializer.Deserialize<List<Suggestion>>(json, Json) ?? new List<Suggestion>();
        }

        public async Task<string> DeepPrompt(string text, IEnumerable<string> known) =>
            JsonSerializer.Deserialize<string>(await Eval($"ProofmarkEngine.deepPrompt({Lit(text)}, {Lit(known.ToArray())})")) ?? "";

        public async Task<string> RewritePrompt(string segment, string goal) =>
            JsonSerializer.Deserialize<string>(await Eval($"ProofmarkEngine.rewritePrompt({Lit(segment)}, {Lit(goal)})")) ?? "";

        public async Task<string> CleanOut(string text) =>
            JsonSerializer.Deserialize<string>(await Eval($"ProofmarkEngine.cleanOut({Lit(text)})")) ?? "";

        /// <summary>Turns a model reply plus LanguageTool matches into suggestions anchored on the text.</summary>
        public async Task<(List<Suggestion> Sugs, List<string> Tone)> MapDeep(string? llmReply, JsonArray languageTool, string text, string engineName)
        {
            string expr =
                "(() => {" +
                $" const raw = {Lit(llmReply)}, lt = {languageTool.ToJsonString()}, text = {Lit(text)}, engine = {Lit(engineName)};" +
                "  const r = raw == null ? null : ProofmarkEngine.parseJSONLoose(raw);" +
                "  const list = r == null ? [] : (Array.isArray(r) ? r : (r.issues || [])).map(i => ({ ...i, engine: i && i.engine || engine }));" +
                "  return { sugs: ProofmarkEngine.mapIssues(lt.concat(list), text), tone: r && Array.isArray(r.tone) ? r.tone.filter(t => typeof t === 'string').slice(0, 3) : [] };" +
                " })()";
            JsonNode? node = JsonNode.Parse(await Eval(expr));
            var sugs = node?["sugs"]?.Deserialize<List<Suggestion>>(Json) ?? new List<Suggestion>();
            var tone = node?["tone"]?.Deserialize<List<string>>(Json) ?? new List<string>();
            return (sugs, tone);
        }
    }
}
