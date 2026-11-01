(() => {
  let generation = 0, timer, scheduledAt = Infinity, route = location.href, pending = null, saved = '', statusNode;
  function showStatus(message, state = 'working') {
    if (!document.body) return;
    if (!statusNode) {
      statusNode = document.createElement('div');
      statusNode.setAttribute('role', 'status');
      statusNode.setAttribute('data-nova-nest', '');
      Object.assign(statusNode.style, {position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#173d2b',color:'white',padding:'10px 12px 10px 48px',borderRadius:'20px',font:'13px sans-serif',maxWidth:'300px',boxShadow:'0 3px 14px #2e164a66',backgroundRepeat:'no-repeat',backgroundPosition:'10px center',backgroundSize:'30px 30px'});
      if (chrome.runtime.getURL) statusNode.style.backgroundImage = `url("${chrome.runtime.getURL('icons/nova-32.png')}")`;
      document.body.appendChild(statusNode);
    }
    const version = chrome.runtime.getManifest?.().version || '0.2.0';
    const text = `Nova Nest · ${message} · v${version}`;
    statusNode.style.backgroundColor = state === 'success' ? '#563094' : state === 'warning' ? '#703a74' : '#4b287c';
    if (statusNode.textContent !== text) statusNode.textContent = text;
  }
  function clearStatus() { if (statusNode) { statusNode.remove(); statusNode = null; } }
  const capturedFields = ZillowCaptureRequests.fields;
  const fingerprint = ZillowCaptureRequests.fingerprint;
  const captures = ZillowCaptureRequests.build;
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
  let readFailure = '';
  function extract(start) {
    readFailure = '';
    return ZillowExtract.collect(document, start, getComputedStyle, reason => { readFailure = reason; });
  }
  async function capture() {
    routeChanged();
    const start = location.href, id = ZillowExtract.identity(start), turn = generation;
    if (!id) return;
    const observation = extract(start);
    if (location.href !== start || turn !== generation) return;
    if (!observation) {
      const reasons = {
        identity:'Listing URL not recognized',
        'structured-identity':'Waiting for matching listing data',
        'structured-address':'Listing address data missing or ambiguous',
        'canonical-mismatch':'Page identity has not caught up with navigation',
        'no-visible-container':'Listing details container not visible',
        'ambiguous-container':'Multiple listing containers found',
        'heading-mismatch':'Visible address does not match listing data',
        'status-missing':'Listing status not visible',
        'status-unsupported':'Listing status not supported',
        'status-contradictory':'Conflicting listing statuses found',
        'price-missing':'Asking price not visible',
        'price-ambiguous':'Multiple asking prices found',
        'structured-price-mismatch':'Visible price does not match listing data'
      };
      showStatus(`Couldn't read listing: ${reasons[readFailure] || 'unknown reading error'}.`, 'warning');
      return;
    }
    const key = fingerprint(observation);
    if (key === saved) return;
    if (!pending || pending.key !== key) {
      try { pending = {key, observation: {...observation, captures: captures(observation)}, attempts: 0, inFlight: false}; }
      catch { showStatus('A listing detail is unsupported; capture is incomplete.', 'warning'); return; }
    }
    const current = pending;
    if (current.inFlight) return;
    if (current.retryAt && current.retryAt > Date.now()) { schedule(current.retryAt - Date.now()); return; }
    current.inFlight = true;
    showStatus('Checking listing details against your data…');
    let result;
    try { result = await chrome.runtime.sendMessage({type:'observe', observation:current.observation}); } catch { /* retry below */ }
    current.inFlight = false;
    if (location.href !== start || turn !== generation || pending !== current) return;
    const displayed = extract(start);
    if (location.href !== start || !displayed || fingerprint(displayed) !== key) { pending = null; schedule(); return; }
    if (result?.ok === true && Array.isArray(result.changedFields) && result.changedFields.every(x => capturedFields.has(x))) {
      saved = key; pending = null;
      showStatus(result.changedFields.length ? `Saved ${new Set(result.changedFields).size} ${new Set(result.changedFields).size === 1 ? 'detail' : 'details'}.` : 'Checked; no changes.', 'success');
    } else {
      const messages = {settings:'Check extension settings and site permission.', authorization:'Dashboard authorization failed; check extension settings.', network:'Dashboard unavailable; retrying.', 'not-tracked':'This listing is not tracked.', oversized:'A listing detail exceeds the supported capture size; capture is incomplete.', invalid:'A listing detail was rejected; capture is incomplete.'};
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
