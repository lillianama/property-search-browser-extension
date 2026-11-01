const {test}=require('node:test'),assert=require('node:assert/strict');
const extract=require('../extract.js'),builder=require('../capture-requests.js'),fixture=require('./sold-fixture.cjs');
globalThis.ZillowDomFields=require('../dom-fields.js');
const collect=(label,history=true)=>{const f=fixture(label,history);return extract.collect(f.document,f.url,f.style)};
test('literal sold label reaches scoped DOM history without promoting sale or estimate to asking price',()=>{
  const o=collect('Sold for $439,000');
  assert.equal(o.status,'Sold');assert.equal(o.price,undefined);
  assert.deepEqual(o.fields.listing_history,[{date:'2026-10-15',event:'Sold',kind:'sale',price:439000},{date:'2026-07-31',event:'Price change',kind:'sale',price:449000}]);
  assert.deepEqual(builder.build(o)[0].value,{status:'Sold'});
  const undated=collect('Sold for $439,000',false);
  assert.equal(undated.price,undefined);assert.equal(undated.fields?.listing_history,undefined);
});
test('only constrained complete Sold labels pass and conflicting visible states reject',()=>{
  for(const label of ['Sold','SOLD','Sold for $439000',' Sold  for $439,000 ','Sold for $439,000.00','Sold on 10/15/2026']) assert.equal(collect(label).status,'Sold',label);
  for(const label of ['Soldier','Not sold','Sold out','Previously Sold','Sold for Zestimate $439,000','Sold for $439,000 estimate','Sold for $43,90','Sold for $0','Sold on 2/30/2026','Sold on tomorrow','Sold on 10/15/2026 extra']) assert.equal(collect(label),null,label);
  for(const label of ['For sale','Pending','Off market','For rent']) {
    const f=fixture();const n=f.document.createElement('span');n.dataset.testid='home-details-chip';n.textContent=label;f.document.querySelector('#layout-wrapper').append(n);
    assert.equal(extract.collect(f.document,f.url,f.style),null,label);
  }
  const f=fixture();f.document.querySelector('h1').textContent='Different address';assert.equal(extract.collect(f.document,f.url,f.style),null);
});
