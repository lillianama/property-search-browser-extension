const {test}=require('node:test'),assert=require('node:assert/strict');
const extract=require('../extract'),builder=require('../capture-requests'),fixture=require('./range-fixture.cjs');
test('verified whole-property range retains every endpoint through request builder',()=>{
 const f=fixture(),o=extract.collect(f.document,f.url,f.style);assert.ok(o);
 assert.equal(o.legacyUrl,'https://www.zillow.com/homes/1630-1632-NE-81st-Ave-Portland-OR-97213_rb/');
 assert.ok(builder.build(o).every(p=>p.identity.legacyUrl===o.legacyUrl));
});
test('apartment or missing whole-property scope never produces captures or an intake offer',()=>{
 for(const homeType of ['APARTMENT','SINGLE_FAMILY','CONDO',null]){
  const f=fixture({homeType}),reasons=[];assert.equal(extract.collect(f.document,f.url,f.style,r=>reasons.push(r)),null);assert.deepEqual(reasons,['listing-scope']);
 }
});
test('range and unit boundaries must agree in structured, cache and visible identity',()=>{
 for(const street of ['1630 NE 81st Ave','1632 NE 81st Ave','1630-1633 NE 81st Ave','16301632 NE 81st Ave','1630-1632 NE 81st Ave Apt 1']){
  for(const key of ['heading','cacheStreet']){const f=fixture({[key]:street});assert.equal(extract.collect(f.document,f.url,f.style),null,key+': '+street);}
 }
 const f=fixture({street:'1632 NE 81st Ave',heading:'1630-1632 NE 81st Ave'});assert.equal(extract.collect(f.document,f.url,f.style),null);
});
test('range alias syntax does not accept ambiguous suffixes or drop unit tokens',()=>{
 const a={addressLocality:'Portland',addressRegion:'OR',postalCode:'97213'};
 for(const streetAddress of ['1630-1632 NE 81st Ave Apt J25-A','1630-1632 NE 81st Ave Apt J25/2','1630-1632 NE 81st Ave Apt J25.A','1630-1632-1634 NE 81st Ave','1632-1630 NE 81st Ave'])assert.equal(extract.legacyUrl({...a,streetAddress}),null);
 assert.equal(extract.legacyUrl({...a,streetAddress:'1630-1632 NE 81st Ave Apt J25'}),'https://www.zillow.com/homes/1630-1632-NE-81st-Ave-Apt-J25-Portland-OR-97213_rb/');
});

