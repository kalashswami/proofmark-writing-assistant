/* Background service worker: the only code that sends text off the page.
   It routes Deep check and Rewrite to whichever engine the person chose in settings:
     chrome  – Gemini Nano built into Chrome, on this device, free (runs in an offscreen document)
     openai  – any OpenAI-compatible server: Ollama or LM Studio on this computer, or a free cloud tier
     claude  – the Claude API with the person's own key
   LanguageTool can run alongside any of them as an extra grammar pass.
   Nothing is sent anywhere until the person presses Deep check or Rewrite. */
importScripts('engine.js', 'spell.js');
const E = self.ProofmarkEngine;

/* Spelling dictionary, loaded on first use (about 50 ms) and kept while the service worker is awake */
let speller = null;
async function getSpeller(){
  if (!speller){
    const text = await (await fetch(chrome.runtime.getURL('dict/words.txt'))).text();
    speller = self.ProofmarkSpell.create(text);
  }
  return speller;
}
async function spell(words){
  const sp = await getSpeller();
  const res = sp.check((Array.isArray(words) ? words : []).slice(0, 500).map(String));
  const out = {};                     // word -> suggestion, or null when nothing is close; spelled-fine words are left out
  for (const k of Object.keys(res)) out[k] = res[k] === undefined ? undefined : res[k];
  return { result:out };
}

/* Automatic checks while typing use the free daily allowance, so they stop a little short of each service's limit */
function autoBudget(c){
  if (c.provider === 'claude') return 0;                       // paid: only when the person presses Deep check
  if (c.provider === 'openai'){
    const b = String(c.oaiBase || '');
    if (/generativelanguage\.googleapis/.test(b)) return 15;   // Gemini free tier: about 20 requests a day
    if (/groq\.com/.test(b)) return 800;                       // Groq free tier: about 1,000 a day
  }
  return Infinity;                                              // on this computer: no limit
}
async function takeAuto(c){
  const max = autoBudget(c);
  if (max === 0) return 'Automatic AI checks are off for the paid Claude API. Press Deep check instead.';
  if (max === Infinity) return null;
  const day = new Date().toISOString().slice(0, 10);
  const st = await chrome.storage.local.get(['autoDay', 'autoCount']);
  const n = st.autoDay === day ? (st.autoCount || 0) : 0;
  if (n >= max) return `Automatic AI checks have used today’s free allowance for ${engineName(c)}. Deep check still works.`;
  await chrome.storage.local.set({ autoDay:day, autoCount:n + 1 });
  return null;
}

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const LT_PUBLIC = 'https://api.languagetool.org';
const KEYS = ['provider', 'apiKey', 'model', 'workspaceId', 'oaiBase', 'oaiModel', 'oaiKey', 'ltOn', 'ltUrl'];
const ENGINE_NAMES = { chrome:'Gemini Nano', openai:'Local model', claude:'Claude' };

async function config(){
  const c = await chrome.storage.local.get(KEYS);
  if (!c.provider) c.provider = c.apiKey ? 'claude' : 'none';   // keep earlier installs working
  return c;
}
function engineName(c){
  if (c.provider === 'openai'){
    const b = String(c.oaiBase || '');
    if (/:11434/.test(b)) return 'Ollama';
    if (/:1234/.test(b)) return 'LM Studio';
    if (/groq\.com/.test(b)) return 'Groq';
    if (/generativelanguage\.googleapis/.test(b)) return 'Gemini';
    return c.oaiModel ? E.trunc(c.oaiModel, 20) : 'Local model';
  }
  return ENGINE_NAMES[c.provider] || null;
}
async function capabilities(){
  const c = await config();
  let llm = false;
  if (c.provider === 'claude') llm = !!c.apiKey;
  else if (c.provider === 'openai') llm = !!(c.oaiBase && c.oaiModel);
  else if (c.provider === 'chrome') llm = true;
  return { deep: llm || !!c.ltOn, rewrite: llm, auto: llm && c.provider !== 'claude', engine: llm ? engineName(c) : null, languagetool: !!c.ltOn };
}

