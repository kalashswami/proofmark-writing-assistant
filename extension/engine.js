/* Proofmark engine: rules, spans, rebasing and prompts. Pure functions, no DOM.
   Shared by the editor, the browser extension's content script and the test page. */
(function (global) {
'use strict';
if (global.ProofmarkEngine) return;
/* ================= Engine: rules, spans and rebasing (no DOM) ================= */
const SAMPLE = `Hi Jordan,

I just wanted to follow up on the the proposal we discussed last week. Due to the fact that the deadline is coming up, i think we should make a decision soon. The budget was reviewed by the finance team, and their was a few concerns about the cost of the new enviroment.

However the team is very excited about the project. We could of started earlier, but alot of things came up. In order to stay on track, I recomend we meet on Thursday to finalize the plan.

Let me know what works for you!!

Best,
Sam`;

const CATS = {
  correctness: { label: 'Correctness', weight: 4 },
  clarity: { label: 'Clarity', weight: 2 },
  style: { label: 'Style', weight: 1.5 },
  tone: { label: 'Tone', weight: 1.5 },
};

const MISSPELL = {
  acheive:'achieve', accomodate:'accommodate', accross:'across', acknowlege:'acknowledge', adress:'address', adressed:'addressed',
  agressive:'aggressive', apparantly:'apparently', arguement:'argument', basicly:'basically', begining:'beginning', beleive:'believe',
  belive:'believe', buisness:'business', calender:'calendar', catagory:'category', cemetary:'cemetery', collegue:'colleague',
  comming:'coming', commited:'committed', comittee:'committee', comparision:'comparison', completly:'completely', concious:'conscious',
  confernce:'conference', convienient:'convenient', curiousity:'curiosity', decison:'decision', definately:'definitely', definatly:'definitely',
  developement:'development', diffrent:'different', dissapoint:'disappoint', embarass:'embarrass', enviroment:'environment',
  enviroments:'environments', enviromental:'environmental', excercise:'exercise', existance:'existence', experiance:'experience',
  familar:'familiar', febuary:'February', finaly:'finally', foriegn:'foreign', freind:'friend', freindly:'friendly', futher:'further',
  gaurd:'guard', goverment:'government', goverments:'governments', grammer:'grammar', guarentee:'guarantee', happend:'happened',
  harrass:'harass', hieght:'height', immediatly:'immediately', independant:'independent', intresting:'interesting', knowlege:'knowledge',
  lenght:'length', liason:'liaison', libary:'library', maintainance:'maintenance', managment:'management', manuever:'maneuver',
  mesage:'message', millenium:'millennium', mispell:'misspell', neccessary:'necessary', necessery:'necessary', noticable:'noticeable',
  occassion:'occasion', ocasion:'occasion', occured:'occurred', occurence:'occurrence', occuring:'occurring', oppurtunity:'opportunity',
  paralell:'parallel', peice:'piece', percieve:'perceive', persistant:'persistent', persue:'pursue', posession:'possession',
  posible:'possible', prefered:'preferred', preperation:'preparation', presense:'presence', priviledge:'privilege', probaly:'probably',
  publically:'publicly', questionaire:'questionnaire', realy:'really', recieve:'receive', recieved:'received', recieving:'receiving',
  recomend:'recommend', reccomend:'recommend', refered:'referred', refrence:'reference', relevent:'relevant', religous:'religious',
  remeber:'remember', responsability:'responsibility', resturant:'restaurant', rythm:'rhythm', schedual:'schedule', sentance:'sentence',
  seperate:'separate', sieze:'seize', similiar:'similar', sincerly:'sincerely', strenght:'strength', succesful:'successful',
  successfull:'successful', sucess:'success', supercede:'supersede', suprise:'surprise', tecnology:'technology', temperture:'temperature',
  tendancy:'tendency', therefor:'therefore', threshhold:'threshold', tommorow:'tomorrow', tomorow:'tomorrow', tounge:'tongue',
  truely:'truly', untill:'until', usally:'usually', vaccuum:'vacuum', wednsday:'Wednesday', wensday:'Wednesday', whereever:'wherever',
  wich:'which', wierd:'weird', writting:'writing', yeild:'yield', thier:'their', teh:'the', adn:'and', becuase:'because',
  beacuse:'because', dont:"don't", didnt:"didn't", doesnt:"doesn't", isnt:"isn't", wasnt:"wasn't", couldnt:"couldn't",
  shouldnt:"shouldn't", wouldnt:"wouldn't", youre:"you're", im:"I'm", ive:"I've"
};

function matchCase(orig, rep){
  if (!rep) return rep;
  if (orig.length > 1 && /[A-Z]/.test(orig) && orig === orig.toUpperCase()) return rep.toUpperCase();
  if (/^[A-Z]/.test(orig)) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
}
function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function phraseRe(p){ return new RegExp('\\b' + p.split(' ').map(reEsc).join('[ \\t]+') + '\\b', 'gi'); }
function scan(text, re, fn, out){
  re.lastIndex = 0; let m;
  while ((m = re.exec(text)) !== null){
    const r = fn(m); if (r) out.push(r);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const RULES = [];
const addRule = r => RULES.push(r);

addRule({ id:'spelling', cat:'correctness', mark:'sp', title:'Spelling',
  run: t => scan(t, /\b[A-Za-z]+\b/g, m => {
    const w = m[0], fix = MISSPELL[w.toLowerCase()]; if (!fix) return null;
    const rep = matchCase(w, fix);
    return { start:m.index, end:m.index + w.length, replacement:rep, why:`“${w}” is misspelled. The standard spelling is “${rep}”.` };
  }, []) });

addRule({ id:'repeat', cat:'correctness', mark:'del', title:'Repeated word',
  run: t => scan(t, /\b([A-Za-z]+)[ \t]+\1\b/gi, m => {
    if (/^(had|that|is)$/i.test(m[1])) return null;
    const s = m.index + m[1].length;
    return { start:s, end:m.index + m[0].length, replacement:'', why:`“${m[1]}” appears twice in a row.` };
  }, []) });

addRule({ id:'pronoun-i', cat:'correctness', mark:'cap', title:'Capitalize “I”',
  run: t => scan(t, /(^|[^A-Za-z0-9_'’.\-])i(?=['’](?:m|ve|ll|d)\b|[ \t\n,;:!?]|$)/g, m => {
    const s = m.index + m[1].length;
    return { start:s, end:s + 1, replacement:'I', why:'The pronoun “I” is always capitalized.' };
  }, []) });

const ABBR = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|jr|sr|approx|no|fig|inc|ltd|co|dept|est|a\.m|p\.m|u\.s)\.$/i;
addRule({ id:'sentence-cap', cat:'correctness', mark:'cap', title:'Capitalize the sentence',
  run: t => scan(t, /(^|[.!?]['"”’)]*[ \t]+|\n[ \t]*)([a-z])/g, m => {
    const s = m.index + m[0].length - 1;
    if (/[A-Z]/.test(t.charAt(s + 1))) return null;
    if (/[.!?]/.test(m[1])){
      const before = t.slice(0, m.index + m[1].replace(/\s+$/, '').length).replace(/['"”’)]+$/, '');
      if (ABBR.test(before)) return null;
    }
    return { start:s, end:s + 1, replacement:m[2].toUpperCase(), why:'Start each sentence with a capital letter.' };
  }, []) });

function wantsAn(word){
  if (word.length > 1 && word.length <= 4 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) return /^[AEFHILMNORSX]/.test(word);
  const w = word.toLowerCase();
  if (/^(hour|honest|honor|honour|heir)/.test(w)) return true;
  if (/^(uni(?![nm])|use|usu|usa|uti|uto|ure|uro|eu|ewe|one\b|once|ufo|ubiq|uk\b)/.test(w)) return false;
  return /^[aeiou]/.test(w);
}
addRule({ id:'a-an', cat:'correctness', mark:'ww', title:'Article',
  run: t => scan(t, /\b(a|an)[ \t]+([A-Za-z][\w'-]*)/gi, m => {
    const art = m[1], word = m[2];
    if (/^(or|and|of|in|is|as|at|to|on|if|vs)$/i.test(word)) return null;
    if (word.length === 1 && word !== word.toUpperCase()) return null;
    const need = wantsAn(word) ? 'an' : 'a';
    if (art.toLowerCase() === need) return null;
    return { start:m.index, end:m.index + art.length, replacement:matchCase(art, need), title:`Use “${need}”`,
      why: need === 'an' ? `Use “an” before a vowel sound, as in “an ${word}”.` : `Use “a” before a consonant sound, as in “a ${word}”.` };
  }, []) });

addRule({ id:'could-of', cat:'correctness', mark:'ww', title:'Use “have”',
  run: t => scan(t, /\b(could|should|would|must|might)[ \t]+of\b/gi, m => ({
    start:m.index, end:m.index + m[0].length, replacement:`${m[1]} have`,
    why:`“${m[1].toLowerCase()} of” is a mishearing of “${m[1].toLowerCase()}’ve”. Write “${m[1].toLowerCase()} have”.` }), []) });

const WORD_SWAPS = [
  { re:/\balot\b/gi, rep:'a lot', title:'Two words', why:'“A lot” is always two words.' },
  { re:/\birregardless\b/gi, rep:'regardless', title:'Nonstandard word', why:'“Irregardless” is nonstandard. Use “regardless”.' },
  { re:/\bcan[ \t]+not\b/gi, rep:'cannot', title:'One word', why:'“Cannot” is normally written as one word.' },
  { re:/\bfor[ \t]+all[ \t]+intensive[ \t]+purposes\b/gi, rep:'for all intents and purposes', title:'Wrong phrase', why:'The phrase is “for all intents and purposes”.' },
  { re:/\btheir(?=[ \t]+(?:is|was|are|were|will[ \t]+be|has[ \t]+been)\b)/gi, rep:'there', title:'Their or there', why:'“Their” shows ownership. Use “there” with “is”, “was” or “are”.' },
  { re:/\btheir(?=[ \t]+(?:going|coming|doing|not|being|already)\b)/gi, rep:"they're", title:'Their or they’re', why:'“Their” shows ownership. “They’re” means “they are”.' },
  { re:/\byour(?=[ \t]+welcome\b)/gi, rep:"you're", title:'Your or you’re', why:'“You’re welcome” uses “you’re”, short for “you are”.' },
  { re:/\bits(?=[ \t]+(?:a|an|the|been|not|going|time|important|clear|hard|easy|true|okay|possible|likely)\b)/gi, rep:"it's", title:'Its or it’s', why:'“It’s” means “it is”. “Its” shows ownership.' },
  { re:/\b(?:am|is|are|was|were)[ \t]+(suppose)(?=[ \t]+to\b)/gi, group:1, rep:'supposed', title:'Supposed to', why:'The phrase is “supposed to”.' },
  { re:/\b(?:more|less|better|worse|rather|larger|smaller|bigger|faster|slower|higher|lower|greater|fewer|easier|harder|other)[ \t]+(then)\b/gi, group:1, rep:'than', title:'Than or then', why:'Use “than” for comparisons. “Then” is about time.' },
];
addRule({ id:'word-swap', cat:'correctness', mark:'ww', title:'Wrong word',
  run: t => { const out = [];
    for (const w of WORD_SWAPS){
      scan(t, w.re, m => {
        const orig = w.group ? m[w.group] : m[0];
        const s = w.group ? m.index + m[0].lastIndexOf(orig) : m.index;
        return { start:s, end:s + orig.length, replacement:matchCase(orig, w.rep), title:w.title, why:w.why };
      }, out);
    }
    return out; } });

addRule({ id:'spacing', cat:'correctness', mark:'#', title:'Spacing',
  run: t => { const out = [];
    scan(t, /(\S)( {2,})(?=\S)/g, m => ({ start:m.index + 1, end:m.index + 1 + m[2].length, replacement:' ', title:'Extra space', why:'There are extra spaces between these words.' }), out);
    scan(t, /([A-Za-z0-9)])( +)([,.;:!?])(?![\w.])/g, m => ({ start:m.index + 1, end:m.index + 1 + m[2].length, replacement:'', title:'Space before punctuation', why:'Punctuation goes right after the word, with no space before it.' }), out);
    scan(t, /([a-z])([,;])([A-Za-z])/g, m => ({ start:m.index + 1, end:m.index + 2, replacement:m[2] + ' ', title:'Add a space', why:`Put a space after the ${m[2] === ',' ? 'comma' : 'semicolon'}.` }), out);
    return out; } });

addRule({ id:'punct-repeat', cat:'tone', mark:'del', title:'One is enough',
  run: t => { const out = [];
    scan(t, /([!?])\1+/g, m => ({ start:m.index, end:m.index + m[0].length, replacement:m[1],
      why: m[1] === '!' ? 'One exclamation point already reads as enthusiastic. More can come across as unprofessional.' : 'One question mark is enough.' }), out);
    scan(t, /,{2,}|(?<!\.)\.\.(?!\.)/g, m => ({ start:m.index, end:m.index + m[0].length, replacement:m[0][0], cat:'correctness', title:'Doubled punctuation', why:'This punctuation mark is doubled.' }), out);
    return out; } });

const INTRO = 'However|Therefore|Moreover|Furthermore|Additionally|Unfortunately|Fortunately|Meanwhile|Nevertheless|Consequently|Otherwise|Ideally|Honestly|Overall|In addition|For example|For instance|In fact|Of course|As a result|On the other hand|In conclusion|In short|In other words';
const INTRO_RE = new RegExp(`(^|[.!?]['"”’)]*[ \\t]+|\\n[ \\t]*)(${INTRO.replace(/ /g, '[ \\t]+')})(?=[ \\t]+[A-Za-z])`, 'g');
addRule({ id:'intro-comma', cat:'correctness', mark:'ins', title:'Add a comma',
  run: t => scan(t, INTRO_RE, m => {
    const s = m.index + m[1].length, w = m[2];
    return { start:s, end:s + w.length, replacement:w + ',', why:`An introductory “${w}” is usually followed by a comma.` };
  }, []) });

const WORDY = [
  ['in order to','to'],['due to the fact that','because'],['owing to the fact that','because'],['in spite of the fact that','although'],
  ['despite the fact that','although'],['at this point in time','now'],['at the present time','now'],['in the event that','if'],
  ['a large number of','many'],['the majority of','most'],['a majority of','most'],['is able to','can'],['are able to','can'],
  ['has the ability to','can'],['have the ability to','can'],['for the purpose of','for'],['with regard to','about'],
  ['with regards to','about'],['in regard to','about'],['make a decision','decide'],['made a decision','decided'],
  ['making a decision','deciding'],['give consideration to','consider'],['take into consideration','consider'],
  ['in the near future','soon'],['prior to','before'],['on a daily basis','daily'],['on a regular basis','regularly'],
  ['at all times','always'],['until such time as','until']
].map(([p, r]) => [phraseRe(p), r]);
addRule({ id:'wordy', cat:'clarity', mark:'wdy', title:'Wordy phrase',
  run: t => { const out = [];
    for (const [re, rep] of WORDY) scan(t, re, m => {
      const r = matchCase(m[0], rep);
      return { start:m.index, end:m.index + m[0].length, replacement:r, why:`“${r}” says the same thing in fewer words.` };
    }, out);
    return out; } });

const REDUNDANT = [
  ['each and every','every'],['basic fundamentals','fundamentals'],['end result','result'],['final outcome','outcome'],
  ['past history','history'],['free gift','gift'],['advance planning','planning'],['future plans','plans'],
  ['close proximity','proximity'],['very unique','unique'],['completely finished','finished'],['unexpected surprise','surprise'],
  ['revert back','revert'],['repeat again','repeat'],['join together','join'],['added bonus','bonus'],['true fact','fact'],
  ['new innovation','innovation']
].map(([p, r]) => [phraseRe(p), r]);
addRule({ id:'redundant', cat:'clarity', mark:'red', title:'Redundant',
  run: t => { const out = [];
    for (const [re, rep] of REDUNDANT) scan(t, re, m => {
      const r = matchCase(m[0], rep);
      return { start:m.index, end:m.index + m[0].length, replacement:r, why:`“${m[0]}” repeats itself. “${r}” is enough.` };
    }, out);
    return out; } });

const VERY = { good:'excellent', bad:'awful', big:'huge', small:'tiny', happy:'delighted', sad:'miserable', tired:'exhausted',
  important:'essential', hard:'challenging', difficult:'daunting', fast:'rapid', quick:'swift', interesting:'fascinating',
  sure:'certain', angry:'furious', scared:'terrified', excited:'thrilled', clear:'obvious', cold:'freezing', hot:'scorching',
  busy:'swamped', old:'ancient', smart:'brilliant', large:'enormous', nice:'lovely', worried:'anxious', often:'frequently',
  pretty:'gorgeous', beautiful:'stunning', bright:'dazzling', loud:'deafening', quiet:'silent', rich:'wealthy', funny:'hilarious',
  hungry:'starving', dirty:'filthy', clean:'spotless', strong:'powerful', weak:'feeble', boring:'tedious', wet:'soaked', dry:'parched' };
const VERY_RE = new RegExp(`\\b(very|really)[ \\t]+(${Object.keys(VERY).join('|')})\\b`, 'gi');
addRule({ id:'intensifier', cat:'style', mark:'wc', title:'Choose a stronger word',
  run: t => scan(t, VERY_RE, m => {
    const r = matchCase(m[0], VERY[m[2].toLowerCase()]);
    return { start:m.index, end:m.index + m[0].length, replacement:r,
      why:`One precise word like “${r.toLowerCase()}” lands harder than “${m[1].toLowerCase()} ${m[2].toLowerCase()}”.` };
  }, []) });

addRule({ id:'filler', cat:'clarity', mark:'del', title:'Filler word',
  run: t => scan(t, /[ \t](basically|actually|literally|totally|essentially)(?=[ \t])/gi, m => ({
    start:m.index, end:m.index + m[0].length, replacement:'', why:`“${m[1].toLowerCase()}” adds length without adding meaning here.` }), []) });

addRule({ id:'hedge', cat:'tone', mark:'tn', title:'Sound more confident',
  run: t => { const out = [];
    scan(t, /\bjust[ \t]+(?=(?:wanted|want|checking|following|wondering|thought|checked)\b)/gi, m => ({
      start:m.index, end:m.index + m[0].length, replacement:'', why:'“Just” can make a message sound apologetic. Without it the request reads as direct.' }), out);
    scan(t, /\b[Ii][ \t]+think[ \t]+(?=(?:we|you|it|this|that|the|our|they|there)\b)/g, m => ({
      start:m.index, end:m.index + m[0].length, replacement:'', title:'Hedging', why:'Dropping “I think” makes the recommendation sound surer of itself.' }), out);
    scan(t, /\bsorry[ \t]+to[ \t]+bother[ \t]+you(?:,?[ \t]+but)?,?[ \t]*/gi, m => ({
      start:m.index, end:m.index + m[0].length, replacement:'', title:'Skip the apology', why:'You don’t need to apologize for writing. Get straight to the point.' }), out);
    return out; } });

const IRREG = 'known|written|given|taken|made|done|seen|thrown|built|sent|found|held|kept|told|shown|chosen|broken|spoken|driven|eaten|forgotten|hidden|stolen|paid|sold|bought|brought|caught|taught|lost|led|won|begun|drawn|grown|worn|torn|frozen|spent|understood|forgiven|beaten|bitten|ridden|shaken|swept|woven';
const PASSIVE_RE = new RegExp(`\\b(?:am|is|are|was|were|be|been|being)[ \\t]+(?:(?:not|never|already|also|often|always|just|then|recently|being|been)[ \\t]+)?(?:[a-z]+ed[ \\t]+by\\b|(?:${IRREG})\\b(?:[ \\t]+by\\b)?)`, 'gi');
/* Whole stretches typed in capitals read as shouting. Converted to sentence case, keeping "I" and common acronyms. */
const ACRONYMS = new Set(['OK','USB','API','PDF','CEO','CTO','CFO','HR','QA','UI','UX','USA','UK','EU','ASAP','FYI','ETA','EOD','TBD','FAQ','NDA',
  'ID','PC','TV','AI','GPU','CPU','URL','LED','NYC','EMG','PM','AM','IT']);
const AMBIGUOUS = new Set(['IT','AM','PM']);   // also ordinary words; kept only when the person clearly means the acronym
function sentenceCase(run, atStart){
  let capNext = atStart;
  return run.replace(/[A-Za-z0-9'’]+|[^A-Za-z0-9'’]+/g, tok => {
    if (!/[A-Za-z0-9]/.test(tok)){ if (/[.!?]/.test(tok)) capNext = true; return tok; }
    let w;
    if (/\d/.test(tok) || (ACRONYMS.has(tok) && !AMBIGUOUS.has(tok))) w = tok;
    else if (/^I(['’][A-Z]+)?$/.test(tok)) w = 'I' + tok.slice(1).toLowerCase();
    else w = tok.toLowerCase();
    if (capNext) w = w.charAt(0).toUpperCase() + w.slice(1);
    capNext = false;
    return w;
  });
}
const CAPS_RUN = /(?<![A-Za-z0-9'’])[A-Z][A-Z0-9'’]*(?:[ \t,;:.!?"“”()\-]+[A-Z][A-Z0-9'’]*){3,}(?![A-Za-z0-9])/g;
addRule({ id:'all-caps', cat:'tone', mark:'cap', title:'All caps',
  run: t => scan(t, CAPS_RUN, m => {
    if ((m[0].match(/[A-Z]/g) || []).length < 12) return null;
    const before = t.slice(0, m.index).replace(/[ \t"“(]+$/, '');
    const rep = sentenceCase(m[0], before === '' || /[.!?\n]$/.test(before));
    return { start:m.index, end:m.index + m[0].length, replacement:rep,
      why:'Text in all capitals reads as shouting and is harder to read. Use normal capitalization.' };
  }, []) });

/* A sentence that opens like a question ("Can you …") should end with a question mark */
const Q_START = /^(?:(?:hey|hi|hello)\b[ \t,]*(?:[A-Z][a-z]+[ \t,]+)?)?(?:can|could|would|will|do|does|did|is|are|was|were|have|has|should|shall|may)[ \t]+(?:you|we|i|they|he|she|it|there|this|that|someone|anyone)\b/i;
addRule({ id:'question-mark', cat:'correctness', mark:'ins', title:'Add a question mark',
  run: t => scan(t, /[^.!?\n]+([.!?]|(?=\n)|$)/g, m => {
    if (m[1] === '?' || m[1] === '!') return null;
    const lead = m[0].match(/^\s*/)[0].length, body = m[0].slice(lead);
    if (!Q_START.test(body)) return null;
    if (m[1] === '.') { const p = m.index + m[0].length - 1; return { start:p, end:p + 1, replacement:'?', why:'This sentence asks a question, so it ends with a question mark.' }; }
    const w = body.match(/([A-Za-z0-9'’]+)\s*$/); if (!w) return null;
    const end = m.index + m[0].replace(/\s+$/, '').length;
    if (/^[A-Z]/.test(m[0].slice(lead)) && t.slice(end).trim() === '' && (body.match(/\S+/g) || []).length < 4) return null;
    return { start:end - w[1].length, end, replacement:w[1] + '?', why:'This sentence asks a question, so it ends with a question mark.' };
  }, []) });

/* "Hey can you …" → "Hey, can you …" */
addRule({ id:'greeting-comma', cat:'correctness', mark:'ins', title:'Add a comma',
  run: t => scan(t, /(^|\n[ \t]*)(hey|hi|hello)(?=[ \t]+(?:can|could|would|will|do|did|is|are|just|quick|so|i|we|hope|thanks|thank)\b)/gi, m => {
    const s = m.index + m[1].length;
    return { start:s, end:s + m[2].length, replacement:m[2] + ',', why:`Put a comma after “${m[2]}” when it opens a message.` };
  }, []) });

addRule({ id:'passive', cat:'clarity', mark:'pass', title:'Passive voice',
  run: t => scan(t, PASSIVE_RE, m => ({ start:m.index, end:m.index + m[0].length, replacement:null,
    why:'Passive voice can hide who did what. Try leading with the person or thing doing the action.' }), []) });

addRule({ id:'long-sentence', cat:'clarity', mark:'lng', title:'Long sentence',
  run: t => scan(t, /[^.!?\n]+[.!?]*/g, m => {
    const words = m[0].match(/[A-Za-z0-9’'-]+/g) || [];
    if (words.length <= 32) return null;
    const lead = m[0].match(/^\s*/)[0].length;
    return { start:m.index + lead, end:m.index + m[0].length, replacement:null,
      why:`This sentence runs ${words.length} words. Splitting it in two makes it easier to follow.` };
  }, []) });

function dkey(g){ return `${g.rule}|${g.original.toLowerCase()}|${g.replacement}`; }

function runEngine(text, dismissed){
  const out = [], seen = new Set();
  for (const r of RULES){
    let found = [];
    try { found = r.run(text); } catch (e) { console.error(r.id, e); }
    for (const f of found){
      if (f.end < f.start) continue;
      const original = text.slice(f.start, f.end);
      const replacement = f.replacement === undefined ? null : f.replacement;
      if (replacement !== null && replacement === original) continue;
      const g = { id:`${r.id}:${f.start}:${f.end}`, source:'rules', rule:r.id, cat:f.cat || r.cat, mark:f.mark || r.mark,
        title:f.title || r.title, why:f.why || '', start:f.start, end:f.end, original, replacement };
      const k = `${g.start}:${g.end}:${replacement}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (dismissed && dismissed.has(dkey(g))) continue;
      out.push(g);
    }
  }
  // While a stretch is in all caps, smaller fixes inside it wait: they come back, correctly cased, once it's fixed
  const caps = out.filter(g => g.rule === 'all-caps');
  const kept = caps.length ? out.filter(g => g.rule === 'all-caps' || !caps.some(c => g.start >= c.start && g.end <= c.end)) : out;
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}

/* One-span diff: what changed between two versions of the text */
function diff(a, b){
  const max = Math.min(a.length, b.length);
  let p = 0; while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0; while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { pos:p, del:a.length - p - s, ins:b.length - p - s };
}
/* Shift spans past the edit, drop spans the edit touched */
function rebaseList(list, d, inserted, prevText){
  const kept = []; let dropped = 0;
  const editEnd = d.pos + d.del, delta = d.ins - d.del;
  const wordIns = /\w/.test(inserted);
  for (const g of list){
    const overlaps = d.pos < g.end && editEnd > g.start;
    const adjacent = d.del === 0 && d.ins > 0 && wordIns && (d.pos === g.end || d.pos === g.start) && /\w/.test(prevText.slice(g.start, g.end));
    if (overlaps || adjacent){ dropped++; continue; }
    if (g.start >= editEnd && delta !== 0) kept.push({ ...g, start:g.start + delta, end:g.end + delta });
    else kept.push(g);
  }
  return { kept, dropped };
}

function syllables(word){
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
function textStats(text){
  const words = (text.match(/[A-Za-z0-9’'-]+/g) || []).filter(w => /[A-Za-z0-9]/.test(w));
  const wc = words.length;
  const sentences = Math.max(1, (text.match(/[^.!?\n]+[.!?]*/g) || []).filter(s => /[A-Za-z0-9]/.test(s)).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const fre = wc ? 206.835 - 1.015 * (wc / sentences) - 84.6 * (syl / wc) : null;
  return { words:wc, sentences, fre, minutes:wc / 238 };
}
function scoreFor(sugs, wc){
  if (!wc) return null;
  let w = 0; for (const g of sugs) w += CATS[g.cat].weight;
  return Math.max(0, Math.min(100, Math.round(100 - (w / Math.max(wc, 40)) * 100)));
}
function editTag(g){
  if (g.replacement === null) return '$KEEP (flag only)';
  if (g.replacement === '') return '$DELETE';
  if (g.original && g.replacement.startsWith(g.original)) return '$APPEND_' + g.replacement.slice(g.original.length);
  if (g.original && g.original.toLowerCase() === g.replacement.toLowerCase()) return '$TRANSFORM_CASE_CAPITAL';
  return '$REPLACE_' + g.replacement;
}

/* ---------- Claude helpers: prompts and mapping answers back onto spans ---------- */
const AI_MARK = { correctness:'gr', clarity:'awk', style:'wc', tone:'tn' };
let aiSeq = 0;
function trunc(s, n = 60){ return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function clip(s, n){ return typeof s === 'string' ? trunc(s.trim(), n) : ''; }
function cleanOut(s){ return String(s || '').replace(/^\s*<(?:text|draft)>\s*/i, '').replace(/\s*<\/(?:text|draft)>\s*$/i, '').trim(); }
function parseJSONLoose(t){
  const s = String(t || '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence){ try { return JSON.parse(fence[1]); } catch (_) {} }
  const a = s.search(/[[{]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a >= 0 && b > a){ try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
  throw new Error('Claude’s reply came back in a form Proofmark couldn’t read. Try again.');
}
function deepPrompt(text, known){
  return `You are a careful copy editor. Review the draft between the <draft> tags and list the problems a good editor would fix: grammar and agreement, spelling, punctuation, wrong or confused words, unclear or wordy phrasing, weak word choice, and tone that works against the writer. Flag only real problems and leave correct text alone. Respect the writer's voice.
When a sentence is confusing, repeats itself or runs two thoughts together, quote the whole sentence and give a clear, simpler version as the replacement (category "clarity", title "Simplify the sentence"). Prefer giving a replacement over null.

These spans are already flagged by another checker, so do not repeat them: ${known.length ? known.map(k => JSON.stringify(k)).join(', ') : 'none'}.

Reply with only a JSON object in this shape:
{"tone": ["up to 3 single-word labels for how the draft sounds"], "issues": [{"quote": "exact text copied character for character from the draft, as short as possible", "before": "the 20 or so characters that come right before quote in the draft", "replacement": "corrected text that replaces quote; an empty string to delete it; null if it needs a broader rewrite", "category": "correctness | clarity | style | tone", "title": "a 2 to 5 word label", "why": "one plain sentence explaining the problem"}]}
List at most 20 issues, in the order they appear.

<draft>
${text}
</draft>`;
}
function locate(text, quote, before, taken){
  const hits = []; let i = text.indexOf(quote);
  while (i !== -1){ hits.push(i); i = text.indexOf(quote, i + 1); }
  if (!hits.length) return -1;
  const free = hits.filter(h => !taken.some(([a, b]) => h < b && h + quote.length > a));
  const pool = free.length ? free : hits;
  if (before){
    const exact = pool.find(h => text.slice(Math.max(0, h - before.length), h) === before);
    if (exact !== undefined) return exact;
    const tail = before.trim().slice(-12);
    if (tail){ const loose = pool.find(h => text.slice(0, h).trimEnd().endsWith(tail)); if (loose !== undefined) return loose; }
  }
  return pool[0];
}
function mapIssues(issues, text){
  const out = [], taken = [];
  for (const it of (Array.isArray(issues) ? issues : []).slice(0, 30)){
    if (!it || typeof it.quote !== 'string' || !it.quote) continue;
    const q = it.quote;
    const pos = locate(text, q, typeof it.before === 'string' ? it.before : '', taken);
    if (pos < 0) continue;
    let rep = it.replacement;
    if (rep !== null && typeof rep !== 'string') rep = null;
    if (rep === q) continue;
    if (taken.some(([a, b]) => a === pos && b === pos + q.length)) continue;
    const c = String(it.category || '').toLowerCase().trim();
    const cat = CATS[c] ? c : 'clarity';
    out.push({ id:'ai-' + (++aiSeq), source:'claude', rule:'claude', cat, mark:AI_MARK[cat], title:clip(it.title, 48) || CATS[cat].label,
      why:clip(it.why, 320), start:pos, end:pos + q.length, original:q, replacement:rep, engine:clip(it.engine, 24) || null });
    taken.push([pos, pos + q.length]);
  }
  return out.sort((a, b) => a.start - b.start);
}
function newAiSug(fields){ return { id:'ai-' + (++aiSeq), source:'claude', rule:'claude', ...fields }; }
function sentenceBounds(t, s, e){
  let a = s;
  while (a > 0){
    const c = t[a - 1];
    if (c === '\n') break;
    if (/[.!?]/.test(c) && /\s/.test(t[a] || '')) break;
    a--;
  }
  while (a < s && /\s/.test(t[a])) a++;
  let b = Math.max(e, a);
  if (!(b > 0 && /[.!?]/.test(t[b - 1]))){
    while (b < t.length){
      const c = t[b];
      if (c === '\n') break;
      b++;
      if (/[.!?]/.test(c) && (b >= t.length || /[\s'"”’)]/.test(t[b]))){
        while (b < t.length && /['"”’)]/.test(t[b])) b++;
        break;
      }
    }
  }
  return [a, b];
}
const GOALS = {
  concise:{ label:'Concise', ask:'shorter and more concise, cutting filler and repetition' },
  formal:{ label:'Formal', ask:'more formal and professional' },
  friendly:{ label:'Friendly', ask:'warmer and friendlier while staying professional' },
  confident:{ label:'Confident', ask:'more confident and direct, removing hedges and apologies' }
};
function rewritePrompt(seg, goal){
  return `Rewrite the text below so it is ${GOALS[goal].ask}. Keep the meaning, names, numbers and the original language. Keep paragraph breaks where they make sense. Reply with only the rewritten text: no preface, quotes or notes.\n\n<text>\n${seg}\n</text>`;
}
function flagRewritePrompt(g, sentence){
  return `Rewrite the sentence below to fix this problem: ${g.title}. ${g.why}\nKeep the meaning, names and numbers, and keep it in the same language. Reply with only the rewritten sentence.\n\nSentence: ${sentence}`;
}
function knownSpans(sugs){ return sugs.filter(g => g.source === 'rules').slice(0, 40).map(g => g.original.trim()).filter(Boolean); }

global.ProofmarkEngine = Object.freeze({
  SAMPLE, CATS, RULES, runEngine, diff, rebaseList, dkey, editTag, textStats, scoreFor,
  trunc, cleanOut, parseJSONLoose, deepPrompt, mapIssues, newAiSug, sentenceBounds, GOALS, rewritePrompt, flagRewritePrompt, knownSpans
});
})(typeof window !== 'undefined' ? window : globalThis);
