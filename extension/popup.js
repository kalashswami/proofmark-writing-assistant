const DEFAULTS = { disabledSites: [], autoAi: true, cats: { correctness:true, clarity:true, style:true, tone:true } };
const LT_PUBLIC = 'https://api.languagetool.org';
const PRESETS = {
  groq:     { base:'https://api.groq.com/openai/v1', model:'llama-3.3-70b-versatile', cloud:true, hint:'Free tier, about 1,000 checks a day. Get a key at console.groq.com/keys and paste it below. Your text goes to Groq.' },
  gemini:   { base:'https://generativelanguage.googleapis.com/v1beta/openai/', model:'gemini-3.8-flash', cloud:true, hint:'Free tier, but only about 20 checks a day. Get a key at aistudio.google.com/apikey. Your text goes to Google.' },
  ollama:   { base:'http://localhost:11434/v1', model:'llama3.2:3b', hint:'Install Ollama, run “ollama pull llama3.2:3b”, and set OLLAMA_ORIGINS to chrome-extension://* (see the README). Use a name from “ollama list”.' },
  lmstudio: { base:'http://localhost:1234/v1', model:'', hint:'In LM Studio, load a model, open the Developer tab and start the server. Use the model name it shows.' },
  custom:   { base:'', model:'', hint:'Any server with an OpenAI-style /chat/completions endpoint. Proofmark will ask permission to reach it.' }
};
const LANG = { expectedInputs:[{ type:'text', languages:['en'] }], expectedOutputs:[{ type:'text', languages:['en'] }] };
const $ = id => document.getElementById(id);
let host = null;

function provider(){ const r = document.querySelector('input[name=provider]:checked'); return r ? r.value : 'none'; }
function showSubs(){
  document.querySelectorAll('.sub[data-for]').forEach(s => s.classList.toggle('on', s.dataset.for === provider()));
  $('ltSub').classList.toggle('on', $('ltOn').checked);
  $('ltUrl').hidden = $('ltWhere').value !== 'custom';
  if (provider() === 'chrome') checkChrome();
}
function presetFor(base){
  return /groq\.com/.test(base) ? 'groq' : /generativelanguage\.googleapis/.test(base) ? 'gemini'
    : /:11434/.test(base) ? 'ollama' : /:1234/.test(base) ? 'lmstudio' : (base ? 'custom' : 'groq');
}

async function checkChrome(){
  const st = $('chromeStatus'), btn = $('chromeDownload');
  btn.hidden = true;
  if (typeof LanguageModel === 'undefined'){ st.textContent = 'Not available in this browser. It needs desktop Chrome 138 or newer.'; return; }
  try {
    const a = await LanguageModel.availability(LANG);
    if (a === 'available') st.textContent = 'Ready. The model is on this computer.';
    else if (a === 'downloading') st.textContent = 'Chrome is downloading the model. This can take a while.';
    else if (a === 'downloadable'){ st.textContent = 'The model needs a one-time download.'; btn.hidden = false; }
    else st.textContent = 'Not supported on this computer. It needs about 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM.';
  } catch (e){ st.textContent = 'Couldn’t check: ' + (e && e.message || e); }
}
$('chromeDownload').addEventListener('click', async () => {
  const st = $('chromeStatus'), btn = $('chromeDownload');
  btn.disabled = true; st.textContent = 'Starting download…';
  try {
    const s = await LanguageModel.create({ ...LANG, monitor(m){ m.addEventListener('downloadprogress', e => { st.textContent = `Downloading… ${Math.round(e.loaded * 100)}%`; }); } });
    s.destroy();
    st.textContent = 'Ready. The model is on this computer.'; btn.hidden = true;
  } catch (e){ st.textContent = 'The download didn’t start: ' + (e && e.message || e); }
  finally { btn.disabled = false; }
});

async function load(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true }).catch(() => []);
  try { const u = new URL(tab && tab.url ? tab.url : ''); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch (_) {}
  const s = await chrome.storage.sync.get(DEFAULTS);
  const cats = { ...DEFAULTS.cats, ...(s.cats || {}) }, disabled = s.disabledSites || [];
  if (host){ $('siteName').textContent = host; $('siteToggle').setAttribute('aria-checked', String(!disabled.includes(host))); }
  else { $('siteName').textContent = 'This page'; $('siteToggle').disabled = true; $('siteHint').textContent = 'Browser pages and the settings page can’t be checked.'; }
  document.querySelectorAll('[data-cat]').forEach(cb => { cb.checked = cats[cb.dataset.cat] !== false; });
  $('autoAi').checked = s.autoAi !== false;

  const c = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'workspaceId', 'oaiBase', 'oaiModel', 'oaiKey', 'ltOn', 'ltUrl']);
  const p = c.provider || (c.apiKey ? 'claude' : 'none');
  (document.querySelector(`input[name=provider][value="${p}"]`) || $('pNone')).checked = true;
  $('apiKey').value = c.apiKey ? '••••••••' + String(c.apiKey).slice(-4) : ''; $('apiKey').dataset.masked = c.apiKey ? '1' : '';
  $('workspaceId').value = c.workspaceId || '';
  $('model').value = c.model || 'claude-sonnet-5-5';
  const preset = presetFor(c.oaiBase || '');
  $('oaiPreset').value = preset;
  $('oaiBase').value = c.oaiBase || PRESETS[preset].base;
  $('oaiModel').value = c.oaiModel || PRESETS[preset].model;
  $('oaiKey').value = c.oaiKey || '';
  $('oaiHint').textContent = PRESETS[preset].hint;
  $('ltOn').checked = !!c.ltOn;
  $('ltWhere').value = c.ltUrl && c.ltUrl !== LT_PUBLIC ? 'custom' : 'public';
  $('ltUrl').value = c.ltUrl && c.ltUrl !== LT_PUBLIC ? c.ltUrl : '';
  showSubs();
}

