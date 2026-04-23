/* ============================================================
   GEO-API — Countries (RestCountries) + Cities (Nominatim OSM)
   ============================================================ */

const GEO = (() => {
  let _countries = [];   // [{name, code, flag, currency:{code,symbol}}]
  let _citiesCache = {}; // cacheKey → [{name, country, countryCode}]
  let _searchTimer = null;
  let _initPromise = null;

  // ---- Init: load all countries once ----
  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = _loadCountries();
    return _initPromise;
  }

  async function _loadCountries() {
    try {
      const res = await fetch(
        'https://restcountries.com/v3.1/all?fields=name,cca2,flag,currencies,translations',
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      _countries = data.map(c => {
        // Prefer Russian name from translations
        const name = (c.translations && c.translations.rus && c.translations.rus.common)
          || c.name.common;
        const currEntries = Object.entries(c.currencies || {});
        const currency = currEntries.length
          ? { code: currEntries[0][0], symbol: currEntries[0][1]?.symbol || currEntries[0][0] }
          : { code: 'USD', symbol: '$' };
        return { name, code: (c.cca2 || '').toLowerCase(), flag: c.flag || '🏳️', currency };
      }).filter(c => c.code); // remove entries without code

      _sortCountries();
      console.log('[GEO] Loaded', _countries.length, 'countries');
    } catch (e) {
      console.warn('[GEO] RestCountries API failed, using fallback:', e.message);
      _useFallback();
    }
  }

  // CIS countries pinned to top, rest alphabetical by Russian name
  const _CIS_ORDER = [
    'Казахстан','Россия','Беларусь','Украина','Узбекистан',
    'Кыргызстан','Таджикистан','Туркменистан','Армения',
    'Грузия','Азербайджан','Молдова'
  ];

  function _sortCountries() {
    _countries.sort((a, b) => {
      const ai = _CIS_ORDER.indexOf(a.name);
      const bi = _CIS_ORDER.indexOf(b.name);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.name.localeCompare(b.name, 'ru');
    });
  }

  // Fallback: use static COUNTRIES from config.js
  function _useFallback() {
    const CUR = { kz:'KZT',ru:'RUB',by:'BYN',uz:'UZS',kg:'KGS',tj:'TJS',tm:'TMT',ua:'UAH',am:'AMD',ge:'GEL',az:'AZN',md:'MDL' };
    const SYM = { KZT:'₸',RUB:'₽',BYN:'Br',UZS:'сўм',KGS:'с',TJS:'SM',TMT:'T',UAH:'₴',AMD:'֏',GEL:'₾',AZN:'₼',MDL:'L' };
    _countries = Object.entries(window.COUNTRIES || {}).map(([name, c]) => {
      const cur = CUR[c.code] || 'USD';
      return { name, code: c.code, flag: c.flag, currency: { code: cur, symbol: SYM[cur] || cur } };
    });
    _sortCountries();
  }

  // ---- Search countries (synchronous, from cache) ----
  function searchCountries(query) {
    if (!_countries.length) return [];
    if (!query) return _countries.slice(0, 8);
    const q = query.toLowerCase();
    return _countries.filter(c => c.name.toLowerCase().includes(q)).slice(0, 10);
  }

  // ---- Get country by ISO-2 code ----
  function getCountry(code) {
    return _countries.find(c => c.code === (code || '').toLowerCase()) || null;
  }

  // ---- Normalize city name: strip administrative suffixes ----
  function _normalizeCity(name) {
    if (!name) return '';
    return name
      .replace(/\s+[Гг]\.[Аа]\b\.?/g, '')           // "г.а." — городская администрация
      .replace(/\s+[Гг][Оо]\b\.?/g, '')              // "г.о." — городской округ
      .replace(/\s+[Гг]ород(ской)?\s+[Оо]круг\b/gi, '')
      .replace(/\s+[Мм]униципальный\s+[Рр]айон\b/gi, '')
      .replace(/\s+[Мм]униципальный\s+[Оо]круг\b/gi, '')
      .replace(/\s+[Рр]айон\b/gi, '')
      .replace(/\s+[Оо]бласть\b/gi, '')
      .replace(/^[Гг]\.\s*/, '')                     // leading "г." prefix
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ---- Search cities via Nominatim (async, debounced, cached) ----
  const SETTLEMENT = new Set([
    'city','town','village','municipality','hamlet',
    'borough','suburb','quarter','administrative'
  ]);

  function searchCities(query, countryCode, callback) {
    if (!query || query.length < 2) { callback([]); return; }

    const cacheKey = `${query.toLowerCase()}_${(countryCode || '').toLowerCase()}`;
    if (_citiesCache[cacheKey]) { callback(_citiesCache[cacheKey]); return; }

    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      try {
        let url = `https://nominatim.openstreetmap.org/search`
          + `?format=json&q=${encodeURIComponent(query)}`
          + `&addressdetails=1&limit=12&accept-language=ru,en`;
        if (countryCode) url += `&countrycodes=${countryCode.toLowerCase()}`;

        const res = await fetch(url, {
          headers: { 'User-Agent': 'TelegramTaxiApp/1.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        const seen = new Set();
        const results = data
          .filter(r => r.addresstype && SETTLEMENT.has(r.addresstype))
          .map(r => {
            const addr = r.address || {};
            // Prefer canonical address fields; normalize to remove admin suffixes
            const raw = addr.city || addr.town || addr.village
                     || addr.suburb || addr.borough || r.name;
            const name = _normalizeCity(raw);
            return {
              name,
              country: addr.country || '',
              countryCode: (addr.country_code || '').toUpperCase()
            };
          })
          .filter(r => {
            if (!r.name) return false;
            const key = r.name.toLowerCase() + '_' + r.countryCode.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        _citiesCache[cacheKey] = results;
        callback(results);
      } catch (e) {
        console.warn('[GEO] Nominatim failed, fallback:', e.message);
        // Fallback to static city list
        const q = query.toLowerCase();
        const seen = new Set();
        const fallback = [];
        Object.entries(window.COUNTRIES || {}).forEach(([cname, c]) => {
          (c.cities || []).forEach(city => {
            if (city.toLowerCase().includes(q) && !seen.has(city.toLowerCase())) {
              seen.add(city.toLowerCase());
              fallback.push({ name: city, country: cname, countryCode: c.code.toUpperCase() });
            }
          });
        });
        callback(fallback.slice(0, 10));
      }
    }, 380);
  }

  // ---- Get currency for a country code ----
  function getCurrency(countryCode) {
    const c = getCountry(countryCode);
    return c ? c.currency : { code: 'KZT', symbol: '₸' };
  }

  return { init, searchCountries, getCountry, searchCities, getCurrency };
})();
