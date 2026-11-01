(function(root) {
  const text = node => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const number = value => { const m = String(value).match(/^[\s$]*([\d,]+(?:\.\d+)?)/); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const date = value => {
    const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return null;
    const iso = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    const d = new Date(iso+'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : null;
  };
  const labels = {
    'Basement':'basement','Heating':'heating','Cooling':'cooling','Appliances included':'appliances',
    'Laundry':'laundry','Flooring':'flooring','Windows':'windows','Parking features':'parking_features',
    'Roof':'roof','Foundation':'foundation','Architectural style':'architectural_style',
    'Property subtype':'property_subtype','Exterior features':'exterior_features','Patio & porch':'patio_porch',
    'View description':'view','Sewer':'sewer','Water':'water','Gas':'gas','Listing terms':'listing_terms',
    'Has HOA':'has_hoa','Stories':'stories','New construction':'new_construction','Has view':'has_view',
    'Room types':'room_types','Cumulative days on market':'days_on_market','Date on market':'date_on_market',
    'Annual tax amount':'published_annual_tax_amount','Tax assessed value':'published_assessed_value'
  };
  function collect(container, visible) {
    const out = {}, features = {}, rooms = [];
    const nodes = selector => [...container.querySelectorAll(selector)].filter(visible);
    const modules = nodes('[data-testid="facts-and-features-module"]');
    if (modules.length === 1) {
      for (const category of modules[0].querySelectorAll('[data-testid="fact-category"]')) {
        if (!visible(category)) continue;
        const heading = text(category.querySelector('h6, h5, h4'));
        const lines = [...category.querySelectorAll('li')].filter(visible).map(text);
        let room;
        if (/^(?:primary bedroom|bedroom(?: \d+)?|kitchen|2nd kitchen|living room|family room|dining room|utility room|office)$/i.test(heading)) {
          room = {roomType:/bedroom/i.test(heading)?'bedroom':'other',roomLabel:heading};
        }
        for (const line of lines) {
          const split = line.indexOf(':'); if (split < 0) continue;
          const label = line.slice(0,split).trim(), value = line.slice(split+1).trim();
          if (!value || value.length > 1000) continue;
          if (labels[label]) features[labels[label]] = value;
          const numeric = {'Bedrooms':'bedrooms','Bathrooms':'bathrooms','Year built':'year_built','Total interior livable area':'finished_sqft','Total structure area':'structure_sqft'}[label];
          if (numeric && number(value) > 0) out[numeric] = number(value);
          if (label === 'Parcel number' && /^[A-Za-z0-9-]{1,40}$/.test(value)) out.parcel_id = value;
          if (heading === 'Lot' && label === 'Size') {
            const n = number(value); if (n > 0 && /acres?\b/i.test(value)) out.lot_sqft = Math.round(n*43560);
            else if (n > 0 && /sq\.?\s*ft|square feet/i.test(value)) out.lot_sqft = n;
          }
          if (room && /^(?:Level|Room level)$/i.test(label) && value.length < 60) room.level = value;
          if (room && /^(?:Dimensions|Room dimensions)$/i.test(label)) {
            const m = value.match(/^(\d+(?:\.\d+)?)\s*(?:ft|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|')?$/i);
            if (m && +m[1] > 0 && +m[2] > 0 && +m[1] <= 100 && +m[2] <= 100) Object.assign(room,{widthFt:+m[1],lengthFt:+m[2],areaSqft:+m[1]*+m[2]});
          }
        }
        if (room && (room.level || room.areaSqft)) rooms.push(room);
      }
    }
    const tax = [], history = [];
    for (const table of nodes('table')) {
      const headers = [...table.querySelectorAll('thead th')].map(text);
      const isTax = headers.join('|') === 'Year|Property taxes|Tax assessment';
      const isHistory = headers.join('|') === 'Date|Event|Price';
      if (!isTax && !isHistory) continue;
      let last;
      for (const row of table.querySelectorAll('tbody tr')) {
        if (!visible(row)) continue;
        const cells = [...row.querySelectorAll('td')].map(text);
        if (isTax && cells.length === 3 && /^\d{4}$/.test(cells[0])) {
          const year = +cells[0], taxPaid = number(cells[1]), assessedValue = number(cells[2]);
          if (year >= 1900 && year <= new Date().getFullYear()+1 && taxPaid > 0) tax.push({year,taxPaid,...(assessedValue > 0 ? {assessedValue} : {})});
        }
        if (isHistory && cells.length === 3 && date(cells[0])) {
          const event = cells[1], price = number(cells[2]);
          if (!/^(?:Pending sale|Price change|Listed for sale|Listing removed|Listed for rent|Sold|Rented|Relisted|Contingent|Listing pending)$/i.test(event)) { last = null; continue; }
          last = {date:date(cells[0]),event,kind:/rent/i.test(event)?'rental':'sale',...(price > 0 ? {price} : {})}; history.push(last);
        } else if (isHistory && cells.length === 1 && /^Source:/i.test(cells[0]) && last) {
          const source = cells[0].replace(/^Source:\s*/i,'').replace(/\s+Report\s+a problem.*$/i,'').trim();
          const mls = source.match(/#([A-Za-z0-9-]+)/); if (mls) last.mlsNumber = mls[1];
          last.source = source.replace(/\s*#[A-Za-z0-9-]+/,'').trim().slice(0,150);
          if (/rent/i.test(last.source)) last.kind = 'rental';
          last = null;
        }
      }
    }
    if (Object.keys(features).length) out.features = features;
    if (rooms.length) out.rooms = rooms;
    if (tax.length) out.tax_history = tax;
    if (history.length) out.listing_history = history;
    return out;
  }
  root.ZillowDomFields = {collect};
  if (typeof module !== 'undefined') module.exports = root.ZillowDomFields;
})(globalThis);
