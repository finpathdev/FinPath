// Pure helpers for optional Life Path sync. localStorage stays the source of
// truth. Callers push or pull only when a signed-in client exists.

const KINDS = { trade: 1, simulation: 1, goal: 1, learning: 1, reflection: 1 };

export function timeMs(value){
  if(typeof value === 'number' && isFinite(value)) return value;
  const n = Date.parse(value);
  return isFinite(n) ? n : 0;
}

function cleanInputs(inputs){
  if(!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return null;
  return inputs;
}

// local / remote: { inputs, dollars, comparePreset, updatedAt, touched }
// Remote wins only when it is strictly newer. An untouched local default
// never overwrites a saved cloud path. An empty cloud never wipes local notes
// or a path the learner already edited.
export function choosePath(local, remote){
  const localInputs = local ? cleanInputs(local.inputs) : null;
  const remoteInputs = remote ? cleanInputs(remote.inputs) : null;
  const localAt = local ? timeMs(local.updatedAt) : 0;
  const remoteAt = remote ? timeMs(remote.updatedAt) : 0;
  const localOk = !!(local && local.touched && localInputs && localAt > 0);
  const remoteOk = !!(remote && remoteInputs && remoteAt > 0);
  if(!localOk && !remoteOk) return { source: 'none', push: false, record: null };
  if(!localOk && remoteOk){
    return { source: 'remote', push: false, record: pack(remoteInputs, remote, remoteAt) };
  }
  if(localOk && !remoteOk){
    return { source: 'local', push: true, record: pack(localInputs, local, localAt) };
  }
  if(remoteAt > localAt){
    return { source: 'remote', push: false, record: pack(remoteInputs, remote, remoteAt) };
  }
  return { source: 'local', push: true, record: pack(localInputs, local, localAt) };
}

function pack(inputs, src, at){
  return {
    inputs: inputs,
    dollars: src.dollars === 'future' ? 'future' : 'today',
    comparePreset: String(src.comparePreset || 'wait25').slice(0, 40),
    updatedAt: at,
    touched: true
  };
}

function kindOf(k){
  return KINDS[k] ? k : 'reflection';
}

export function normalizeJournalEntry(entry){
  if(!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || entry.entry_id || '').trim();
  if(!id) return null;
  const concepts = Array.isArray(entry.conceptIds) ? entry.conceptIds : (Array.isArray(entry.concept_ids) ? entry.concept_ids : []);
  return {
    id: id.slice(0, 80),
    kind: kindOf(entry.kind),
    title: String(entry.title || '').slice(0, 140),
    why: String(entry.why || '').slice(0, 280),
    conceptIds: concepts.map(function(c){ return String(c); }).filter(Boolean).slice(0, 8),
    at: Math.max(0, Math.round(timeMs(entry.at) || Number(entry.at) || 0)),
    ref: entry.ref ? String(entry.ref).slice(0, 40) : ''
  };
}

// Union by id. The later `at` wins. A tie keeps the entry already stored,
// which is the local one when locals are applied first. Empty remote does
// not drop local notes.
export function mergeJournalEntries(local, remote){
  const map = new Map();
  function take(entry, replaceTie){
    const next = normalizeJournalEntry(entry);
    if(!next) return;
    const prev = map.get(next.id);
    if(!prev){
      map.set(next.id, next);
      return;
    }
    if(next.at > prev.at || (replaceTie && next.at === prev.at)) map.set(next.id, next);
  }
  (Array.isArray(local) ? local : []).forEach(function(e){ take(e, false); });
  (Array.isArray(remote) ? remote : []).forEach(function(e){ take(e, false); });
  return Array.from(map.values()).sort(function(a, b){ return (b.at || 0) - (a.at || 0); }).slice(0, 300);
}

export function journalRow(userId, entry){
  const next = normalizeJournalEntry(entry);
  if(!next || !userId) return null;
  return {
    user_id: userId,
    entry_id: next.id,
    kind: next.kind,
    title: next.title,
    why: next.why,
    concept_ids: next.conceptIds,
    at: next.at,
    ref: next.ref
  };
}

export function entryFromRow(row){
  if(!row || typeof row !== 'object') return null;
  return normalizeJournalEntry({
    id: row.entry_id,
    kind: row.kind,
    title: row.title,
    why: row.why,
    conceptIds: row.concept_ids,
    at: row.at,
    ref: row.ref
  });
}
