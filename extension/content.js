/* Proofmark content script.
   Finds the text field you are typing in on any page, checks it with the shared engine, and draws
   underlines, a floating widget, suggestion cards and a panel in an overlay. The page's own DOM is
   never modified: everything lives in one closed shadow root appended to <html>. */
(() => {
'use strict';
if (window.__proofmarkLoaded) return;
window.__proofmarkLoaded = true;
const E = window.ProofmarkEngine, H = window.ProofmarkHost;
if (!E || !H) return;

const MAX_CHARS = 30000, MAX_BOXES = 300, SIZE = 26;
const SITE = location.hostname || 'this page';
const CAT_KEYS = ['correctness', 'clarity', 'style', 'tone'];
const DEFAULTS = { disabledSites: [], ignoredWords: [], autoAi: true, cats: { correctness:true, clarity:true, style:true, tone:true } };
let settings = { ...DEFAULTS, cats: { ...DEFAULTS.cats } };
let aiOn = false, aiBusy = false;          // aiOn: a deep check engine is set up
let caps = { deep:false, rewrite:false, auto:false, engine:null, languagetool:false };
let S = null;                    // the active field session
const memory = new WeakMap();    // field -> { dismissed, ai, tone, status } so returning to a field keeps its state

const CARET = '<svg viewBox="0 0 16 14" aria-hidden="true"><path d="M2 12.5 L8 2 L14 12.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CSS = `
:host{
  --bg:#FFFFFF; --bg2:#F4F6F8; --fg:#17202A; --fg2:#4B5764; --fg3:#7E8994; --rule:#D9DFE4;
  --accent:#243746; --accent-ink:#FFFFFF; --brand:#C2402A;
  --c-correct:#C2402A; --c-clarity:#2460C4; --c-style:#17845A; --c-tone:#7445C2; --on-c:#FFFFFF; --good:#17845A;
  --shadow:0 14px 34px -10px rgba(23,32,42,.32), 0 2px 6px rgba(23,32,42,.08);
  --ui:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :host{
    --bg:#151C22; --bg2:#1B242B; --fg:#E3E8EC; --fg2:#A7B2BC; --fg3:#76838F; --rule:#2A353E;
    --accent:#CFDCE6; --accent-ink:#0E1317; --brand:#F0806A;
    --c-correct:#F0806A; --c-clarity:#7AAAF3; --c-style:#52C394; --c-tone:#B794F2; --on-c:#0E1317; --good:#52C394;
    --shadow:0 14px 34px -10px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.3);
  }
}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none !important}
.cat-correctness{--c:var(--c-correct)} .cat-clarity{--c:var(--c-clarity)} .cat-style{--c:var(--c-style)} .cat-tone{--c:var(--c-tone)}
.clip{position:fixed;overflow:hidden;pointer-events:none}
.inner{position:absolute;left:0;top:0}
.u{position:absolute;height:2px;border-radius:1px;background:var(--c)}
.u.flag{height:0;background:transparent;border-bottom:2px dotted var(--c)}
.hl{position:absolute;border-radius:3px;background:rgba(229,72,77,.22);box-shadow:0 0 0 2px #E5484D}
.mirror{position:fixed;visibility:hidden;pointer-events:none;display:none}
button{font:inherit;color:inherit;cursor:pointer;margin:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.widget{position:fixed;width:${SIZE}px;height:${SIZE}px;padding:0;border-radius:50%;border:1px solid var(--rule);background:var(--bg);color:var(--fg);display:grid;place-items:center;pointer-events:auto;box-shadow:0 3px 10px -3px rgba(0,0,0,.3);transition:transform .12s ease}
.widget:hover{transform:scale(1.08)}
.widget svg{width:12px;height:11px;display:block}
.widget.is-clean{color:var(--good)}
.widget.is-off{color:var(--fg3)}
.widget.is-off svg{opacity:.6}
.widget.is-checking::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:2px solid transparent;border-top-color:var(--fg3);animation:pm-spin .8s linear infinite}
.badge{position:absolute;top:-7px;right:-9px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--c);color:var(--on-c);font:600 10.5px/17px var(--ui);text-align:center;box-shadow:0 0 0 2px var(--bg)}
@keyframes pm-spin{to{transform:rotate(360deg)}}

