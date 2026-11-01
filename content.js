(() => {
  let generation = 0, timer, route = location.href, pending = null, saved = '';
  const fingerprint = o => JSON.stringify([o.zpid, o.price, o.status]);
  function schedule(delay = 800) {
    clearTimeout(timer);
    timer = setTimeout(capture, delay);
  }
  function routeChanged() {
    if (route !== location.href) {
      route = location.href; generation++; pending = null; saved = ''; schedule();
    }
  }
  function extract(start) {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => x.textContent);
    return ZillowExtract.extract(start, scripts, {status:[...document.querySelectorAll('[data-testid="home-details-chip"]')].map(x => x.innerText || ''), price:[...document.querySelectorAll('[data-testid="price"]')].map(x => x.innerText || '')});
  }
  async function capture() {
    routeChanged();
    const start = location.href, id = ZillowExtract.identity(start), turn = generation;
    if (!id) return;
    const observation = extract(start);
    if (!observation || location.href !== start || turn !== generation) return;
    const key = fingerprint(observation);
    if (key === saved) return;
    if (!pending || pending.key !== key) pending = {key, observation: {...observation, captureId: crypto.randomUUID()}, attempts: 0, inFlight: false};
    const current = pending;
    if (current.inFlight) return;
    if (current.retryAt && current.retryAt > Date.now()) { schedule(current.retryAt - Date.now()); return; }
    current.inFlight = true;
    let result;
    try { result = await chrome.runtime.sendMessage({type:'observe', observation:current.observation}); } catch { /* retry below */ }
    current.inFlight = false;
    if (location.href !== start || turn !== generation || pending !== current) return;
    const displayed = extract(start);
    if (location.href !== start || !displayed || fingerprint(displayed) !== key) { pending = null; schedule(); return; }
    if (result?.ok === true && Array.isArray(result.changedFields) && result.changedFields.every(x => x === 'price' || x === 'status')) {
      saved = key; pending = null;
      if (result.changedFields.length) {
        const toast = document.createElement('div'); toast.textContent = `Listing saved: ${[...new Set(result.changedFields)].join(', ')}`;
        Object.assign(toast.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#173d2b',color:'white',padding:'12px',borderRadius:'6px'});
        document.body.appendChild(toast); setTimeout(() => toast.remove(),4000);
      }
    } else {
      current.attempts++;
      const delay = Math.min(60000, 1000 * 2 ** Math.min(current.attempts, 6));
      current.retryAt = Date.now() + delay; schedule(delay);
    }
  }
  new MutationObserver(() => { routeChanged(); schedule(); }).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  setInterval(routeChanged,500);
  schedule();
})();
