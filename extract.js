(function(root) {
  function identity(url) {
    try { const u = new URL(url); const m = u.pathname.match(/^\/homedetails\/(?:[^/]*\/)?([1-9]\d{0,19})_zpid\/?$/); return u.origin === 'https://www.zillow.com' && !u.username && !u.password && m ? m[1] : null; } catch { return null; }
  }
  function extract(url, scripts, evidence) {
    const zpid = identity(url); if (!zpid || !evidence || !Array.isArray(evidence.status) || !Array.isArray(evidence.price)) return null;
    let status;
    if (evidence.status.some(text => /\b(?:for\s+rent|sold|off[\s-]+market)\b/i.test(text))) return null;
    const pending = evidence.status.some(text => /^(?:pending|contingent)$/i.test(text.trim()));
    const active = evidence.status.some(text => /^for sale$/i.test(text.trim()));
    if (pending && active) return null;
    if (pending) status = 'Pending';
    else if (active) status = 'Active';
    else return null;
    const visiblePrices = new Set(evidence.price.map(text => text.trim()));
    if (visiblePrices.size !== 1) return null;
    const prices = new Set(); let matched = false;
    for (const script of scripts) {
      let data; try { data = JSON.parse(script); } catch { continue; }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const itemId = identity(item.url || item['@id'] || '');
        if (itemId !== zpid) continue;
        matched = true;
        const offers = item.offers; if (!offers || Array.isArray(offers) || typeof offers !== 'object') continue;
        const p = Number(offers.price); if (Number.isSafeInteger(p) && p > 0 && p <= 1000000000 && evidence.price.some(text => new RegExp('^\\$\\s*' + p.toLocaleString('en-US').replace(/,/g, ',?') + '$').test(text.trim()))) prices.add(p);
      }
    }
    if (!matched || prices.size !== 1) return null;
    const price = [...prices][0];
    return {zpid,url:`https://www.zillow.com/homedetails/${zpid}_zpid/`,observedAt:new Date().toISOString(),status,...(price ? {price} : {})};
  }
  function collect(document, url, style) {
    const zpid = identity(url); if (!zpid) return null;
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => x.textContent);
    const visible = node => {
      if (!node.getClientRects().length) return false;
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        const css = style(n);
        if (n.hidden || css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') return false;
      }
      return true;
    };
    const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g,'');
    const addresses = [];
    for (const script of scripts) {
      let data; try { data = JSON.parse(script); } catch { continue; }
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && identity(item.url || item['@id'] || '') === zpid && typeof item.address?.streetAddress === 'string') addresses.push(normalize(item.address.streetAddress));
      }
    }
    const canonical = document.querySelector('link[rel="canonical"]');
    // Bind evidence either to an explicitly identified listing container or to
    // the unique detail view with both canonical identity and a matching address.
    const candidates = [...document.querySelectorAll('[data-zpid], #hdp-content')].filter(node => {
      if (!visible(node)) return false;
      const ownId = node.getAttribute('data-zpid');
      if (ownId) return ownId === zpid;
      return node.id === 'hdp-content' && identity(canonical?.href || '') === zpid &&
        [...node.querySelectorAll('h1')].some(h => visible(h) && addresses.some(a => a.length >= 6 && normalize(h.innerText).includes(a)));
    });
    const roots = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (roots.length !== 1) return null;
    const scoped = selector => [...roots[0].querySelectorAll(selector)].filter(node => visible(node) && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid)).map(node => node.innerText || '');
    return extract(url, scripts, {status:scoped('[data-testid="home-details-chip"]'),price:scoped('[data-testid="price"]')});
  }
  root.ZillowExtract = {identity,extract,collect};
  if (typeof module !== 'undefined') module.exports = root.ZillowExtract;
})(globalThis);
