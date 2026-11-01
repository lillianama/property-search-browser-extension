(function(root) {
  function identity(url) {
    try { const u = new URL(url); const m = u.pathname.match(/^\/homedetails\/(?:[^/]*\/)?([1-9]\d{0,19})_zpid\/?$/); return u.origin === 'https://www.zillow.com' && !u.username && !u.password && m ? m[1] : null; } catch { return null; }
  }
  const houseNumber = value => /^\s*([1-9]\d*)(?:\s*-\s*([1-9]\d*))?(?=\s|,|$)/.exec(String(value || ''))?.slice(1).join('-') || null;
  function legacyUrl(address) {
    const street = address?.streetAddress || '';
    const range = /^([1-9]\d{0,6})-([1-9]\d{0,6}) (?=[A-Za-z])/.exec(street);
    if (range && Number(range[1]) >= Number(range[2])) return null;
    if (!address || !/^[0-9][A-Za-z0-9, ]{4,119}$/.test(range ? street.replace(/^\d+-\d+ /, x=>x.replace('-', ' ')) : street)
      || !/^[A-Za-z][A-Za-z ]{1,59}$/.test(address.addressLocality || '')
      || !/^[A-Z]{2}$/.test(address.addressRegion || '') || !/^\d{5}$/.test(address.postalCode || '')) return null;
    const slug = [address.streetAddress,address.addressLocality,address.addressRegion,address.postalCode].map(x=>x.trim().replace(/[, ]+/g,'-')).join('-');
    return `https://www.zillow.com/homes/${slug}_rb/`;
  }
  // Only explicitly named property data may leave the page. In particular,
  // never serialize the surrounding Next.js cache, agent/contact details,
  // account data, mortgage data, or analytics.
  function projectCache(nextText, zpid, address) {
    let next, cache;
    try {
      next = JSON.parse(nextText);
      cache = JSON.parse(next.props.pageProps.componentProps.gdpClientCache);
    } catch { return null; }
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return null;
    const norm = value => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
    const street = address?.streetAddress;
    const matches = Object.values(cache).map(x => x && typeof x === 'object' ? x.property : null).filter(p => {
      const a = p?.address || {};
      return p && String(p.zpid) === zpid && houseNumber(a.streetAddress || p.streetAddress) === houseNumber(street) && norm(a.streetAddress || p.streetAddress) === norm(street) && norm(street).length >= 6
        && (!address.addressLocality || norm(address.addressLocality) === norm(a.city || p.city))
        && (!address.addressRegion || norm(address.addressRegion) === norm(a.state || p.state))
        && (!address.postalCode || norm(address.postalCode) === norm(a.zipcode || p.zipcode));
    });
    if (matches.length !== 1) return null;
    const p = matches[0], f = p.resoFacts && typeof p.resoFacts === 'object' ? p.resoFacts : {};
    const out = {};
    const number = (key, value, min, max) => { if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) out[key] = value; };
    const string = (key, value) => { if (typeof value === 'string' && value.trim()) out[key] = value.trim(); };
    const strings = (key, value) => { if (Array.isArray(value) && value.length && value.every(x => typeof x === 'string' && x.trim())) out[key] = value.map(x => x.trim()); };
    number('bedrooms', p.bedrooms ?? f.bedrooms, 0, 100);
    number('bathrooms', p.bathrooms ?? f.bathrooms, 0, 100);
    number('finished_sqft', p.livingArea ?? p.livingAreaValue, 1, 1000000);
    number('year_built', f.yearBuilt, 1600, 2200);
    number('lot_sqft', p.lotSize, 1, 1000000000);
    number('latitude', p.latitude, -90, 90);
    number('longitude', p.longitude, -180, 180);
    number('monthly_hoa_fee', p.monthlyHoaFee ?? f.hoaFeeTotal, 0, 1000000);
    number('zestimate', p.zestimate, 1, 1000000000);
    number('rent_zestimate', p.rentZestimate, 1, 1000000);
    number('unit_count', f.numberOfUnitsTotal, 1, 1000);
    string('property_type', p.homeType || f.homeType);
    string('description', p.description);
    string('mls_number', p.mlsid || p.attributionInfo?.mlsId);
    string('basement', f.basement);
    for (const [key, source] of Object.entries({parking_features:'parkingFeatures', heating:'heating', cooling:'cooling', interior_features:'interiorFeatures', exterior_features:'exteriorFeatures', appliances:'appliances', roof:'roofType', flooring:'flooring', property_subtype:'propertySubType'})) strings(key, f[source]);
    number('stories', f.stories, 1, 200);
    const photo = value => {
      try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || !(u.hostname === 'zillowstatic.com' || u.hostname.endsWith('.zillowstatic.com'))) return null; u.search = ''; u.hash = ''; return u.href; } catch { return null; }
    };
    const photos = [];
    if (Array.isArray(p.originalPhotos)) for (const item of p.originalPhotos) {
      const images = item?.mixedSources?.jpeg;
      if (!Array.isArray(images)) continue;
      const candidates = images.map(x => ({url:photo(x?.url),width:Number(x?.width)})).filter(x => x.url);
      candidates.sort((a,b) => (b.width || 0) - (a.width || 0));
      if (candidates[0] && !photos.includes(candidates[0].url)) photos.push(candidates[0].url);
    }
    if (photos.length) out.photos = photos;
    const taxes = Array.isArray(p.taxHistory) ? p.taxHistory.filter(t => Number.isInteger(t?.year) && t.year >= 1900 && t.year <= 2200 && typeof t.taxPaid === 'number' && Number.isFinite(t.taxPaid) && t.taxPaid > 0 && t.taxPaid <= 100000000).sort((a,b) => b.year - a.year) : [];
    if (taxes.length) out.tax_history = taxes.map(t => ({year:t.year,taxPaid:t.taxPaid}));
    return out;
  }
  function extract(url, scripts, evidence, diagnostic = () => {}) {
    const fail = reason => { diagnostic(reason); return null; };
    const zpid = identity(url); if (!zpid) return fail('identity');
    if (!evidence || !Array.isArray(evidence.status) || !Array.isArray(evidence.price)) return fail('status-missing');
    if (!evidence.status.length) return fail('status-missing');
    const statuses = new Set();
    for (const text of evidence.status) {
      const label = text.trim().toLowerCase().replace(/\s+/g, ' ');
      if (label === 'active' || label === 'for sale') statuses.add('Active');
      else if (label === 'pending' || label === 'contingent') statuses.add('Pending');
      // Match the entire identity-scoped status label, never arbitrary page text.
      // The amount here is a sold figure, not the current asking price. Dated
      // sale evidence is collected separately by the listing-history projector.
      else if (/^sold\b(?: for \$(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.00)?| on \d{1,2}\/\d{1,2}\/\d{4})?$/i.test(label)
        && (!label.startsWith('sold on ') || (() => {
          const [month,day,year] = label.slice(8).split('/');
          const iso = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
          const date = new Date(iso+'T00:00:00Z');
          return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso;
        })())) statuses.add('Sold');
      else if (label === 'off market' || label === 'off-market') statuses.add('Off market');
      else if (label === 'for rent') statuses.add('For rent');
    }
    if (statuses.size > 1) return fail('status-contradictory');
    if (!statuses.size) return fail('status-unsupported');
    const status = [...statuses][0];
    const sale = status === 'Active' || status === 'Pending';
    if (sale && !evidence.price.length) return fail('price-missing');
    const visiblePrices = new Set(evidence.price.map(text => text.trim()));
    if (sale && visiblePrices.size !== 1) return fail('price-ambiguous');
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
    if (sale && prices.size !== 1) return fail('structured-price-mismatch');
    const price = sale ? [...prices][0] : undefined;
    return {zpid,url:`https://www.zillow.com/homedetails/${zpid}_zpid/`,observedAt:new Date().toISOString(),status,...(price ? {price} : {})};
  }
  // Read-only candidates contain no apartment facts or capture authorization.
  function validTracking(o) {
    if (!o || Object.keys(o).sort().join(',') !== 'action,identity,legacyUrl,scope,url,zpid'
      || o.action !== 'tracking-lookup' || o.scope !== 'apartment-range'
      || typeof o.zpid !== 'string' || !identity(o.url) || o.url !== `https://www.zillow.com/homedetails/${o.zpid}_zpid/`
      || typeof o.legacyUrl !== 'string') return false;
    const range = /^https:\/\/www\.zillow\.com\/homes\/([1-9]\d{0,6})-([1-9]\d{0,6})-([A-Za-z][A-Za-z0-9-]{2,120})-Portland-OR-(97\d{3})_rb\/$/.exec(o.legacyUrl);
    if (!range || Number(range[1]) >= Number(range[2]) || /(?:^|-)(?:apt|apartment|unit|suite|ste|floor|fl|room|rm|lot)(?:-|$)/i.test(range[3])) return false;
    return !!o.identity && typeof o.identity === 'object' && !Array.isArray(o.identity)
      && Object.entries(o.identity).every(([k,v])=>['mlsNumber','parcelId'].includes(k) && typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v));
  }
  function collect(document, url, style, diagnostic = () => {}, tracking = () => {}) {
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
    const units = value => {
      const found = [...String(value || '').matchAll(/\b(?:apartment|apt|unit|suite|ste)(?:\s+|(?=[#-])|(?=[a-z]?\d))\s*[#-]?\s*([\s\S]+)|#\s*([\s\S]+)/gi)];
      const result = [];
      for (const match of found) {
        // Reject ambiguous suffixes instead of normalizing another unit.
        const token = /^([a-z0-9]+)(?:(?:\s*,\s*|\s+)Portland\b[\s\S]*)?\s*$/i.exec((match[1] || match[2]).trim());
        if (!token || !/^[a-z0-9]+$/i.test(token[1])) return null;
        result.push(token[1].toLowerCase());
      }
      return result;
    };
    const headingMatches = (heading, street) => { const tokens=s=>String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); const a=tokens(street), b=tokens(heading), u=units(street), v=units(heading); return !!a && houseNumber(heading) === houseNumber(street) && u!==null && v!==null && u.length<=1 && v.length<=1 && JSON.stringify(u)===JSON.stringify(v) && (` ${b} `).includes(` ${a} `); };
    const addresses = [], addressObjects = []; let structuredIdentity = false;
    for (const script of scripts) {
      let data; try { data = JSON.parse(script); } catch { continue; }
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && identity(item.url || item['@id'] || '') === zpid) {
          structuredIdentity = true;
          for (const address of [item.address, item.offers?.itemOffered?.address]) {
            if (typeof address?.streetAddress === 'string') { addresses.push(normalize(address.streetAddress)); addressObjects.push(address); }
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
        const matching = fallback.filter(node => [...node.querySelectorAll('h1')].some(h => visible(h) && headingMatches(h.innerText,addressObjects[0]?.streetAddress)));
        if (!matching.length && !explicit.length) return fail('heading-mismatch');
        candidates = [...explicit, ...matching];
      }
    }
    const roots = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (!roots.length) return fail('no-visible-container');
    if (roots.length !== 1) return fail('ambiguous-container');
    const street=addressObjects[0]?.streetAddress;
    const headings=[...roots[0].querySelectorAll('h1')].filter(visible);
    if (street && ((units(street)?.length ?? 1) || headings.some(h=>(units(h.innerText)?.length ?? 1))) && !headings.some(h=>headingMatches(h.innerText,street))) return fail('heading-mismatch');
    const scoped = selector => [...roots[0].querySelectorAll(selector)].filter(node => visible(node) && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid)).map(node => node.innerText || '');
    // Showcase uses a separate overview header. Never read history or nearby
    // home-status/price-text nodes outside that identity-bound overview.
    const overviews = [...roots[0].querySelectorAll('[data-testid="property-overview"]')].filter(node => visible(node)
      && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid)
      && [...node.querySelectorAll('h1')].some(h=>visible(h) && addresses.length && headingMatches(h.innerText,addressObjects[0]?.streetAddress)));
    if (overviews.length > 1) return fail('ambiguous-container');
    const overview = overviews[0];
    const headerText = selector => overview ? [...overview.querySelectorAll(selector)].filter(node=>visible(node)
      && node.closest('[data-testid="property-overview"]') === overview
      && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid)).map(node=>node.innerText || '') : [];
    const observation = extract(url, scripts, {status:[...scoped('[data-testid="home-details-chip"], [data-testid="gallery-status-pill"]'),...headerText('[data-testid="home-status"]')],price:[...scoped('[data-testid="price"]'),...headerText('[data-testid="home-info"] .price-text')]}, diagnostic);
    if (!observation) return null;
    const sourceUrls = addressObjects.map(legacyUrl);
    if (sourceUrls.length && sourceUrls.every(x=>x && x === sourceUrls[0])
      && [...roots[0].querySelectorAll('h1')].some(h=>visible(h) && headingMatches(h.innerText,addressObjects[0]?.streetAddress))) observation.legacyUrl = sourceUrls[0];
    const next = document.querySelector('script#__NEXT_DATA__');
    if (next && addressObjects.length && new Set(addresses).size === 1) {
      const fields = projectCache(next.textContent, zpid, addressObjects[0]);
      if (fields) observation.fields = fields;
    }
    // A range can label one rental apartment as well as the entire plex. Only
    // identity-bound whole-property data can authorize captures for a range.
    if (/^\d+\s*-\s*\d+\b/.test(street || '')
      && !/^multi_?family$/i.test(observation.fields?.property_type || '')) {
      if (structuredIdentity && identity(canonical?.href || '') === zpid
        && observation.fields?.property_type === 'APARTMENT' && observation.legacyUrl
        && headings.length === 1 && headingMatches(headings[0].innerText, street)
        // Only the exact street plus optional published locality is recognized.
        // Extra floor/room/lot or bare unit suffixes must not be discarded.
        && [street, `${street} Portland OR`, `${street} Portland OR ${addressObjects[0].postalCode}`].some(value => normalize(value) === normalize(headings[0].innerText))
        && units(street)?.length === 0 && units(headings[0].innerText)?.length === 0) {
        const candidate = {action:'tracking-lookup',scope:'apartment-range',zpid,url:observation.url,legacyUrl:observation.legacyUrl,
          identity:Object.fromEntries([['mlsNumber',observation.fields.mls_number],['parcelId',observation.fields.parcel_id]].filter(([,v])=>v !== undefined))};
        if (validTracking(candidate)) tracking(candidate);
      }
      return fail('listing-scope');
    }
    if (root.ZillowDomFields) {
      const scopedVisible = node => visible(node) && (!node.closest('[data-zpid]') || node.closest('[data-zpid]').getAttribute('data-zpid') === zpid);
      const dom = root.ZillowDomFields.collect(roots[0],scopedVisible);
      const fields = observation.fields || {};
      for (const [field,value] of Object.entries(dom)) {
        if (field === 'features') continue;
        if (['tax_history','listing_history','rooms'].includes(field)) {
          const records = [...(fields[field] || []),...value].map(item => {
            if (field !== 'listing_history' || !item.source) return item;
            // Listing history carries publisher names, not arbitrary contact
            // text copied from the page.
            if (/^(?:RMLS(?: \(OR\))?|Zillow)$/i.test(item.source)) return item;
            const {source,...safe} = item; return safe;
          });
          fields[field] = records.filter((item,index) => records.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index);
        } else if (fields[field] === undefined) fields[field] = value;
      }
      const arrayFields = new Set(['heating','cooling','appliances','flooring','parking_features','roof','property_subtype','exterior_features']);
      for (const [field,value] of Object.entries(dom.features || {})) {
        if (field === 'published_annual_tax_amount' || field === 'published_assessed_value') {
          if (!/^\$?\s*[\d,]+(?:\.\d+)?$/.test(value)) continue;
          const n = Number(value.replace(/[$,\s]/g,''));
          if (n > 0) fields[field] = n;
        } else if (field === 'stories' || field === 'days_on_market') {
          if (/^\d+(?:\.\d+)?$/.test(value)) fields[field] = Number(value);
        } else if (arrayFields.has(field)) {
          const values = value.split(',').map(x => x.trim()).filter(Boolean);
          fields[field] = [...new Set([...(fields[field] || []),...values])];
        } else if (fields[field] === undefined) fields[field] = value;
      }
      if (Object.keys(fields).length) observation.fields = fields;
    }
    return observation;
  }
  root.ZillowExtract = {identity,extract,collect,projectCache,legacyUrl,validTracking};
  if (typeof module !== 'undefined') module.exports = root.ZillowExtract;
})(globalThis);
