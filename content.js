(() => {
  let generation = 0, timer, scheduledAt = Infinity, route = ZillowExtract.identity(location.href), pending = null, saved = '', statusNode, intakePending = null, intakeChoice = null;
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
    if (route !== ZillowExtract.identity(location.href)) {
      route = ZillowExtract.identity(location.href); generation++; pending = null; intakePending = null; intakeChoice = null; saved = ''; clearStatus();
      if (route) showStatus('Zillow listing detected. Reading details…');
      schedule();
    }
  }
  function isCurrent(start, turn) {
    routeChanged();
    return generation === turn && ZillowExtract.identity(start) === route;
  }
  let readFailure = '';
  function extract(start) {
    readFailure = '';
    return ZillowExtract.collect(document, start, getComputedStyle, reason => { readFailure = reason; });
  }
  function offerIntake(observation, key, start, turn) {
    if (!observation.legacyUrl || !statusNode?.appendChild) return;
    // Shadow isolation keeps Zillow's global button rules out of these controls.
    const host=document.createElement('div');
    const controls=host.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=`
      :host { all: initial; display: block; margin-top: 12px; color-scheme: light; }
      * { box-sizing: border-box; }
      [role=radiogroup] { display: flex; gap: 8px; margin-bottom: 10px; }
      button { all: unset; box-sizing: border-box; display: block; font: 600 14px/20px system-ui, sans-serif; text-align: center; cursor: pointer; border: 2px solid #bca6d9; border-radius: 10px; padding: 9px 14px; color: #26143e; background: #fff; transition: background .12s; }
      [role=radio] { flex: 1; }
      [role=radio][aria-checked=true] { background: #e6d5ff; border-color: #e6d5ff; color: #26143e; box-shadow: inset 0 0 0 2px #563094; }
      button:hover:enabled { background: #f0e8fa; border-color: #fff; }
      button:focus-visible { outline: 3px solid #ffe48a; outline-offset: 3px; }
      [data-add] { width: 100%; background: #ffe48a; border-color: #ffe48a; color: #26143e; }
      [data-add]:hover:enabled { background: #fff0b8; border-color: #fff0b8; }
      button:disabled { cursor: default; background: #ded7e7; color: #51445f; border-color: #b9adc8; box-shadow: none; }
      [role=radio]:disabled[aria-checked=true] { border-color: #6a537e; box-shadow: inset 0 0 0 2px #6a537e; }
    `;
    controls.appendChild(style);
    const group=document.createElement('div'); group.setAttribute('role','radiogroup'); group.setAttribute('aria-label','Watchlist track');
    let chosenTrack=intakePending?.key===key ? intakePending.body.track : intakeChoice?.key===key ? intakeChoice.track : 'house';
    const radios=[];
    function choose(track, focus=false) {
      chosenTrack=track; intakeChoice={key,track};
      for (const radio of radios) { const selected=radio.value===track; radio.setAttribute('aria-checked',String(selected)); radio.tabIndex=selected ? 0 : -1; if (focus && selected) radio.focus(); }
    }
    for (const [value,label] of [['house','House'],['plex','Plex']]) {
      const radio=document.createElement('button'); radio.type='button'; radio.value=value; radio.textContent=label; radio.setAttribute('role','radio');
      radio.disabled=intakePending?.key===key;
      radio.addEventListener('click',event=>{ if (event.isTrusted && !radio.disabled) choose(value); });
      radio.addEventListener('keydown',event=>{
        if (!event.isTrusted || radio.disabled) return;
        let next;
        if (['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)) next=chosenTrack==='house'?'plex':'house';
        else if (event.key==='Home') next='house';
        else if (event.key==='End') next='plex';
        else if (event.key===' ' || event.key==='Enter') next=value;
        if (next) { event.preventDefault(); event.stopPropagation(); choose(next,true); }
      });
      radios.push(radio); group.appendChild(radio);
    }
    choose(chosenTrack);
    controls.appendChild(group);
    const button=document.createElement('button'); button.type='button'; button.setAttribute('data-add',''); button.textContent='Add to Watchlist';
    button.addEventListener('click',async event => {
      if (!event.isTrusted || !['house','plex'].includes(chosenTrack) || button.disabled) return;
      event.stopPropagation();
      const current=extract(start);
      if (!isCurrent(start,turn) || !current || fingerprint(current)!==key || current.legacyUrl!==observation.legacyUrl) { showStatus('Listing changed. Refresh and try again.','warning'); return; }
      if (!intakePending || intakePending.key!==key || intakePending.body.track!==chosenTrack) intakePending={key,body:{action:'watchlist-intake',zpid:observation.zpid,url:observation.url,legacyUrl:observation.legacyUrl,captureId:crypto.randomUUID(),observedAt:new Date().toISOString(),track:chosenTrack,identity:Object.fromEntries([['mlsNumber',observation.fields?.mls_number],['parcelId',observation.fields?.parcel_id]].filter(([,v])=>typeof v==='string' && /^[A-Za-z0-9-]{1,40}$/.test(v))),listing:{status:observation.status,...(observation.price===undefined?{}:{price:observation.price})}}};
      const request=intakePending; button.disabled=true; radios.forEach(radio=>{radio.disabled=true;});
      let result; try { result=await chrome.runtime.sendMessage({type:'watchlist-intake',observation,intake:request.body}); } catch {}
      if (!isCurrent(start,turn) || intakePending!==request) return;
      const after=extract(start);
      if (!after || fingerprint(after)!==key || !isCurrent(start,turn)) { showStatus('Listing changed. Refresh and try again.','warning'); return; }
      if (result?.ok && result.status==='created') { intakePending=null; saved=''; showStatus('Added to Watchlist. Saving listing details…'); schedule(0); }
      else if (result?.ok && result.status==='existing') { intakePending=null; showStatus('Already tracked; existing decisions preserved.','success'); }
      else if (result?.ok && result.status==='conflict') { intakePending=null; showStatus('Listing identity needs review.','warning'); }
      else { button.disabled=false; button.textContent='Retry Add to Watchlist'; }
    });
    controls.appendChild(button); statusNode.appendChild(host);
  }
  async function capture() {
    routeChanged();
    const start = location.href, id = ZillowExtract.identity(start), turn = generation;
    if (!id) return;
    const observation = extract(start);
    if (!isCurrent(start,turn)) return;
    if (!observation) {
      const reasons = {
        identity:'Listing URL not recognized',
        'listing-scope':'Range listing scope is apartment-only or unverified; whole-property capture is blocked',
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
    if (!isCurrent(start,turn) || pending !== current) return;
    const displayed = extract(start);
    if (!isCurrent(start,turn) || !displayed || fingerprint(displayed) !== key) { pending = null; schedule(); return; }
    if (result?.ok === true && Array.isArray(result.changedFields) && result.changedFields.every(x => capturedFields.has(x))) {
      saved = key; pending = null;
      showStatus(result.changedFields.length ? `Saved ${new Set(result.changedFields).size} ${new Set(result.changedFields).size === 1 ? 'detail' : 'details'}.` : 'Checked; no changes.', 'success');
    } else {
      const messages = {settings:'Check extension settings and site permission.', authorization:'Dashboard authorization failed; check extension settings.', network:'Dashboard unavailable; retrying.', 'not-tracked':'This listing is not tracked.', oversized:'A listing detail exceeds the supported capture size; capture is incomplete.', invalid:'A listing detail was rejected; capture is incomplete.'};
      showStatus(messages[result?.reason] || 'Could not save listing; retrying.', 'warning');
      if (result?.reason === 'not-tracked') { offerIntake(observation,key,start,turn); return; }
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
  if (route) showStatus('Zillow listing detected. Reading details…');
  schedule();
})();