/* ---------- Claude ---------- */
async function callClaude(c, prompt, { fast, maxTokens }){
  if (!c.apiKey) throw new Error('Add your Claude API key in Proofmark settings first.');
  const headers = {
    'content-type':'application/json', 'authorization':`Bearer ${c.apiKey}`,
    'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'
  };
  if (c.workspaceId) headers['anthropic-workspace-id'] = c.workspaceId;
  let res;
  try {
    res = await fetch(CLAUDE_URL, { method:'POST', headers, body:JSON.stringify({
      model: fast ? 'claude-haiku-5-5' : (c.model || 'claude-sonnet-5-5'),
      max_tokens: clampTokens(maxTokens),
      messages: [{ role:'user', content:String(prompt).slice(0, 120000) }]
    }) });
  } catch (_) { throw new Error('Couldn’t reach Claude. Check your internet connection.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok){
    const msg = errMessage(data);
    if (isBusy(res.status, msg)) throw busy(msg);
    if (res.status === 401) throw new Error('Claude rejected the API key. Check it in Proofmark settings.');
    if (res.status === 429) throw new Error('Claude is rate-limiting this key. Try again in a minute.');
    if (/workspace/i.test(msg)) throw new Error('This key isn’t tied to a workspace. Add your workspace ID in Proofmark settings, or create a key for one workspace.');
    if (/credit|billing|balance/i.test(msg)) throw new Error('Your Claude Console account is out of API credits. Add credits in the Console, then try again.');
    throw new Error(msg || `Claude returned an error (${res.status}).`);
  }
  return (data && Array.isArray(data.content) ? data.content : []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/* ---------- OpenAI-compatible (Ollama, LM Studio, Groq, OpenRouter, …) ---------- */
async function callOpenAI(c, prompt, { maxTokens, json }){
  if (!c.oaiBase || !c.oaiModel) throw new Error('Set the server address and model name in Proofmark settings.');
  const url = c.oaiBase.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'content-type':'application/json' };
  if (c.oaiKey) headers.authorization = `Bearer ${c.oaiKey}`;
  const body = { model:c.oaiModel, temperature:0.2, max_tokens:clampTokens(maxTokens), messages:[{ role:'user', content:String(prompt).slice(0, 60000) }] };
  if (json) body.response_format = { type:'json_object' };
  let res;
  try { res = await fetch(url, { method:'POST', headers, body:JSON.stringify(body) }); }
  catch (_) {
    throw new Error(/localhost|127\.0\.0\.1/.test(url)
      ? 'Couldn’t reach the model on this computer. Make sure Ollama or LM Studio is running.'
      : 'Couldn’t reach that server. Check the address and your connection.');
  }
  if (res.status === 403 && /:11434/.test(url)) throw new Error('Ollama blocked the request. Set OLLAMA_ORIGINS to chrome-extension://* and restart Ollama (see the README).');
  const data = await res.json().catch(() => null);
  if (!res.ok){
    const err = errMessage(data);
    if (isBusy(res.status, err)) throw busy(err);
    if (json && res.status === 400 && body.response_format){ delete body.response_format; return retryPlain(url, headers, body); }
    if (err) throw new Error(err);
    throw new Error((data && data.error && (data.error.message || data.error)) || `The model server returned an error (${res.status}).`);
  }
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
async function retryPlain(url, headers, body){
  const res = await fetch(url, { method:'POST', headers, body:JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`The model server returned an error (${res.status}).`);
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

/* ---------- Chrome built-in AI (Gemini Nano), run inside an offscreen document ---------- */
async function ensureOffscreen(){
  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({ url:'offscreen.html', reasons:['DOM_PARSER'], justification:'Run Chrome’s on-device language model for writing suggestions.' });
  } catch (e) { if (!/single offscreen/i.test(String(e && e.message))) throw e; }
}
async function callChrome(prompt, { json }){
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target:'offscreen', type:'prompt', prompt:String(prompt).slice(0, 14000), json:!!json });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Chrome’s built-in AI didn’t answer.');
  return res.text;
}

/* Gemini wraps errors in a one-item array; others use { error: { message } } */
function errMessage(data){
  const d = Array.isArray(data) ? data[0] : data;
  const e = d && d.error;
  return (e && (e.message || (typeof e === 'string' ? e : ''))) || '';
}
function isBusy(status, msg){ return status === 429 || status >= 500 || /demand|overloaded|try again later/i.test(msg || ''); }
function isDaily(msg){ return /per ?day|PerDay|\bRPD\b|daily/i.test(msg || ''); }
function busy(msg){
  if (isDaily(msg)){
    const m = /(?:retry|try again) in\s+(?:(\d+)h)?/i.exec(msg || '');
    const hrs = m && m[1] ? ` It resets in about ${m[1]} ${m[1] === '1' ? 'hour' : 'hours'}.` : '';
    return new Error('This engine has used up its free daily limit.' + hrs + ' Switch to Groq or a model on this computer in Proofmark settings.');
  }
  const e = new Error('The AI service is busy right now. Try again in a minute.'); e.busy = true; return e;
}

/* Busy or rate-limited services get two more tries, 1.5 s and then 4 s apart */
async function llm(prompt, opts = {}){
  for (let attempt = 0; ; attempt++){
    try { return await llmOnce(prompt, opts); }
    catch (e){
      if (!e || !e.busy || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, attempt === 0 ? 1500 : 4000));
    }
  }
}
async function llmOnce(prompt, opts = {}){
  const c = await config();
  if (c.provider === 'claude') return callClaude(c, prompt, opts);
  if (c.provider === 'openai') return callOpenAI(c, prompt, opts);
  if (c.provider === 'chrome') return callChrome(prompt, opts);
  throw new Error('Choose a smart-check engine in Proofmark settings.');
}

/* ---------- LanguageTool ---------- */
function ltCategory(m){
  const t = (m.rule && m.rule.issueType) || '', c = (m.rule && m.rule.category && m.rule.category.id) || '';
  if (/^(misspelling|grammar|typographical)$/.test(t) || /^(TYPOS|GRAMMAR|PUNCTUATION|CASING|CONFUSED_WORDS|COMPOUNDING)$/.test(c)) return 'correctness';
  if (/^(REDUNDANCY|PLAIN_ENGLISH|WORDINESS)$/.test(c)) return 'clarity';
  return 'style';
}
async function languageTool(c, text){
  const base = (c.ltUrl || LT_PUBLIC).replace(/\/+$/, '');
  const isPublic = base === LT_PUBLIC;
  const sample = isPublic ? text.slice(0, 18000) : text.slice(0, 100000);
  let res;
  try {
    res = await fetch(base + '/v2/check', { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({ text:sample, language:'auto', preferredVariants:'en-US' }) });
  } catch (_) { throw new Error(isPublic ? 'Couldn’t reach LanguageTool. Check your connection.' : 'Couldn’t reach your LanguageTool server. Is it running?'); }
  if (res.status === 429) throw new Error('LanguageTool’s free server is busy for you right now. Wait a minute and try again.');
  if (!res.ok) throw new Error(`LanguageTool returned an error (${res.status}).`);
  const data = await res.json();
  return (data.matches || []).map(m => ({
    quote: sample.substr(m.offset, m.length),
    before: sample.slice(Math.max(0, m.offset - 20), m.offset),
    replacement: m.replacements && m.replacements.length ? m.replacements[0].value : null,
    category: ltCategory(m),
    title: m.shortMessage || (m.rule && m.rule.category && m.rule.category.name) || 'Suggestion',
    why: m.message || '',
    engine: 'LanguageTool'
  })).filter(i => i.quote);
}

async function deep(text, known, auto){
  const c = await config(), caps = await capabilities();
  if (auto){
    const stop = await takeAuto(c);
    if (stop) return { issues:[], tone:[], engines:[], warning:'', skipped:stop };
  }
  const jobs = [], issues = [], errors = [];
  let tone = [];
  if (c.ltOn) jobs.push(languageTool(c, text).then(list => issues.unshift(...list), e => errors.push(e.message)));
  if (caps.rewrite){
    const limit = c.provider === 'chrome' ? 3500 : 24000;
    jobs.push(llm(E.deepPrompt(text.slice(0, limit), known), { json:true, maxTokens:4096 }).then(out => {
      const res = E.parseJSONLoose(out);
      const list = Array.isArray(res) ? res : (res && Array.isArray(res.issues) ? res.issues : []);
      issues.push(...list.map(i => ({ ...i, engine:caps.engine })));
      if (res && Array.isArray(res.tone)) tone = res.tone.filter(x => typeof x === 'string').slice(0, 3);
    }, e => errors.push(e.message)));
  }
  if (!jobs.length) throw new Error('Choose a smart-check engine in Proofmark settings.');
  await Promise.all(jobs);
  if (!issues.length && errors.length) throw new Error(errors[0]);
  return { issues, tone, engines:[c.ltOn && 'LanguageTool', caps.engine].filter(Boolean), warning:errors[0] || '' };
}

function clampTokens(n){ return Math.min(Math.max(Number(n) || 2048, 64), 8192); }
function reply(p, sendResponse){ p.then(v => sendResponse({ ok:true, ...v }), e => sendResponse({ ok:false, error:String(e && e.message || e) })); return true; }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'caps') return reply(capabilities().then(caps => ({ caps })), sendResponse);
  if (msg.type === 'llm' || msg.type === 'claude') return reply(llm(msg.prompt, { fast:!!msg.fast, maxTokens:msg.maxTokens, json:!!msg.json }).then(text => ({ text })), sendResponse);
  if (msg.type === 'deep') return reply(deep(String(msg.text || ''), msg.known || [], !!msg.auto), sendResponse);
  if (msg.type === 'spell') return reply(spell(msg.words), sendResponse);
  if (msg.type === 'openOptions') chrome.runtime.openOptionsPage();
});
