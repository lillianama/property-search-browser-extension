const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const extract = require('../extract.js');
const url = 'https://www.zillow.com/homedetails/example/123_zpid/';
const script = JSON.stringify({url,offers:{price:500000}});
test('identity, visible status and matching sale price are required', () => {
  assert.equal(extract.extract(url,[script],{status:['For sale'],price:['$500,000']}).price,500000);
  assert.equal(extract.extract(url,[script],{status:['For rent'],price:['$500,000']}),null);
  assert.equal(extract.extract(url,[script],{status:['For sale'],price:['Zestimate $600,000']}),null);
  assert.equal(extract.extract(url,[JSON.stringify({url:url.replace('123','456'),offers:{price:500000}})],{status:['For sale'],price:['$500,000']}),null);
  assert.equal(extract.identity('https://evil.test/homedetails/123_zpid/'),null);
});
test('worker rejects untrusted frames and mismatched tabs before fetching', async () => {
  let listener, fetched = 0;
  const chrome = {runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'secret'})}},tabs:{get:async()=>({url})},permissions:{contains:async()=>true}};
  const context={chrome, URL, importScripts:()=>{}, ZillowExtract:extract, fetch:async()=>{fetched++; return {ok:true,json:async()=>({matched:true,zpid:'123',changedFields:['price']})}}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),context);
  const send=(sender,o={zpid:'123',url:'https://www.zillow.com/homedetails/123_zpid/'})=>new Promise(resolve=>listener({type:'observe',observation:o},sender,resolve));
  const sender={id:'extension',frameId:0,tab:{id:1,url},url};
  assert.equal((await send({...sender,frameId:1})).ok,false);
  assert.equal((await send({...sender,tab:{id:1,url:url.replace('123','456')}})).ok,false);
  assert.equal((await send(sender)).ok,true); assert.equal(fetched,1);
});
test('manifest limits permissions to Zillow and optional HTTPS origins', () => {
  const m=JSON.parse(fs.readFileSync('manifest.json')); assert.deepEqual(m.permissions,['storage']); assert.deepEqual(m.optional_host_permissions,['https://*/*']); assert.deepEqual(m.content_scripts[0].matches,['https://www.zillow.com/homedetails/*']);
});
test('SPA change and acknowledgement gate toast', async () => {
  let scheduled, listener, resolveResponse, appended=0;
  const location={href:url};
  const body={appendChild(){appended++}};
  const document={documentElement:{},body,querySelectorAll(sel){ return sel.startsWith('script') ? [{textContent:script}] : [{innerText:sel.includes('chip') ? 'For sale' : '$500,000'}]; },createElement(){return {style:{},remove(){}}}};
  const context={location,document,ZillowExtract:extract,MutationObserver:class {constructor(f){listener=f} observe(){}},setTimeout:f=>{scheduled=f;return 1},clearTimeout(){},setInterval(){},chrome:{runtime:{sendMessage:()=>new Promise(r=>resolveResponse=r)}}};
  vm.runInNewContext(fs.readFileSync('content.js','utf8'),context);
  scheduled(); location.href=url.replace('123','456'); resolveResponse({ok:true,changedFields:['price']}); await new Promise(setImmediate); assert.equal(appended,0);
  location.href=url; listener(); scheduled(); resolveResponse({ok:true,changedFields:[]}); await new Promise(setImmediate); assert.equal(appended,0);
});