.card,.panel,.toast{position:fixed;pointer-events:auto;font:13px/1.45 var(--ui);color:var(--fg);text-align:left;letter-spacing:normal;text-transform:none}
.card,.panel{background:var(--bg);border:1px solid var(--rule);border-radius:10px;box-shadow:var(--shadow)}
.card{width:300px;max-width:calc(100vw - 16px);padding:12px 14px}
.c-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.mark{display:inline-grid;place-items:center;min-width:34px;height:21px;padding:0 5px;border-radius:3px;border:1px solid var(--c);color:var(--c);font:500 11px/1 var(--mono);flex:none}
.c-title{font-weight:600;flex:1;min-width:0}
.src{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg2);border:1px solid var(--rule);border-radius:999px;padding:0 6px;line-height:16px}
.fix{font-size:14.5px;line-height:1.45;overflow-wrap:anywhere}
.fix del{color:var(--fg3);text-decoration:line-through;text-decoration-color:var(--c)}
.fix ins{text-decoration:none;color:var(--c);font-weight:600}
.fix .arrow{color:var(--fg3);margin:0 6px}
.fix .op{font-size:12px;color:var(--fg3);margin-left:6px}
.fix .quote{color:var(--fg2);font-style:italic;font-size:13.5px}
.why{margin:6px 0 0;color:var(--fg2);font-size:12.5px}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;line-height:1.2;padding:6px 11px;border-radius:6px;border:1px solid var(--rule);background:var(--bg);white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--fg3)}
.btn:disabled{opacity:.5;cursor:default}
.btn-accept{background:var(--c);border-color:var(--c);color:var(--on-c)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn-quiet{background:transparent;border-color:transparent;color:var(--fg2)}
.btn-quiet:hover:not(:disabled){border-color:var(--rule);color:var(--fg)}
.chip{padding:4px 9px;border-radius:999px;font-size:12px}

.panel{width:340px;display:flex;flex-direction:column;overflow:hidden}
.p-head{display:flex;align-items:center;gap:10px;padding:10px 8px 10px 14px;border-bottom:1px solid var(--rule)}
.brand{display:flex;align-items:center;gap:6px;font-weight:700;font-size:13.5px}
.brand svg{width:13px;height:12px;color:var(--brand)}
.p-count{color:var(--fg3);font-size:12.5px;flex:1}
.x{background:none;border:0;font-size:20px;line-height:1;color:var(--fg2);padding:2px 8px;border-radius:6px}
.x:hover{background:var(--bg2)}
.p-body{flex:1;min-height:0;overflow:auto}
.p-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:10px 14px 8px}
.tab{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid var(--rule);background:transparent;font-size:12px;color:var(--fg2)}
.tab[aria-pressed="true"]{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.tab .dot{width:7px;height:7px;border-radius:50%;background:var(--c)}
.tab .n{opacity:.7;font-variant-numeric:tabular-nums}
.p-list{list-style:none;margin:0;padding:0}
.item{border-top:1px solid var(--rule)}
.item.is-open{background:color-mix(in srgb, var(--c) 8%, var(--bg))}
.i-head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;width:100%;padding:10px 14px;background:none;border:0;text-align:left}
.i-head:hover{background:var(--bg2)}
.item.is-open .i-head:hover{background:transparent}
.i-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.i-title{font-weight:600;font-size:12.5px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.i-body{padding:0 14px 12px 58px}
.i-body .why{margin:0}
.p-empty{padding:22px 16px;color:var(--fg2)}
.p-empty p{margin:0}
.p-empty-t{font-weight:600;color:var(--fg);margin-bottom:4px !important}
.p-tone{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 14px 0}
.ask{margin:10px 0 0;font-weight:600;font-size:12.5px}
.p-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 14px 10px}
.p-bulk .note{margin:0}
.eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fg3)}
.tone-chip{padding:1px 8px;border-radius:999px;border:1px solid var(--rule);font-size:12px}
.p-rw{margin:10px 14px;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--bg2)}
.p-rw-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}
.p-rw-scope{font-size:11.5px;color:var(--fg3)}
.p-rw-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-size:13.5px;line-height:1.5;user-select:text}
.p-rw-text.is-wait{color:var(--fg3);font-style:italic}
.note{margin:8px 0 0;font-size:12px;color:var(--fg2)}
.p-foot{border-top:1px solid var(--rule);padding:10px 14px 12px;display:flex;flex-direction:column;gap:9px;background:var(--bg)}
.p-ai{display:flex;flex-direction:column;gap:8px}
.p-goals{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.p-goals .eyebrow{margin-right:2px}
.p-ai-off{flex-direction:row;align-items:center;justify-content:space-between;gap:8px;color:var(--fg2);font-size:12.5px}
.p-status{margin:0;font-size:12px;color:var(--fg2)}
.p-status a{color:var(--fg);text-underline-offset:2px}
.p-site{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--fg3)}
.p-site b{color:var(--fg2);font-weight:600}
.toast{padding:7px 12px;border-radius:7px;background:var(--fg);color:var(--bg);font-size:12.5px;box-shadow:var(--shadow);max-width:280px}
@media (prefers-reduced-motion: reduce){ .widget{transition:none} .widget.is-checking::after{animation:none} }
`;

/* ---------- overlay root ---------- */
const host = document.createElement('proofmark-overlay');
host.setAttribute('style', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;');
const shadow = host.attachShadow({ mode:'closed' });
shadow.innerHTML = `<style>${CSS}</style>
<div class="clip" id="clip" hidden><div class="inner" id="inner"></div></div>
<div class="mirror" id="mirror"></div>
<button type="button" class="widget" id="widget" hidden></button>
<div class="card" id="card" role="dialog" aria-label="Suggestion" hidden></div>
<div class="panel" id="panel" role="dialog" aria-label="Proofmark" hidden></div>
<div class="toast" id="toast" role="status" hidden></div>`;
const q = id => shadow.getElementById(id);
const clipEl = q('clip'), innerEl = q('inner'), mirrorEl = q('mirror'), widgetEl = q('widget'),
  cardEl = q('card'), panelEl = q('panel'), toastEl = q('toast');
function mount(){ if (!host.isConnected) document.documentElement.appendChild(host); }

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function enabledHere(){ return !settings.disabledSites.includes(SITE); }
function errText(e){ return (e && e.message) || 'The request didn’t finish. Try again.'; }
function deepActive(){ let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; }
function selFor(el){ const rn = el.getRootNode(); return (rn !== document && rn && typeof rn.getSelection === 'function' && rn.getSelection()) || window.getSelection(); }
function editCommand(text){
  let ok = false;
  try { ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete', false); } catch (_) {}
  return ok;
}

/* ---------- which elements count as writing fields ---------- */
const OPT_OUT = '[data-proofmark="false"],[data-gramm="false"],[data-gramm_editor="false"],[data-enable-grammarly="false"]';
const CODE_EDITORS = '.monaco-editor,.CodeMirror,.cm-editor,.ace_editor';
function optedOut(el){ return !!(el.closest(OPT_OUT) || el.closest(CODE_EDITORS)); }
function editableRoot(t){
  if (!t || t.nodeType !== 1 || t === host) return null;
  if (t.tagName === 'TEXTAREA') return (!t.readOnly && !t.disabled && !optedOut(t)) ? t : null;
  if (t.tagName === 'INPUT'){
    const type = (t.getAttribute('type') || 'text').toLowerCase();
    return (/^(text|search)$/.test(type) && !t.readOnly && !t.disabled && !optedOut(t)) ? t : null;
  }
  if (t.isContentEditable){
    let r = t;
    while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
    return optedOut(r) ? null : r;
  }
  return null;
}
function findClippers(el){
  const out = []; let p = el.parentElement || (el.getRootNode() && el.getRootNode().host), n = 0;
  while (p && p !== document.body && p !== document.documentElement && n < 30){
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) out.push(p);
    p = p.parentElement || (p.getRootNode() && p.getRootNode().host) || null; n++;
  }
  return out;
}

/* ---------- textarea and input: read value, measure with a mirror div ---------- */
const MIRROR_PROPS = ['direction','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle',
  'paddingTop','paddingRight','paddingBottom','paddingLeft','fontStyle','fontVariant','fontWeight','fontStretch','fontSize',
  'fontSizeAdjust','lineHeight','fontFamily','fontFeatureSettings','fontVariationSettings','fontKerning','textAlign',
  'textTransform','textIndent','letterSpacing','wordSpacing','tabSize','whiteSpace','wordBreak','overflowWrap','writingMode','textRendering'];
class ControlAdapter {
  constructor(el){ this.el = el; this.single = el.tagName === 'INPUT'; }
  text(){ return this.el.value; }
  caret(){ const s = this.el.selectionStart, e = this.el.selectionEnd; return (s == null || s !== e) ? null : s; }
  selection(){ const s = this.el.selectionStart, e = this.el.selectionEnd; return s == null ? null : { start:s, end:e }; }
  measure(list){
    const el = this.el, cs = getComputedStyle(el), r = el.getBoundingClientRect(), t = el.value, st = mirrorEl.style;
    for (const p of MIRROR_PROPS) st[p] = cs[p];
    st.position = 'fixed'; st.left = r.left + 'px'; st.top = r.top + 'px'; st.width = r.width + 'px'; st.height = r.height + 'px';
    st.boxSizing = 'border-box'; st.margin = '0'; st.visibility = 'hidden'; st.borderColor = 'transparent'; st.overflow = 'hidden';
    if (this.single){ st.display = 'flex'; st.alignItems = 'center'; st.whiteSpace = 'pre'; st.overflowWrap = 'normal'; }
    else {
      st.display = 'block';
      st.overflowY = el.scrollHeight > el.clientHeight ? 'scroll' : 'hidden';
      st.overflowX = 'hidden';
      if (!/pre/.test(cs.whiteSpace)) st.whiteSpace = 'pre-wrap';
    }
    mirrorEl.textContent = t;
    mirrorEl.scrollTop = el.scrollTop; mirrorEl.scrollLeft = el.scrollLeft;
    const node = mirrorEl.firstChild;
    const out = list.map(g => {
      if (!node || g.end <= g.start) return [];
      const rg = document.createRange();
      rg.setStart(node, Math.min(g.start, t.length)); rg.setEnd(node, Math.min(g.end, t.length));
      return Array.from(rg.getClientRects());
    });
    mirrorEl.textContent = ''; st.display = 'none';
    return out;
  }
  replace(start, end, text){
    const el = this.el, before = el.value, expected = before.slice(0, start) + text + before.slice(end);
    el.focus({ preventScroll:true });
    el.setSelectionRange(start, end);
    if (!editCommand(text) || el.value !== expected){
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (desc && desc.set) desc.set.call(el, expected); else el.value = expected;
      el.dispatchEvent(new Event('input', { bubbles:true }));
    }
    const c = start + text.length;
    try { el.setSelectionRange(c, c); } catch (_) {}
  }
}

/* ---------- contenteditable: walk the tree, keep a map from text offsets to DOM nodes ---------- */
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TR|TD|TH|UL)$/;
class EditableAdapter {
  constructor(el){ this.el = el; this.segs = []; this.str = ''; }
  text(){
    const segs = []; let s = '';
    const walk = node => {
      for (let c = node.firstChild; c; c = c.nextSibling){
        if (c.nodeType === 3){
          if (c.data.length){ segs.push({ node:c, start:s.length, len:c.data.length }); s += c.data.replace(/ /g, ' '); }
        } else if (c.nodeType === 1){
          const tag = c.tagName;
          if (tag === 'BR'){ s += '\n'; continue; }
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
          if (c.getAttribute('contenteditable') === 'false'){ s += '￼'; continue; }
          const block = BLOCK.test(tag);
          if (block && s.length && !s.endsWith('\n')) s += '\n';
          walk(c);
          if (block && s.length && !s.endsWith('\n')) s += '\n';
        }
      }
    };
    walk(this.el);
    this.segs = segs; this.str = s;
    return s;
  }
  point(off){
    const a = this.segs;
    if (!a.length) return [this.el, 0];
    let lo = 0, hi = a.length - 1;
    while (lo < hi){ const mid = (lo + hi + 1) >> 1; if (a[mid].start <= off) lo = mid; else hi = mid - 1; }
    const g = a[lo];
    if (off < g.start) return [g.node, 0];
    if (off <= g.start + g.len) return [g.node, off - g.start];
    const n = a[lo + 1];
    return n ? [n.node, 0] : [g.node, g.len];
  }
  range(start, end){
    const r = document.createRange();
    const [n1, o1] = this.point(start), [n2, o2] = this.point(end);
    r.setStart(n1, o1);
    try { r.setEnd(n2, o2); } catch (_) { r.collapse(true); }
    return r;
  }
  offsetOf(node, off){
    if (node.nodeType === 3){ const g = this.segs.find(x => x.node === node); if (g) return g.start + Math.min(off, g.len); }
    const pt = document.createRange();
    try { pt.setStart(node, off); } catch (_) { return null; }
    for (const g of this.segs) if (pt.comparePoint(g.node, 0) >= 0) return g.start;
    return this.str.length;
  }
  selection(){
    const sel = selFor(this.el);
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!this.el.contains(r.startContainer) || !this.el.contains(r.endContainer)) return null;
    const a = this.offsetOf(r.startContainer, r.startOffset), b = this.offsetOf(r.endContainer, r.endOffset);
    return (a == null || b == null) ? null : { start:Math.min(a, b), end:Math.max(a, b) };
  }
  caret(){ const s = this.selection(); return (s && s.start === s.end) ? s.start : null; }
  measure(list){
    return list.map(g => {
      if (g.end <= g.start) return [];
      const seen = new Set(), out = [];
      for (const q of this.range(g.start, g.end).getClientRects()){
        const k = `${Math.round(q.left)}:${Math.round(q.top)}:${Math.round(q.width)}`;
        if (!seen.has(k)){ seen.add(k); out.push(q); }
      }
      return out;
    });
  }
  replace(start, end, text){
    this.text();
    const r = this.range(start, end);
    this.el.focus({ preventScroll:true });
    const sel = selFor(this.el);
    sel.removeAllRanges(); sel.addRange(r);
    if (!editCommand(text)){
      r.deleteContents();
      if (text) r.insertNode(document.createTextNode(text));
      this.el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertReplacementText', data:text }));
    }
  }
}

/* ---------- a session: one field being checked ---------- */
class Session {
  constructor(el){
    this.el = el;
    this.kind = el.isContentEditable ? 'contenteditable' : el.tagName.toLowerCase();
    this.ad = el.isContentEditable ? new EditableAdapter(el) : new ControlAdapter(el);
    if (!memory.has(el)) memory.set(el, { dismissed:new Set(), ai:[], tone:[], status:'' });
    this.mem = memory.get(el);
    this.text = null; this.sugs = []; this.boxes = new Map(); this.tooLong = false;
    this.rect = null; this.visible = null; this.clippers = findClippers(el);
    const a = deepActive(); this.focused = a === el || (a && el.contains(a));
    this.checking = false; this.timer = 0; this.checkMs = 0; this.measureMs = 0;
    this.onInput = () => this.schedule();
    this.onScroll = () => requestLayout(true);
    this.onClick = () => this.clickAt();
    this.onKey = e => { if (e.key && e.key.startsWith('Arrow')) this.clickAt(); };
    this.onFocus = () => { this.focused = true; renderWidget(); };
    this.onBlur = () => setTimeout(() => {
      if (S !== this) return;
      const now = deepActive(); this.focused = now === this.el || !!(now && this.el.contains(now));
      renderWidget();
    }, 120);
    el.addEventListener('input', this.onInput);
    el.addEventListener('scroll', this.onScroll, { passive:true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('keyup', this.onKey);
    el.addEventListener('focus', this.onFocus);
    el.addEventListener('blur', this.onBlur);
    this.ro = new ResizeObserver(() => requestLayout(true));
    this.ro.observe(el);
    this.poll = setInterval(() => this.tick(), 1000);
    this.check();
  }
  destroy(){
    const el = this.el;
    el.removeEventListener('input', this.onInput);
    el.removeEventListener('scroll', this.onScroll);
    el.removeEventListener('click', this.onClick);
    el.removeEventListener('keyup', this.onKey);
    el.removeEventListener('focus', this.onFocus);
    el.removeEventListener('blur', this.onBlur);
    this.ro.disconnect(); clearInterval(this.poll); clearTimeout(this.timer);
  }
  schedule(){
    clearTimeout(this.timer);
    this.checking = true; renderWidget();
    this.timer = setTimeout(() => this.check(), 260);
  }
  tick(){
    if (!this.el.isConnected){ end(); return; }
    mount();
    if (this.ad.text() !== this.text){ this.check(); return; }
    const r = this.el.getBoundingClientRect(), o = this.rect;
    if (!o || Math.abs(r.width - o.width) > .5 || Math.abs(r.height - o.height) > .5) this.measure();
    else if (Math.abs(r.left - o.left) > .5 || Math.abs(r.top - o.top) > .5) this.place();
  }
  check(){
    clearTimeout(this.timer);
    const t0 = performance.now();
    const t = this.ad.text();
    if (this.text !== null && t !== this.text && this.mem.ai.length){
      const d = E.diff(this.text, t);
      this.mem.ai = E.rebaseList(this.mem.ai, d, t.slice(d.pos, d.pos + d.ins), this.text).kept;
    }
    this.text = t;
    this.tooLong = t.length > MAX_CHARS;
    const on = enabledHere();
    let rules = (!on || this.tooLong) ? [] : E.runEngine(t, this.mem.dismissed);
    if (on && !this.tooLong) rules = rules.concat(spellSugs(t, rules, this.mem.dismissed)).sort((a, b) => a.start - b.start || a.end - b.end);
    const spans = new Set(rules.map(g => g.start + ':' + g.end));
    // short AI fixes that overlap an instant fix are the same problem twice; sentence rewrites stay
    const ai = on ? this.mem.ai.filter(g => !spans.has(g.start + ':' + g.end) &&
      !(g.end - g.start < 25 && rules.some(r => r.start < g.end && r.end > g.start))) : [];
    this.sugs = rules.concat(ai).filter(g => settings.cats[g.cat] !== false && !isIgnored(g.original)).sort((a, b) => a.start - b.start || a.end - b.end);
    this.checking = false;
    this.checkMs = performance.now() - t0;
    if (card.g){
      const same = this.sugs.find(g => g.id === card.g.id) ||
        this.sugs.find(g => g.rule === card.g.rule && g.original === card.g.original && Math.abs(g.start - card.g.start) < 3);
      if (same) card.g = same; else hideCard();
    }
    this.measure();
    renderPanel();
    emitDebug('check');
    if (this.focused) scheduleAuto(this);
  }
  measure(){
    if (!this.el.isConnected){ end(); return; }
    if (this.ad.text() !== this.text){ this.check(); return; }
    const t0 = performance.now();
    const r = this.el.getBoundingClientRect();
    this.rect = r; this.boxes.clear();
    if (this.sugs.length && r.width > 0 && r.height > 0){
      const list = this.sugs.slice(0, MAX_BOXES);
      const rects = this.ad.measure(list);
      list.forEach((g, i) => {
        const bs = [];
        for (const b of rects[i] || []) if (b.width > 0.5 && b.height > 0) bs.push({ x:b.left - r.left, y:b.top - r.top, w:b.width, h:b.height });
        this.boxes.set(g.id, bs);
      });
    }
    this.measureMs = performance.now() - t0;
    this.draw();
    this.place();
    emitDebug('measure');
  }
  draw(){
    const act = card.g ? card.g.id : panelHover;
    let html = '';
    if (enabledHere()) for (const g of this.sugs){
      const bs = this.boxes.get(g.id); if (!bs) continue;
      for (const b of bs){
        if (g.id === act){ const w = Math.max(b.w, 8); html += `<div class="hl" style="left:${b.x - (w - b.w) / 2 - 1}px;top:${b.y - 1}px;width:${w + 2}px;height:${b.h + 2}px"></div>`; }
        html += `<div class="u cat-${g.cat}${g.replacement === null ? ' flag' : ''}" style="left:${b.x}px;top:${b.y + b.h - 2}px;width:${b.w}px"></div>`;
      }
    }
    innerEl.innerHTML = html;
  }
  place(){
    const r = this.el.getBoundingClientRect(); this.rect = r;
    const c = { left:Math.max(r.left, 0), top:Math.max(r.top, 0), right:Math.min(r.right, innerWidth), bottom:Math.min(r.bottom, innerHeight) };
    for (const p of this.clippers){
      const b = p.getBoundingClientRect();
      c.left = Math.max(c.left, b.left); c.top = Math.max(c.top, b.top);
      c.right = Math.min(c.right, b.right); c.bottom = Math.min(c.bottom, b.bottom);
    }
    const w = c.right - c.left, h = c.bottom - c.top;
    this.visible = (w > 4 && h > 4) ? c : null;
    if (!this.visible) clipEl.hidden = true;
    else {
      clipEl.hidden = false;
      clipEl.style.left = c.left + 'px'; clipEl.style.top = c.top + 'px';
      clipEl.style.width = w + 'px'; clipEl.style.height = h + 'px';
      innerEl.style.transform = `translate(${r.left - c.left}px, ${r.top - c.top}px)`;
    }
    renderWidget(); placeCard(); placePanel();
  }
  clickAt(){
    if (this.ad.text() !== this.text) return;
    const pos = this.ad.caret();
    if (pos == null) return;
    const g = sugAt(pos, this.sugs);
    if (g) showCard(g, { pinned:true });
    else if (card.g) hideCard();
  }
  apply(g){
    const t = this.ad.text();
    if (t !== this.text || t.slice(g.start, g.end) !== g.original){ this.check(); toast('That text changed, so the suggestions were refreshed.'); return; }
    if (g.source === 'claude') this.mem.ai = this.mem.ai.filter(x => x !== g);
    hideCard();
    this.ad.replace(g.start, g.end, g.replacement);
    this.check();
    toast(g.replacement === '' ? `Removed “${E.trunc(g.original.trim() || 'space', 28)}”` : `Changed to “${E.trunc(g.replacement, 28)}”`);
  }
  dismiss(g){
    if (g.source === 'rules') this.mem.dismissed.add(E.dkey(g));
    else this.mem.ai = this.mem.ai.filter(x => x !== g);
    hideCard();
    this.check();
  }
}

function sugAt(pos, sugs){
  let pick = null;
  for (const g of sugs){
    if (g.end > g.start && g.start <= pos && pos <= g.end){
      const better = !pick || (pick.replacement === null && g.replacement !== null) ||
        ((pick.replacement === null) === (g.replacement === null) && (g.end - g.start) < (pick.end - pick.start));
      if (better) pick = g;
    }
  }
  return pick;
}

/* ---------- layout scheduling: measure on content or size change, only move on scroll ---------- */
let rafPending = false, needMeasure = false, needPlace = false;
function requestLayout(full){
  if (full) needMeasure = true; else needPlace = true;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const m = needMeasure, p = needPlace; needMeasure = needPlace = false;
    if (!S) return;
    if (m) S.measure(); else if (p) S.place();
  });
}

function start(el){
  if (S && S.el === el){ if (!S.focused){ S.focused = true; renderWidget(); } return; }
  end();
  mount();
  S = new Session(el);
  refreshAi();
}
function end(){
  if (!S) return;
  S.destroy(); S = null;
  hideCard(); closePanel();
  clipEl.hidden = true; innerEl.innerHTML = ''; widgetEl.hidden = true; rwJob = null;
  emitDebug('end');
}

/* ---------- floating widget ---------- */
let widgetHTML = '';
function renderWidget(){
  if (!S || !S.visible || !(S.focused || panelOpen) || S.rect.width < 120 || S.rect.height < 18){ widgetEl.hidden = true; return; }
  const on = enabledHere(), n = S.sugs.length;
  const state = !on ? 'off' : (S.checking || aiBusy) ? 'checking' : n ? 'issues' : 'clean';
  const worst = CAT_KEYS.find(k => S.sugs.some(g => g.cat === k)) || 'correctness';
  const label = state === 'off' ? `Proofmark is paused on ${SITE}` : state === 'checking' ? 'Proofmark is checking'
    : n ? `Proofmark: ${n} suggestion${n === 1 ? '' : 's'}` : 'Proofmark: no issues found';
  widgetEl.className = `widget is-${state} cat-${worst}`;
  widgetEl.title = label; widgetEl.setAttribute('aria-label', label);
  widgetEl.setAttribute('aria-expanded', String(panelOpen));
  const html = CARET + (on && n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '');
  if (html !== widgetHTML){ widgetEl.innerHTML = html; widgetHTML = html; }
  const v = S.visible, r = S.rect, small = r.height < 44;
  let x = v.right - SIZE - (small ? 6 : 8);
  let y = small ? r.top + (r.height - SIZE) / 2 : v.bottom - SIZE - 8;
  y = Math.min(Math.max(y, v.top + 1), v.bottom - SIZE - 1);
  widgetEl.style.left = x + 'px'; widgetEl.style.top = y + 'px';
  widgetEl.hidden = false;
}
widgetEl.addEventListener('click', () => { panelOpen ? closePanel() : openPanel(); });

/* ---------- suggestion card (hover or click an underline) ---------- */
const card = { g:null, pinned:false, over:false, showT:0, hideT:0 };
function fixHTML(g){
  const o = g.original, r = g.replacement, t = E.trunc;
  if (r === null) return `<span class="quote">“${esc(t(o, 96))}”</span>`;
  if (!o.trim()) return r === '' ? '<span class="op">remove the space</span>' : `<span class="op">${o.length} spaces → 1</span>`;
  if (r === '') return `<del>${esc(t(o.trim()))}</del><span class="op">remove</span>`;
  if (r.startsWith(o)){
    const added = r.slice(o.length);
    return /^\s+$/.test(added) ? `${esc(o)}<span class="op">add a space after</span>` : `${esc(t(o))}<ins>${esc(added)}</ins>`;
  }
  return `<del>${esc(t(o))}</del><span class="arrow" aria-hidden="true">→</span><ins>${esc(t(r, 120))}</ins>`;
}
function mainAction(g){
  if (g.replacement !== null) return `<button type="button" class="btn btn-accept" data-act="accept">${g.replacement === '' ? 'Remove' : 'Accept'}</button>`;
  if (caps.rewrite) return `<button type="button" class="btn btn-accept" data-act="rewrite"${g.rewriting ? ' disabled' : ''}>${g.rewriting ? 'Rewriting…' : 'Rewrite this sentence'}</button>`;
  return '';
}
/* ---------- the same word in several places: ask before changing or ignoring all of them ---------- */
let ask = null;   // { id, mode: 'accept' | 'dismiss', count, word }
const isWord = s => /^[A-Za-z][A-Za-z'’-]+$/.test(String(s).trim());
function isIgnored(s){ return isWord(s) && (settings.ignoredWords || []).includes(String(s).trim().toLowerCase()); }
function sameAs(g){
  const o = g.original.trim().toLowerCase(), r = (g.replacement || '').toLowerCase();
  return S ? S.sugs.filter(x => x.original.trim().toLowerCase() === o && (x.replacement || '').toLowerCase() === r) : [g];
}
function actionsHTML(g){
  if (ask && ask.id === g.id){
    const w = esc(g.original.trim()), n = ask.count;
    const q = ask.mode === 'accept' ? `“${w}” appears ${n} times. Change all of them?`
      : ask.word ? (n > 1 ? `“${w}” appears ${n} times. Stop flagging it everywhere?` : `Stop flagging “${w}” everywhere?`)
      : `This appears ${n} times. Dismiss all of them?`;
    const all = ask.mode === 'accept' ? `Change all ${n}` : ask.word ? 'Ignore everywhere' : `Dismiss all ${n}`;
    return `<p class="ask">${q}</p><div class="actions"><button type="button" class="btn ${ask.mode === 'accept' ? 'btn-accept' : 'btn-primary'}" data-act="ask-all">${all}</button>` +
      `<button type="button" class="btn" data-act="ask-one">Just this one</button></div>` +
      (ask.mode === 'dismiss' && ask.word ? '<p class="note">You can remove ignored words in Proofmark settings.</p>' : '');
  }
  return `<div class="actions">${mainAction(g)}<button type="button" class="btn btn-quiet" data-act="dismiss">Dismiss</button></div>`;
}
/* Returns true when it opened a question instead of acting straight away */
function askFirst(g, mode){
  const n = sameAs(g).length;
  if (mode === 'accept' ? n > 1 : (n > 1 || isWord(g.original))){ ask = { id:g.id, mode, count:n, word:isWord(g.original) }; return true; }
  ask = null; return false;
}
function answer(g, all){
  const q = ask; ask = null;
  if (!q || !S) return;
  if (q.mode === 'accept'){ if (all) acceptAll(sameAs(g)); else S.apply(g); }
  else if (all && q.word) ignoreWord(g.original);
  else if (all){ for (const x of sameAs(g)) S.dismiss(x); }
  else S.dismiss(g);
}
function ignoreWord(word){
  const w = word.trim().toLowerCase();
  const list = Array.from(new Set([...(settings.ignoredWords || []), w]));
  settings.ignoredWords = list;
  Promise.resolve(H.setSettings({ ignoredWords:list })).catch(() => {});
  if (S){ S.mem.ai = S.mem.ai.filter(x => x.original.trim().toLowerCase() !== w); hideCard(); S.check(); }
  toast(`Proofmark won't flag “${word.trim()}” again.`);
}
function cardHTML(g){
  return `<div class="c-head"><span class="mark">${esc(g.mark)}</span><span class="c-title">${esc(g.title)}</span>${g.source === 'claude' ? `<span class="src">${esc(g.engine || 'Claude')}</span>` : ''}</div>` +
    `<div class="fix">${fixHTML(g)}</div>${g.why ? `<p class="why">${esc(g.why)}</p>` : ''}` + actionsHTML(g);
}
function showCard(g, opts = {}){
  if (!S) return;
  clearTimeout(card.hideT); clearTimeout(card.showT);
  card.g = g; card.pinned = !!opts.pinned;
  cardEl.className = `card cat-${g.cat}`;
  cardEl.innerHTML = cardHTML(g);
  cardEl.hidden = false;
  S.draw(); placeCard();
}
function hideCard(){
  clearTimeout(card.showT); clearTimeout(card.hideT);
  if (!card.g) return;
  card.g = null; card.over = false; cardEl.hidden = true;
  if (S) S.draw();
}
function placeCard(){
  if (!card.g || !S) return;
  const bs = S.boxes.get(card.g.id), r = S.rect, v = S.visible;
  const b = bs && bs[0];
  if (!b || !v || r.top + b.y + b.h < v.top || r.top + b.y > v.bottom){ cardEl.hidden = true; return; }
  cardEl.hidden = false;
  const ax = r.left + b.x, ay = r.top + b.y;
  const cw = cardEl.offsetWidth || 300, ch = cardEl.offsetHeight || 140;
  const left = Math.min(Math.max(8, ax - 14), innerWidth - cw - 8);
  let top = ay + b.h + 6;
  if (top + ch > innerHeight - 8) top = Math.max(8, ay - ch - 6);
  cardEl.style.left = left + 'px'; cardEl.style.top = top + 'px';
}
function scheduleHide(){ clearTimeout(card.hideT); card.hideT = setTimeout(() => { if (!card.over && !card.pinned) hideCard(); }, 320); }
cardEl.addEventListener('mouseenter', () => { card.over = true; clearTimeout(card.hideT); });
cardEl.addEventListener('mouseleave', () => { card.over = false; if (!card.pinned) scheduleHide(); });
cardEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || !card.g || !S) return;
  const g = card.g, act = b.dataset.act;
  if (act === 'accept' || act === 'dismiss'){
    if (askFirst(g, act)){ card.pinned = true; cardEl.innerHTML = cardHTML(g); placeCard(); return; }
    if (act === 'accept') S.apply(g); else S.dismiss(g);
  }
  else if (act === 'ask-all') answer(g, true);
  else if (act === 'ask-one') answer(g, false);
  else if (act === 'rewrite') rewriteFlag(g);
});