function needsPermission(url){
  try { const u = new URL(url); return !/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && u.origin !== 'https://api.anthropic.com' && u.origin !== LT_PUBLIC ? `${u.protocol}//${u.hostname}/*` : null; }
  catch (_) { return null; }
}

$('save').addEventListener('click', async () => {
  const p = provider();
  const oaiBase = $('oaiBase').value.trim(), ltUrl = $('ltWhere').value === 'custom' ? $('ltUrl').value.trim() : LT_PUBLIC;
  if (p === 'openai' && (!/^https?:\/\//.test(oaiBase) || !$('oaiModel').value.trim())){ $('status').textContent = 'Enter the server address (starting with http) and a model name.'; return; }
  if (p === 'openai' && (PRESETS[presetFor(oaiBase)] || {}).cloud && !$('oaiKey').value.trim()){ $('status').textContent = 'Paste your API key. Cloud services need one.'; return; }
  if ($('ltOn').checked && !/^https?:\/\//.test(ltUrl)){ $('status').textContent = 'Enter your LanguageTool server address, starting with http.'; return; }
  const origins = [p === 'openai' && needsPermission(oaiBase), $('ltOn').checked && needsPermission(ltUrl)].filter(Boolean);
  if (origins.length){
    const ok = await chrome.permissions.request({ origins });   // must run first, while the click still counts
    if (!ok){ $('status').textContent = 'Proofmark needs permission to reach that server.'; return; }
  }
  const patch = { provider:p, model:$('model').value, workspaceId:$('workspaceId').value.trim(),
    oaiBase, oaiModel:$('oaiModel').value.trim(), oaiKey:$('oaiKey').value.trim(), ltOn:$('ltOn').checked, ltUrl };
  const key = $('apiKey').value.trim();
  if (key && !key.startsWith('••')){
    if (!/^sk-ant-/.test(key)){ $('status').textContent = 'That doesn’t look like a Claude API key. Keys start with “sk-ant-”.'; return; }
    patch.apiKey = key;
  }
  if (p === 'claude' && !key){ $('status').textContent = 'Paste your Claude API key, or pick a free engine.'; return; }
  await chrome.storage.local.set(patch);
  $('status').textContent = 'Saved. Refresh open tabs to use it.';
  load();
});

document.querySelectorAll('input[name=provider]').forEach(r => r.addEventListener('change', showSubs));
$('ltOn').addEventListener('change', showSubs);
$('ltWhere').addEventListener('change', showSubs);
$('oaiPreset').addEventListener('change', () => {
  const pr = PRESETS[$('oaiPreset').value];
  $('oaiBase').value = pr.base; $('oaiModel').value = pr.model; $('oaiHint').textContent = pr.hint;
});
$('apiKey').addEventListener('focus', () => { if ($('apiKey').dataset.masked) $('apiKey').value = ''; });
$('clearKey').addEventListener('click', async () => { await chrome.storage.local.remove('apiKey'); $('status').textContent = 'Key removed.'; load(); });
$('siteToggle').addEventListener('click', async () => {
  if (!host) return;
  const s = await chrome.storage.sync.get(DEFAULTS);
  const list = (s.disabledSites || []).filter(h => h !== host);
  const on = $('siteToggle').getAttribute('aria-checked') === 'true';
  if (on) list.push(host);
  await chrome.storage.sync.set({ disabledSites:list });
  $('siteToggle').setAttribute('aria-checked', String(!on));
});
document.querySelectorAll('[data-cat]').forEach(cb => cb.addEventListener('change', async () => {
  const s = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ cats:{ ...DEFAULTS.cats, ...(s.cats || {}), [cb.dataset.cat]:cb.checked } });
}));
$('autoAi').addEventListener('change', () => chrome.storage.sync.set({ autoAi:$('autoAi').checked }));
$('openTest').addEventListener('click', () => chrome.tabs.create({ url:chrome.runtime.getURL('test.html') }));
load();
