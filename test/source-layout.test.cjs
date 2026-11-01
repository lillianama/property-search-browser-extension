const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),extract=require('../extract.js'),builder=require('../capture-requests.js');
const {fixture,cases}=require('./legacy-fixture.cjs');
for(const name of Object.keys(cases))test(`${name} carries exact structured legacy source with no canonical city/ZIP dependency`,()=>{
 const f=fixture(name),o=extract.collect(f.document,f.url,f.style);assert.ok(o);assert.equal(o.zpid,cases[name].zpid);
 assert.equal(o.legacyUrl,`https://www.zillow.com/homes/${cases[name].street.replace(/ /g,'-')}-Portland-OR-${cases[name].zip}_rb/`);
 assert.ok(builder.build(o).every(r=>r.identity.legacyUrl===o.legacyUrl));
 f.document.querySelector('h1').textContent='999 Other St';assert.equal(extract.collect(f.document,f.url,f.style),null);
});
const showcase=require('./showcase-fixture.cjs');
test('Showcase current header supplies Active and asking price, ignoring historical pending and nearby prices',()=>{
 const f=showcase(),o=extract.collect(f.document,f.url,f.style);assert.equal(o.status,'Active');assert.equal(o.price,450000);
 f.document.querySelector('[data-testid="home-status"]').hidden=true;assert.equal(extract.collect(f.document,f.url,f.style),null);
});
test('Showcase rejects unbound, ambiguous, contradictory and estimate evidence',()=>{
 for(const mutate of [
  d=>d.querySelector('h1').textContent='999 Other St',
  d=>d.querySelector('link').href='https://www.zillow.com/homedetails/999_zpid/',
  d=>d.querySelector('.price-text').textContent='Zestimate: $450,000',
  d=>d.querySelector('[data-testid="property-overview"]').insertAdjacentHTML('beforeend','<span data-testid="home-status">Pending</span>'),
  d=>d.querySelector('[data-testid="property-overview"]').insertAdjacentHTML('afterend',d.querySelector('[data-testid="property-overview"]').outerHTML),
 ]){const f=showcase();mutate(f.document);assert.equal(extract.collect(f.document,f.url,f.style),null);}
});
module.exports={showcase};