let mx = 0, my = 0, moveRaf = false;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  if (moveRaf) return;
  moveRaf = true;
  requestAnimationFrame(() => { moveRaf = false; onHover(); });
}, { capture:true, passive:true });
function onHover(){
  if (!S || !S.rect || !S.visible || card.over || !enabledHere()) return;
  const v = S.visible;
  if (mx < v.left || mx > v.right || my < v.top || my > v.bottom){ clearTimeout(card.showT); if (card.g && !card.pinned) scheduleHide(); return; }
  const lx = mx - S.rect.left, ly = my - S.rect.top;
  let hit = null;
  for (const g of S.sugs){
    const bs = S.boxes.get(g.id); if (!bs) continue;
    for (const b of bs) if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h + 3 && (!hit || b.w < hit.w)) hit = { g, w:b.w };
  }
  if (hit){
    clearTimeout(card.hideT);
    if (!card.g || card.g.id !== hit.g.id){ clearTimeout(card.showT); const g = hit.g; card.showT = setTimeout(() => showCard(g, { pinned:false }), 260); }
  } else { clearTimeout(card.showT); if (card.g && !card.pinned) scheduleHide(); }
}

/* ---------- panel (opened from the widget) ---------- */
let panelOpen = false, panelFilter = 'all', panelOpenId = null, panelHover = null, rwJob = null;
function openPanel(){ if (!S) return; hideCard(); panelOpen = true; panelOpenId = null; refreshAi(); renderPanel(); renderWidget(); }
function closePanel(){
  if (!panelOpen) return;
  panelOpen = false; panelHover = null; panelEl.hidden = true; panelEl.innerHTML = '';
  if (S){ S.draw(); renderWidget(); }
}
function renderPanel(){
  if (!panelOpen || !S) return;
  const prevBody = panelEl.querySelector('.p-body'), scroll = prevBody ? prevBody.scrollTop : 0;
  const on = enabledHere(), sugs = S.sugs, n = sugs.length;
  const counts = { all:n, correctness:0, clarity:0, style:0, tone:0 };
  for (const g of sugs) counts[g.cat]++;
  if (panelFilter !== 'all' && !counts[panelFilter]) panelFilter = 'all';
  let body = '';
  if (S.mem.tone.length && on) body += `<div class="p-tone"><span class="eyebrow">Sounds</span>${S.mem.tone.map(t => `<span class="tone-chip">${esc(E.trunc(t, 22))}</span>`).join('')}</div>`;
  if (rwJob){
    body += `<div class="p-rw"><div class="p-rw-head"><span class="eyebrow">Rewrite · ${esc(E.GOALS[rwJob.goal].label)}</span><span class="p-rw-scope">${esc(rwJob.scope)}</span></div>` +
      `<div class="p-rw-text${rwJob.busy ? ' is-wait' : ''}">${rwJob.busy ? 'Thinking…' : esc(rwJob.result)}</div>` +
      `<div class="actions"><button type="button" class="btn btn-primary" data-act="rw-use"${rwJob.busy || !rwJob.result ? ' disabled' : ''}>Replace</button>` +
      `<button type="button" class="btn btn-quiet" data-act="rw-close">Discard</button></div>${rwJob.note ? `<p class="note">${esc(rwJob.note)}</p>` : ''}</div>`;
  }
  if (!on) body += `<div class="p-empty"><p class="p-empty-t">Paused on ${esc(SITE)}</p><p>Proofmark isn’t checking text on this site.</p></div>`;
  else if (S.tooLong) body += `<div class="p-empty"><p class="p-empty-t">This field is very long</p><p>Proofmark checks fields up to ${MAX_CHARS.toLocaleString()} characters.</p></div>`;
  else if (!n) body += `<div class="p-empty"><p class="p-empty-t">${S.text.trim() ? 'No issues found' : 'Nothing to check yet'}</p><p>${S.text.trim() ? (aiOn ? 'The instant checks are clear. A deep check can catch grammar and tone the rules miss.' : 'The instant checks are clear.') : 'Start typing and suggestions appear here.'}</p></div>`;
  else {
    body += `<div class="p-tabs">${['all', ...CAT_KEYS].map(k => `<button type="button" class="tab${k === 'all' ? '' : ' cat-' + k}" data-act="filter" data-filter="${k}" aria-pressed="${panelFilter === k}">${k === 'all' ? '' : '<span class="dot"></span>'}${k === 'all' ? 'All' : E.CATS[k].label}<span class="n">${counts[k]}</span></button>`).join('')}</div>`;
    const shown = panelFilter === 'all' ? sugs : sugs.filter(g => g.cat === panelFilter);
    const fixable = shown.filter(g => g.replacement !== null).length;
    if (fixable > 1){
      const what = panelFilter === 'all' ? '' : ` ${E.CATS[panelFilter].label.toLowerCase()}`;
      body += `<div class="p-bulk"><button type="button" class="btn btn-primary" data-act="accept-all">Accept all ${fixable}${what} fixes</button>` +
        (fixable < shown.length ? `<span class="note">${shown.length - fixable} need a rewrite and stay listed</span>` : '') + '</div>';
    }
    body += `<ol class="p-list">${shown.map(g => {
      const open = g.id === panelOpenId;
      return `<li class="item cat-${g.cat}${open ? ' is-open' : ''}" data-id="${esc(g.id)}"><button type="button" class="i-head" data-act="open" aria-expanded="${open}">` +
        `<span class="mark">${esc(g.mark)}</span><span class="i-main"><span class="i-title">${esc(g.title)}${g.source === 'claude' ? `<span class="src">${esc(g.engine || 'Claude')}</span>` : ''}</span><span class="fix">${fixHTML(g)}</span></span></button>` +
        (open ? `<div class="i-body">${g.why ? `<p class="why">${esc(g.why)}</p>` : ''}${actionsHTML(g)}</div>` : '') + '</li>';
    }).join('')}</ol>`;
  }
  let foot = '';
  if (on){
    const who = [caps.languagetool && 'LanguageTool', caps.engine].filter(Boolean).join(' + ') || 'Claude';
    foot += aiOn
      ? `<div class="p-ai"><button type="button" class="btn btn-primary" data-act="deep"${aiBusy ? ' disabled' : ''}>${aiBusy ? (S.auto ? 'Checking as you write…' : 'Checking…') : `Deep check · ${esc(who)}`}</button>` +
        (caps.rewrite ? `<div class="p-goals"><span class="eyebrow">Rewrite</span>${Object.keys(E.GOALS).map(k => `<button type="button" class="btn chip" data-act="goal" data-goal="${k}"${rwJob && rwJob.busy ? ' disabled' : ''}>${E.GOALS[k].label}</button>`).join('')}</div>` : '') +
        (caps.languagetool ? '<span class="p-status">Grammar checks by <a href="https://languagetool.org" target="_blank" rel="noopener">LanguageTool</a></span>' : '') + '</div>'
      : `<div class="p-ai p-ai-off"><span>${esc(H.aiHint || 'Turn on a smart-check engine in Proofmark settings.')}</span>${H.openSettings ? '<button type="button" class="btn" data-act="settings">Settings</button>' : ''}</div>`;
  }
  if (S.mem.status) foot += `<p class="p-status">${esc(S.mem.status)}</p>`;
  foot += `<div class="p-site"><span>${on ? 'Checking' : 'Paused on'} <b>${esc(SITE)}</b></span><button type="button" class="btn btn-quiet" data-act="site">${on ? 'Pause on this site' : 'Resume'}</button></div>`;
  const label = !on ? 'Paused' : n ? `${n} suggestion${n === 1 ? '' : 's'}` : 'No issues';
  panelEl.innerHTML = `<div class="p-head"><span class="brand">${CARET}Proofmark</span><span class="p-count">${label}</span><button type="button" class="x" data-act="close" aria-label="Close">×</button></div>` +
    `<div class="p-body">${body}</div><div class="p-foot">${foot}</div>`;
  panelEl.hidden = false;
  const nb = panelEl.querySelector('.p-body'); if (nb) nb.scrollTop = scroll;
  placePanel();
}
function placePanel(){
  if (!panelOpen || !S || panelEl.hidden) return;
  if (!S.visible){ panelEl.style.visibility = 'hidden'; return; }
  panelEl.style.visibility = '';
  const w = Math.min(340, innerWidth - 16);
  panelEl.style.width = w + 'px';
  const v = S.visible;
  const a = widgetEl.hidden ? { left:v.right - SIZE, right:v.right, top:v.bottom - SIZE, bottom:v.bottom } : widgetEl.getBoundingClientRect();
  // Prefer the side of the text box, so the panel never covers the words it's pointing at
  const side = innerWidth - v.right - 12 >= w + 8 ? v.right + 12 : v.left - 12 - w >= 8 ? v.left - 12 - w : null;
  if (side !== null){
    panelEl.style.maxHeight = Math.max(200, Math.min(500, innerHeight - 16)) + 'px';
    const ph = panelEl.offsetHeight;
    const top = Math.min(Math.max(8, a.bottom - ph), innerHeight - ph - 8);
    panelEl.style.left = side + 'px'; panelEl.style.top = top + 'px';
    return;
  }
  const below = innerHeight - a.bottom - 16, above = a.top - 16;
  const useAbove = above > below;
  panelEl.style.maxHeight = Math.max(200, Math.min(500, useAbove ? above : below)) + 'px';
  const ph = panelEl.offsetHeight;
  let top = useAbove ? a.top - 8 - ph : a.bottom + 8;
  top = Math.min(Math.max(8, top), innerHeight - ph - 8);
  const left = Math.min(Math.max(8, a.right - w), innerWidth - w - 8);
  panelEl.style.left = left + 'px'; panelEl.style.top = top + 'px';
}
panelEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || !S) return;
  const act = b.dataset.act, li = b.closest('.item'), g = li ? S.sugs.find(x => x.id === li.dataset.id) : null;
  if (act === 'close') closePanel();
  else if (act === 'filter'){ panelFilter = b.dataset.filter; renderPanel(); }
  else if (act === 'open' && g){ panelOpenId = panelOpenId === g.id ? null : g.id; renderPanel(); }
  else if (act === 'accept-all') acceptAll(panelFilter === 'all' ? S.sugs : S.sugs.filter(x => x.cat === panelFilter));
  else if ((act === 'accept' || act === 'dismiss') && g && askFirst(g, act)){ panelOpenId = g.id; renderPanel(); }
  else if ((act === 'ask-all' || act === 'ask-one') && g){ const i = S.sugs.indexOf(g); answer(g, act === 'ask-all'); const nx = S && (S.sugs[i] || S.sugs[0]); panelOpenId = nx ? nx.id : null; renderPanel(); }
  else if (act === 'accept' && g){ const i = S.sugs.indexOf(g); S.apply(g); const nx = S && (S.sugs[i] || S.sugs[0]); panelOpenId = nx ? nx.id : null; renderPanel(); }
  else if (act === 'dismiss' && g){ const i = S.sugs.indexOf(g); S.dismiss(g); const nx = S && (S.sugs[i] || S.sugs[0]); panelOpenId = nx ? nx.id : null; renderPanel(); }
  else if (act === 'rewrite' && g) rewriteFlag(g);
  else if (act === 'deep') deepCheck();
  else if (act === 'goal') rewriteGoal(b.dataset.goal);
  else if (act === 'rw-use') useRewrite();
  else if (act === 'rw-close'){ rwJob = null; renderPanel(); }
  else if (act === 'settings' && H.openSettings) H.openSettings();
  else if (act === 'site') toggleSite();
});
panelEl.addEventListener('mouseover', e => {
  const li = e.target.closest('.item'), id = li ? li.dataset.id : null;
  if (id !== panelHover){ panelHover = id; if (S){ S.draw(); revealSoon(id); } }
});
panelEl.addEventListener('mouseleave', () => { if (panelHover){ panelHover = null; if (S) S.draw(); } });
/* Keep the field focused (and its selection intact) when our buttons are pressed */
shadow.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

