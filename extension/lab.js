/* Behaviour for the Proofmark test page: a working chat box, a search form, and the live readout. */
(() => {
  const $ = id => document.getElementById(id);
  const mailBody = $('mailBody');
  const mailStart = mailBody ? mailBody.innerHTML : '';

  const log = $('chatLog'), input = $('chatInput');
  function send(){
    const text = input.innerText.trim();
    if (!text) return;
    const li = document.createElement('li');
    li.className = 'bubble me'; li.textContent = text;
    log.appendChild(li); log.scrollTop = log.scrollHeight;
    input.innerHTML = '';
    input.focus();
  }
  if (input){
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); send(); } });
    $('chatSend').addEventListener('click', send);
  }
  const form = $('searchForm');
  if (form) form.addEventListener('submit', e => e.preventDefault());
  const reset = $('mailReset');
  if (reset) reset.addEventListener('click', () => { mailBody.innerHTML = mailStart; });

  const live = $('live'), liveText = $('liveText');
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  window.addEventListener('proofmark:debug', e => {
    const d = e.detail || {};
    if (d.kind === 'end' || !d.field){
      live.classList.remove('on'); liveText.textContent = 'Waiting for a field';
      ['rField', 'rChars', 'rSugs', 'rBoxes', 'rCheck', 'rMeasure'].forEach(id => set(id, '—'));
      return;
    }
    live.classList.add('on');
    liveText.textContent = d.label ? `Attached to “${d.label}”` : 'Attached';
    set('rField', d.field);
    set('rChars', String(d.chars));
    set('rSugs', String(d.sugs));
    set('rBoxes', String(d.boxes));
    set('rCheck', `${d.checkMs.toFixed(1)} ms`);
    set('rMeasure', `${d.measureMs.toFixed(1)} ms`);
  });
})();