test('only verified apartment ranges emit separate read-only candidates without facts',()=>{
 const f=fixture({homeType:'APARTMENT'});let c;
 assert.equal(extract.collect(f.document,f.url,f.style,()=>{},x=>c=x),null);
 assert.ok(extract.validTracking(c));assert.deepEqual(Object.keys(c).sort(),['action','identity','legacyUrl','scope','url','zpid']);assert.deepEqual(c.identity,{});
 for(const options of [{homeType:null},{homeType:'CONDO'},{homeType:'APARTMENT',cacheStreet:'1630-1633 NE 81st Ave'},{homeType:'APARTMENT',heading:'1630-1632 NE 81st Ave Apt 1'},{homeType:'APARTMENT',street:'1630-1632 NE 81st Ave Apt 1'}]){
  const f=fixture(options);let candidate;extract.collect(f.document,f.url,f.style,()=>{},x=>candidate=x);assert.equal(candidate,undefined);
 }
 for(const suffix of ['Apt-1','Unit-1','Suite-1']) assert.equal(extract.validTracking({...c,legacyUrl:c.legacyUrl.replace('-Portland',`-${suffix}-Portland`)}),false);
});
const fs=require('node:fs'),vm=require('node:vm');
function worker(candidate,{tab=candidate.url,reply={tracked:true},lost=false}={}) {
 let listener,calls=0,current=tab;const bodies=[];
 const chrome={runtime:{id:'ext',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'secret'})}},permissions:{contains:async()=>true},tabs:{get:async()=>({url:current})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../worker.js'),'utf8'),{chrome,ZillowExtract:extract,importScripts:()=>{},URL,AbortSignal,TextEncoder,fetch:async(url,init)=>{calls++;bodies.push(init.body);if(lost&&calls===1)throw Error('lost');return {ok:true,json:async()=>reply}}});
 return {bodies,setTab:v=>current=v,send:(sender={id:'ext',frameId:0,url:candidate.url,tab:{id:1,url:candidate.url}})=>new Promise(r=>listener({type:'tracking-lookup',candidate},sender,r))};
}
test('tracking worker validates scope, sender, tab, safe response and immutable retries',async()=>{
 const f=fixture({homeType:'APARTMENT'});let c;extract.collect(f.document,f.url,f.style,()=>{},x=>c=x);
 const w=worker(c,{lost:true});assert.deepEqual(JSON.parse(JSON.stringify(await w.send())),{ok:true,tracked:true});assert.equal(w.bodies.length,2);assert.equal(w.bodies[0],w.bodies[1]);
 for(const candidate of [{...c,fields:{finished_sqft:813}},{...c,scope:'whole'},{...c,zpid:'1'},{...c,identity:{mlsNumber:'bad#'}}]){const w=worker(candidate);assert.equal((await w.send()).ok,false);assert.equal(w.bodies.length,0)}
 const stale=worker(c,{tab:c.url.replace('53891611','123')});assert.equal((await stale.send()).ok,false);assert.equal(stale.bodies.length,0);
 for(const reply of [{tracked:true,propertyId:'private'},{tracked:'true'}])assert.equal((await worker(c,{reply}).send()).ok,false);
 for(const override of [{frameId:1},{id:'other'},{url:'https://evil.test'}]){const w=worker(c);assert.equal((await w.send({id:'ext',frameId:0,url:c.url,tab:{id:1,url:c.url},...override})).ok,false);assert.equal(w.bodies.length,0)}
});
test('blocked apartment UI only looks up tracking, never offers Add or captures facts',async()=>{
 const {JSDOM}=require('jsdom');
 for(const tracked of [true,false]){
  const f=fixture({homeType:'APARTMENT'}),dom=new JSDOM(f.document.documentElement.outerHTML,{url:f.url,runScripts:'outside-only'}),w=dom.window,messages=[];
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent}});w.HTMLElement.prototype.getClientRects=function(){return [{}]};
  const Observer=w.MutationObserver,observers=[];w.MutationObserver=class extends Observer {constructor(cb){super(cb);observers.push(this)}};
  w.chrome={runtime:{getManifest:()=>({version:'0.2.8'}),sendMessage:async m=>{messages.push(m);return {ok:true,tracked}}}};
  for(const file of ['capture-requests.js','extract.js','content.js'])w.eval(fs.readFileSync(require.resolve('../'+file),'utf8'));
  await new Promise(r=>setTimeout(r,1000));
  assert.match(w.document.querySelector('[data-nova-nest]').textContent,tracked?/Whole property tracked; apartment capture blocked/:/tracking unconfirmed; apartment capture blocked/);
  assert.deepEqual(messages.map(x=>x.type),['tracking-lookup']);assert.equal(w.document.querySelector('button'),null);assert.doesNotMatch(JSON.stringify(messages),/813|finished_sqft|observe|watchlist-intake/);await new Promise(r=>setImmediate(r));observers.forEach(o=>o.disconnect());dom.window.close();await new Promise(r=>setImmediate(r));
 }
});

test('delayed tracking response is discarded after tab navigation',async()=>{
 const f=fixture({homeType:'APARTMENT'});let c;extract.collect(f.document,f.url,f.style,()=>{},x=>c=x);
 let listener,finish,current=f.url,started;
 const began=new Promise(r=>started=r),response=new Promise(r=>finish=r);
 const chrome={runtime:{id:'ext',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'secret'})}},permissions:{contains:async()=>true},tabs:{get:async()=>({url:current})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../worker.js'),'utf8'),{chrome,ZillowExtract:extract,importScripts:()=>{},URL,AbortSignal,TextEncoder,fetch:async()=>{started();await response;return {ok:true,json:async()=>({tracked:true})}}});
 const result=new Promise(r=>listener({type:'tracking-lookup',candidate:c},{id:'ext',frameId:0,url:c.url,tab:{id:1,url:c.url}},r));
 await began;current=c.url.replace('53891611','123');finish();assert.equal((await result).ok,false);
});
