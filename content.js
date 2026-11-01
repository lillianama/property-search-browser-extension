(() => {
  let generation = 0, timer, scheduledAt = Infinity, route = location.href, pending = null, saved = '', statusNode;
  function showStatus(message, state = 'working') {
    if (!document.body) return;
    if (!statusNode) {
      statusNode = document.createElement('div');
      statusNode.setAttribute('role', 'status');
      Object.assign(statusNode.style, {position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#173d2b',color:'white',padding:'8px 12px',borderRadius:'6px',font:'13px sans-serif',maxWidth:'300px'});
      document.body.appendChild(statusNode);
    }
    const text = `Property tracker: ${message}`;
    statusNode.style.background = state === 'success' ? '#173d2b' : state === 'warning' ? '#713f12' : '#273449';
    if (statusNode.textContent !== text) statusNode.textContent = text;
  }
  function clearStatus() { if (statusNode) { statusNode.remove(); statusNode = null; } }
  const fingerprint = o => JSON.stringify([o.zpid, o.price, o.status]);
  function schedule(delay = 800) {
    const due = Date.now() + delay;
    if (timer && scheduledAt <= due) return;
    clearTimeout(timer); scheduledAt = due;
    timer = setTimeout(() => { timer = null; scheduledAt = Infinity; capture(); }, delay);
  }
  function routeChanged() {
    if (route !== location.href) {
      route = location.href; generation++; pending = null; saved = ''; clearStatus();
      if (ZillowExtract.identity(route)) showStatus('Zillow listing detected. Reading details…');
      schedule();
    }
  }
  function extract(start) {
    return ZillowExtract.collect(document, start, getComputedStyle);
  }
  async function capture() {
    routeChanged();
    const start = location.href, id = ZillowExtract.identity(start), turn = generation;
    if (!id) return;
    const observation = extract(start);
    if (location.href !== start || turn !== generation) return;
    if (!observation) { showStatus('Listing details could not be read.', 'warning'); return; }
    const key = fingerprint(observation);
    if (key === saved) return;
    if (!pending || pending.key !== key) pending = {key, observation: {...observation, captureId: crypto.randomUUID()}, attempts: 0, inFlight: false};
    const current = pending;
    if (current.inFlight) return;
    if (current.retryAt && current.retryAt > Date.now()) { schedule(current.retryAt - Date.now()); return; }
    current.inFlight = true;
    showStatus('Checking price and status against your data…');
    let result;
    try { result = await chrome.runtime.sendMessage({type:'observe', observation:current.observation}); } catch { /* retry below */ }
    current.inFlight = false;
    if (location.href !== start || turn !== generation || pending !== current) return;
    const displayed = extract(start);
    if (location.href !== start || !displayed || fingerprint(displayed) !== key) { pending = null; schedule(); return; }
    if (result?.ok === true && Array.isArray(result.changedFields) && result.changedFields.every(x => x === 'price' || x === 'status')) {
      saved = key; pending = null;
      showStatus(result.changedFields.length ? `Captured: ${[...new Set(result.changedFields)].join(', ')}.` : 'Price and status are up to date.', 'success');
    } else {
      const messages = {settings:'Check extension settings and site permission.', authorization:'Dashboard authorization failed; check extension settings.', network:'Dashboard unavailable; retrying.', 'not-tracked':'This listing is not tracked.'};
      showStatus(messages[result?.reason] || 'Could not save listing; retrying.', 'warning');
      current.attempts++;
      const delay = Math.min(60000, 1000 * 2 ** Math.min(current.attempts, 6));
      current.retryAt = Date.now() + delay; schedule(delay);
    }
  }
  new MutationObserver(records => {
    if (records.length && records.every(record => statusNode && (record.target === statusNode || statusNode.contains(record.target)))) return;
    routeChanged(); schedule();
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  setInterval(routeChanged,500);
  if (ZillowExtract.identity(route)) showStatus('Zillow listing detected. Reading details…');
  schedule();
})();
