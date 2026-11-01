(function(root) {
  function identity(url) {
    try { const u = new URL(url); const m = u.pathname.match(/^\/homedetails\/(?:[^/]*\/)?([1-9]\d{0,19})_zpid\/?$/); return u.origin === 'https://www.zillow.com' && !u.username && !u.password && m ? m[1] : null; } catch { return null; }
  }
  function extract(url, scripts, evidence) {
    const zpid = identity(url); if (!zpid || !evidence || !Array.isArray(evidence.status) || !Array.isArray(evidence.price)) return null;
    let status;
    if (evidence.status.some(text => /^for sale$/i.test(text.trim()))) status = 'Active';
    else if (evidence.status.some(text => /^(?:pending|contingent)$/i.test(text.trim()))) status = 'Pending';
    else return null;
    let price, matched = false;
    for (const script of scripts) {
      let data; try { data = JSON.parse(script); } catch { continue; }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const itemId = identity(item.url || item['@id'] || '');
        if (itemId !== zpid) continue;
        matched = true;
        const offers = item.offers; if (!offers || Array.isArray(offers) || typeof offers !== 'object') continue;
        const p = Number(offers.price); if (Number.isSafeInteger(p) && p > 0 && p <= 1000000000 && evidence.price.some(text => new RegExp('^\\$\\s*' + p.toLocaleString('en-US').replace(/,/g, ',?') + '$').test(text.trim()))) price = p;
      }
    }
    if (!matched || !price) return null;
    return {zpid,url:`https://www.zillow.com/homedetails/${zpid}_zpid/`,observedAt:new Date().toISOString(),status,...(price ? {price} : {})};
  }
  root.ZillowExtract = {identity,extract};
  if (typeof module !== 'undefined') module.exports = root.ZillowExtract;
})(globalThis);
