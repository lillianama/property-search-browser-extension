importScripts('extract.js');
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  (async () => {
    if (message?.type !== 'observe' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url || !sender.tab.url) return {ok:false};
    const o = message.observation, id = ZillowExtract.identity(sender.url);
    if (!o || !id || ZillowExtract.identity(sender.tab.url) !== id || o.zpid !== id || o.url !== `https://www.zillow.com/homedetails/${id}_zpid/` || Object.keys(o).some(k => !['zpid','url','observedAt','status','price','captureId'].includes(k))) return {ok:false};
    const tab = await chrome.tabs.get(sender.tab.id); if (ZillowExtract.identity(tab.url) !== id) return {ok:false};
    await storageReady;
    const {origin,token} = await chrome.storage.local.get(['origin','token']);
    let u; try { u = new URL(origin); } catch { return {ok:false}; }
    if (u.protocol !== 'https:' || u.origin !== origin || !token || !await chrome.permissions.contains({origins:[origin+'/*']})) return {ok:false};
    const body = JSON.stringify(o);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (ZillowExtract.identity((await chrome.tabs.get(sender.tab.id)).url) !== id) return {ok:false};
      try { response = await fetch(origin+'/api/browser-observations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body,redirect:'error',signal:AbortSignal.timeout(15000)}); if (response.ok || response.status < 500) break; } catch { /* retry the identical capture */ }
    }
    if (!response?.ok) return {ok:false};
    const data = await response.json();
    if (data.matched !== true || data.zpid !== id || !Array.isArray(data.changedFields) || !data.changedFields.every(x => x === 'price' || x === 'status')) return {ok:false};
    return {ok:true,changedFields:data.changedFields.filter(x => x === 'price' || x === 'status')};
  })().then(sendResponse,() => sendResponse({ok:false})); return true;
});
