/* Build-time product boundary. No URL or storage flag can enable another office. */
(function (root, factory) {
  const profile = factory();
  if (typeof module === 'object' && module.exports) module.exports = profile;
  else root.ElectionProductProfile = profile;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const offices = Object.freeze(['mayor', 'metro_mayor', 'county_mayor']);
  const allowsOffice = office => offices.includes(office);
  return Object.freeze({
    id: 'mayor', council: false, offices, allowsOffice,
    title: '台灣縣市長選舉：2022拉鋸地圖 → 2026拉票地圖',
    acceptSearch: record => /^#\/mayor(?:\/|\?|$)/.test(record.route || '') && (!record.office || allowsOffice(record.office)),
    redirectRoute(parsed, navigation) {
      if (parsed.office === 'mayor') return null;
      // Keep geographic context; never reuse council district/candidate identity.
      if (parsed.canonical) return navigation.serialize({office:'mayor',county:parsed.county,town:parsed.town,village:parsed.village});
      return parsed.county ? '#/mayor/' + encodeURIComponent(parsed.county) : '#/mayor';
    }
  });
});
