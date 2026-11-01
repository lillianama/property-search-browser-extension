(function(root) {
  function identity(url) {
    try { const u = new URL(url); const m = u.pathname.match(/^\/homedetails\/(?:[^/]*\/)?([1-9]\d{0,19})_zpid\/?$/); return u.origin === 'https://www.zillow.com' && !u.username && !u.password && m ? m[1] : null; } catch { return null; }
  }
  function extract(url, scripts, evidence, diagnostic = () => {}) {
    const fail = reason => { diagnostic(reason); return null; };
    const zpid = identity(url); if (!zpid) return fail('identity');
    if (!evidence || !Array.isArray(evidence.status) || !Array.isArray(evidence.price)) return fail('status-missing');
    if (!evidence.status.length) return fail('status-missing');
    let status;
    if (evidence.status.some(text => /\b(?:for\s+rent|sold|off[\s-]+market)\b/i.test(text))) return fail('status-contradictory');
    const pending = evidence.status.some(text => /^(?:pending|contingent)$/i.test(text.trim()));
    const active = evidence.status.some(text => /^(?:for sale|active)$/i.test(text.trim()));
    if (pending && active) return fail('status-contradictory');
    if (pending) status = 'Pending';
    else if (active) status = 'Active';
    else return fail('status-unsupported');
    if (!evidence.price.length) return fail('price-missing');
    const visiblePrices = new Set(evidence.price.map(text => text.trim()));
    if (visiblePrices.size !== 1) return fail('price-ambiguous');
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
    if (!matched) return fail('structured-identity');
    if (prices.size !== 1) return fail('structured-price-mismatch');
    const price = [...prices][0];
    return {zpid,url:`https://www.zillow.com/homedetails/${zpid}_zpid/`,observedAt:new Date().toISOString(),status,...(price ? {price} : {})};
  }
  function collect(document, url, style, diagnostic = () => {}) {
    const fail = reason => { diagnostic(reason); return null; };
    const zpid = identity(url); if (!zpid) return fail('identity');
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
    const addresses = []; let structuredIdentity = false;
    for (const script of scripts) {
      let data; try { data = JSON.parse(script); } catch { continue; }
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && identity(item.url || item['@id'] || '') === zpid) {
          structuredIdentity = true;
          for (const address of [item.address, item.offers?.itemOffered?.address]) {
            if (typeof address?.streetAddress === 'string') addresses.push(normalize(address.streetAddress));
          }
        }
      }
    }
    const canonical = document.querySelector('link[rel="canonical"]');
    // Bind evidence either to an explicitly identified listing container or to
    // the unique detail view with both canonical identity and a matching address.
    const nodes = [...document.querySelectorAll('[data-zpid], #hdp-content, #layout-wrapper')].filter(visible);
    if (!nodes.length) return fail('no-visible-container');
    const explicit = nodes.filter(node => node.getAttribute('data-zpid') === zpid);
    const fallback = nodes.filter(node => !node.getAttribute('data-zpid') && (node.id === 'hdp-content' || node.id === 'layout-wrapper'));
    let candidates = explicit;
    if (fallback.length) {
      if (identity(canonical?.href || '') !== zpid) { if (!explicit.length) return fail('canonical-mismatch'); }
      else if (!structuredIdentity) { if (!explicit.length) return fail('structured-identity'); }
      else if (new Set(addresses).size !== 1 || addresses[0].length < 6) { if (!explicit.length) return fail('structured-address'); }
      else {
        const matching = fallback.filter(node => [...node.querySelectorAll('h1')].some(h => visible(h) && normalize(h.innerText).includes(addresses[0])));
        if (!matching.length && !explicit.length) return fail('heading-mismatch');
        candidates = [...explicit, ...matching];
      }
    }
    const roots = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (!roots.length) return fail('no-visible-container');
    if (roots.length !== 1) return fail('ambiguous-container');
    const scoped = selector => [...roots[0].querySelectorAll(selector)].filter(node => visible(node) && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid)).map(node => node.innerText || '');
    return extract(url, scripts, {status:scoped('[data-testid="home-details-chip"], [data-testid="gallery-status-pill"]'),price:scoped('[data-testid="price"]')}, diagnostic);
  }
  root.ZillowExtract = {identity,extract,collect};
  if (typeof module !== 'undefined') module.exports = root.ZillowExtract;
})(globalThis);
