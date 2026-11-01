// Minimized representative Zillow structured-address and detail-container fixtures.
const {JSDOM}=require('jsdom');
const cases=[
 {street:'922 Nw 11th Ave, Apt 307',zip:'97209',zpid:'63298034',mls:'647118193'},
 {street:'920 Nw Naito Pkwy, Apt J25',zip:'97209',zpid:'62966567',mls:'519250596'},
 {street:'851 Sw Broadway Dr, Apt 52',zip:'97201',zpid:'53829995',mls:'385175817'}
];
function fixture(c){
 const slug=c.street.replace(/[, ]+/g,'-'),url=`https://www.zillow.com/homedetails/${slug}-Portland-OR-${c.zip}/${c.zpid}_zpid/`;
 const address={streetAddress:c.street,addressLocality:'Portland',addressRegion:'OR',postalCode:c.zip};
 const price=c.price ?? 250000; const ld={url,address,offers:{price}};
 const property={zpid:c.zpid,address:{streetAddress:c.street,city:'Portland',state:'OR',zipcode:c.zip},mlsid:c.mls,bedrooms:2};
 const next={props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({entry:{property}})}}}};
 const dom=new JSDOM(`<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify(ld)}</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script><div id="layout-wrapper"><h1>${c.street}, Portland, OR ${c.zip}</h1><span data-testid="gallery-status-pill">${c.status || 'For sale'}</span><span data-testid="price">$${price.toLocaleString('en-US')}</span>${c.parcel ? `<section data-testid="facts-and-features-module"><div data-testid="fact-category"><h6>Property</h6><ul><li>Parcel number: ${c.parcel}</li></ul></div></section>` : ''}</div>`);
 const {document,HTMLElement}=dom.window;Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return this.textContent}});HTMLElement.prototype.getClientRects=function(){return [{}]};
 return {document,url,style:n=>dom.window.getComputedStyle(n)};
}
module.exports={cases,fixture};
