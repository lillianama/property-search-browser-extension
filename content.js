(() => {
  let sequence = 0, last = '', timer;
  async function capture() {
    const start = location.href, id = ZillowExtract.identity(start), turn = ++sequence;
    if (!id) return;
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => x.textContent);
    const observation = ZillowExtract.extract(start, scripts, {status:[...document.querySelectorAll('[data-testid="home-details-chip"]')].map(x => x.innerText || ''), price:[...document.querySelectorAll('[data-testid="price"]')].map(x => x.innerText || '')});
    if (!observation || location.href !== start || ZillowExtract.identity(location.href) !== id || turn !== sequence) return;
    const fingerprint = JSON.stringify([observation.zpid, observation.price ?? null, observation.status ?? null]);
    if (fingerprint === last) return;
    try {
      const result = await chrome.runtime.sendMessage({type:'observe',observation});
      if (location.href !== start || ZillowExtract.identity(location.href) !== id || turn !== sequence) return;
      if (result?.ok) last = fingerprint;
      if (result?.ok && Array.isArray(result.changedFields) && result.changedFields.length) {
        const toast = document.createElement('div'); toast.textContent = 'Listing observation saved';
        Object.assign(toast.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#173d2b',color:'white',padding:'12px',borderRadius:'6px'});
        document.body.appendChild(toast); setTimeout(() => toast.remove(),4000);
      }
    } catch { /* next mutation retries */ }
  }
  function schedule() { ++sequence; clearTimeout(timer); timer = setTimeout(capture,800); }
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; schedule(); } },500);
  let lastUrl = location.href; schedule();
})();
