/* Host adapter for the browser extension. The content script talks only to this object,
   so the same content.js also runs on the test page with a different host. */
(() => {
  if (window.ProofmarkHost) return;
  const DEFAULTS = { disabledSites: [], ignoredWords: [], autoAi: true, cats: { correctness:true, clarity:true, style:true, tone:true } };
  const alive = () => { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };

  async function getSettings(){
    if (!alive()) return DEFAULTS;
    const s = await chrome.storage.sync.get(DEFAULTS);
    return { disabledSites: s.disabledSites || [], ignoredWords: s.ignoredWords || [], autoAi: s.autoAi !== false, cats: { ...DEFAULTS.cats, ...(s.cats || {}) } };
  }
  async function send(msg){
    if (!alive()) throw new Error('Proofmark was updated. Reload this page to keep using it.');
    let res;
    try { res = await chrome.runtime.sendMessage(msg); }
    catch (_) { throw new Error('Proofmark couldn’t reach its background service. Reload the page and try again.'); }
    if (!res || !res.ok) throw new Error((res && res.error) || 'The smart-check engine didn’t answer. Check Proofmark settings.');
    return res;
  }

  window.ProofmarkHost = {
    name: 'extension',
    debug: location.protocol === 'chrome-extension:',
    getSettings,
    setSettings: patch => alive() ? chrome.storage.sync.set(patch) : Promise.resolve(),
    onSettings(cb){
      if (!alive()) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.disabledSites || changes.cats || changes.ignoredWords || changes.autoAi)) getSettings().then(cb);
        if (area === 'local') cb(null);
      });
    },
    capabilities: async () => alive() ? (await send({ type:'caps' })).caps : { deep:false, rewrite:false },
    aiAvailable: async () => alive() ? (await send({ type:'caps' })).caps.deep : false,
    aiHint: 'Turn on a free smart-check engine in Proofmark settings, such as Groq’s free tier or LanguageTool.',
    askText: async (prompt, opts = {}) => (await send({ type:'llm', prompt, fast:!!opts.fast, maxTokens:opts.maxTokens || 2048 })).text,
    askJSON: async prompt => window.ProofmarkEngine.parseJSONLoose((await send({ type:'llm', prompt, json:true, maxTokens:4096 })).text),
    deepCheck: async (text, known, opts = {}) => { const r = await send({ type:'deep', text, known, auto:!!opts.auto }); return { issues:r.issues, tone:r.tone, engines:r.engines, warning:r.warning, skipped:r.skipped }; },
    spell: async words => alive() ? (await send({ type:'spell', words })).result : {},
    openSettings: () => { if (alive()) chrome.runtime.sendMessage({ type:'openOptions' }).catch(() => {}); }
  };
})();
