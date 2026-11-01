importScripts('extract.js');
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const fieldNames = new Set(['price','status','bedrooms','bathrooms','finished_sqft','year_built','lot_sqft','latitude','longitude','property_type','description','mls_number','annual_property_tax','annual_property_tax_year','zestimate','rent_zestimate','monthly_hoa_fee','parking_features','basement','heating','cooling','interior_features','exterior_features','appliances','roof','flooring','property_subtype','stories','unit_count','photo_url','tax_history','listing_history','published_room','unit_mix','parcel_id','structure_sqft','days_on_market','published_assessed_value','published_annual_tax_amount','laundry','windows','foundation','architectural_style','patio_porch','view','sewer','water','gas','listing_terms','has_hoa','new_construction','has_view','room_types','date_on_market']);
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  (async () => {
    if (message?.type !== 'observe' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url || !sender.tab.url) return {ok:false};
    const o = message.observation, id = ZillowExtract.identity(sender.url);
    if (!o || !id || ZillowExtract.identity(sender.tab.url) !== id || o.zpid !== id || o.url !== `https://www.zillow.com/homedetails/${id}_zpid/` || Object.keys(o).some(k => !['zpid','url','observedAt','status','price','captureId','fields','captures'].includes(k))) return {ok:false};
    const captures = Array.isArray(o.captures) ? o.captures : [o];
    if (!captures.length || captures.length > 500) return {ok:false,reason:'oversized'};
    if (o.captures && captures.some((c,i) => !c || c.zpid !== id || c.url !== o.url || c.observedAt !== o.observedAt || Object.keys(c).some(k => !['zpid','url','observedAt','captureId','field','value','identity'].includes(k)) || (i === 0 ? c.field !== 'listing' : !fieldNames.has(c.field) || c.field === 'price' || c.field === 'status'))) return {ok:false};
    // Evidence must agree with the identity-bound collector fields, never page-supplied routing.
    if (captures.some(c => c.identity && (Object.keys(c.identity).length !== 2 || c.identity.parcelId !== o.fields?.parcel_id || c.identity.mlsNumber !== o.fields?.mls_number || ![c.identity.parcelId,c.identity.mlsNumber].every(v => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v))))) return {ok:false};
    const bodies = captures.map(c => JSON.stringify(c));
    if (bodies.some(body => new TextEncoder().encode(body).length > 256000)) return {ok:false,reason:'oversized'};
    const tab = await chrome.tabs.get(sender.tab.id); if (ZillowExtract.identity(tab.url) !== id) return {ok:false};
    await storageReady;
    const {origin,token} = await chrome.storage.local.get(['origin','token']);
    let u; try { u = new URL(origin); } catch { return {ok:false, reason:'settings'}; }
    if (u.protocol !== 'https:' || u.origin !== origin || !token || !await chrome.permissions.contains({origins:[origin+'/*']})) return {ok:false, reason:'settings'};
    const changedFields = new Set();
    for (let i = 0; i < bodies.length; i++) {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (ZillowExtract.identity((await chrome.tabs.get(sender.tab.id)).url) !== id) return {ok:false};
        try { response = await fetch(origin+'/api/browser-observations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:bodies[i],redirect:'error',signal:AbortSignal.timeout(15000)}); if (response.ok || response.status < 500) break; } catch { /* retry the identical capture */ }
      }
      if (!response?.ok) return {ok:false, reason:response?.status === 401 || response?.status === 403 ? 'authorization' : response?.status === 400 || response?.status === 413 ? 'invalid' : 'network'};
      const data = await response.json();
      if (data.matched === false && Array.isArray(data.changedFields) && data.changedFields.length === 0) return {ok:false, reason:'not-tracked'};
      const allowed = o.captures ? captures[i].field === 'listing' ? ['price','status'] : [captures[i].field] : ['price','status'];
      if (data.matched !== true || data.zpid !== id || !Array.isArray(data.changedFields) || !data.changedFields.every(x => allowed.includes(x))) return {ok:false};
      for (const field of data.changedFields) changedFields.add(field);
    }
    return {ok:true,changedFields:[...changedFields]};
  })().then(sendResponse,() => sendResponse({ok:false})); return true;
});