/* Accept every suggestion that has a direct fix. Works from the end of the text backwards so
   earlier positions never shift, and skips any fix that overlaps one already applied. */
function acceptAll(list){
  if (!S) return;
  const s = S;
  if (s.ad.text() !== s.text){ s.check(); toast('The text changed, so the suggestions were refreshed. Try again.'); return; }
  let fixes = list.filter(g => g.replacement !== null);
  // an AI rewrite of a whole sentence already includes the smaller fixes inside it, so it wins over them
  const wide = fixes.filter(g => g.source === 'claude' && g.end - g.start >= 25);
  fixes = fixes.filter(g => !wide.some(w => w !== g && w.start <= g.start && w.end >= g.end))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  hideCard();
  let floor = Infinity, done = 0;
  for (const g of fixes){
    if (g.end > floor) continue;
    if (s.ad.text().slice(g.start, g.end) !== g.original) continue;
    if (g.source === 'claude') s.mem.ai = s.mem.ai.filter(x => x !== g);
    s.ad.replace(g.start, g.end, g.replacement);
    floor = g.start; done++;
  }
  panelOpenId = null;
  s.check();
  toast(done ? `Applied ${done} fix${done === 1 ? '' : 'es'}. Ctrl+Z undoes them one at a time.` : 'None of the fixes could be applied.');
}

