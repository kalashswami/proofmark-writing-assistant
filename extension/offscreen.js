/* Runs Chrome's built-in model (Gemini Nano) for the background service worker.
   The model runs on this device; nothing is sent to a server. */
const LANG = { expectedInputs:[{ type:'text', languages:['en'] }], expectedOutputs:[{ type:'text', languages:['en'] }] };
const DEEP_SCHEMA = {
  type:'object',
  properties:{
    tone:{ type:'array', items:{ type:'string' } },
    issues:{ type:'array', items:{ type:'object', properties:{
      quote:{ type:'string' }, before:{ type:'string' }, replacement:{ type:'string' },
      category:{ type:'string', enum:['correctness', 'clarity', 'style', 'tone'] },
      title:{ type:'string' }, why:{ type:'string' }
    }, required:['quote', 'replacement', 'category', 'title', 'why'] } }
  },
  required:['issues']
};

async function run(prompt, json){
  if (typeof LanguageModel === 'undefined') throw new Error('This version of Chrome doesn’t have built-in AI. Update Chrome, or pick another engine in Proofmark settings.');
  const state = await LanguageModel.availability(LANG);
  if (state === 'unavailable') throw new Error('Chrome’s built-in AI isn’t supported on this computer. It needs about 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM.');
  if (state !== 'available') throw new Error('Chrome’s on-device model isn’t downloaded yet. Open Proofmark settings and click “Download the model”.');
  const session = await LanguageModel.create(LANG);
  try {
    return await session.prompt(prompt, json ? { responseConstraint:DEEP_SCHEMA } : undefined);
  } finally { session.destroy(); }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'prompt') return;
  run(msg.prompt, msg.json).then(text => sendResponse({ ok:true, text }), e => sendResponse({ ok:false, error:String(e && e.message || e) }));
  return true;
});
