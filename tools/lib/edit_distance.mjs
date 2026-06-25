// Bounded edit distance for typo / near-match detection.
//
// Optimal String Alignment (restricted Damerau-Levenshtein): substitution,
// insertion, deletion, and adjacent transposition each cost 1. Transpositions
// matter because they are the single most common typing slip (machne ->
// machen), and plain Levenshtein scores them as 2.
//
// Zero-dependency by design: the Lexicon console must run straight after a git
// pull with no `npm install`, so we keep our own tiny implementation instead of
// pulling a package.

// Returns the OSA distance between `a` and `b`, capped: as soon as the best
// achievable distance exceeds `maxDistance`, it bails out and returns
// `maxDistance + 1`. Callers only care whether the distance is within budget,
// so the early exit keeps it cheap across the whole lexicon.
export function boundedEditDistance(a, b, maxDistance = 2) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxDistance) return maxDistance + 1;
  if (al === 0) return bl <= maxDistance ? bl : maxDistance + 1;
  if (bl === 0) return al <= maxDistance ? al : maxDistance + 1;

  // Three rolling rows: prevPrev (i-2) is needed for the transposition check.
  let prevPrev = new Array(bl + 1).fill(0);
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j += 1) prev[j] = j;

  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j] + 1; // deletion
      const ins = curr[j - 1] + 1; // insertion
      if (ins < v) v = ins;
      const sub = prev[j - 1] + cost; // substitution
      if (sub < v) v = sub;
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        const trans = prevPrev[j - 2] + 1; // adjacent transposition
        if (trans < v) v = trans;
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDistance) return maxDistance + 1; // can only grow from here
    const spare = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = spare;
  }
  const d = prev[bl];
  return d <= maxDistance ? d : maxDistance + 1;
}

// Is `candidate` a likely typo of `search` (or vice versa)? The edit budget
// scales with the shorter word: very short words are skipped (everything looks
// close), 4-7 chars tolerate one edit, 8+ tolerate two. Inputs are expected to
// be already normalized (lowercased, diacritics folded) by the caller.
export function isTypoNeighbor(candidate, search) {
  if (!candidate || !search || candidate === search) return false;
  const len = Math.min(candidate.length, search.length);
  if (len < 4) return false;
  const max = len >= 8 ? 2 : 1;
  return boundedEditDistance(candidate, search, max) <= max;
}
