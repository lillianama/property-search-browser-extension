importScripts('extract.js');
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const fieldNames = new Set(['price','status','bedrooms','bathrooms','finished_sqft','year_built','lot_sqft','latitude','longitude','property_type','description','mls_number','annual_property_tax','annual_property_tax_year','zestimate','rent_zestimate','monthly_hoa_fee','parking_features','basement','heating','cooling','interior_features','exterior_features','appliances','roof','flooring','property_subtype','stories','unit_count','photo_url','tax_history','listing_history','published_room','unit_mix','parcel_id','structure_sqft','days_on_market','published_assessed_value','published_annual_tax_amount','laundry','windows','foundation','architectural_style','patio_porch','view','sewer','water','gas','listing_terms','has_hoa','new_construction','has_view','room_types','date_on_market']);
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  (async () => {
    if (message?.type === 'watchlist-intake') {
      if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url || !sender.tab.url) return {ok:false};
      const o=message.observation, body=message.intake, id=ZillowExtract.identity(sender.url);
      if (!id || ZillowExtract.identity(sender.tab.url)!==id || !o || !body || body.action!=='watchlist-intake' || Object.keys(body).sort().join(',')!=='action,captureId,identity,legacyUrl,listing,observedAt,track,url,zpid'
        || !body.identity || typeof body.identity!=='object' || Array.isArray(body.identity) || Object.keys(body.identity).some(k=>!['mlsNumber','parcelId'].includes(k) || typeof body.identity[k]!=='string' || !/^[A-Za-z0-9-]{1,40}$/.test(body.identity[k]) || body.identity[k]!==o.fields?.[k==='mlsNumber'?'mls_number':'parcel_id'])
        || JSON.stringify(body.listing)!==JSON.stringify({status:o.status,...(o.price===undefined?{}:{price:o.price})}) || body.zpid!==id || o.zpid!==id || body.url!==`https://www.zillow.com/homedetails/${id}_zpid/` || o.url!==body.url || body.legacyUrl!==o.legacyUrl
        || !/^https:\/\/www\.zillow\.com\/homes\/[0-9][A-Za-z0-9-]{4,200}-Portland-OR-97[0-9]{3}_rb\/$/i.test(body.legacyUrl || '')
        || !['house','plex'].includes(body.track) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.captureId || '') || typeof body.observedAt!=='string') return {ok:false,reason:'invalid'};
      if (ZillowExtract.identity((await chrome.tabs.get(sender.tab.id)).url)!==id) return {ok:false};
      await storageReady;
      const {origin,token}=await chrome.storage.local.get(['origin','token']);
      let u; try {u=new URL(origin)} catch {return {ok:false,reason:'settings'}}
      if (u.protocol!=='https:' || u.origin!==origin || !token || !await chrome.permissions.contains({origins:[origin+'/*']})) return {ok:false,reason:'settings'};
      const payload=JSON.stringify(body);
      for (let attempt=0;attempt<2;attempt++) {
        if (ZillowExtract.identity((await chrome.tabs.get(sender.tab.id)).url)!==id) return {ok:false};
        try {
          const response=await fetch(origin+'/api/browser-observations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:payload,redirect:'error',signal:AbortSignal.timeout(15000)});
          if (!response.ok) { if (response.status>=500) continue; return {ok:false,reason:response.status===401 || response.status===403?'authorization':'invalid'}; }
          const data=await response.json();
          if (data.zpid!==id || !['created','existing','conflict'].includes(data.status) || Object.keys(data).sort().join(',')!=='status,zpid') return {ok:false};
          return {ok:true,status:data.status};
        } catch { /* retry identical body */ }
      }
      return {ok:false,reason:'network'};
    }
    if (message?.type !== 'observe' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url || !sender.tab.url) return {ok:false};
    const o = message.observation, id = ZillowExtract.identity(sender.url);
    if (!o || !id || ZillowExtract.identity(sender.tab.url) !== id || o.zpid !== id || o.url !== `https://www.zillow.com/homedetails/${id}_zpid/` || Object.keys(o).some(k => !['zpid','url','observedAt','status','price','captureId','fields','captures','legacyUrl'].includes(k))) return {ok:false};
    const captures = Array.isArray(o.captures) ? o.captures : [o];
    if (!captures.length || captures.length > 500) return {ok:false,reason:'oversized'};
    if (o.captures && captures.some((c,i) => !c || c.zpid !== id || c.url !== o.url || c.observedAt !== o.observedAt || Object.keys(c).some(k => !['zpid','url','observedAt','captureId','field','value','identity'].includes(k)) || (i === 0 ? c.field !== 'listing' : !fieldNames.has(c.field) || c.field === 'price' || c.field === 'status'))) return {ok:false};
    // Evidence must agree with the identity-bound collector fields, never page-supplied routing.
    if (captures.some(c => {
      const e=c.identity; if (!e) return false;
      if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k=>!['legacyUrl','parcelId','mlsNumber'].includes(k))) return true;
      if (e.legacyUrl !== undefined && (e.legacyUrl !== o.legacyUrl || !/^https:\/\/www\.zillow\.com\/homes\/[0-9][A-Za-z0-9-]{4,200}-[A-Z]{2}-[0-9]{5}_rb\/$/.test(e.legacyUrl))) return true;
      if (e.legacyUrl === undefined && Object.keys(e).length !== 2) return true;
      return ['parcelId','mlsNumber'].some(k => e[k] !== undefined && (e[k] !== o.fields?.[k==='parcelId'?'parcel_id':'mls_number'] || typeof e[k] !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(e[k])))
        || (e.legacyUrl === undefined && (!e.parcelId || !e.mlsNumber));
    })) return {ok:false};
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