/* Pointing at a suggestion in the panel scrolls its word into view if it's hidden inside the field */
let revealT = 0;
function revealSoon(id){
  clearTimeout(revealT);
  if (!id) return;
  revealT = setTimeout(() => {
    if (!S || panelHover !== id) return;
    const g = S.sugs.find(x => x.id === id); if (!g) return;
    const v = S.visible, r = S.rect, bs = S.boxes.get(id) || [];
    const onScreen = v && bs.some(b => r.top + b.y + b.h > v.top && r.top + b.y < v.bottom);
    if (onScreen) return;
    if (S.ad instanceof EditableAdapter){
      S.ad.text();
      const node = S.ad.range(g.start, g.end).startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block:'nearest' });
    } else if (bs.length){
      // The mirror measured the word even while it's scrolled out of sight, so scroll by that offset
      S.el.scrollTop = Math.max(0, S.el.scrollTop + bs[0].y - S.el.clientHeight / 2);
    } else {
      const el = S.el, before = el.value.slice(0, g.start).split('\n').length - 1;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      el.scrollTop = Math.max(0, before * lh - el.clientHeight / 2);
    }
    requestLayout(true);
  }, 300);
}

function toggleSite(){
  const list = settings.disabledSites.filter(s => s !== SITE);
  if (enabledHere()) list.push(SITE);
  settings.disabledSites = list;
  Promise.resolve(H.setSettings({ disabledSites:list })).catch(() => {});
  if (S) S.check();
  renderWidget();
}

