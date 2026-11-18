/* Proofmark spelling: a full English word list (Hunspell en_US, every word form, ordered from most to least common)
   and a suggester that tries one-edit and then two-edit corrections, preferring common words.
   Runs in the background service worker, so pages never load the 1.6 MB list. */
(function (global){
  const ABC = 'abcdefghijklmnopqrstuvwxyz';
  // Neighbouring keys on a QWERTY keyboard: a typo that hits the key next door is the likeliest substitution
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const NEAR = {};
  ROWS.forEach((row, r) => [...row].forEach((ch, c) => {
    NEAR[ch] = new Set();
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++){
      const rr = ROWS[r + dr]; if (rr && rr[c + dc] && (dr || dc)) NEAR[ch].add(rr[c + dc]);
    }
  }));

  function create(listText){
    const rank = new Map();
    listText.split('\n').forEach((w, i) => { if (w) rank.set(w, i); });
    const known = w => rank.has(w);

    function edits1(w){
      const out = [];
      for (let i = 0; i <= w.length; i++){
        const a = w.slice(0, i), b = w.slice(i);
        if (b) out.push({ w:a + b.slice(1), kind:'del' });
        if (b.length > 1) out.push({ w:a + b[1] + b[0] + b.slice(2), kind:'swap' });
        for (const c of ABC){
          if (b) out.push({ w:a + c + b.slice(1), kind:NEAR[b[0]] && NEAR[b[0]].has(c) ? 'near' : 'sub' });
          out.push({ w:a + c + b, kind:'ins' });
        }
        if (i > 0 && i < w.length){
          out.push({ w:a + "'" + b, kind:'apos' });            // dont -> don't
          out.push({ w:a + ' ' + b, kind:'split' });           // alot -> a lot
        }
      }
      return out;
    }
    // Lower is better: how common the word is, nudged by how natural the typo is
    const COST = { apos:0.2, swap:0.35, near:0.5, ins:0.6, del:0.7, split:0.8, sub:1 };
    function isKnown(c){
      if (!c.includes(' ')) return known(c);
      const [x, y] = c.split(' ');            // both halves must be everyday words
      return known(x) && known(y) && rank.get(x) < 3000 && rank.get(y) < 3000 && (x.length > 1 || x === 'a' || x === 'i');
    }
    function rankOf(c){ return c.includes(' ') ? Math.max(...c.split(' ').map(x => rank.get(x))) : rank.get(c); }
    function score(cand, kind, original){
      let s = Math.log(rankOf(cand) + 50) + COST[kind] * 1.6;
      if (cand[0] !== original[0] && kind !== 'swap') s += 1.2;   // people rarely mistype the first letter
      if (kind === 'apos') s -= 4.5;                                 // a missing apostrophe is by far the likeliest slip
      return s;
    }
    function suggest(word){
      const w = word.toLowerCase().replace(/’/g, "'");
      if (w.length < 2 || known(w)) return undefined;   // undefined: spelled fine
      let best = null, bestS = Infinity;
      const seen = new Set();
      const e1 = edits1(w);
      for (const { w:c, kind } of e1){
        if (seen.has(c) || !isKnown(c)) continue; seen.add(c);
        const s = score(c, kind, w); if (s < bestS){ bestS = s; best = c; }
      }
      if (!best && w.length >= 4 && w.length <= 16){
        for (const { w:m, kind:k1 } of e1){
          if (k1 === 'apos' || k1 === 'split') continue;
          for (const { w:c, kind:k2 } of edits1(m)){
            if (k2 === 'split') continue;
            if (seen.has(c) || !known(c)) continue; seen.add(c);
            const s = score(c, k1, w) + COST[k2] * 1.6 + 1.5; if (s < bestS){ bestS = s; best = c; }
          }
        }
      }
      if (best && (best === 'i' || best.startsWith("i'"))) best = 'I' + best.slice(1);
      return best;   // null: not a word, and nothing close enough to suggest
    }
    function check(words){
      const out = {};
      for (const word of words){
        const key = String(word);
        let w = key.toLowerCase().replace(/’/g, "'");
        // possessives and contractions the list doesn't spell out
        if (!known(w) && /'s$/.test(w) && known(w.slice(0, -2))) { out[key] = undefined; continue; }
        if (!known(w) && /s'$/.test(w) && known(w.slice(0, -1))) { out[key] = undefined; continue; }
        const s = suggest(w);
        if (s !== undefined) out[key] = s;
      }
      return out;
    }
    return { known, suggest, check, size:rank.size };
  }
  global.ProofmarkSpell = { create };
})(typeof self !== 'undefined' ? self : globalThis);
