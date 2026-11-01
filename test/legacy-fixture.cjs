// Sanitized public identity/header excerpts of fetched Davis and Alberta HTML;
// Prescott uses the same legacy layout. No page scripts, cache or analytics.
const {JSDOM}=require('jsdom');
const cases={
 davis:{street:'2124 NE Davis St',zip:'97232',zpid:'53852765',status:'Off market',legacy:'https://www.zillow.com/homes/2124-NE-DAVIS-ST-Portland-OR_rb/'},
 alberta:{street:'2148 N Alberta St',zip:'97217',zpid:'53827815',status:'Sold',mls:'614876122',legacy:'https://www.zillow.com/homes/2148-N-ALBERTA-ST-Portland-OR-97217_rb/'},
 prescott:{street:'1559 N Prescott St',zip:'97217',zpid:'53860996',status:'Off market',legacy:'https://www.zillow.com/homes/1559-N-PRESCOTT-ST-Portland-OR_rb/'}
};
function fixture(name){
 const c=cases[name],url=`https://www.zillow.com/homedetails/${c.street.replace(/ /g,'-')}-Portland-OR-${c.zip}/${c.zpid}_zpid/`;
 const ld={url,offers:{itemOffered:{address:{streetAddress:c.street,addressLocality:'Portland',addressRegion:'OR',postalCode:c.zip}}}};
 const dom=new JSDOM(`<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify(ld)}</script><div id="layout-wrapper"><h1>${c.street}, Portland, OR ${c.zip}</h1><span data-testid="gallery-status-pill">${c.status}</span></div>`);
 const {document,HTMLElement}=dom.window;
 Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 HTMLElement.prototype.getClientRects=function(){return [{}]};
 return {document,url,style:n=>dom.window.getComputedStyle(n)};
}
module.exports={fixture,cases};
