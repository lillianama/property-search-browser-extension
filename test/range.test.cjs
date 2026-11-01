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
