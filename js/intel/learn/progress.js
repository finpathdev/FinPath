// fp_lessons used to be { "0": timestamp } — the array index. Reordering
// lessons would attach a completion to the wrong lesson. Version 1 stores
// { _v: 1, "<slug>": timestamp } and keeps the original time.

export function lessonProgressMap(raw, ids){
  const progress = {};
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return { progress: progress, rewrite: false };
  let sawIndex = false;
  Object.keys(raw).forEach(function(k){
    if(k === '_v') return;
    const n = Number(k);
    const indexKey = String(n) === String(k) && n >= 0 && n < ids.length && Number.isInteger(n);
    const ts = Number(raw[k]);
    if(!isFinite(ts)) return;
    if(indexKey && ids[n]){
      sawIndex = true;
      const id = ids[n];
      if(!progress[id] || ts > progress[id]) progress[id] = ts;
    } else if(!indexKey){
      if(!progress[k] || ts > progress[k]) progress[k] = ts;
    }
  });
  const rewrite = sawIndex || raw._v !== 1;
  return { progress: progress, rewrite: rewrite };
}

export function lessonStoreFromProgress(progress){
  const store = { _v: 1 };
  Object.keys(progress).forEach(function(k){
    if(k === '_v') return;
    store[k] = progress[k];
  });
  return store;
}
