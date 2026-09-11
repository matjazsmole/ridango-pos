/**
 * Fare-model resolver for Ridango "fullset" exports (NeTEx-style, versioned frames).
 *
 * The export is a list of frames; each frame holds entity lists. Entities are versioned
 * ("Code@id?version") and later versions carry `modification: "new" | "change"` with the
 * fields that apply from that version on. References without a version suffix
 * ("Code@id") always point at the latest version. This module merges all versions into
 * one entity map and derives what a point-of-sale needs: sellable offers per zone with prices.
 */

const POS_TYPE = 'TypeOfDistributionChannel@pos';

export function baseCode(code) {
  return typeof code === 'string' ? code.split('?')[0] : code;
}
export function classOf(code) {
  return typeof code === 'string' ? code.split('@')[0] : '';
}

/** Merge every versioned entity in the fullset into a single map keyed by base code. */
export function mergeEntities(fullset) {
  const entities = new Map();

  const register = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.code !== 'string') return;
    const code = baseCode(obj.code);
    const merged = entities.get(code) || { code };
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'code' || key === 'modification') continue;
      merged[key] = value;
    }
    entities.set(code, merged);
    walk(obj);
  };

  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(register); node.forEach((n) => { if (!n?.code) walk(n); }); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'code') continue;
      if (Array.isArray(value)) value.forEach((v) => (v?.code ? register(v) : walk(v)));
      else if (value && typeof value === 'object') (value.code ? register(value) : walk(value));
    }
  };

  for (const frame of fullset?.dataObjects?.frames || []) walk(frame);
  return entities;
}

/** Translated text: preferred language, then Swedish, English, or the first available. */
export function text(node, lang = 'sv') {
  const t = node?.translations;
  if (!t) return '';
  return t[lang] || t.sv || t.en || Object.values(t)[0] || '';
}

function keyValues(list) {
  const out = {};
  for (const kv of list?.keyValues || []) out[kv.key] = kv.value;
  return out;
}

function sortOrderOf(entity) {
  const n = Number(keyValues(entity?.publicKeyList).sortOrder);
  return Number.isFinite(n) ? n : 999;
}