let toastT = 0;
function toast(msg){
  if (!S || !S.visible) return;
  toastEl.textContent = msg; toastEl.hidden = false;
  const v = S.visible, w = toastEl.offsetWidth, h = toastEl.offsetHeight;
  toastEl.style.left = Math.min(Math.max(8, v.left + (v.right - v.left - w) / 2), innerWidth - w - 8) + 'px';
  toastEl.style.top = Math.min(v.bottom + 8, innerHeight - h - 8) + 'px';
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

/* ---------- spelling: every word checked against a full English dictionary (in the background worker) ---------- */
const spellCache = new Map();       // lowercase word -> suggestion string, null (unknown, nothing close) or false (fine)
let spellAsking = false;
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
function spellSugs(t, rules, dismissed){
  if (!H.spell) return [];
  const out = [], need = new Set();
  WORD_RE.lastIndex = 0; let m;
  while ((m = WORD_RE.exec(t)) !== null){
    const w = m[0], start = m.index, end = start + w.length;
    if (w.length < 2 || (w.length > 1 && w === w.toUpperCase()) || /[a-z][A-Z]/.test(w)) continue;   // acronyms, camelCase
    const chunkA = t.slice(0, start).search(/\S*$/), chunkB = end + t.slice(end).search(/\s|$/);
    if (/[@\/\\_#=<>{}|~^]|\w\.\w|\d/.test(t.slice(chunkA, chunkB))) continue;                       // links, emails, paths, code
    if (/^[A-Z]/.test(w)){
      const before = t.slice(0, start).replace(/["“'‘(\s]+$/, '');
      if (before && !/[.!?:\n]$/.test(t.slice(0, start).replace(/[ \t"“'‘(]+$/, ''))) continue;      // a capitalized word mid-sentence is probably a name
    }
    if (isIgnored(w) || rules.some(g => start < g.end && end > g.start)) continue;
    const key = w.toLowerCase().replace(/’/g, "'");
    if (!spellCache.has(key)){ need.add(key); continue; }
    let rep = spellCache.get(key);
    if (!rep) continue;
    if (/^[A-Z]/.test(w) && !/^I\b/.test(rep)) rep = rep.charAt(0).toUpperCase() + rep.slice(1);
    if (w.includes('’')) rep = rep.replace(/'/g, '’');
    const g = { id:`spell:${start}:${end}`, source:'rules', rule:'spell', cat:'correctness', mark:'sp', title:'Spelling',
      why:`“${w}” isn’t in the dictionary. Did you mean “${rep}”?`, start, end, original:w, replacement:rep };
    if (dismissed && dismissed.has(E.dkey(g))) continue;
    out.push(g);
  }
  if (need.size && !spellAsking){
    spellAsking = true;
    const list = [...need].slice(0, 400);
    Promise.resolve(H.spell(list)).then(res => {
      for (const k of list) spellCache.set(k, res && Object.prototype.hasOwnProperty.call(res, k) ? res[k] : false);
    }, () => { for (const k of list) spellCache.set(k, false); })
      .finally(() => { spellAsking = false; if (S) S.check(); });
  }
  return out;
}

/* ---------- automatic AI checks: after a pause in typing, the changed paragraph goes to the AI engine ---------- */
const AUTO_PAUSE = 2200, AUTO_GAP = 8000, AUTO_SPAN = 2400;
let autoTimer = 0, lastAuto = 0, autoStop = '';
function scheduleAuto(s){
  clearTimeout(autoTimer);
  if (!settings.autoAi || !caps.auto || autoStop || !enabledHere() || s.tooLong || !H.deepCheck) return;
  autoTimer = setTimeout(() => autoCheck(s), AUTO_PAUSE);
}
function autoRegion(text, caret){
  if (text.length <= AUTO_SPAN) return [0, text.length];
  const at = caret == null ? text.length : caret;
  let a = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1, b = text.indexOf('\n', at); if (b < 0) b = text.length;
  if (b - a > AUTO_SPAN){ a = Math.max(a, at - AUTO_SPAN / 2); b = Math.min(b, a + AUTO_SPAN); }
  return [a, b];
}
async function autoCheck(s){
  if (S !== s || !s.focused || !s.el.isConnected) return;
  if (aiBusy){ scheduleAuto(s); return; }
  const text = s.ad.text();
  const [a, b] = autoRegion(text, s.ad.caret());
  const region = text.slice(a, b);
  if ((region.match(/[A-Za-z]+/g) || []).length < 4) return;
  const done = s.mem.autoDone || (s.mem.autoDone = new Set());
  if (done.has(region.trim())) return;
  const wait = lastAuto + AUTO_GAP - Date.now();
  if (wait > 0){ clearTimeout(autoTimer); autoTimer = setTimeout(() => autoCheck(s), wait); return; }
  lastAuto = Date.now(); aiBusy = true; s.auto = true; renderWidget(); renderPanel();
  try {
    const known = E.knownSpans(s.sugs.filter(g => g.start >= a && g.end <= b && g.source !== 'claude'));
    const res = await H.deepCheck(region, known, { auto:true });
    if (res && res.skipped){ autoStop = res.skipped; s.mem.status = res.skipped; return; }
    done.add(region.trim()); if (done.size > 40) done.delete(done.values().next().value);
    let mapped = E.mapIssues(res && res.issues, region).map(g => ({ ...g, start:g.start + a, end:g.end + a }));
    // the field may have changed while the AI was thinking: line the results up with the last checked text
    const cur = s.text; let ra = a, rb = b;
    if (cur !== text){
      const d = E.diff(text, cur);
      mapped = E.rebaseList(mapped, d, cur.slice(d.pos, d.pos + d.ins), text).kept;
      const shift = cur.length - text.length;
      if (d.pos <= ra) { ra += shift; rb += shift; } else if (d.pos < rb) rb += shift;
    }
    s.mem.ai = s.mem.ai.filter(g => g.end <= ra || g.start >= rb).concat(mapped);
    if (res && Array.isArray(res.tone) && res.tone.length) s.mem.tone = res.tone.filter(x => typeof x === 'string' && x.trim()).slice(0, 3);
    s.mem.status = mapped.length ? `${caps.engine || 'AI'} checked as you wrote and found ${mapped.length} ${mapped.length === 1 ? 'suggestion' : 'suggestions'}.` : '';
  } catch (e){
    const msg = errText(e);
    if (/daily|quota|allowance|limit/i.test(msg)){ autoStop = msg; s.mem.status = msg; }
  } finally {
    aiBusy = false; s.auto = false;
    if (S === s) s.check(); else renderWidget();
  }
}

/* ---------- Claude: deep check and rewrites (only when the person asks) ---------- */
function refreshAi(){
  const ask = H.capabilities ? H.capabilities() : Promise.resolve(H.aiAvailable()).then(v => ({ deep:!!v, rewrite:!!v, engine:null }));
  Promise.resolve(ask).then(c => {
    const before = JSON.stringify(caps);
    caps = { deep:!!c.deep, rewrite:!!c.rewrite, auto:!!c.auto, engine:c.engine || null, languagetool:!!c.languagetool };
    aiOn = caps.deep;
    if (before !== JSON.stringify(caps)){ renderPanel(); if (card.g) cardEl.innerHTML = cardHTML(card.g); }
  }, () => {});
}
async function deepCheck(){
  if (!S || aiBusy) return;
  const s = S, text = s.ad.text();
  if (!text.trim()){ s.mem.status = 'Write something first.'; renderPanel(); return; }
  aiBusy = true; s.mem.status = ''; renderPanel(); renderWidget();
  try {
    const res = H.deepCheck
      ? await H.deepCheck(text, E.knownSpans(s.sugs))
      : await H.askJSON(E.deepPrompt(text.slice(0, 24000), E.knownSpans(s.sugs)));
    const issues = Array.isArray(res) ? res : (res && Array.isArray(res.issues) ? res.issues : []);
    if (!H.deepCheck && caps.engine) issues.forEach(i => { if (i && !i.engine) i.engine = caps.engine; });
    let mapped = E.mapIssues(issues, text);
    const now = s.ad.text();
    if (now !== text){ const d = E.diff(text, now); mapped = E.rebaseList(mapped, d, now.slice(d.pos, d.pos + d.ins), text).kept; }
    s.mem.ai = mapped;
    s.mem.tone = res && Array.isArray(res.tone) ? res.tone.filter(x => typeof x === 'string' && x.trim()).slice(0, 3) : [];
    s.mem.status = (mapped.length ? `Found ${mapped.length} more ${mapped.length === 1 ? 'issue' : 'issues'}.` : 'Nothing else to fix.') +
      (res && res.warning ? ` (${res.warning})` : '');
    s.text = now;
  } catch (e){ s.mem.status = errText(e); }
  finally {
    aiBusy = false;
    if (S === s) s.check(); else renderWidget();
  }
}
async function rewriteFlag(g){
  if (!S || !caps.rewrite || g.rewriting) return;
  const s = S, text = s.ad.text();
  const [a, b] = E.sentenceBounds(text, g.start, g.end), sentence = text.slice(a, b);
  g.rewriting = true;
  if (card.g === g) cardEl.innerHTML = cardHTML(g);
  renderPanel();
  try {
    const out = await H.askText(E.flagRewritePrompt(g, sentence), { fast:true, maxTokens:600 });
    const rep = E.cleanOut(out).replace(/^["“]|["”]$/g, '');
    const now = s.ad.text();
    if (now.slice(a, b) !== sentence){ s.mem.status = 'The text changed while Claude was rewriting. Try again.'; return; }
    if (!rep || rep === sentence){ s.mem.status = 'Claude kept the sentence as it was.'; return; }
    if (now !== s.text) s.check();
    if (g.source === 'rules') s.mem.dismissed.add(E.dkey(g)); else s.mem.ai = s.mem.ai.filter(x => x !== g);
    const ng = E.newAiSug({ cat:g.cat, mark:g.mark, title:'Suggested rewrite', why:`Rewritten to fix: ${g.title.toLowerCase()}.`, start:a, end:b, original:sentence, replacement:rep, engine:caps.engine });
    s.mem.ai.push(ng);
    s.check();
    if (S === s){ const found = s.sugs.find(x => x.id === ng.id); if (found){ if (panelOpen){ panelOpenId = found.id; renderPanel(); } else showCard(found, { pinned:true }); } }
  } catch (e){ s.mem.status = errText(e); toast(errText(e)); }
  finally {
    g.rewriting = false;
    if (card.g === g) cardEl.innerHTML = cardHTML(g);
    renderPanel();
  }
}
async function rewriteGoal(goal){
  if (!S || !caps.rewrite) return;
  const s = S, text = s.ad.text(), sel = s.ad.selection();
  let a = 0, b = text.length;
  if (sel && sel.end > sel.start){ a = sel.start; b = sel.end; }
  const seg = text.slice(a, b);
  if (!seg.trim()){ s.mem.status = 'Write something first.'; renderPanel(); return; }
  const job = { goal, a, b, seg, result:'', busy:true, note:'', scope:(a === 0 && b === text.length) ? 'Whole field' : 'Selection' };
  rwJob = job; renderPanel();
  try {
    const out = await H.askText(E.rewritePrompt(seg, goal), { fast:true, maxTokens:2048 });
    if (rwJob !== job) return;
    job.result = E.cleanOut(out);
    if (!job.result) job.note = 'Claude returned nothing. Try again.';
  } catch (e){ if (rwJob === job) job.note = errText(e); }
  finally { if (rwJob === job){ job.busy = false; renderPanel(); } }
}
function useRewrite(){
  const job = rwJob; if (!job || !job.result || !S) return;
  const t = S.ad.text(); let a = job.a, b = job.b;
  if (t.slice(a, b) !== job.seg){
    const at = t.indexOf(job.seg);
    if (at < 0){ job.note = 'The text changed since the rewrite started.'; renderPanel(); return; }
    a = at; b = at + job.seg.length;
  }
  rwJob = null;
  S.ad.replace(a, b, job.result);
  S.check();
  toast('Rewrite applied');
}

/* ---------- debug stream for the test page only ---------- */
function emitDebug(kind){
  if (!H.debug) return;
  let boxes = 0; if (S) for (const v of S.boxes.values()) boxes += v.length;
  window.dispatchEvent(new CustomEvent('proofmark:debug', { detail:{
    kind, field:S ? S.kind : null, label:S ? (S.el.getAttribute('aria-label') || S.el.id || '') : '', chars:S && S.text ? S.text.length : 0,
    sugs:S ? S.sugs.length : 0, boxes, checkMs:S ? S.checkMs : 0, measureMs:S ? S.measureMs : 0
  } }));
}

/* ---------- global listeners ---------- */
document.addEventListener('focusin', e => {
  const t = e.composedPath()[0];
  if (t === host) return;
  const el = editableRoot(t);
  if (el) start(el);
  else if (S && t !== S.el && !S.el.contains(t)){ S.focused = false; renderWidget(); }
}, true);
document.addEventListener('mousedown', e => {
  const t = e.composedPath()[0];
  if (t === host) return;
  if (S && (t === S.el || (t.nodeType === 1 && S.el.contains(t)))) return;
  hideCard(); closePanel();
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (card.g) hideCard();
  else if (panelOpen){ closePanel(); if (S) S.el.focus({ preventScroll:true }); }
}, true);
window.addEventListener('scroll', e => {
  if (!S) return;
  const t = e.target;
  requestLayout(t === S.el || (t && t.nodeType === 1 && S.el.contains(t)));
}, { capture:true, passive:true });
window.addEventListener('resize', () => requestLayout(true), { passive:true });

refreshAi();
Promise.resolve(H.getSettings()).then(s => {
  if (s) settings = { disabledSites:s.disabledSites || [], ignoredWords:s.ignoredWords || [], autoAi:s.autoAi !== false, cats:{ ...DEFAULTS.cats, ...(s.cats || {}) } };
  if (S) S.check();
}, () => {});
if (H.onSettings) H.onSettings(s => {
  if (s) settings = { disabledSites:s.disabledSites || [], ignoredWords:s.ignoredWords || [], autoAi:s.autoAi !== false, cats:{ ...DEFAULTS.cats, ...(s.cats || {}) } };
  refreshAi();
  if (S) S.check();
});
const already = editableRoot(deepActive());
if (already) start(already);
})();