/** Simple slug for CSS hooks: "UserProfile@1" + "Adult" → "adult". */
function slug(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Build the catalogue for one client/environment.
 * @param {object} fullset  Parsed fullset JSON.
 * @param {object} options  { distributionChannel?: string, language?: string }
 */
export function buildCatalog(fullset, options = {}) {
  const lang = options.language || 'sv';
  const E = mergeEntities(fullset);
  const get = (ref) => (typeof ref === 'string' ? E.get(baseCode(ref)) : ref);
  const name = (ref) => text(get(ref)?.name, lang);
  const byClass = (cls) => [...E.values()].filter((e) => classOf(e.code) === cls);

  // ---- Zones ----------------------------------------------------------------
  const zoneGroups = new Map(); // group code -> Set(member codes)
  for (const z of byClass('FareZone')) {
    if (Array.isArray(z.contains)) zoneGroups.set(z.code, new Set(z.contains.map(baseCode)));
  }
  const zones = byClass('FareZone')
    .filter((z) => !zoneGroups.has(z.code))
    .map((z) => ({ code: z.code, name: name(z) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  const zoneGroupName = (code) => name(code);
  const zoneRefCovers = (ref, zoneCode) => {
    const code = baseCode(ref);
    if (code === zoneCode) return 2; // exact
    if (zoneGroups.get(code)?.has(zoneCode)) return 1; // via group
    return 0;
  };

  // ---- Distribution channels -------------------------------------------------
  const wanted = options.distributionChannel ? [baseCode(options.distributionChannel)] : null;
  const channels = byClass('DistributionChannel').filter((c) =>
    wanted ? wanted.includes(c.code) : baseCode(c.typeOfDistributionChannel) === POS_TYPE
  );
  const channelSet = new Set(channels.map((c) => c.code));
  const groupSet = new Set(
    byClass('DistributionChannelGroup')
      .filter((g) => (g.members || []).some((m) => channelSet.has(baseCode(m))))
      .map((g) => g.code)
  );
  const assignmentOnChannel = (ref) => {
    const a = get(ref);
    if (!a) return false;
    if (a.distributionChannel && channelSet.has(baseCode(a.distributionChannel))) return true;
    if (a.distributionChannelGroup && groupSet.has(baseCode(a.distributionChannelGroup))) return true;
    return false;
  };

  // ---- Product types (tabs) ----------------------------------------------------
  const productTypes = byClass('TypeOfFareProduct')
    .map((t) => ({ code: t.code, name: name(t), sortOrder: sortOrderOf(t) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // ---- User profiles -----------------------------------------------------------
  const profiles = new Map(
    byClass('UserProfile').map((p) => [p.code, {
      code: p.code,
      name: name(p),
      description: text(p.description, lang),
      sortOrder: sortOrderOf(p),
      slug: slug(text(p.name, 'en') || text(p.name, 'sv')),
    }])
  );

  // ---- Product structure -------------------------------------------------------
  const structureOf = (product) => {
    const profileCodes = [];
    const zoneRefs = [];
    const timeIntervals = [];
    for (const ve of product.validableElements || []) {
      const validable = get(ve?.code ? ve.code : ve) || ve;
      for (const fseRef of validable?.fareStructureElements || []) {
        const fse = get(fseRef);
        if (!fse) continue;
        for (const ti of fse.timeIntervals || []) timeIntervals.push(baseCode(ti));
        for (const vpaRef of fse.validityParameterAssignments || []) {
          const vpa = get(vpaRef?.code ? vpaRef.code : vpaRef) || vpaRef;
          for (const lim of vpa?.limitations || []) {
            const code = baseCode(lim?.code || lim);
            if (classOf(code) === 'UserProfile') profileCodes.push(code);
          }
          for (const vp of vpa?.validityParameters || []) {
            const nvp = get(vp);
            for (const tz of nvp?.tariffZones || []) zoneRefs.push(baseCode(tz));
          }
        }
      }
    }
    return {
      profiles: [...new Set(profileCodes)].map((c) => profiles.get(c)).filter(Boolean).sort((a, b) => a.sortOrder - b.sortOrder),
      zoneRefs: [...new Set(zoneRefs)],
      timeIntervals: [...new Set(timeIntervals)],
    };
  };

  const cellsOf = (product) =>
    (product.fareTables || []).flatMap((ftRef) => (get(ftRef)?.cells || []).map((c) => get(c?.code ? c.code : c) || c));

  const priceFor = (product, cells, profileCode, zoneCode) => {
    let best = null;
    for (const cell of cells) {
      const objects = (cell.priceableObjects || []).map(baseCode);
      const cellProfiles = objects.filter((o) => classOf(o) === 'UserProfile');
      if (profileCode ? !cellProfiles.includes(profileCode) : cellProfiles.length) continue;
      let specificity = 0;
      const tz = cell.specifics?.tariffZone;
      if (tz) {
        specificity = zoneRefCovers(tz, zoneCode);
        if (!specificity) continue;
      }
      const price = get(cell.price?.code) || cell.price;
      if (!price || typeof price.amount !== 'number') continue;
      if (!best || specificity > best.specificity) best = { specificity, amount: price.amount, currency: price.currency || 'SEK' };
    }
    return best;
  };

  // ---- Offers (one card = package × user profile) --------------------------------
  const offers = [];
  for (const sop of byClass('SalesOfferPackage')) {
    const onChannel = (sop.distributionAssignments || []).some((a) => assignmentOnChannel(a?.code ? a.code : a));
    if (!onChannel) continue;
    const templates = keyValues(sop.keyList);
    for (const el of sop.salesOfferPackageElements || []) {
      const element = get(el?.code ? el.code : el) || el;
      const product = get(element?.fareProduct);
      if (!product) continue;
      const structure = structureOf(product);
      const cells = cellsOf(product);
      const typeCode = baseCode(product.typeOfFareProduct) || 'TypeOfFareProduct@TRAVEL_DOCUMENT';
      const categoryOrder = Math.min(...(product.productCategories || []).map((c) => sortOrderOf(get(c))), 999);
      const title = (text(sop.shortName, lang) || templates[`${lang}_derived_product_short_name_template`] || text(product.shortName, lang) || name(product)).trim();
      const profileList = structure.profiles.length ? structure.profiles : [null];
      for (const profile of profileList) {
        offers.push({
          id: `${sop.code}|${profile?.code || ''}`,
          packageCode: sop.code,
          packageName: name(sop),
          productCode: product.code,
          productName: name(product),
          description: text(product.description, lang) || templates[`${lang}_derived_product_description_template`] || '',
          typeCode,
          title,
          profile,
          categoryOrder,
          zoneRefs: structure.zoneRefs,
          hasPrices: cells.length > 0,
          priceIn: (zoneCode) => priceFor(product, cells, profile?.code, zoneCode),
          coversZone: (zoneCode) => !structure.zoneRefs.length || structure.zoneRefs.some((r) => zoneRefCovers(r, zoneCode) > 0),
          /** Name of the area the offer covers when sold in `zoneCode`: the zone itself, or the zone group (e.g. "Västmanland county +"). */
          coverageName: (zoneCode) => {
            let best = { score: 0, name: '' };
            for (const r of structure.zoneRefs) {
              const score = zoneRefCovers(r, zoneCode);
              if (score > best.score) best = { score, name: score === 2 ? name(r) : zoneGroupName(r) };
            }
            return best.name || name(zoneCode);
          },
        });
      }
    }
  }

  /** Sellable offers in a zone, each with its resolved price. */
  const offersInZone = (zoneCode) =>
    offers
      .filter((o) => o.coversZone(zoneCode))
      .map((o) => ({ ...o, price: o.priceIn(zoneCode) }))
      .filter((o) => !o.hasPrices || o.price)
      .sort((a, b) =>
        a.title.localeCompare(b.title, 'sv') ||
        (a.profile?.sortOrder ?? 0) - (b.profile?.sortOrder ?? 0) ||
        a.categoryOrder - b.categoryOrder
      );

  /** Product types that have at least one sellable offer in the zone, in configured order. */
  const typesInZone = (zoneCode) => {
    const present = new Set(offersInZone(zoneCode).map((o) => o.typeCode));
    return productTypes.filter((t) => present.has(t.code));
  };

  return {
    entities: E,
    zones,
    zoneName: (code) => zones.find((z) => z.code === code)?.name || name(code) || '',
    channels: channels.map((c) => ({ code: c.code, name: name(c) })),
    productTypes,
    profiles: [...profiles.values()],
    offers,
    offersInZone,
    typesInZone,
    publishedAt: fullset?.publicationTimestamp ? new Date(fullset.publicationTimestamp) : null,
  };
}
