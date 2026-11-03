"use strict";

(function exposeViewerCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ElectionViewerCore = api;
})(typeof globalThis === "object" ? globalThis : null, function createViewerCore() {
  function samePoint(a, b) {
    return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
  }

  function unionBounds(features) {
    if (!features.length) throw new Error("cannot derive bounds from an empty feature set");
    return [
      Math.min(...features.map((feature) => feature.bbox[0])),
      Math.min(...features.map((feature) => feature.bbox[1])),
      Math.max(...features.map((feature) => feature.bbox[2])),
      Math.max(...features.map((feature) => feature.bbox[3])),
    ];
  }

  function polygonBounds(polygon) {
    const points = polygon.flat();
    if (!points.length) throw new Error("cannot derive bounds from an empty polygon");
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function signedRingArea(ring) {
    let area = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
  }

  function polygonArea(polygon) {
    if (!polygon.length) return 0;
    return Math.max(
      0,
      Math.abs(signedRingArea(polygon[0]))
        - polygon.slice(1).reduce((total, ring) => total + Math.abs(signedRingArea(ring)), 0),
    );
  }

  function pointInRing(point, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const current = ring[index];
      const prior = ring[previous];
      const intersects = current[1] > point[1] !== prior[1] > point[1]
        && point[0] < ((prior[0] - current[0]) * (point[1] - current[1]))
          / ((prior[1] - current[1]) || 1e-12) + current[0];
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, polygon) {
    return Boolean(
      polygon.length
      && pointInRing(point, polygon[0])
      && !polygon.slice(1).some((hole) => pointInRing(point, hole)),
    );
  }

  function ringCentroid(ring) {
    const area = signedRingArea(ring);
    if (Math.abs(area) < 1e-12) {
      const [minX, minY, maxX, maxY] = polygonBounds([ring]);
      return [(minX + maxX) / 2, (minY + maxY) / 2];
    }
    let x = 0;
    let y = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const cross = current[0] * next[1] - next[0] * current[1];
      x += (current[0] + next[0]) * cross;
      y += (current[1] + next[1]) * cross;
    }
    return [x / (6 * area), y / (6 * area)];
  }

  function scanlineAnchor(polygon) {
    const [minX, minY, maxX, maxY] = polygonBounds(polygon);
    let best = null;
    const steps = 41;
    for (let step = 0; step < steps; step += 1) {
      const y = minY + ((step + 0.5) / steps) * (maxY - minY);
      const intersections = [];
      polygon.forEach((ring) => {
        for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
          const current = ring[index];
          const prior = ring[previous];
          if (current[1] > y === prior[1] > y) continue;
          intersections.push(
            current[0] + ((y - current[1]) * (prior[0] - current[0]))
              / ((prior[1] - current[1]) || 1e-12),
          );
        }
      });
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = intersections[index];
        const right = intersections[index + 1];
        const candidate = [(left + right) / 2, y];
        if (right > left && pointInPolygon(candidate, polygon) && (!best || right - left > best.width)) {
          best = { point: candidate, width: right - left };
        }
      }
    }
    return best ? best.point : null;
  }

  function labelPlacement(polygons, containmentPolygons = polygons) {
    if (!Array.isArray(polygons) || !polygons.length) throw new Error("cannot derive label anchor from empty polygons");
    const polygon = [...polygons].sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    const centroid = ringCentroid(polygon[0]);
    let anchor = centroid;
    if (!pointInPolygon(anchor, polygon)) {
      const [minX, minY, maxX, maxY] = polygonBounds(polygon);
      const center = [(minX + maxX) / 2, (minY + maxY) / 2];
      anchor = pointInPolygon(center, polygon)
        ? center
        : scanlineAnchor(polygon) || polygon[0][0];
    }
    const placement = { anchor, bbox: polygonBounds(polygon), area: polygonArea(polygon) };
    const containers = Array.isArray(containmentPolygons) && containmentPolygons.length
      ? containmentPolygons
      : polygons;
    if (containers.some((candidate) => pointInPolygon(anchor, candidate))) return placement;
    const fallback = [...containers].sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    return labelPlacement([fallback], [fallback]);
  }

  function labelAnchor(polygons) {
    return labelPlacement(polygons).anchor;
  }

  function intersects(bounds, windowBounds) {
    const [minX, minY, maxX, maxY] = bounds;
    return maxX >= windowBounds[0]
      && minX <= windowBounds[2]
      && maxY >= windowBounds[1]
      && minY <= windowBounds[3];
  }

  function deriveBounds(features) {
    const fullBounds = unionBounds(features);
    const primaryWindow = [118, 21, 123, 27];
    const primaryComponents = features.flatMap((feature) => {
      if (!Array.isArray(feature.polygons)) return [{ bbox: feature.bbox }];
      return feature.polygons.map((polygon) => ({ bbox: polygonBounds(polygon) }));
    }).filter((component) => intersects(component.bbox, primaryWindow));
    return {
      fullBounds,
      primaryBounds: primaryComponents.length ? unionBounds(primaryComponents) : fullBounds,
    };
  }

  function sameBounds(left, right, tolerance = 1e-9) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === 4
      && right.length === 4
      && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
  }

  const REQUIRED_AREA_COLUMNS = [
    "source_area_id", "source_geo_key", "comparison_area_id", "map_area_ids",
    "resolution_status", "county_name", "township_name", "village_name",
    "electoral_district_name", "valid_votes", "invalid_votes", "total_votes",
    "electorate", "turnout_ratio",
  ];
  const REQUIRED_OPTION_COLUMNS = [
    "option_id", "option_no", "option_name", "party_name", "running_mate",
    "source_option_id", "contest_scope",
  ];

  function validateColumns(columns, required, label) {
    if (!Array.isArray(columns)
      || columns.some((name) => typeof name !== "string" || !name)
      || new Set(columns).size !== columns.length
      || required.some((name) => !columns.includes(name))) {
      throw new Error(`invalid shard ${label} columns`);
    }
  }

  function validateShard(shard, metadata) {
    if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
      throw new Error("invalid shard document");
    }
    if (shard.schema !== "election-machine-offline-v1") {
      throw new Error("invalid shard schema");
    }
    if (!metadata || typeof metadata !== "object" || !shard.election || typeof shard.election !== "object") {
      throw new Error("invalid shard election metadata");
    }
    if (String(shard.election.id || "") !== String(metadata.id || "")) {
      throw new Error("shard election id does not match manifest");
    }
    if (!Number.isInteger(shard.election.year) || shard.election.year !== metadata.year) {
      throw new Error("shard election year does not match manifest");
    }
    validateColumns(shard.area_columns, REQUIRED_AREA_COLUMNS, "area");
    validateColumns(shard.option_columns, REQUIRED_OPTION_COLUMNS, "option");
    if (!Array.isArray(shard.areas) || shard.areas.length !== metadata.area_count) {
      throw new Error("shard area count does not match manifest");
    }
    if (!Array.isArray(shard.options) || shard.options.length !== metadata.option_count) {
      throw new Error("shard option count does not match manifest");
    }
    if (!Array.isArray(shard.votes)) throw new Error("invalid shard votes array");

    const mapIdsColumn = shard.area_columns.indexOf("map_area_ids");
    shard.areas.forEach((row) => {
      if (!Array.isArray(row) || row.length < shard.area_columns.length) {
        throw new Error("invalid shard area row");
      }
      const mapIds = row[mapIdsColumn];
      if (!Array.isArray(mapIds) || mapIds.some((value) => typeof value !== "string")) {
        throw new Error("invalid shard map area ids");
      }
    });
    shard.options.forEach((row) => {
      if (!Array.isArray(row) || row.length < shard.option_columns.length) {
        throw new Error("invalid shard option row");
      }
    });
    shard.votes.forEach((row) => {
      if (!Array.isArray(row) || row.length !== 3) throw new Error("invalid shard vote row");
      const [areaIndex, optionIndex, voteValue] = row;
      if (!Number.isInteger(areaIndex)
        || areaIndex < 0
        || areaIndex >= shard.areas.length
        || !Number.isInteger(optionIndex)
        || optionIndex < 0
        || optionIndex >= shard.options.length) {
        throw new Error("invalid shard vote index");
      }
      if (!Number.isInteger(voteValue) || voteValue < 0) {
        throw new Error("invalid shard vote value");
      }
    });
    return shard;
  }

  // A display union, never a replacement source election. Both original shards
  // are validated before offsets are applied; counties must be disjoint.
  function combineMayor2022(primary, metadata, rerun, rerunMetadata) {
    validateShard(primary, metadata); validateShard(rerun, rerunMetadata);
    const countyColumn = primary.area_columns.indexOf("county_name");
    const counties = [...new Set(primary.areas.map((a) => a[countyColumn]))].sort();
    if (primary.election.id !== "mayor_2022" || primary.election.type !== "mayor"
      || primary.election.year !== 2022 || rerun.election.year !== 2022
      || rerun.election.type !== "mayor" || !/^mayor_rerun_2022_[0-9]+$/.test(rerun.election.id)
      || !String(rerun.election.name).includes("重行選舉")
      || JSON.stringify(primary.area_columns) !== JSON.stringify(rerun.area_columns)
      || JSON.stringify(primary.option_columns) !== JSON.stringify(rerun.option_columns)
      || counties.length !== 21 || JSON.stringify(counties) !== JSON.stringify([...metadata.counties].sort())
      || primary.areas.some((area) => area[countyColumn] === "嘉義市")
      || !rerun.areas.length || rerun.areas.some((area) => area[countyColumn] !== "嘉義市")
      || JSON.stringify(rerunMetadata.counties) !== '["嘉義市"]') {
      throw new Error("invalid 2022 mayor display union identity or overlapping county");
    }
    const ids = new Set(primary.areas.map((a) => a[primary.area_columns.indexOf("source_area_id")]));
    if (rerun.areas.some((a) => ids.has(a[primary.area_columns.indexOf("source_area_id")]))) {
      throw new Error("overlapping 2022 display source areas");
    }
    const mapColumn = primary.area_columns.indexOf("map_area_ids");
    const mapIds = new Set(primary.areas.flatMap((a) => a[mapColumn]));
    if (rerun.areas.some((a) => a[mapColumn].some((id) => mapIds.has(id)))) throw new Error("overlapping 2022 display geometry");
    return {...primary, areas:[...primary.areas, ...rerun.areas], options:[...primary.options, ...rerun.options],
      votes:[...primary.votes, ...rerun.votes.map(([a,o,v]) => [a+primary.areas.length,o+primary.options.length,v])]};
  }

  function mobilizationRate(votes, electorates) {
    if (!historyCount(votes) || !electorates.length || !electorates.every(historyCount)) return null;
    const denominator = electorates.reduce((sum, n) => sum + n, 0);
    return Number.isSafeInteger(denominator) && denominator > 0 && votes <= denominator ? votes / denominator : null;
  }

  function mobilizationOpacity(rate) {
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
    return (Math.min(9, Math.floor(rate * 10)) + 1) / 10;
  }

  function historyDisplayArea(area) {
    if (!area || area.names.length !== 3) return area;
    const granularityLimits = [];
    const limitedYears = new Set();
    const periods = area.periods.map((period) => {
      const excluded = period.elections.filter((race) => race.unmapped_area_count !== 0
        || race.resolution_status_counts.exact !== race.source_area_count);
      if (!excluded.length) return period;
      limitedYears.add(period.year);
      granularityLimits.push({year: period.year, elections: excluded});
      // A same-year partial village total would change the source scope too.
      return {...period, elections: []};
    });
    if (!limitedYears.size) return area;
    const mask = (values) => values.map((value, i) => limitedYears.has(area.chart.years[i]) ? null : value);
    return {...area, periods, granularity_limits: granularityLimits,
      chart: {...area.chart, electorate: mask(area.chart.electorate),
        series: area.chart.series.map((line) => ({...line,
          votes: mask(line.votes), votes_per_elector: mask(line.votes_per_elector)}))}};
  }

  function mayorCoverageInfo(record, year, county) {
    const scopes = (record?.coverage || []).filter((scope) => scope.year === year);
    const counties = [...new Set(scopes.map((scope) => scope.county))].sort();
    const scope = scopes.find((item) => item.county === county) || null;
    const predecessor = {"新北市":"臺北縣", "桃園市":"桃園縣", "臺中市":"臺中縣",
      "臺南市":"臺南縣", "高雄市":"高雄縣"}[county];
    const historicalCounty = predecessor && counties.includes(predecessor) ? predecessor : null;
    return {counties, scope, historicalCounty};
  }

  function combineHistoryAreas(mayor, president, mayorSourceRecord = null) {
    const names = new Map();
    [mayor, president].filter(Boolean).forEach((shard) => shard.areas.forEach((a) => names.set(JSON.stringify(a.names), a.names)));
    return [...names].map(([key, scope]) => {
      const sources = [["mayor", mayor], ["president", president]].map(([type, shard]) =>
        ({type, area:historyDisplayArea(shard?.areas.find((a) => JSON.stringify(a.names) === key)), years:shard?.years || []}));
      const years = [...new Set(sources.flatMap((s) => s.years))].sort((a,b) => b-a);
      const periods = [...years].reverse().map((year) => ({year, elections:sources.flatMap((s) =>
        (s.area?.periods.find((p) => p.year === year)?.elections || []).map((e) => ({...e, type:s.type})))}));
      const series = sources.flatMap((s) => (s.area?.chart.series || []).map((line) =>
        ({...line, type:s.type, years:s.area.chart.years})));
      const ordered = [...periods].reverse();
      const granularityLimits = sources.flatMap((s) => (s.area?.granularity_limits || []).map((limit) =>
        ({year: limit.year, elections: limit.elections.map((e) => ({...e, type: s.type}))})));
      if (scope.length === 3) (mayorSourceRecord?.coverage || []).filter((r) =>
        r.county === scope[0] && r.source_grain === "township").forEach((r) => {
        const town = mayor?.areas.find((a) => JSON.stringify(a.names) === JSON.stringify(scope.slice(0, 2)));
        const race = town?.periods.find((p) => p.year === r.year)?.elections.find((e) => e.id === r.election_id);
        if (race && !granularityLimits.some((limit) => limit.year === r.year && limit.elections.some((e) => e.type === "mayor"))) {
          granularityLimits.push({year:r.year, source_names:town.names, elections:[{...race, type:"mayor"}]});
        }
      });
      return {names:scope, periods, granularity_limits:granularityLimits, chart:{years, series,
        status:ordered.map((p) => p.elections.length === 1 ? "available" : p.elections.length ? "multiple" : "missing"),
        electorate:ordered.map((p) => p.elections.length === 1 ? p.elections[0].electorate : null),
        electorate_by_type:sources.filter((s) => s.area).map((s) =>
          ({type:s.type, party:"選舉人數", years:s.area.chart.years, values:s.area.chart.electorate}))}};
    });
  }

  function decodeTopology(topology) {
    const transform = topology.transform || null;
    const arcCache = new Map();

    function decodeArc(index) {
      const reversed = index < 0;
      const sourceIndex = reversed ? ~index : index;
      if (!arcCache.has(sourceIndex)) {
        const source = topology.arcs[sourceIndex] || [];
        let points;
        if (transform) {
          let x = 0;
          let y = 0;
          points = source.map((delta) => {
            x += delta[0];
            y += delta[1];
            return [
              x * transform.scale[0] + transform.translate[0],
              y * transform.scale[1] + transform.translate[1],
            ];
          });
        } else {
          points = source.map((point) => [point[0], point[1]]);
        }
        arcCache.set(sourceIndex, points);
      }
      const points = arcCache.get(sourceIndex);
      return reversed ? [...points].reverse() : points;
    }

    function stitch(indexes) {
      const ring = [];
      indexes.forEach((index) => {
        const arc = decodeArc(index);
        arc.forEach((point, pointIndex) => {
          if (ring.length && pointIndex === 0 && samePoint(ring[ring.length - 1], point)) return;
          ring.push(point);
        });
      });
      return ring;
    }

    function polygonsFor(geometry) {
      if (geometry.type === "Polygon") return [geometry.arcs.map(stitch)];
      if (geometry.type === "MultiPolygon") return geometry.arcs.map((polygon) => polygon.map(stitch));
      return [];
    }

    function arcRingsFor(geometry) {
      if (geometry.type === "Polygon") return geometry.arcs;
      if (geometry.type === "MultiPolygon") return geometry.arcs.flat();
      return [];
    }

    const collection = topology.objects && (topology.objects.village || topology.objects.county || topology.objects.town || Object.values(topology.objects)[0]);
    if (!collection || !Array.isArray(collection.geometries)) {
      throw new Error("本地圖資缺少 geometry collection");
    }
    const features = collection.geometries.map((geometry) => {
      const polygons = polygonsFor(geometry);
      const points = polygons.flat(2);
      if (!points.length) throw new Error("本地圖資包含空 geometry");
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      return {
        properties: geometry.properties || {},
        polygons,
        arcRings: arcRingsFor(geometry),
        decodeArc,
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
    return { features, ...deriveBounds(features) };
  }

  function buildMapAreaIndexes(areas, mapColumn) {
    const indexes = new Map();
    areas.forEach((area, areaIndex) => {
      const ids = Array.isArray(area[mapColumn]) ? area[mapColumn] : [];
      ids.forEach((rawId) => {
        const id = String(rawId);
        if (!indexes.has(id)) indexes.set(id, []);
        const values = indexes.get(id);
        if (!values.includes(areaIndex)) values.push(areaIndex);
      });
    });
    return indexes;
  }

  function resultForAreas(areaIndexes, votesByArea, optionCount) {
    const votes = Array(optionCount).fill(0);
    areaIndexes.forEach((areaIndex) => {
      const areaVotes = votesByArea[areaIndex] || [];
      for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
        const value = Number(areaVotes[optionIndex] || 0);
        if (Number.isFinite(value)) votes[optionIndex] += value;
      }
    });
    if (!areaIndexes.length) return { kind: "missing", optionIndex: -1, votes };
    const maximum = Math.max(0, ...votes);
    if (maximum <= 0) return { kind: "zero", optionIndex: -1, votes };
    const winners = votes
      .map((value, optionIndex) => ({ value, optionIndex }))
      .filter((entry) => entry.value === maximum);
    if (winners.length !== 1) return { kind: "tie", optionIndex: -1, votes };
    return { kind: "winner", optionIndex: winners[0].optionIndex, votes };
  }

  function mapDetailScope(region) {
    const areaIndexes = [...(region.mapAreaIndexes || [])];
    const supplementalAreaIndexes = [...(region.supplementalAreaIndexes || [])];
    return {
      areaIndexes,
      supplementalAreaIndexes,
      sourceAreaCount: (region.areaIndexes || []).length,
      isPartial: supplementalAreaIndexes.length > 0,
    };
  }

  function mapLinkageLabel(mapIds) {
    const values = Array.isArray(mapIds) ? mapIds.filter((value) => String(value)) : [];
    if (!values.length) return "未對位來源資料";
    if (values.length > 1) return "跨村里來源資料";
    return "村里資料";
  }

  function mapBoundaryStyle(level, selected, swingStatus = null, theme = "light", options = {}) {
    const style = legacyMapBoundaryStyle(level, selected, swingStatus, theme, options);
    if (!Number.isFinite(options.viewportWidth)) return style;
    // CSS pixels, independent of devicePixelRatio. Dense/small maps need finer lines.
    const size = Math.min(options.viewportWidth, options.viewportHeight || options.viewportWidth);
    const responsive = Math.max(.65, Math.min(1, size / 640));
    const zoom = Math.max(1, Math.min(6, options.zoom || 1));
    const detail = 1 + Math.log2(zoom) * .12;
    const base = level === "county" ? 1 : level === "village" ? .55 : .75;
    const width = Math.min(1.6, base * responsive * detail + (swingStatus ? .25 * responsive : 0));
    if (selected) return {...style, outerColor:"#ffffff", innerColor:"#17212b",
      outerWidth:Math.min(2.2, width + 1, Number.isFinite(options.featurePixels) ? Math.max(.8,Math.min(1.8,options.featurePixels * .14)) : 2.2), innerWidth:Math.min(1.1, width + .15, Number.isFinite(options.featurePixels) ? Math.max(.4,Math.min(.9,options.featurePixels * .07)) : 1.1),
      striped:false, dash:[], interaction:true};
    return {...style, outerWidth:width, innerWidth:width * .4,
      ...(style.dash ? {dash:style.dash.map(n=>n * responsive)} : {})};
  }

  function legacyMapBoundaryStyle(level, selected, swingStatus = null, theme = "light", options = {}) {
    const dark = theme === "dark";
    const styles = dark ? {
      county: { outerColor: "rgba(231,239,248,0.95)", innerColor: "rgba(23,34,47,0.98)", outerWidth: 3.2, innerWidth: 1.3 },
      second: { outerColor: "rgba(210,222,236,0.88)", innerColor: "rgba(35,49,64,0.95)", outerWidth: 1.8, innerWidth: 0.7 },
      village: { outerColor: "rgba(194,208,224,0.78)", innerColor: "rgba(39,55,72,0.90)", outerWidth: 1.35, innerWidth: 0.45 },
    } : {
      county: { outerColor: "rgba(255,255,255,0.96)", innerColor: "rgba(20,35,52,0.90)", outerWidth: 3.2, innerWidth: 1.3 },
      second: { outerColor: "rgba(255,255,255,0.76)", innerColor: "rgba(34,52,68,0.74)", outerWidth: 1.8, innerWidth: 0.7 },
      village: { outerColor: "rgba(255,255,255,0.66)", innerColor: "rgba(43,59,72,0.62)", outerWidth: 1.35, innerWidth: 0.45 },
    };
    const baseStyle = styles[level] || styles.village;
    const style = { ...baseStyle };

    // Dynamic stroke width adjustment for national/zoomed-out view to avoid visual clutter
    if (typeof options.zoom === "number" || typeof options.scale === "number") {
      const z = options.zoom ?? 1;
      if (level === "county") {
        // At zoom <= 1 (national overview), refine county stroke width from 3.2 to ~1.2-1.5px
        const factor = Math.min(1.0, Math.max(0.42, 0.42 + (z - 1) * 0.28));
        style.outerWidth = Math.max(1.1, +(baseStyle.outerWidth * factor).toFixed(2));
        style.innerWidth = Math.max(0.45, +(baseStyle.innerWidth * factor).toFixed(2));
      } else if (level === "second") {
        const factor = Math.min(1.0, Math.max(0.65, 0.65 + (z - 1) * 0.25));
        style.outerWidth = Math.max(1.0, +(baseStyle.outerWidth * factor).toFixed(2));
        style.innerWidth = Math.max(0.4, +(baseStyle.innerWidth * factor).toFixed(2));
      }
    }

    if (swingStatus === "close_swing") {
      return {
        ...style,
        outerColor: dark ? "#f43f5e" : "#dc2626",
        stripeColor: "#facc15",
        innerColor: dark ? "#fbbf24" : "#991b1b",
        outerWidth: selected ? 3.8 : 3.0,
        innerWidth: selected ? 1.8 : 1.2,
        striped: !dark,
        dash: [6, 6],
      };
    }
    if (swingStatus === "close_only") {
      return {
        ...style,
        outerColor: dark ? "#f59e0b" : "#d97706",
        innerColor: dark ? "#1e2736" : "#ffffff",
        outerWidth: selected ? 3.4 : 2.6,
        innerWidth: selected ? 1.6 : 1.0,
        striped: false,
      };
    }
    if (swingStatus === "swing_only") {
      return {
        ...style,
        outerColor: dark ? "#a855f7" : "#7c3aed",
        innerColor: dark ? "#1e2736" : "#ffffff",
        outerWidth: selected ? 3.2 : 2.4,
        innerWidth: selected ? 1.4 : 0.8,
        dash: [4, 4],
        striped: false,
      };
    }
    if (swingStatus === "swing") {
      return {
        ...style,
        outerColor: "#facc15",
        innerColor: "#854d0e",
        outerWidth: selected ? 3.6 : 2.5,
        innerWidth: selected ? 1.8 : 1.0,
        striped: false,
      };
    }
    if (swingStatus === "bellwether") {
      return {
        ...style,
        outerColor: dark ? "#10b981" : "#059669",
        innerColor: dark ? "#1e2736" : "#ffffff",
        outerWidth: selected ? 3.2 : 2.4,
        innerWidth: selected ? 1.4 : 0.8,
        striped: false,
      };
    }

    if (!selected) return { ...style };
    return {
      ...style,
      innerColor: "rgba(10,20,32,0.98)",
      outerWidth: style.outerWidth + 1,
      innerWidth: style.innerWidth + 1,
    };
  }

  function observationRegionBaseFill(region, swingRecord, options = {}) {
    const dark = options.theme === "dark";
    const selected = Boolean(options.selected);
    const hover = Boolean(options.hover);
    const mode = options.mode || "mayor"; // "mayor" | "council"
    const mayorMetrics = options.mayorMetrics || null;
    const councilMetrics = options.councilMetrics || null;

    if (!["mayor", "council"].includes(mode)) return {fill:dark ? "#737373" : "#d4d4d4", badge:"行政區定位", statusKey:"default", intensity:0.25, isHighlighted:false};
    if(mode === "council" && Object.prototype.hasOwnProperty.call(options,"councilLayerRecord")) {
      const record=options.councilLayerRecord;
      if(!record || !Number.isFinite(record.value))return {fill:dark?"#737373":"#d4d4d4",badge:record?.reason||"無法唯一對照／未提供資料",statusKey:"default",intensity:0.25,isHighlighted:false};
      const v=record.value,competition=options.councilLayer==="competition";
      if(!competition && v<0)return {fill:dark?"#a21caf":"#d946ef",badge:record.label,statusKey:"negative",intensity:1,isHighlighted:false};
      const i=competition?(v<=1?3:v<=1.5?2:v<=2?1:0):(v<=1?0:v<=3?1:v<=6?2:3);
      return {fill:(dark?["#fbbf24","#d97706","#9a3412","#4c315b"]:["#9a3412","#d97706","#fcd34d","#e9dcf0"])[i],badge:record.label,statusKey:"metric",intensity:1,isHighlighted:false};
    }
    // 模式 1: 議員模式 (Councilor Mode)
    if (mode === "council") {
      if (region?.level === "village") return {fill:dark ? "#737373" : "#d4d4d4", badge:"議員行政區定位", statusKey:"default", intensity:0.25, isHighlighted:false};
      if (region?.level === "county") {
        // 全國層：淺灰底色，可點擊
        return {
          fill: dark ? "#737373" : "#d4d4d4",
          badge: "點選進入縣市選區",
          statusKey: "county_base",
          intensity: 0.3,
          isHighlighted: false,
        };
      }
      // 縣市層（鄉鎮市區）：比對其所屬之區域議員選區
      if (councilMetrics && Array.isArray(councilMetrics.districts)) {
        const matchingDistricts = councilMetrics.districts.filter(d => {
          if (d.county !== region.county || (d.office_kind || d.scope) !== "regional") return false;
          // 比對 townships 或 partial_townships
          const locs = options.councilorLocations || [];
          const loc = locs.find(l => l.district_id === d.map_district_id || (l.county === d.county && l.scope === d.scope && l.district_no === d.district_no));
          if (loc) {
            return (loc.townships || []).includes(region.township || region.label)
              || (loc.partial_townships || []).includes(region.township || region.label);
          }
          return false;
        });

        const matchingDistrict = matchingDistricts.length === 1 ? matchingDistricts[0] : null;
        const location = matchingDistrict && (options.councilorLocations || []).find(l => l.district_id === matchingDistrict.map_district_id);
        if (matchingDistrict && !(location?.partial_townships || []).includes(region.township || region.label)) {
          const comp = matchingDistrict.comparability?.["2022_2026"];
          const m = matchingDistrict.margin?.["2022"];
          if (comp === "redistricted" || !m || m.uncontested) {
            return {
              fill: "stripe",
              badge: m?.uncontested ? "同額競選" : "新劃選區",
              statusKey: "stripe",
              intensity: 0.2,
              isHighlighted: false,
            };
          }
          const pct = m.pct;
          if (pct != null) {
            if (pct <= 1) {
              return { fill: dark ? "#fbbf24" : "#9a3412", badge: `極接近 (差距 ${pct}%)`, statusKey: "tight", intensity: 1, isHighlighted: false };
            }
            if (pct <= 3) {
              return { fill: dark ? "#d97706" : "#d97706", badge: `接近 (差距 ${pct}%)`, statusKey: "close", intensity: 0.75, isHighlighted: false };
            }
            if (pct <= 6) {
              return { fill: dark ? "#9a3412" : "#fcd34d", badge: `普通 (差距 ${pct}%)`, statusKey: "normal", intensity: 0.5, isHighlighted: false };
            }
            return { fill: dark ? "#4c315b" : "#e9dcf0", badge: `寬鬆 (差距 ${pct}%)`, statusKey: "loose", intensity: 0.25, isHighlighted: false };
          }
        }
      }
      return {
        fill: dark ? "#737373" : "#d4d4d4",
        badge: "行政區定位（無可對照選區指標）",
        statusKey: "default",
        intensity: 0.25,
        isHighlighted: false,
      };
    }

    // Fixed 2022 margin scale; historical party turnover is a separate metric.
    const pct = region?.level === "county"
      ? mayorMetrics?.counties?.find(c => c.county === region.county)?.margin_2022_pct
      : swingRecord?.marginPct;
    if (pct == null || !Number.isFinite(pct)) return {fill:"stripe", badge:"2022 差距資料不足", statusKey:"missing", intensity:0.2, isHighlighted:false};
    const i = pct <= 1 ? 0 : pct <= 3 ? 1 : pct <= 6 ? 2 : 3;
    return {fill:(dark ? ["#fbbf24","#d97706","#9a3412","#4c315b"] : ["#9a3412","#d97706","#fcd34d","#e9dcf0"])[i], badge:`2022 票差占選舉人數 ${pct}%`, statusKey:["tight","close","normal","loose"][i], intensity:1-i*0.25, isHighlighted:false};
  }

  function observationRegionFill(region, swingRecord, options = {}) {
    const result = observationRegionBaseFill(region, swingRecord, options);
    if (!options.selected && !options.hover) return result;
    // Interaction must never impersonate a metric bin or erase a missing-data pattern.
    return {...result, isHighlighted:true};
  }

  const MAYOR_DEFAULT_SWING_YEARS = [2014, 2018, 2022];
  const MAYOR_EXTENDED_SWING_YEARS = [2010, 2014, 2018, 2022];

  function parseSwingOptions(optionsOrMinChanges) {
    if (typeof optionsOrMinChanges === "number") {
      const cycleYears = optionsOrMinChanges >= 2 ? MAYOR_EXTENDED_SWING_YEARS : MAYOR_DEFAULT_SWING_YEARS;
      return {
        cycleYears,
        minChanges: optionsOrMinChanges,
        marginThreshold: 0.03,
      };
    }
    const opts = optionsOrMinChanges || {};
    const cycleYears = Array.isArray(opts.cycleYears) && opts.cycleYears.length
      ? opts.cycleYears
      : MAYOR_DEFAULT_SWING_YEARS;
    const defaultMinChanges = cycleYears.length <= 3 ? 1 : 2;
    const minChanges = typeof opts.minChanges === "number" ? opts.minChanges : defaultMinChanges;
    const marginThreshold = typeof opts.marginThreshold === "number" ? opts.marginThreshold : 0.03;
    return { cycleYears, minChanges, marginThreshold, ...opts };
  }

  function analyzeMayorSwing(areas, optionsOrMinChanges = {}) {
    if (!Array.isArray(areas)) return new Map();
    const opts = parseSwingOptions(optionsOrMinChanges);
    const { cycleYears, minChanges, marginThreshold } = opts;
    const result = new Map();

    areas.forEach((area) => {
      if (!area || !Array.isArray(area.names) || area.names.length !== 3) return;
      const key = area.names.join("／");
      const periods = Array.isArray(area.periods) ? area.periods : [];
      const history = [];
      let cand2022 = null;
      let elec2022 = null;

      cycleYears.forEach((year) => {
        const period = periods.find((p) => p && p.year === year);
        if (!period || !Array.isArray(period.elections) || !period.elections.length) return;
        const election = period.elections[0];
        if (!Array.isArray(election.candidates) || !election.candidates.length) return;
        const sorted = [...election.candidates]
          .filter((c) => typeof c.votes === "number" && Number.isFinite(c.votes))
          .sort((a, b) => b.votes - a.votes);
        if (sorted.length > 0) {
          history.push({
            year,
            party: sorted[0].party,
            candidate: sorted[0].name,
            votes: sorted[0].votes,
            electorate: election.electorate,
          });
          if (year === 2022) {
            cand2022 = sorted;
            elec2022 = typeof election.electorate === "number" ? election.electorate : null;
          }
        }
      });

      const isComplete = history.length === cycleYears.length;
      let partyChanges = 0;
      for (let i = 1; i < history.length; i++) {
        if (history[i].party !== history[i - 1].party) {
          partyChanges++;
        }
      }

      let isClose2022 = false;
      let margin = null;
      if (cand2022 && cand2022.length >= 2 && elec2022 && elec2022 > 0) {
        margin = (cand2022[0].votes - cand2022[1].votes) / elec2022;
        if (margin <= marginThreshold) {
          isClose2022 = true;
        }
      }

      const isSwing = isComplete && partyChanges >= minChanges;
      let quadrantStatus = "solid";
      if (isSwing && isClose2022) quadrantStatus = "close_swing";
      else if (!isSwing && isClose2022) quadrantStatus = "close_only";
      else if (isSwing && !isClose2022) quadrantStatus = "swing_only";
      else quadrantStatus = "solid";

      const status = quadrantStatus === "solid" ? null : (quadrantStatus === "swing_only" ? "swing" : quadrantStatus);
      const pendulum = cycleYears.length <= 3 ? partyChanges === 2 : partyChanges >= 3;
      const flipped = partyChanges >= 1;

      result.set(key, {
        names: [...area.names],
        partyChanges,
        isComplete,
        comparableYears: history.length,
        isSwing,
        isClose2022,
        margin,
        marginPct: margin !== null ? margin * 100 : null,
        status,
        quadrantStatus,
        pendulum,
        flipped,
        history,
      });
    });

    return result;
  }

  function analyzeMayorSwingAggregate(areas, optionsOrMinChanges = {}) {
    const opts = parseSwingOptions(optionsOrMinChanges);
    const { cycleYears, minChanges, marginThreshold } = opts;
    const history = [];
    let margin = null;
    let comparableYears = 0;

    cycleYears.forEach((year) => {
      if (!Array.isArray(areas) || !areas.length) return;
      const candidatesByIdentity = new Map();
      let electorate = 0;
      let complete = true;

      areas.forEach((area) => {
        const period = Array.isArray(area?.periods)
          ? area.periods.find((entry) => entry?.year === year)
          : null;
        const election = period?.elections?.[0];
        if (!election || !Array.isArray(election.candidates) || !election.candidates.length
          || !Number.isSafeInteger(election.electorate) || election.electorate <= 0) {
          complete = false;
          return;
        }
        electorate += election.electorate;
        election.candidates.forEach((candidate) => {
          if (!candidate || typeof candidate.votes !== "number" || !Number.isFinite(candidate.votes)) {
            complete = false;
            return;
          }
          const identity = JSON.stringify([candidate.name || "", candidate.party || ""]);
          const current = candidatesByIdentity.get(identity) || {
            name: candidate.name || "",
            party: candidate.party || null,
            votes: 0,
          };
          current.votes += candidate.votes;
          candidatesByIdentity.set(identity, current);
        });
      });

      const sorted = [...candidatesByIdentity.values()].sort((a, b) => b.votes - a.votes);
      if (!complete || sorted.length < 1) return;
      comparableYears += 1;
      history.push({ year, party: sorted[0].party, candidate: sorted[0].name, votes: sorted[0].votes, electorate });
      if (year === 2022 && sorted.length >= 2) margin = (sorted[0].votes - sorted[1].votes) / electorate;
    });

    let partyChanges = 0;
    for (let index = 1; index < history.length; index += 1) {
      if (history[index].party !== history[index - 1].party) partyChanges += 1;
    }
    const isComplete = comparableYears === cycleYears.length;
    const isSwing = isComplete && partyChanges >= minChanges;
    const isClose2022 = margin !== null && margin <= marginThreshold;

    let quadrantStatus = "solid";
    if (isSwing && isClose2022) quadrantStatus = "close_swing";
    else if (!isSwing && isClose2022) quadrantStatus = "close_only";
    else if (isSwing && !isClose2022) quadrantStatus = "swing_only";
    else quadrantStatus = "solid";

    const status = quadrantStatus === "solid" ? null : (quadrantStatus === "swing_only" ? "swing" : quadrantStatus);
    const pendulum = cycleYears.length <= 3 ? partyChanges === 2 : partyChanges >= 3;
    const flipped = partyChanges >= 1;

    return {
      partyChanges,
      isComplete,
      comparableYears,
      isSwing,
      isClose2022,
      margin,
      marginPct: margin === null ? null : margin * 100,
      status,
      quadrantStatus,
      pendulum,
      flipped,
      history,
    };
  }

  const COUNCIL_MARGIN_BANDS = [1, 3, 6];

  function classifyCouncilDistrict(d) {
    const m = d?.margin?.["2022"];
    if (!m || m.uncontested) {
      return { band: "na", label: m?.uncontested ? "同額" : "無資料" };
    }
    if (m.pct == null) {
      return { band: "na", label: "無資料" };
    }
    const i = COUNCIL_MARGIN_BANDS.findIndex((t) => m.pct <= t);
    return {
      band: ["tight", "close", "normal"][i] ?? "loose",
      label: ["極接近", "接近", "普通"][i] ?? "寬鬆",
    };
  }

  function classifyMayorContest(margin2022Rate, turnoverCount) {
    const isClose = margin2022Rate != null && margin2022Rate <= 0.03;
    const hasTurnover = turnoverCount != null && turnoverCount > 0;
    const isSwing = turnoverCount != null && turnoverCount >= 2;
    if (isClose && hasTurnover) {
      return { band: "tight", level: 1, label: "極度拉鋸" };
    }
    if (isClose && !hasTurnover) {
      return { band: "close", level: 2, label: "拉鋸" };
    }
    if (isSwing) {
      return { band: "swing", level: 3, label: "搖擺" };
    }
    return { band: "stable", level: 4, label: "穩定" };
  }

  function analyzeMayorSwingScopes(areas, councilorLocations = [], optionsOrMinChanges = {}) {
    const opts = parseSwingOptions(optionsOrMinChanges);
    const records = Array.isArray(areas) ? areas : [];
    const countyName = records.find((area) => Array.isArray(area?.names) && area.names.length)?.names[0] || "";
    const villageResults = analyzeMayorSwing(records, opts);
    const countyAreas = records.filter((area) => area?.names?.length === 1);
    const townshipAreas = records.filter((area) => area?.names?.length === 2);
    const villageAreas = records.filter((area) => area?.names?.length === 3);
    const counties = new Map();
    const townships = new Map();

    countyAreas.forEach((area) => {
      const direct = analyzeMayorSwingAggregate([area], opts);
      const county = area.names[0];
      counties.set(county, {
        county,
        ...direct,
        swingVillageCount: 0,
        closeSwingVillageCount: 0,
        closeOnlyVillageCount: 0,
        swingOnlyVillageCount: 0,
      });
    });
    townshipAreas.forEach((area) => {
      const direct = analyzeMayorSwingAggregate([area], opts);
      const key = area.names.join("／");
      townships.set(key, {
        county: area.names[0],
        township: area.names[1],
        ...direct,
        swingVillageCount: 0,
        closeSwingVillageCount: 0,
        closeOnlyVillageCount: 0,
        swingOnlyVillageCount: 0,
      });
    });

    villageAreas.forEach((area) => {
      const key = area.names.join("／");
      const village = villageResults.get(key);
      if (!village) return;
      const county = counties.get(area.names[0]);
      const township = townships.get(area.names.slice(0, 2).join("／"));

      if (village.isSwing) {
        if (county) county.swingVillageCount += 1;
        if (township) township.swingVillageCount += 1;
      }
      if (village.quadrantStatus === "close_swing") {
        if (county) county.closeSwingVillageCount += 1;
        if (township) township.closeSwingVillageCount += 1;
      } else if (village.quadrantStatus === "close_only") {
        if (county) county.closeOnlyVillageCount += 1;
        if (township) township.closeOnlyVillageCount += 1;
      } else if (village.quadrantStatus === "swing_only") {
        if (county) county.swingOnlyVillageCount += 1;
        if (township) township.swingOnlyVillageCount += 1;
      }
    });

    counties.forEach((record) => {
      record.displayStatus = record.status === "close_swing" || record.closeSwingVillageCount > 0
        ? "close_swing"
        : (record.status === "close_only" || record.closeOnlyVillageCount > 0
          ? "close_only"
          : (record.status === "swing_only" || record.swingVillageCount > 0 || record.status === "swing" ? "swing" : null));
      record.displayQuadrantStatus = record.displayStatus === "swing" ? "swing_only" : (record.displayStatus || "solid");
    });
    townships.forEach((record) => {
      record.displayStatus = record.status === "close_swing" || record.closeSwingVillageCount > 0
        ? "close_swing"
        : (record.status === "close_only" || record.closeOnlyVillageCount > 0
          ? "close_only"
          : (record.status === "swing_only" || record.swingVillageCount > 0 || record.status === "swing" ? "swing" : null));
      record.displayQuadrantStatus = record.displayStatus === "swing" ? "swing_only" : (record.displayStatus || "solid");
    });

    const councilDistricts = new Map();
    const townshipByName = new Map(townshipAreas.map((area) => [area.names[1], area]));
    (Array.isArray(councilorLocations) ? councilorLocations : []).forEach((location) => {
      if (!location || location.county !== countyName || location.scope !== "regional"
        || !["metro_councilor", "county_councilor"].includes(location.office)) return;
      const selectedAreas = (location.townships || []).map((name) => townshipByName.get(name)).filter(Boolean);
      const completeScope = !(location.partial_townships || []).length
        && (location.townships || []).length > 0
        && selectedAreas.length === location.townships.length;
      const direct = completeScope ? analyzeMayorSwingAggregate(selectedAreas, opts) : null;
      const selectedTownships = new Set(location.townships || []);
      const nestedVillageKeys = villageAreas
        .filter((area) => area.names[0] === countyName && selectedTownships.has(area.names[1]))
        .map((area) => area.names.join("／"))
        .filter((key) => villageResults.get(key)?.isSwing);
      const closeVillageKeys = nestedVillageKeys.filter((key) => villageResults.get(key)?.quadrantStatus === "close_swing");
      const closeOnlyVillageKeys = villageAreas
        .filter((area) => area.names[0] === countyName && selectedTownships.has(area.names[1]))
        .map((area) => area.names.join("／"))
        .filter((key) => villageResults.get(key)?.quadrantStatus === "close_only");
      const record = {
        districtId: location.district_id,
        county: location.county,
        office: location.office,
        townships: [...(location.townships || [])],
        scopeText: location.scope_text || "",
        scopeComplete: completeScope,
        comparable: Boolean(direct?.isComplete),
        unavailableReason: !completeScope ? "incomplete-or-nonregional-scope" : !direct?.isComplete ? "missing-history-year" : null,
        ...(direct || { partyChanges: 0, isComplete: false, comparableYears: 0, isSwing: false, isClose2022: false, margin: null, marginPct: null, status: null, quadrantStatus: "solid", history: [] }),
        swingVillageCount: nestedVillageKeys.length,
        closeSwingVillageCount: closeVillageKeys.length,
        closeOnlyVillageCount: closeOnlyVillageKeys.length,
        swingVillageKeys: nestedVillageKeys,
        closeSwingVillageKeys: closeVillageKeys,
        closeOnlyVillageKeys,
      };
      record.displayStatus = record.status === "close_swing" || record.closeSwingVillageCount > 0
        ? "close_swing"
        : (record.status === "close_only" || record.closeOnlyVillageCount > 0
          ? "close_only"
          : (record.status === "swing_only" || record.swingVillageCount > 0 || record.status === "swing" ? "swing" : null));
      record.displayQuadrantStatus = record.displayStatus === "swing" ? "swing_only" : (record.displayStatus || "solid");
      councilDistricts.set(record.districtId, record);
    });

    return { counties, townships, councilDistricts, villages: villageResults };
  }

  function analyzeBellwetherVillages(countyAreas, options = {}) {
    const opts = parseSwingOptions(options);
    const { cycleYears } = opts;
    const maxMae = typeof opts.maxMae === "number" ? opts.maxMae : 0.02; // 2.0%
    const records = Array.isArray(countyAreas) ? countyAreas : [];

    const countyRecord = records.find((a) => Array.isArray(a?.names) && a.names.length === 1);
    if (!countyRecord) return new Map();

    const countyCycleData = new Map();
    for (const year of cycleYears) {
      const period = Array.isArray(countyRecord.periods)
        ? countyRecord.periods.find((p) => p && p.year === year)
        : null;
      const election = period?.elections?.[0];
      if (!election || !Array.isArray(election.candidates) || !election.candidates.length) return new Map();
      const sorted = [...election.candidates]
        .filter((c) => typeof c?.votes === "number" && Number.isFinite(c.votes))
        .sort((a, b) => b.votes - a.votes);
      if (sorted.length < 2) return new Map();
      const validVotes = (typeof election.valid_votes === "number" && election.valid_votes > 0)
        ? election.valid_votes
        : sorted.reduce((sum, c) => sum + c.votes, 0);
      if (validVotes <= 0) return new Map();
      countyCycleData.set(year, {
        winnerParty: sorted[0].party,
        topParties: [
          { party: sorted[0].party, share: sorted[0].votes / validVotes },
          { party: sorted[1].party, share: sorted[1].votes / validVotes },
        ],
      });
    }

    const bellwethers = new Map();
    const villageAreas = records.filter((a) => Array.isArray(a?.names) && a.names.length === 3);

    for (const village of villageAreas) {
      const key = village.names.join("／");
      const periods = Array.isArray(village.periods) ? village.periods : [];
      let isMatch = true;
      let absoluteErrorsSum = 0;
      let comparisonPoints = 0;

      for (const year of cycleYears) {
        const countyInfo = countyCycleData.get(year);
        if (!countyInfo) { isMatch = false; break; }
        const period = periods.find((p) => p && p.year === year);
        const election = period?.elections?.[0];
        if (!election || !Array.isArray(election.candidates) || !election.candidates.length) {
          isMatch = false;
          break;
        }
        const sorted = [...election.candidates]
          .filter((c) => typeof c?.votes === "number" && Number.isFinite(c.votes))
          .sort((a, b) => b.votes - a.votes);
        if (sorted.length < 1) { isMatch = false; break; }
        const validVotes = (typeof election.valid_votes === "number" && election.valid_votes > 0)
          ? election.valid_votes
          : sorted.reduce((sum, c) => sum + c.votes, 0);
        if (validVotes <= 0) { isMatch = false; break; }

        if (sorted[0].party !== countyInfo.winnerParty) {
          isMatch = false;
          break;
        }

        for (const cp of countyInfo.topParties) {
          const cand = sorted.find((c) => c.party === cp.party);
          const share = cand ? (cand.votes / validVotes) : 0;
          absoluteErrorsSum += Math.abs(share - cp.share);
          comparisonPoints += 1;
        }
      }

      if (isMatch && comparisonPoints > 0) {
        const mae = absoluteErrorsSum / comparisonPoints;
        if (mae <= maxMae) {
          bellwethers.set(key, {
            names: [...village.names],
            isBellwether: true,
            mae,
            maePct: mae * 100,
          });
        }
      }
    }

    return bellwethers;
  }

  function analyzeCouncilorDistrict(district, election2022Data = null, candidates2026 = null) {
    if (!district) return null;
    if (district.precomputed_metrics) return district.precomputed_metrics;

    const history = Array.isArray(district.history) ? district.history : [];
    const registeredCandidates = Array.isArray(candidates2026)
      ? candidates2026
      : (Array.isArray(district.candidates) ? district.candidates : []);
    const registeredCount = registeredCandidates.length;

    let lastWinner = null;
    let firstLoser = null;
    let seats2022 = 0;
    let validVotes2022 = null;
    let electorate2022 = null;

    const candidateList = Array.isArray(election2022Data)
      ? election2022Data
      : (Array.isArray(election2022Data?.candidates) ? election2022Data.candidates : null);

    if (candidateList && candidateList.length) {
      const winners = candidateList.filter((c) => c.is_winner === true);
      const losers = candidateList.filter((c) => c.is_winner === false || !c.is_winner);
      seats2022 = winners.length;
      if (winners.length > 0) {
        lastWinner = [...winners].sort((a, b) => a.votes - b.votes)[0];
      }
      if (losers.length > 0) {
        firstLoser = [...losers].sort((a, b) => b.votes - a.votes)[0];
      }
      validVotes2022 = election2022Data?.valid_votes || candidateList.reduce((sum, c) => sum + (c.votes || 0), 0);
      electorate2022 = election2022Data?.electorate || null;
    }

    const h2022 = history.find((h) => h.year === 2022);
    if (h2022) {
      if (!validVotes2022) validVotes2022 = h2022.valid_votes;
      if (!electorate2022) electorate2022 = h2022.electorate;
    }

    let marginalVotes = null;
    let marginalVoteShareGap = null;
    let marginalMobilizationGap = null;
    let marginalStatus = "safe";

    if (lastWinner && firstLoser && typeof lastWinner.votes === "number" && typeof firstLoser.votes === "number") {
      marginalVotes = lastWinner.votes - firstLoser.votes;
      if (validVotes2022 && validVotes2022 > 0) {
        marginalVoteShareGap = marginalVotes / validVotes2022;
      }
      if (electorate2022 && electorate2022 > 0) {
        marginalMobilizationGap = marginalVotes / electorate2022;
      }
      if ((marginalVoteShareGap !== null && marginalVoteShareGap <= 0.01) || marginalVotes <= 500) {
        marginalStatus = "close_marginal";
      } else if (marginalVoteShareGap !== null && marginalVoteShareGap <= 0.02) {
        marginalStatus = "marginal";
      }
    }

    const sortedHistory = [...history].sort((a, b) => a.year - b.year);
    const partyShifts = [];
    const allPartyNames = new Set(sortedHistory.flatMap((h) => (h.parties || []).map((p) => p.name)));
    for (const partyName of allPartyNames) {
      const shares = sortedHistory.map((h) => {
        const p = (h.parties || []).find((x) => x.name === partyName);
        return p?.electorate_share_pct ?? null;
      });
      const delta = (shares.length >= 2 && shares[shares.length - 1] !== null && shares[shares.length - 2] !== null)
        ? (shares[shares.length - 1] - shares[shares.length - 2])
        : null;
      partyShifts.push({
        name: partyName,
        shares,
        delta,
      });
    }

    const competitionRatio = seats2022 > 0 ? (registeredCount / seats2022) : null;

    return {
      districtId: district.id,
      registeredCount,
      seats2022,
      competitionRatio,
      registrationRatio: competitionRatio,
      lastWinner,
      firstLoser,
      marginalVotes,
      marginalVoteShareGap,
      marginalMobilizationGap,
      marginalStatus,
      partyShifts,
    };
  }

  function buildGlobalSpotlightIndex(manifest, shard, geography) {
    const items = [];
    if (!manifest) return items;

    (manifest.counties || []).forEach((c) => {
      items.push({
        kind: "county",
        label: c.name,
        sublabel: `${c.candidate_count} 位候選人 · ${c.district_count} 選區`,
        badge: "縣市",
        action: { level: "county", value: c.name },
      });
    });

    if (shard && Array.isArray(shard.districts)) {
      const county = shard.districts[0]?.county || "";

      const officesInShard = new Set(shard.districts.map((d) => d.office));
      officesInShard.forEach((officeId) => {
        const officeLabel = manifest.offices?.[officeId] || officeId;
        items.push({
          kind: "office",
          label: `${county} · ${officeLabel}`,
          sublabel: "切換公職觀察視圖",
          badge: "公職",
          action: { level: "office", value: officeId },
        });
      });

      shard.districts.forEach((d) => {
        items.push({
          kind: "district",
          label: `${county} ${d.name || d.id}`,
          sublabel: `${manifest.offices?.[d.office] || d.office} · ${d.candidates.length} 人參選`,
          badge: "選區",
          action: { level: "district", value: d.id },
        });

        (d.candidates || []).forEach((cand) => {
          items.push({
            kind: "candidate",
            label: `${cand.name || "候選人"} (${cand.party === "無" ? "無黨籍" : cand.party || "無黨籍"})`,
            sublabel: `${county} · ${d.name || d.id} · ${manifest.offices?.[d.office] || d.office}`,
            badge: "參選人",
            action: { level: "district", value: d.id },
          });
        });
      });

      if (geography && typeof geography.townships === "function") {
        const towns = geography.townships(county) || [];
        towns.forEach((t) => {
          items.push({
            kind: "township",
            label: `${county} ${t.label}`,
            sublabel: "行政區村里圖資與選情",
            badge: "鄉鎮市區",
            action: { level: "township", value: t.label },
          });
        });
      }
    }

    return items;
  }

  function regionReference(region) {
    if (!region) return null;
    const anchorFeatureIndex = Array.isArray(region.featureIndexes)
      && Number.isInteger(region.featureIndexes[0])
      ? region.featureIndexes[0]
      : null;
    return {
      key: String(region.key || ""),
      label: String(region.label || ""),
      anchorFeatureIndex,
    };
  }

  function findRegionByReference(regions, reference) {
    if (!reference) return null;
    const candidates = Array.isArray(regions) ? regions : [];
    return candidates.find((region) => String(region.key || "") === String(reference.key || ""))
      || candidates.find((region) => String(region.label || "") === String(reference.label || ""))
      || (
        Number.isInteger(reference.anchorFeatureIndex)
          ? candidates.find((region) => (
            Array.isArray(region.featureIndexes)
            && region.featureIndexes.includes(reference.anchorFeatureIndex)
          ))
          : null
      )
      || null;
  }

  function captureNavigationIntent(level, path) {
    const normalizedLevel = ["county", "second", "village"].includes(level) ? level : "county";
    const entries = Array.isArray(path) ? path : [];
    return {
      level: normalizedLevel,
      county: normalizedLevel === "county" ? null : regionReference(entries[0]),
      parent: normalizedLevel === "village" ? regionReference(entries[1]) : null,
    };
  }

  function resolveNavigationIntent(hierarchy, intent) {
    const fallback = { level: "county", county: null, parent: null, second: null };
    if (!hierarchy || !intent || intent.level === "county") return fallback;
    const county = findRegionByReference(hierarchy.counties, intent.county);
    if (!county) return fallback;
    const second = hierarchy.secondLevel(county.key);
    if (!second || !second.regions.length) return { ...fallback, county };
    if (intent.level !== "village") {
      return { level: "second", county, parent: null, second };
    }
    const parent = findRegionByReference(second.regions, intent.parent);
    if (!parent || !canDrillToVillage(parent) || !hierarchy.villages(parent).length) {
      return { level: "second", county, parent: null, second };
    }
    return { level: "village", county, parent, second };
  }

  function normalizeRegionName(value) {
    return String(value || "").trim().replaceAll("台", "臺");
  }

  function normalizeHierarchySearch(value) {
    return normalizeRegionName(String(value || "").normalize("NFKC"))
      .toLocaleLowerCase("zh-Hant")
      .replaceAll("選舉區", "選區")
      .replace(/第0*(\d+)選區/g, (_, number) => `第${Number(number)}選區`);
  }

  function matchesHierarchySearch(label, query) {
    const text = normalizeHierarchySearch(label).replace(/[\s／/、｜|>]+/g, "");
    const terms = normalizeHierarchySearch(query).split(/[\s／/、｜|>]+/)
      .flatMap((term) => term.split(/(第\d+選區)/)).filter(Boolean);
    return terms.every((term) => text.includes(term));
  }

  function hierarchySearchExamples(shard) {
    const area = shard.areas[0];
    if (!area) return [];
    const value = (column) => String(area[shard.area_columns.indexOf(column)] || "");
    const county = value("county_name");
    const district = value("electoral_district_name");
    const districtAddress = district && !district.startsWith(county) ? county + district : district;
    return [...new Set([
      county, districtAddress,
      [value("township_name"), value("village_name")].filter(Boolean).join(" "),
    ].filter(Boolean))];
  }

  function pointKey(point) {
    return `${point[0]}|${point[1]}`;
  }

  function dissolvePolygons(polygons) {
    const boundaryEdges = new Map();
    polygons.forEach((polygon) => polygon.forEach((ring) => {
      const points = ring.length > 1 && pointKey(ring[0]) === pointKey(ring.at(-1))
        ? ring.slice(0, -1)
        : [...ring];
      for (let index = 0; index < points.length; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        const startKey = pointKey(start);
        const endKey = pointKey(end);
        if (startKey === endKey) continue;
        const edgeKey = startKey < endKey ? `${startKey}>${endKey}` : `${endKey}>${startKey}`;
        if (boundaryEdges.has(edgeKey)) boundaryEdges.delete(edgeKey);
        else boundaryEdges.set(edgeKey, { start, end, startKey, endKey });
      }
    }));
    const edges = [...boundaryEdges.values()];
    const adjacency = new Map();
    edges.forEach((edge, edgeIndex) => {
      [edge.startKey, edge.endKey].forEach((key) => {
        if (!adjacency.has(key)) adjacency.set(key, new Set());
        adjacency.get(key).add(edgeIndex);
      });
    });
    const unused = new Set(edges.map((_, index) => index));
    const rings = [];
    while (unused.size) {
      const firstIndex = unused.values().next().value;
      const firstEdge = edges[firstIndex];
      unused.delete(firstIndex);
      const ring = [firstEdge.start, firstEdge.end];
      const startKey = firstEdge.startKey;
      let currentKey = firstEdge.endKey;
      let guard = 0;
      while (currentKey !== startKey && guard <= edges.length) {
        guard += 1;
        const nextIndex = [...(adjacency.get(currentKey) || [])]
          .find((candidate) => unused.has(candidate));
        if (nextIndex === undefined) break;
        unused.delete(nextIndex);
        const edge = edges[nextIndex];
        if (edge.startKey === currentKey) {
          ring.push(edge.end);
          currentKey = edge.endKey;
        } else {
          ring.push(edge.start);
          currentKey = edge.startKey;
        }
      }
      if (currentKey === startKey && ring.length >= 4) rings.push(ring);
    }
    return rings.map((ring) => [ring]);
  }

  function dissolveFeatureArcs(features) {
    const boundaryArcs = new Map();
    features.forEach((feature) => feature.arcRings.forEach((ring) => ring.forEach((arcIndex) => {
      const sourceIndex = arcIndex < 0 ? ~arcIndex : arcIndex;
      if (boundaryArcs.has(sourceIndex)) boundaryArcs.delete(sourceIndex);
      else boundaryArcs.set(sourceIndex, arcIndex);
    })));
    const decodeArc = features[0].decodeArc;
    const edges = [...boundaryArcs.values()].map((arcIndex) => {
      const points = decodeArc(arcIndex);
      return {
        points,
        startKey: pointKey(points[0]),
        endKey: pointKey(points.at(-1)),
      };
    });
    const adjacency = new Map();
    edges.forEach((edge, edgeIndex) => {
      [edge.startKey, edge.endKey].forEach((key) => {
        if (!adjacency.has(key)) adjacency.set(key, new Set());
        adjacency.get(key).add(edgeIndex);
      });
    });
    const unused = new Set(edges.map((_, index) => index));
    const rings = [];
    while (unused.size) {
      const firstIndex = unused.values().next().value;
      const firstEdge = edges[firstIndex];
      unused.delete(firstIndex);
      const ring = [...firstEdge.points];
      const startKey = firstEdge.startKey;
      let currentKey = firstEdge.endKey;
      let guard = 0;
      while (currentKey !== startKey && guard <= edges.length) {
        guard += 1;
        const nextIndex = [...(adjacency.get(currentKey) || [])]
          .find((candidate) => unused.has(candidate));
        if (nextIndex === undefined) break;
        unused.delete(nextIndex);
        const edge = edges[nextIndex];
        const forward = edge.startKey === currentKey;
        const points = forward ? edge.points : [...edge.points].reverse();
        points.forEach((point, pointIndex) => {
          if (pointIndex === 0 && samePoint(ring.at(-1), point)) return;
          ring.push(point);
        });
        currentKey = forward ? edge.endKey : edge.startKey;
      }
      if (currentKey === startKey && ring.length >= 4) rings.push(ring);
    }
    return rings.map((ring) => [ring]);
  }

  const dissolvedRegionCache = new WeakMap();

  function regionRenderPolygons(level, featureIndexes, features, sourcePolygons) {
    if (level === "village") return sourcePolygons;
    let cache = dissolvedRegionCache.get(features);
    if (!cache) {
      cache = new Map();
      dissolvedRegionCache.set(features, cache);
    }
    const key = featureIndexes.join(",");
    if (!cache.has(key)) {
      const regionFeatures = featureIndexes.map((featureIndex) => features[featureIndex]);
      const supportsArcDissolve = regionFeatures.length
        && regionFeatures.every((feature) => Array.isArray(feature.arcRings) && feature.decodeArc);
      cache.set(
        key,
        supportsArcDissolve ? dissolveFeatureArcs(regionFeatures) : dissolvePolygons(sourcePolygons),
      );
    }
    return cache.get(key);
  }

  function regionFromFeatures(
    level,
    key,
    label,
    featureIndexes,
    areaIndexes,
    features,
    mapAreaIndexes = areaIndexes,
  ) {
    const regionFeatures = featureIndexes.map((index) => features[index]);
    const sourcePolygons = regionFeatures.flatMap((feature) => feature.polygons);
    const polygons = regionRenderPolygons(level, featureIndexes, features, sourcePolygons);
    const mapAreas = new Set(mapAreaIndexes);
    return {
      level,
      key,
      label,
      geometry: true,
      featureIndexes,
      areaIndexes,
      mapAreaIndexes,
      supplementalAreaIndexes: areaIndexes.filter((areaIndex) => !mapAreas.has(areaIndex)),
      polygons,
      hitPolygons: sourcePolygons,
      sourcePolygonParts: sourcePolygons.length,
      renderPolygonParts: polygons.length,
      bbox: unionBounds(regionFeatures),
    };
  }

  function buildMapHierarchy(features, areas, areaColumn, areaIndexesByMapId) {
    function mapIdsForArea(areaIndex) {
      const value = areas[areaIndex]?.[areaColumn.map_area_ids];
      return Array.isArray(value) ? value.map(String) : [];
    }

    function uniquelyMappedAreaIndexes(areaIndexes, featureIndexes) {
      const allowedMapIds = new Set(featureIndexes.map((featureIndex) => (
        String(features[featureIndex].properties?.VILLCODE || "")
      )));
      return areaIndexes.filter((areaIndex) => {
        const mapIds = mapIdsForArea(areaIndex);
        return mapIds.length === 1 && allowedMapIds.has(mapIds[0]);
      });
    }

    const countyGroups = new Map();
    features.forEach((feature, featureIndex) => {
      const properties = feature.properties || {};
      const label = String(properties.COUNTYNAME || "未標示縣市");
      const key = String(properties.COUNTYCODE || normalizeRegionName(label));
      if (!countyGroups.has(key)) countyGroups.set(key, { key, label, featureIndexes: [] });
      countyGroups.get(key).featureIndexes.push(featureIndex);
    });
    const counties = [...countyGroups.values()].map((group) => {
      const normalizedLabel = normalizeRegionName(group.label);
      const areaIndexes = areas
        .map((area, areaIndex) => ({ area, areaIndex }))
        .filter(({ area }) => normalizeRegionName(area[areaColumn.county_name]) === normalizedLabel)
        .map(({ areaIndex }) => areaIndex);
      const mapAreaIndexes = uniquelyMappedAreaIndexes(areaIndexes, group.featureIndexes);
      return regionFromFeatures(
        "county",
        `county:${group.key}`,
        group.label,
        group.featureIndexes,
        areaIndexes,
        features,
        mapAreaIndexes,
      );
    }).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));

    function featureIndexesForAreas(parent, indexes) {
      const selected = new Set(indexes);
      return parent.featureIndexes.filter((featureIndex) => {
        const villageCode = String(features[featureIndex].properties.VILLCODE || "");
        return (areaIndexesByMapId.get(villageCode) || []).some((areaIndex) => selected.has(areaIndex));
      });
    }

    function secondLevel(countyKey) {
      const county = counties.find((region) => region.key === countyKey);
      if (!county || !county.areaIndexes.length) {
        return { kind: "none", sourceKind: "no-source-areas", warning: "", regions: [] };
      }
      const districtGroups = new Map();
      let districtsComplete = true;
      county.areaIndexes.forEach((areaIndex) => {
        const label = String(areas[areaIndex][areaColumn.electoral_district_name] || "").trim();
        if (!label) {
          districtsComplete = false;
          return;
        }
        if (!districtGroups.has(label)) districtGroups.set(label, []);
        districtGroups.get(label).push(areaIndex);
      });
      const hasActualSubdivision = [...districtGroups.keys()]
        .some((label) => normalizeRegionName(label) !== normalizeRegionName(county.label));
      if (!districtsComplete || !hasActualSubdivision) {
        const townGroups = new Map();
        county.featureIndexes.forEach((featureIndex) => {
          const properties = features[featureIndex].properties || {};
          const label = String(properties.TOWNNAME || "未標示鄉鎮市區");
          const key = String(properties.TOWNCODE || normalizeRegionName(label));
          if (!townGroups.has(key)) townGroups.set(key, { key, label, featureIndexes: [] });
          townGroups.get(key).featureIndexes.push(featureIndex);
        });
        const townKeyByMapId = new Map();
        const townKeyByName = new Map();
        townGroups.forEach((group, key) => {
          townKeyByName.set(normalizeRegionName(group.label), key);
          group.featureIndexes.forEach((featureIndex) => {
            const villageCode = String(features[featureIndex].properties.VILLCODE || "");
            if (villageCode) townKeyByMapId.set(villageCode, key);
          });
        });
        const townKeyByAreaIndex = new Map();
        const historicalNameAliases = new Map();
        county.areaIndexes.forEach((areaIndex) => {
          const mapIds = Array.isArray(areas[areaIndex][areaColumn.map_area_ids])
            ? areas[areaIndex][areaColumn.map_area_ids]
            : [];
          const keys = [...new Set(mapIds.map((id) => townKeyByMapId.get(String(id))).filter(Boolean))];
          if (keys.length !== 1) return;
          townKeyByAreaIndex.set(areaIndex, keys[0]);
          const historicalName = normalizeRegionName(areas[areaIndex][areaColumn.township_name]);
          if (!historicalNameAliases.has(historicalName)) historicalNameAliases.set(historicalName, new Set());
          historicalNameAliases.get(historicalName).add(keys[0]);
        });
        county.areaIndexes.forEach((areaIndex) => {
          if (townKeyByAreaIndex.has(areaIndex)) return;
          const historicalName = normalizeRegionName(areas[areaIndex][areaColumn.township_name]);
          const currentKey = townKeyByName.get(historicalName);
          const aliases = [...(historicalNameAliases.get(historicalName) || [])];
          if (currentKey) townKeyByAreaIndex.set(areaIndex, currentKey);
          else if (aliases.length === 1) townKeyByAreaIndex.set(areaIndex, aliases[0]);
        });
        const regions = [...townGroups.values()].map((group) => {
          const areaIndexes = county.areaIndexes
            .filter((areaIndex) => townKeyByAreaIndex.get(areaIndex) === group.key);
          const mapAreaIndexes = uniquelyMappedAreaIndexes(areaIndexes, group.featureIndexes);
          return regionFromFeatures(
            "township-fallback",
            `${county.key}:township:${group.key}`,
            group.label,
            group.featureIndexes,
            areaIndexes,
            features,
            mapAreaIndexes,
          );
        }).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
        return {
          kind: "township-fallback",
          sourceKind: districtsComplete
            ? "non-subdividing-electoral-district"
            : "missing-electoral-district",
          warning: "此資料集尚未提供更細的選舉區邊界；目前顯示 2025 鄉鎮市區行政區，尚未更新為選區。請點選行政區後查看村里級資料。",
          unassignedAreaIndexes: county.areaIndexes
            .filter((areaIndex) => !townKeyByAreaIndex.has(areaIndex)),
          regions,
        };
      }
      const regions = [...districtGroups.entries()].map(([label, areaIndexes]) => {
        const featureIndexes = featureIndexesForAreas(county, areaIndexes);
        if (!featureIndexes.length) return null;
        const mapAreaIndexes = uniquelyMappedAreaIndexes(areaIndexes, featureIndexes);
        return regionFromFeatures(
          "electoral-district",
          `${county.key}:district:${label}`,
          label,
          featureIndexes,
          areaIndexes,
          features,
          mapAreaIndexes,
        );
      }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
      return { kind: "electoral-district", sourceKind: "electoral-district", warning: "", regions };
    }

    function villages(parent) {
      const parentAreas = new Set(parent.mapAreaIndexes || []);
      return parent.featureIndexes.map((featureIndex) => {
        const properties = features[featureIndex].properties || {};
        const villageCode = String(properties.VILLCODE || featureIndex);
        const areaIndexes = (areaIndexesByMapId.get(villageCode) || [])
          .filter((areaIndex) => parentAreas.has(areaIndex));
        return regionFromFeatures(
          "village",
          `${parent.key}:village:${villageCode}`,
          String(properties.VILLNAME || villageCode),
          [featureIndex],
          areaIndexes,
          features,
        );
      }).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
    }

    function supplemental(parent) {
      const areaIndexes = [...(parent.supplementalAreaIndexes || [])];
      if (!areaIndexes.length) return null;
      return {
        level: "supplemental",
        key: `${parent.key}:supplemental`,
        label: "未能唯一對位至 2025 村里",
        geometry: false,
        featureIndexes: [],
        areaIndexes,
        mapAreaIndexes: [],
        supplementalAreaIndexes: areaIndexes,
        polygons: [],
        bbox: null,
      };
    }

    return { counties, secondLevel, villages, supplemental };
  }

  function canDrillToVillage(parent) {
    return Boolean(parent?.mapAreaIndexes?.length);
  }

  function hasTimestampTimezone(value) {
    return typeof value === "string"
      && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value));
  }

  function newsManifestCounty(manifest, value) {
    const needle = String(value || "");
    return (manifest?.counties || []).find(
      (entry) => String(entry.key) === needle || String(entry.name) === needle,
    ) || null;
  }

  function validateNewsManifest(manifest) {
    if (!manifest || manifest.schema !== "election-county-news-manifest-v1") {
      throw new Error("county news manifest schema mismatch");
    }
    if (!hasTimestampTimezone(manifest.generated_at)) {
      throw new Error("county news manifest generated_at is invalid");
    }
    if (manifest.sort !== "published_ts_desc_item_code_asc") {
      throw new Error("county news manifest sort contract mismatch");
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.source?.snapshot_sha256 || ""))) {
      throw new Error("county news snapshot identity is invalid");
    }
    if (!Number.isInteger(manifest.classified_item_count) || manifest.classified_item_count < 0) {
      throw new Error("county news classified item count is invalid");
    }
    if (!Number.isInteger(manifest.unclassified_eligible_count) || manifest.unclassified_eligible_count < 0) {
      throw new Error("county news unclassified item count is invalid");
    }
    if (!Number.isInteger(manifest.relation_count) || manifest.relation_count < 0) {
      throw new Error("county news relation count is invalid");
    }
    if (!Array.isArray(manifest.counties) || manifest.county_count !== manifest.counties.length) {
      throw new Error("county news manifest county count mismatch");
    }
    const keys = new Set();
    const names = new Set();
    manifest.counties.forEach((entry) => {
      const key = String(entry?.key || "");
      const name = String(entry?.name || "");
      if (!key || !name || keys.has(key) || names.has(name)) {
        throw new Error("county news manifest has blank or duplicate county identity");
      }
      if (!Number.isInteger(entry.item_count) || entry.item_count < 0) {
        throw new Error("county news manifest item count is invalid");
      }
      localDataPath(`data/${String(entry.file || "")}`);
      keys.add(key);
      names.add(name);
    });
    if (manifest.counties.reduce((total, entry) => total + entry.item_count, 0) !== manifest.relation_count) {
      throw new Error("county news manifest relation count mismatch");
    }
    return true;
  }

  function validateNewsPointer(manifest, pointer) {
    validateNewsManifest(manifest);
    if (
      manifest.schema !== pointer?.schema
      || manifest.generated_at !== pointer?.generated_at
      || manifest.source.snapshot_sha256 !== pointer?.snapshot_sha256
      || manifest.county_count !== pointer?.county_count
      || manifest.classified_item_count !== pointer?.classified_item_count
      || manifest.unclassified_eligible_count !== pointer?.unclassified_eligible_count
      || manifest.relation_count !== pointer?.relation_count
    ) {
      throw new Error("county news pointer identity mismatch");
    }
    return true;
  }

  function validateNewsShard(shard, expectedCounty, manifest) {
    const exactKeys = (value, allowed) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const keys = Object.keys(value);
      return keys.length === allowed.size && keys.every((key) => allowed.has(key));
    };
    const shardKeys = new Set(["schema", "generated_at", "county", "count", "items"]);
    const countyKeys = new Set(["key", "name"]);
    const itemKeys = new Set([
      "item_code", "published_at", "published_ts", "title", "source", "url", "localities",
    ]);
    const localityKeysAllowed = new Set(["key", "name"]);
    if (!exactKeys(shard, shardKeys) || !exactKeys(shard?.county, countyKeys)) {
      throw new Error("county news shard has unexpected fields");
    }
    if (!shard || shard.schema !== "election-county-news-v1") {
      throw new Error("county news shard schema mismatch");
    }
    if (!hasTimestampTimezone(shard.generated_at)) {
      throw new Error("county news shard generated_at is invalid");
    }
    if (!manifest || shard.generated_at !== manifest.generated_at) {
      throw new Error("county news shard snapshot identity mismatch");
    }
    if (
      String(shard.county?.key || "") !== String(expectedCounty?.key || "")
      || String(shard.county?.name || "") !== String(expectedCounty?.name || "")
    ) {
      throw new Error("county news shard county identity mismatch");
    }
    if (!Array.isArray(shard.items) || shard.count !== shard.items.length) {
      throw new Error("county news shard count mismatch");
    }
    if (Number(expectedCounty.item_count) !== shard.items.length) {
      throw new Error("county news shard manifest count mismatch");
    }
    const itemCodes = new Set();
    const manifestCountyNames = new Map(
      (manifest.counties || []).map((entry) => [String(entry.key), String(entry.name)]),
    );
    let previousTimestamp = Number.POSITIVE_INFINITY;
    let previousCode = "";
    shard.items.forEach((item) => {
      if (!exactKeys(item, itemKeys)) {
        throw new Error("county news item has unexpected fields");
      }
      const itemCode = String(item?.item_code || "");
      const timestamp = Number(item?.published_ts);
      if (!itemCode || itemCodes.has(itemCode)) {
        throw new Error("county news shard has blank or duplicate item code");
      }
      if (!String(item.title || "").trim() || !String(item.source || "").trim()) {
        throw new Error("county news shard has blank public text");
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(String(item.url || ""));
      } catch (error) {
        throw new Error("county news URL must be HTTPS", { cause: error });
      }
      if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
        throw new Error("county news URL must be HTTPS");
      }
      if (!hasTimestampTimezone(item.published_at) || !Number.isFinite(timestamp)) {
        throw new Error("county news publication time is invalid");
      }
      if (timestamp > previousTimestamp || (timestamp === previousTimestamp && itemCode < previousCode)) {
        throw new Error("county news item order is invalid");
      }
      if (!Array.isArray(item.localities) || !item.localities.length) {
        throw new Error("county news item localities are invalid");
      }
      const localityKeys = new Set();
      item.localities.forEach((locality) => {
        if (!exactKeys(locality, localityKeysAllowed)) {
          throw new Error("county news item locality has unexpected fields");
        }
        const key = String(locality?.key || "");
        const name = String(locality?.name || "");
        if (!key || !name || localityKeys.has(key)) {
          throw new Error("county news item locality is blank or duplicate");
        }
        if (!manifestCountyNames.has(key) || manifestCountyNames.get(key) !== name) {
          throw new Error("county news item has unknown locality");
        }
        localityKeys.add(key);
      });
      if (!localityKeys.has(String(expectedCounty.key))) {
        throw new Error("county news item does not belong to expected county");
      }
      itemCodes.add(itemCode);
      previousTimestamp = timestamp;
      previousCode = itemCode;
    });
    return true;
  }

  function localDataPath(path) {
    const value = String(path || "");
    const segments = value.split("/");
    const safe = /^data\/[A-Za-z0-9_./-]+\.json$/.test(value)
      && segments.every((segment) => segment && segment !== "." && segment !== "..");
    if (!safe) throw new Error(`unsafe local data path: ${value}`);
    return value;
  }

  function selectNonOverlappingLabels(candidates) {
    const selected = [];
    [...candidates]
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .forEach((candidate) => {
        const [left, top, right, bottom] = candidate.box;
        const overlaps = selected.some((entry) => {
          const [otherLeft, otherTop, otherRight, otherBottom] = entry.box;
          return right > otherLeft && left < otherRight && bottom > otherTop && top < otherBottom;
        });
        if (!overlaps) selected.push(candidate);
      });
    return selected;
  }

  function historyKeys(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every((key) => keys.includes(key));
  }

  function historyString(value, allowEmpty = false) {
    return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= 512;
  }

  function historyCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validatePresidentRevision(record) {
    if (record?.schema === "cec-president-source-audit-v2") return validatePresidentAudit(record);
    if (!historyKeys(record, ["schema", "base_database_sha256", "revision_ids", "sources", "before", "after", "corrections", "auxiliary_notes"])
      || record.schema !== "cec-president-source-revision-v1" || !/^[a-f0-9]{64}$/.test(record.base_database_sha256)
      || JSON.stringify(record.revision_ids) !== '["cec-1996-original","cec-2004-taitung-rebuild"]'
      || !Array.isArray(record.sources) || !record.sources.length || record.sources.length > 32) {
      throw new Error("invalid presidential source revision record");
    }
    const files = new Set();
    record.sources.forEach((source) => {
      if (!historyKeys(source, ["file", "url", "sha256", "bytes", "role", "accessed_at"])
        || !/^[A-Za-z0-9_-]+\.(zip|json)$/.test(source.file) || files.has(source.file)
        || !/^[a-f0-9]{64}$/.test(source.sha256) || !historyCount(source.bytes)
        || !historyString(source.role) || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessed_at)) {
        throw new Error("invalid presidential source evidence");
      }
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.hostname !== "db.cec.gov.tw" || url.username || url.password || url.hash) {
        throw new Error("presidential evidence must use official HTTPS sources");
      }
      files.add(source.file);
    });
    if (!["1996-official.zip", "2004-official.zip", "1996-normalized.json", "2004-normalized.json"].every((file) => files.has(file))
      || !Array.isArray(record.corrections) || !Array.isArray(record.auxiliary_notes)) {
      throw new Error("incomplete presidential source evidence");
    }
    [record.before, record.after].forEach((scope) => {
      if (!historyKeys(scope, ["source_area_count", "missing_electorate_count", "invalid_vote_area_count",
        "electorate_sum_of_nonmissing", "candidate_totals", "turnout_rows", "candidate_rows"])
        || !historyCount(scope.source_area_count) || !historyCount(scope.missing_electorate_count)
        || !historyCount(scope.invalid_vote_area_count) || !historyCount(scope.electorate_sum_of_nonmissing)
        || scope.missing_electorate_count > scope.source_area_count || scope.invalid_vote_area_count > scope.source_area_count
        || !Array.isArray(scope.candidate_totals) || !Array.isArray(scope.turnout_rows) || !Array.isArray(scope.candidate_rows)
        || scope.turnout_rows.length !== scope.source_area_count) {
        throw new Error("invalid presidential revision scope");
      }
    });
    // Receipt facts contain only public election fields. Unknown keys fail
    // closed even though the UI only offers this file as a download.
    const fields = new Set(["schema", "base_database_sha256", "revision_ids", "sources", "before", "after", "corrections", "auxiliary_notes",
      "file", "url", "sha256", "bytes", "role", "accessed_at", "source_area_count", "missing_electorate_count", "invalid_vote_area_count",
      "electorate_sum_of_nonmissing", "candidate_totals", "number", "turnout_rows", "candidate_rows", "names", "original_source_area_id",
      "original_votes", "corrected_votes", "original_electorate", "corrected_electorate", "spreadsheet_rows", "stations", "reason", "original",
      "handling", "row", "station", "valid", "invalid", "total", "electorate", "election_id", "election_year", "election_date", "election_type",
      "source_area_id", "source_geo_key", "comparison_area_id", "resolution_status", "county_name", "township_name", "village_name",
      "electoral_district_name", "valid_votes", "invalid_votes", "total_votes", "turnout_ratio", "turnout_fact_id", "map_area_ids", "candidate_id",
      "candidate_no", "candidate_name", "running_mate", "party_id", "party_name", "gender", "age", "incumbent", "elected_note", "votes",
      "vote_percentage", "candidate_fact_id"]);
    function inspect(value, depth = 0) {
      if (depth > 12 || typeof value === "string" && value.length > 2048 || typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("invalid presidential receipt value");
      }
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          if (value.length > 50000) throw new Error("oversized presidential receipt");
          value.forEach((item) => inspect(item, depth + 1));
        } else Object.entries(value).forEach(([key, item]) => {
          if (!fields.has(key)) throw new Error("unknown presidential receipt field");
          inspect(item, depth + 1);
        });
      }
    }
    inspect(record);
    return true;
  }

  function validatePresidentAudit(record) {
    const years = [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024];
    const candidates = [4, 5, 2, 2, 3, 3, 3, 3];
    if (!historyKeys(record, ["schema", "base_database_sha256", "revision_ids", "sources", "coverage", "corrections",
      "auxiliary_notes", "previous_revision", "name_aliases", "api_gaps", "supplemental_notes"])
      || record.schema !== "cec-president-source-audit-v2" || !/^[a-f0-9]{64}$/.test(record.base_database_sha256)
      || JSON.stringify(record.revision_ids) !== '["cec-president-full-audit"]'
      || !Array.isArray(record.sources) || record.sources.length < 57 || record.sources.length > 1024
      || !Array.isArray(record.coverage) || record.coverage.length !== 188) throw new Error("invalid full presidential audit identity");
    const officialUrl = (text) => {
      const url = new URL(text);
      if (url.protocol !== "https:" || url.hostname !== "db.cec.gov.tw" || url.username || url.password || url.search || url.hash) {
        throw new Error("audit evidence must use official HTTPS sources");
      }
    };
    const files = new Set();
    record.sources.forEach((source) => {
      if (!historyKeys(source, ["file", "url", "sha256", "bytes", "role", "accessed_at"])
        || !/^[A-Za-z0-9_-]+\.(zip|json)$/.test(source.file) || files.has(source.file)
        || !/^[a-f0-9]{64}$/.test(source.sha256) || !historyCount(source.bytes) || !historyString(source.role)
        || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessed_at)) throw new Error("invalid full audit source");
      officialUrl(source.url);files.add(source.file);
    });
    if (!files.has("president-list.json") || !years.every((year) => ["attachments.json", "official.zip", "normalized.json",
      "national-profiles.json", "national-tickets.json", "counties-profiles.json", "counties-tickets.json"].every(
      (suffix) => files.has(`${year}-${suffix}`)))) throw new Error("missing eight-cycle source evidence");
    const seen = new Set(), counts = new Map();
    record.coverage.forEach((scope) => {
      const index = years.indexOf(scope.year), key = JSON.stringify([scope.year, scope.county]);
      if (!historyKeys(scope, ["year", "county", "stations", "villages", "electorate", "valid", "invalid", "total", "candidate_votes",
        "before", "after", "changed_units", "date"]) || index < 0 || !historyString(scope.county) || seen.has(key)
        || !["stations", "villages", "electorate", "valid", "invalid", "total", "changed_units"].every((field) => historyCount(scope[field]))
        || !Array.isArray(scope.candidate_votes) || scope.candidate_votes.length !== candidates[index]
        || !scope.candidate_votes.every(historyCount) || scope.candidate_votes.reduce((a, b) => a + b, 0) !== scope.valid
        || scope.valid + scope.invalid !== scope.total || scope.total > scope.electorate
        || typeof scope.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scope.date) || !scope.date.startsWith(String(scope.year))) {
        throw new Error("invalid full audit county totals");
      }
      [scope.before, scope.after].forEach((summary) => {
        if (!historyKeys(summary, ["source_area_count", "missing_electorate_count", "invalid_vote_area_count", "electorate_sum_of_nonmissing", "candidate_totals"])
          || !["source_area_count", "missing_electorate_count", "invalid_vote_area_count", "electorate_sum_of_nonmissing"].every((field) => historyCount(summary[field]))
          || !Array.isArray(summary.candidate_totals)) throw new Error("invalid full audit SQL summary");
      });
      const after = scope.after;
      if (after.source_area_count !== scope.villages || after.missing_electorate_count !== 0 || after.invalid_vote_area_count !== 0
        || after.electorate_sum_of_nonmissing !== scope.electorate || after.candidate_totals.length !== candidates[index]
        || !after.candidate_totals.every((c, i) => historyKeys(c, ["number", "votes"]) && String(c.number) === String(i + 1)
          && c.votes === scope.candidate_votes[i])) throw new Error("audited SQL totals differ from official source");
      seen.add(key);counts.set(scope.year, (counts.get(scope.year) || 0) + 1);
    });
    if (!years.every((year) => counts.get(year) === (year <= 2008 ? 25 : 22))) throw new Error("incomplete county/year audit");
    ["corrections", "auxiliary_notes", "name_aliases", "api_gaps", "supplemental_notes"].forEach((field) => {
      if (!Array.isArray(record[field])) throw new Error("invalid audit evidence list");
    });
    if (record.previous_revision !== null) {
      if (record.previous_revision.schema !== "cec-president-source-revision-v1") throw new Error("invalid previous revision");
      validatePresidentRevision(record.previous_revision);
    }
    const fields = new Set(["schema", "base_database_sha256", "revision_ids", "sources", "coverage", "corrections", "auxiliary_notes",
      "previous_revision", "name_aliases", "api_gaps", "supplemental_notes", "year", "county", "date", "villages", "stations", "changed_units",
      "candidate_votes", "before", "after", "file", "url", "sha256", "bytes", "role", "accessed_at", "source_area_count",
      "missing_electorate_count", "invalid_vote_area_count", "electorate_sum_of_nonmissing", "candidate_totals", "number", "turnout_rows",
      "candidate_rows", "names", "original_names", "original_source_area_id", "original_votes", "corrected_votes", "original_electorate",
      "corrected_electorate", "spreadsheet_rows", "reason", "original", "handling", "workbook", "sheet", "row", "station", "valid", "invalid",
      "total", "electorate", "before_turnout", "before_candidates", "official", "official_rows", "after_turnout", "after_candidates",
      "proof", "kind", "code", "source_area_ids", "counts", "redirected_to", "election_id", "election_year", "election_date", "election_type",
      "source_area_id", "source_geo_key", "comparison_area_id", "resolution_status", "county_name", "township_name", "village_name",
      "electoral_district_name", "valid_votes", "invalid_votes", "total_votes", "turnout_ratio", "turnout_fact_id", "map_area_ids", "candidate_id",
      "candidate_no", "candidate_name", "running_mate", "party_id", "party_name", "gender", "age", "incumbent", "elected_note", "votes",
      "vote_percentage", "candidate_fact_id"]);
    function inspect(value, depth = 0) {
      if (depth > 16 || typeof value === "string" && value.length > 2048 || typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("invalid full audit receipt value");
      }
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          if (value.length > 50000) throw new Error("oversized full audit receipt");
          value.forEach((item) => inspect(item, depth + 1));
        } else Object.entries(value).forEach(([key, item]) => {
          if (!fields.has(key)) throw new Error("unknown full audit receipt field");
          if (key === "url" || key === "redirected_to") officialUrl(item);
          inspect(item, depth + 1);
        });
      }
    }
    inspect(record);return true;
  }

  function validateMayorRevision(record) {
    const roots=["schema","base_database_sha256","sources","coverage","corrections","date_corrections","name_aliases","limitations"];
    const fields=["election_id","year","county","date","theme_id","type","source_grain","original_units","source_areas","electorate","valid","invalid","total","candidate_votes","changed_units"];
    if (!historyKeys(record, roots) || record.schema!=="cec-mayor-source-audit-v1"
      || !/^[a-f0-9]{64}$/.test(record.base_database_sha256) || !Array.isArray(record.coverage) || record.coverage.length!==98
      || !Array.isArray(record.sources) || record.sources.length>1024) throw new Error("invalid mayor audit identity/coverage");
    const seen=new Set(), cycles=new Map(),files=new Set();
    record.coverage.forEach((r)=>{
      const key=JSON.stringify([r.election_id,r.county]);
      if (!historyKeys(r,fields) || seen.has(key) || !historyString(r.county) || !historyString(r.election_id)
        || ![2001,2002,2006,2010,2014,2018,2022].includes(r.year) || !["C1","C2"].includes(r.type)
        || !/^[a-f0-9]{32}$/.test(r.theme_id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number(r.date.slice(0,4))!==r.year
        || !["station","village","township"].includes(r.source_grain)
        || !["original_units","source_areas","electorate","valid","invalid","total","changed_units"].every(k=>historyCount(r[k]))
        || !r.source_areas || !r.original_units || r.changed_units>r.source_areas
        || !Array.isArray(r.candidate_votes) || !r.candidate_votes.length || !r.candidate_votes.every(historyCount)
        || r.candidate_votes.reduce((a,b)=>a+b,0)!==r.valid || r.valid+r.invalid!==r.total || r.total>r.electorate) throw new Error("invalid mayor source totals");
      seen.add(key);cycles.set(r.election_id,(cycles.get(r.election_id)||0)+1);
    });
    const expected={county_mayor_2001:23,municipal_mayor_2002:2,municipal_mayor_2006:2,municipal_mayor_2010:5,mayor_2014:22,mayor_2018:22,mayor_2022:21,mayor_rerun_2022_2677522590:1};
    if (cycles.size!==8 || !Object.entries(expected).every(([id,n])=>cycles.get(id)===n)) throw new Error("incomplete mayor election coverage");
    record.sources.forEach(s=>{
      if (!historyKeys(s,["file","url","sha256","bytes","role","accessed_at"]) || !/^[A-Za-z0-9_-]+\.(zip|rar|xls|json|csv)$/.test(s.file)
        || files.has(s.file) || !/^[a-f0-9]{64}$/.test(s.sha256) || !historyCount(s.bytes) || !historyString(s.role)
        || !/^\d{4}-\d{2}-\d{2}$/.test(s.accessed_at)) throw new Error("invalid mayor source identity");
      const supplied=s.url===null && /^200[12]-original-el(base|prof|ctks|cand|paty)\.csv$/.test(s.file) && s.role.startsWith("Provided CEC CSV archive;");
      if (!supplied) {const u=new URL(s.url);if(u.protocol!=="https:" || u.hostname!=="db.cec.gov.tw" || u.username || u.password || u.search || u.hash) throw new Error("nonofficial mayor source");}
      files.add(s.file);
    });
    const required=["mayor-C1-list.json","mayor-C2-list.json",...record.coverage.map(r=>`${r.year}${r.election_id.startsWith("mayor_rerun")?"-rerun":""}-${r.type}-C-profiles.json`)];
    if (!required.every(f=>files.has(f))) throw new Error("missing mayor source evidence");
    ["corrections","date_corrections","name_aliases","limitations"].forEach(k=>{if(!Array.isArray(record[k])) throw new Error("invalid mayor audit list");});
    record.corrections.forEach(r=>{
      if(!historyKeys(r,["election_id","names","reason","before","after","official_rows"]) || !Object.hasOwn(expected,r.election_id)
        || !Array.isArray(r.names) || r.names.length!==3 || !r.names.every(n=>historyString(n,true))
        || !Array.isArray(r.before) || !Array.isArray(r.after) || !Array.isArray(r.official_rows)) throw new Error("invalid mayor correction scope");
      r.after.forEach(a=>{
        if(!historyKeys(a,["source_area_id","electorate","valid","invalid","total","votes","candidate_numbers","candidate_electorates"])
          || !historyString(a.source_area_id) || !["electorate","valid","invalid","total"].every(k=>historyCount(a[k]))
          || !Array.isArray(a.votes) || !a.votes.length || !a.votes.every(historyCount)
          || a.votes.reduce((x,y)=>x+y,0)!==a.valid || a.valid+a.invalid!==a.total || a.total>a.electorate
          || !Array.isArray(a.candidate_numbers) || a.candidate_numbers.length!==a.votes.length || !a.candidate_numbers.every((n,i)=>n===i+1)
          || !Array.isArray(a.candidate_electorates) || a.candidate_electorates.length!==a.votes.length || !a.candidate_electorates.every(n=>n===a.electorate)) throw new Error("invalid mayor correction denominator");
      });
      r.official_rows.forEach(a=>{if(!historyKeys(a,["source_file","workbook","sheet","row","station"]) || !files.has(a.source_file) || !historyCount(a.row) || !a.row)throw new Error("invalid mayor original row reference");});
    });
    const allowed=new Set([...roots,...fields,"file","url","sha256","bytes","role","accessed_at","names","reason","before","after","source_area_id","votes","candidate_numbers","candidate_electorates","official_rows","source_file","workbook","sheet","row","station","original_names","proof","kind","code","count","before_date","after_date","tables"]);
    function inspect(v,d=0){
      if(d>14 || typeof v==="string" && v.length>2048 || typeof v==="number" && !Number.isFinite(v)) throw new Error("invalid mayor audit value");
      if(Array.isArray(v)){if(v.length>50000)throw new Error("oversized mayor audit");v.forEach(x=>inspect(x,d+1));}
      else if(v && typeof v==="object"){Object.entries(v).forEach(([k,x])=>{if(!allowed.has(k))throw new Error("unknown/private mayor audit field");inspect(x,d+1);});}
    }
    inspect(record);return true;
  }

  function validateHistoryPointer(pointer, databaseSha) {
    const revised = pointer?.schema === "election-president-history-v2";
    const mayorExtended = pointer?.schema === "election-mayor-history-v4";
    const mayorRevised = mayorExtended || pointer?.schema === "election-mayor-history-v3";
    const president = revised || pointer?.schema === "election-president-history-v1";
    if (!historyKeys(pointer, ["schema", "database_sha256", "years", "counties", ...(revised || mayorRevised ? ["revision"] : [])])
      || !["election-mayor-history-v2", "election-mayor-history-v3", "election-mayor-history-v4", "election-president-history-v1", "election-president-history-v2"].includes(pointer.schema)
      || !/^[a-f0-9]{64}$/.test(pointer.database_sha256)
      || pointer.database_sha256 !== databaseSha
      || JSON.stringify(pointer.years) !== (revised ? "[1996,2000,2004,2008,2012,2016,2020,2024]" : president ? "[2000,2004,2008,2012,2016,2020,2024]" : mayorExtended ? "[2001,2002,2006,2010,2014,2018,2022]" : "[2010,2014,2018,2022]")
      || !Array.isArray(pointer.counties) || pointer.counties.length > (president || mayorExtended ? 27 : 22)) {
      throw new Error("invalid mayor history pointer identity");
    }
    if ((revised || mayorRevised) && (mayorRevised || pointer.revision !== null) && (!historyKeys(pointer.revision, ["file", "sha256"])
      || pointer.revision.file !== (mayorRevised ? "history/mayor-sources.json" : "history/president-sources.json")
      || !/^[a-f0-9]{64}$/.test(pointer.revision.sha256))) {
      throw new Error("invalid presidential source revision pointer");
    }
    const names = new Set();
    const files = new Set();
    pointer.counties.forEach((entry) => {
      if (!historyKeys(entry, ["name", "file", "sha256", "area_count"])
        || !historyString(entry.name) || names.has(entry.name) || files.has(entry.file)
        || !(president ? /^history\/president-county-[0-9]{2}\.json$/ : /^history\/county-[0-9]{2}\.json$/).test(entry.file)
        || !/^[a-f0-9]{64}$/.test(entry.sha256)
        || !historyCount(entry.area_count) || entry.area_count < 1) {
        throw new Error("invalid mayor history county pointer");
      }
      localDataPath(`data/${entry.file}`);
      names.add(entry.name); files.add(entry.file);
    });
    return true;
  }

  function validateHistoryShard(shard, entry, pointer) {
    validateHistoryPointer(pointer, pointer?.database_sha256);
    const revised = pointer.schema === "election-president-history-v2";
    const mayorRevised = ["election-mayor-history-v3", "election-mayor-history-v4"].includes(pointer.schema);
    const president = revised || pointer.schema === "election-president-history-v1";
    if (!pointer.counties.some((county) => JSON.stringify(county) === JSON.stringify(entry))
      || !historyKeys(shard, ["schema", "database_sha256", "county", "years", "areas"])
      || shard.schema !== pointer.schema || shard.database_sha256 !== pointer.database_sha256
      || shard.county !== entry.name || JSON.stringify(shard.years) !== JSON.stringify(pointer.years)
      || !Array.isArray(shard.areas) || shard.areas.length !== entry.area_count) {
      throw new Error("mayor history shard identity mismatch");
    }
    const names = new Set();
    shard.areas.forEach((area) => {
      const key = JSON.stringify(area?.names);
      if (!historyKeys(area, ["names", "periods", "chart"]) || !Array.isArray(area.names)
        || area.names.length < 1 || area.names.length > 3 || area.names[0] !== entry.name
        || !area.names.every((name) => historyString(name)) || names.has(key)
        || !Array.isArray(area.periods) || area.periods.length !== pointer.years.length) {
        throw new Error("invalid mayor history area");
      }
      names.add(key);
      area.periods.forEach((period, index) => {
        if (!historyKeys(period, ["year", "elections"]) || period.year !== pointer.years[index]
          || !Array.isArray(period.elections)) throw new Error("invalid mayor history period");
        const electionIds = new Set();
        period.elections.forEach((election) => {
          if (!historyKeys(election, ["id", "name", "kind", "date", "electorate", "source_area_count",
            "missing_electorate_count", "unmapped_area_count", "resolution_status_counts", "boundary_status", "candidates",
            ...(president ? ["invalid_vote_area_count"] : []), ...(revised || mayorRevised ? ["source_revision"] : [])])
            || (mayorRevised && election.source_revision !== "cec-mayor-full-audit")
            || (president && (!historyCount(election.invalid_vote_area_count)
              || election.invalid_vote_area_count > election.source_area_count))
            || !historyString(election.id) || electionIds.has(election.id) || !historyString(election.name)
            || !(president ? ["general"] : ["general", "local_general", "local", "rerun"]).includes(election.kind)
            || (president && election.id !== `president_${period.year}`)
            || (revised && election.source_revision !== null && (!pointer.revision
              || !["cec-president-full-audit", ...(period.year === 1996 ? ["cec-1996-original"] : period.year === 2004 && entry.name === "臺東縣" ? ["cec-2004-taitung-rebuild"] : [])].includes(election.source_revision)))
            || (election.date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(election.date)
              || Number(election.date.slice(0, 4)) !== period.year || !Number.isFinite(Date.parse(election.date))))
            || (election.electorate !== null && !historyCount(election.electorate))
            || !historyCount(election.source_area_count) || election.source_area_count < 1
            || !historyCount(election.missing_electorate_count) || election.missing_electorate_count > election.source_area_count
            || (election.electorate === null) !== (election.missing_electorate_count > 0)
            || !historyCount(election.unmapped_area_count) || election.unmapped_area_count > election.source_area_count
            || election.boundary_status !== "not_harmonized"
            || !Array.isArray(election.candidates) || !election.candidates.length) {
            throw new Error("invalid mayor history election");
          }
          electionIds.add(election.id);
          const statuses = election.resolution_status_counts;
          if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)
            || Object.keys(statuses).some((status) => !["exact", "unresolved", "unknown", "cross_village_exact_membership"].includes(status))
            || !Object.values(statuses).every(historyCount)
            || Object.values(statuses).reduce((sum, n) => sum + n, 0) !== election.source_area_count) {
            throw new Error("invalid mayor history geography counts");
          }
          const ids = new Set();
          election.candidates.forEach((candidate) => {
            if (!historyKeys(candidate, ["id", "number", "name", "party", "votes", "votes_per_elector"])
              || !historyString(candidate.id) || ids.has(candidate.id) || !historyString(candidate.number, true)
              || !historyString(candidate.name) || !historyString(candidate.party, true)
              || (candidate.votes !== null && (!historyCount(candidate.votes) || election.invalid_vote_area_count > 0))) {
              throw new Error("invalid mayor history candidate");
            }
            ids.add(candidate.id);
            const ratio = candidate.votes_per_elector;
            const available = candidate.votes !== null && election.electorate > 0;
            if (available ? (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1
              || Math.abs(ratio - candidate.votes / election.electorate) > 5.1e-9) : ratio !== null) {
              throw new Error("invalid precomputed votes per elector");
            }
          });
        });
      });
      validateHistoryChart(area.chart, area.periods);
    });
    return true;
  }

  function validateHistoryChart(chart, periods) {
    const ordered = [...periods].reverse();
    if (!historyKeys(chart, ["years", "status", "electorate", "series"])
      || JSON.stringify(chart.years) !== JSON.stringify(ordered.map((p) => p.year))
      || !Array.isArray(chart.status) || chart.status.length !== ordered.length
      || !Array.isArray(chart.electorate) || chart.electorate.length !== ordered.length
      || !Array.isArray(chart.series)) throw new Error("invalid mayor history chart");
    const parties = new Set(periods.flatMap((p) => p.elections.flatMap((e) => e.candidates.map((c) => c.party))));
    const seen = new Set();
    ordered.forEach((period, i) => {
      const available = period.elections.length === 1;
      const expectedStatus = available ? "available" : period.elections.length ? "multiple" : "missing";
      if (chart.status[i] !== expectedStatus
        || chart.electorate[i] !== (available ? period.elections[0].electorate : null)) {
        throw new Error("mayor history chart period mismatch");
      }
    });
    chart.series.forEach((series) => {
      if (!historyKeys(series, ["party", "votes", "votes_per_elector"])
        || !parties.has(series.party) || seen.has(series.party)
        || !Array.isArray(series.votes) || series.votes.length !== ordered.length
        || !Array.isArray(series.votes_per_elector) || series.votes_per_elector.length !== ordered.length) {
        throw new Error("invalid mayor history chart series");
      }
      seen.add(series.party);
      ordered.forEach((period, i) => {
        const candidates = period.elections.length === 1
          ? period.elections[0].candidates.filter((c) => c.party === series.party) : [];
        const votes = candidates.length && candidates.every((c) => c.votes !== null)
          ? candidates.reduce((total, c) => total + c.votes, 0) : null;
        const ratio = series.votes_per_elector[i];
        if (series.votes[i] !== votes || (votes !== null && !historyCount(votes))
          || (votes !== null && chart.electorate[i] > 0
            ? typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1
              || Math.abs(ratio - votes / chart.electorate[i]) > 5.1e-9
            : ratio !== null)) throw new Error("invalid precomputed mayor history chart value");
      });
    });
    if (seen.size !== parties.size) throw new Error("mayor history chart omitted a party");
  }

  function historyLineSegments(values) {
    const segments = [];
    let segment = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else segment.push([index, value]);
    });
    if (segment.length) segments.push(segment);
    return segments;
  }

  class RequestGate {
    constructor() {
      this.generation = 0;
    }

    begin() {
      this.generation += 1;
      return this.generation;
    }

    invalidate() {
      this.generation += 1;
    }

    isCurrent(generation) {
      return generation === this.generation;
    }
  }

  class BoundedLruCache {
    constructor(limit) {
      this.limit = Math.max(1, Number(limit) || 1);
      this.values = new Map();
    }

    has(key) {
      return this.values.has(key);
    }

    get(key) {
      if (!this.values.has(key)) return undefined;
      const value = this.values.get(key);
      this.values.delete(key);
      this.values.set(key, value);
      return value;
    }

    set(key, value) {
      if (this.values.has(key)) this.values.delete(key);
      this.values.set(key, value);
      while (this.values.size > this.limit) {
        this.values.delete(this.values.keys().next().value);
      }
      return value;
    }
  }

  const OBSERVATION_SCHEMA = "election-observation-2026-v1";
  // Administrative location only: no historical electoral crosswalk is used.
  function buildObservationGeography(features) {
    const cache = new Map();
    function groups(level, county = "", township = "") {
      const cacheKey = JSON.stringify([level, county, township]);
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const grouped = new Map();
      features.forEach((feature, index) => {
        const p = feature.properties;
        if (county && p.COUNTYNAME !== county) return;
        if (township && p.TOWNNAME !== township) return;
        const sourceLabel = p[level === "county" ? "COUNTYNAME" : level === "township" ? "TOWNNAME" : "VILLNAME"];
        const label = sourceLabel || (level === "village" && p.NOTE === "未編定村里" ? "未編定村里" : "");
        const identity = p[level === "county" ? "COUNTYCODE" : level === "township" ? "TOWNCODE" : "VILLCODE"];
        if (!label || !identity) return;
        const key = JSON.stringify([p.COUNTYNAME, level === "county" ? "" : p.TOWNNAME, identity]);
        if (!grouped.has(key)) grouped.set(key, {label, named: Boolean(sourceLabel), indexes: [], county: p.COUNTYNAME, township: level === "county" ? "" : p.TOWNNAME});
        grouped.get(key).indexes.push(index);
      });
      const regions = [...grouped].map(([key, group]) => ({
        ...regionFromFeatures(level, key, group.label, group.indexes, [], features),
        county: group.county, township: group.township, named: group.named,
      })).sort((a,b) => a.label.localeCompare(b.label, "zh-Hant"));
      cache.set(cacheKey, regions);
      return regions;
    }
    return {counties: groups("county"), townships: county => groups("township", county), villages: (county,township) => groups("village", county, township)};
  }

  function observationMapTarget(region, office, districts, locations = [], activeDistrictId = null) {
    if (region.named === false) return null;
    if (region.level === "county") return {level: "county", value: region.county};
    if (region.level === "township") {
      const matches = locations.filter(l => l.county === region.county && l.office === office && l.scope === "regional" && (l.townships.includes(region.township) || l.partial_townships?.includes(region.township))
        && districts.some(d => d.id === l.district_id && d.county === l.county && d.office === l.office));
      if (activeDistrictId && matches.some(l => l.district_id === activeDistrictId)) {
        return {level: "township", value: region.township};
      }
      if (matches.length === 1 && matches[0].townships.includes(region.township)) return {level: "district", value: matches[0].district_id};
      if (matches.length && matches.every(l => l.partial_townships?.includes(region.township) && !l.townships.includes(region.township))) return {level: "township", value: region.township};
      if (matches.length > 1) return null;
    }
    const scoped = districts.filter(d => d.county === region.county && d.office === office && d.township === region.township);
    if (region.level === "township") {
      if (scoped.length) return {level: "township", value: region.township};
      if (["metro_mayor", "county_mayor", "metro_councilor", "county_councilor"].includes(office)) return {level: "township", value: region.township};
      return null;
    }
    if (region.level === "village") {
      if (["metro_mayor", "county_mayor"].includes(office)) {
        return {level: "village", value: region.label};
      }
      if (["metro_councilor", "county_councilor"].includes(office) && locations && locations.length > 0) {
        return {level: "village", value: region.label};
      }
    }
    if (region.level !== "village" || office !== "village_chief") return null;
    const matches = scoped.filter(d => d.name === region.county + region.township + region.label);
    return matches.length === 1 ? {level: "district", value: matches[0].id} : null;
  }

  const OBSERVATION_OFFICES = ["metro_mayor", "metro_councilor", "county_mayor", "county_councilor", "indigenous_district_mayor", "indigenous_district_representative", "township_mayor", "township_representative", "village_chief"];
  function observationKeys(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(" ") !== keys.split(" ").sort().join(" ")) throw new Error("observation unexpected or missing fields");
  }
  function observationCount(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("observation invalid count");
  }
  function observationText(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\u0000-\u001f]/.test(value)) throw new Error("observation invalid text");
  }
  function observationDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("observation invalid date");
  }
  // Official textual membership supports navigation; it does not create electoral polygons.
  function validateObservationLocations(locations, sources, districts = null) {
    if (!Array.isArray(locations) || !locations.length) throw new Error("observation councilor locations missing");
    const ids = new Set(), towns = new Set(), partialTowns = new Set(), sourceIds = new Set(sources.map(s => s.id));
    locations.forEach(l => {
      const detailed = ["scope_text", "partial_townships", "source_pages"].some(k => Object.hasOwn(l, k));
      observationKeys(l, "district_id county office scope townships source_id source_page" + (detailed ? " scope_text partial_townships source_pages" : ""));
      observationText(l.county); observationCount(l.source_page);
      if (!/^d-[a-f0-9]{24}$/.test(l.district_id) || ids.has(l.district_id) || !["metro_councilor", "county_councilor"].includes(l.office)
        || !["regional", "plains_indigenous", "mountain_indigenous"].includes(l.scope) || !sourceIds.has(l.source_id) || !l.source_page
        || !Array.isArray(l.townships) || (l.scope === "regional" ? (!detailed && !l.townships.length) : l.townships.length !== 0)) throw new Error("observation councilor location identity mismatch");
      ids.add(l.district_id);
      if (detailed) {
        observationText(l.scope_text);
        if (!Array.isArray(l.partial_townships) || new Set(l.partial_townships).size !== l.partial_townships.length
          || (l.scope !== "regional" && l.partial_townships.length)
          || !Array.isArray(l.source_pages) || !l.source_pages.length || l.source_pages[0] !== l.source_page
          || l.source_pages.some((p,i) => !Number.isSafeInteger(p) || p < 1 || (i && p <= l.source_pages[i-1]))
          || (l.scope === "regional" ? l.scope_text.includes("原住民") : !l.scope_text.includes(l.scope === "plains_indigenous" ? "平地原住民" : "山地原住民"))) throw new Error("observation councilor scope details invalid");
        l.partial_townships.forEach(t => {
          observationText(t); const key = JSON.stringify([l.county,l.office,t]);
          if (towns.has(key)) throw new Error("observation whole and partial township overlap");
          partialTowns.add(key);
        });
      }
      l.townships.forEach(t => {
        observationText(t); const key = JSON.stringify([l.county, l.office, t]);
        if (towns.has(key) || partialTowns.has(key)) throw new Error("observation ambiguous councilor township");
        towns.add(key);
      });
      if (districts && !districts.some(d => d.id === l.district_id && d.county === l.county && d.office === l.office)) throw new Error("observation councilor location has no matching roster");
    });
    return locations;
  }
  function validateObservationManifest(manifest, pointer) {
    const pointerExtra = ["registration_status", "mayor_metrics", "council_metrics"].filter(k => Object.hasOwn(pointer, k)).join(" ");
    observationKeys(pointer, "schema manifest sha256 as_of candidate_count district_count" + (pointerExtra ? " " + pointerExtra : ""));
    observationKeys(manifest, "schema as_of source_date election_date registration_status sources national_electorate official_district_count offices counties history_database_sha256 district_count candidate_count history_basis history_years" + (Object.hasOwn(manifest, "councilor_locations") ? " councilor_locations" : ""));
    if (manifest.schema !== OBSERVATION_SCHEMA || pointer.schema !== manifest.schema || pointer.manifest !== "observation/manifest.json" || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.as_of !== manifest.as_of || pointer.candidate_count !== manifest.candidate_count || pointer.district_count !== manifest.district_count) throw new Error("observation pointer identity mismatch");
    observationDate(manifest.as_of); observationDate(manifest.source_date);
    if (manifest.election_date !== "2026-11-28" || manifest.as_of >= manifest.election_date || manifest.source_date > manifest.as_of || !["registered_pending_review", "approved", "official_reviewed"].includes(manifest.registration_status) || manifest.history_basis !== "nominal_district_not_2026_boundary" || JSON.stringify(manifest.history_years) !== "[2014,2018,2022]" || !/^[a-f0-9]{64}$/.test(manifest.history_database_sha256)) throw new Error("observation snapshot identity mismatch");
    observationKeys(manifest.offices, OBSERVATION_OFFICES.join(" "));
    Object.values(manifest.offices).forEach(observationText);
    const sourceIds = new Set();
    if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error("observation sources missing");
    manifest.sources.forEach((s) => {
      observationKeys(s, "id title url published_on sha256");
      observationText(s.id); observationText(s.title); observationDate(s.published_on);
      const u = new URL(s.url);
      if (u.protocol !== "https:" || !["web.cec.gov.tw", "info.cec.gov.tw"].includes(u.hostname) || u.username || u.password || u.port || sourceIds.has(s.id) || !/^[a-f0-9]{64}$/.test(s.sha256) || s.published_on > manifest.as_of) throw new Error("observation invalid official source");
      sourceIds.add(s.id);
    });
    if (Object.hasOwn(manifest, "councilor_locations")) validateObservationLocations(manifest.councilor_locations, manifest.sources);
    observationKeys(manifest.national_electorate, "value status as_of source_id");
    observationCount(manifest.national_electorate.value); observationDate(manifest.national_electorate.as_of);
    if (manifest.national_electorate.status !== "estimate" || !sourceIds.has(manifest.national_electorate.source_id)) throw new Error("observation electorate estimate identity mismatch");
    const names = new Set(), paths = new Set();
    let candidateCount = 0, districtCount = 0;
    if (!Array.isArray(manifest.counties) || manifest.counties.length !== 22) throw new Error("observation county coverage mismatch");
    manifest.counties.forEach((c) => {
      observationKeys(c, "name file sha256 district_count candidate_count");
      observationText(c.name); observationCount(c.district_count); observationCount(c.candidate_count);
      if (names.has(c.name) || paths.has(c.file) || !/^observation\/c-[a-f0-9]{12}\.json$/.test(c.file) || !/^[a-f0-9]{64}$/.test(c.sha256)) throw new Error("observation county identity mismatch");
      names.add(c.name); paths.add(c.file); candidateCount += c.candidate_count; districtCount += c.district_count;
    });
    observationCount(manifest.official_district_count);
    if (candidateCount !== manifest.candidate_count || districtCount !== manifest.district_count || districtCount > manifest.official_district_count) throw new Error("observation coverage mismatch");
    return manifest;
  }
  function observationRatio(numerator, denominator) {
    return numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator * 100;
  }
  function validateObservationHistory(h) {
    observationKeys(h, "year date election_id area_count valid_votes invalid_votes total_votes electorate turnout_pct parties");
    if (![2014, 2018, 2022].includes(h.year)) throw new Error("observation disallowed historical year");
    observationDate(h.date);
    if (!h.date.startsWith(String(h.year))) throw new Error("observation historical date mismatch");
    observationText(h.election_id); observationCount(h.area_count);
    [h.valid_votes, h.invalid_votes, h.total_votes, h.electorate].forEach(v => { if (v !== null) observationCount(v); });
    function sameRate(actual, expected) {
      if (expected === null ? actual !== null : typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-8) throw new Error("observation historical ratio mismatch");
    }
    if (h.valid_votes !== null && h.invalid_votes !== null && h.total_votes !== null && h.valid_votes + h.invalid_votes !== h.total_votes) throw new Error("observation turnout closure mismatch");
    if (h.total_votes !== null && h.electorate !== null && h.total_votes > h.electorate) throw new Error("observation electorate smaller than votes");
    sameRate(h.turnout_pct, observationRatio(h.total_votes, h.electorate));
    const names = new Set(); let total = 0;
    if (!Array.isArray(h.parties)) throw new Error("observation parties missing");
    h.parties.forEach(p => {
      observationKeys(p, "name votes vote_share_pct electorate_share_pct");
      observationText(p.name); observationCount(p.votes);
      if (names.has(p.name)) throw new Error("observation duplicate party");
      names.add(p.name); total += p.votes;
      sameRate(p.vote_share_pct, observationRatio(p.votes, h.valid_votes));
      sameRate(p.electorate_share_pct, observationRatio(p.votes, h.electorate));
    });
    if (h.valid_votes !== null && total !== h.valid_votes) throw new Error("observation party vote closure mismatch");
  }
  function validateObservationShard(shard, county, manifest) {
    observationKeys(shard, "schema as_of county districts");
    if (shard.schema !== manifest.schema || shard.as_of !== manifest.as_of || shard.county !== county.name || !Array.isArray(shard.districts) || shard.districts.length !== county.district_count) throw new Error("observation county shard identity mismatch");
    const sources = new Set(manifest.sources.map(s => s.id)), ids = new Set(), scopes = new Set(); let count = 0;
    shard.districts.forEach(d => {
      observationKeys(d, "id office county township name source_id candidates electorate population history history_issues");
      const scope = `${d.office}|${d.name}`;
      if (!/^d-[a-f0-9]{24}$/.test(d.id) || ids.has(d.id) || scopes.has(scope) || !OBSERVATION_OFFICES.includes(d.office) || d.county !== county.name || typeof d.township !== "string" || !d.name.startsWith(d.county + d.township) || !sources.has(d.source_id)) throw new Error("observation district identity mismatch");
      observationText(d.name); ids.add(d.id); scopes.add(scope);
      observationKeys(d.electorate, "status value as_of source_id");
      if (d.electorate.status !== "not_verified" || d.electorate.value !== null || d.electorate.as_of !== null || d.electorate.source_id !== null) throw new Error("observation unverified electorate must be null");
      if (d.population !== null) {
        observationKeys(d.population, "value as_of source_id");
        observationCount(d.population.value); observationDate(d.population.as_of);
        if (!["metro_mayor", "county_mayor"].includes(d.office) || !sources.has(d.population.source_id)) throw new Error("observation population scope mismatch");
      }
      const names = new Set();
      if (!Array.isArray(d.candidates) || !d.candidates.length) throw new Error("observation registration list missing");
      d.candidates.forEach(c => {
        observationKeys(c, "name name_status party registered_on source_page");
        if (!["readable", "unreadable"].includes(c.name_status) || (c.name === null) !== (c.name_status === "unreadable")) throw new Error("observation name extraction status mismatch");
        if (c.name !== null) observationText(c.name); observationText(c.party); observationDate(c.registered_on); observationCount(c.source_page);
        if ((c.name !== null && names.has(c.name)) || !c.source_page || c.registered_on < "2026-08-31" || c.registered_on > "2026-09-04") throw new Error("observation candidate identity mismatch");
        names.add(c.name); count += 1;
      });
      const years = new Set();
      if (!Array.isArray(d.history) || !Array.isArray(d.history_issues)) throw new Error("observation historical series missing");
      d.history.forEach(h => { validateObservationHistory(h); if (years.has(h.year)) throw new Error("observation duplicate history year"); years.add(h.year); });
      d.history_issues.forEach(observationText);
    });
    const locations = (manifest.councilor_locations || []).filter(l => l.county === county.name);
    if (locations.length) validateObservationLocations(locations, manifest.sources, shard.districts);
    if (count !== county.candidate_count) throw new Error("observation registration count mismatch");
    return shard;
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-Hant").replace(/台/g, "臺");
  }

  function searchPage(entries, query, offset = 0, limit = 200) {
    const needle = normalizeSearch(query);
    const matching = entries.filter(entry => normalizeSearch(entry.label).includes(needle));
    matching.sort((a, b) => {
      const rank = entry => (normalizeSearch(entry.label) === needle ? 0 : entry.kind === "county" ? 1 : 2);
      return rank(a) - rank(b);
    });
    return { total: matching.length, entries: matching.slice(offset, offset + limit) };
  }

  function unavailableYearsText(years) {
    const missing = years.filter(entry => !entry.available).map(entry => entry.year);
    return missing.length
      ? `本版本未收錄 ${missing.join("、")} 年投票資料；未收錄不代表零票。`
      : "本版本各年份皆有收錄投票資料；不代表每場選舉均已完整收錄。";
  }

  return {
    normalizeSearch,
    searchPage,
    unavailableYearsText,
    buildObservationGeography,
    observationMapTarget,
    validateObservationManifest,
    validateObservationLocations,
    validateObservationShard,
    observationRatio,
    BoundedLruCache,
    RequestGate,
    buildMapAreaIndexes,
    buildMapHierarchy,
    canDrillToVillage,
    mayorCoverageInfo,
    captureNavigationIntent,
    decodeTopology,
    dissolvePolygons,
    deriveBounds,
    findRegionByReference,
    hierarchySearchExamples,
    labelAnchor,
    labelPlacement,
    localDataPath,
    mapBoundaryStyle,
    mapDetailScope,
    mapLinkageLabel,
    matchesHierarchySearch,
    newsManifestCounty,
    pointInPolygon,
    resolveNavigationIntent,
    resultForAreas,
    sameBounds,
    selectNonOverlappingLabels,
    validateNewsManifest,
    validateNewsPointer,
    validateNewsShard,
    validateShard,
    validateHistoryPointer,
    validateHistoryShard,
    validatePresidentRevision,
    validateMayorRevision,
    historyLineSegments,
    combineMayor2022,
    mobilizationRate,
    mobilizationOpacity,
    combineHistoryAreas,
    analyzeMayorSwing,
    analyzeMayorSwingAggregate,
    analyzeMayorSwingScopes,
    analyzeBellwetherVillages,
    analyzeCouncilorDistrict,
    observationRegionFill,
    buildGlobalSpotlightIndex,
    classifyCouncilDistrict,
    classifyMayorContest,
    COUNCIL_MARGIN_BANDS,
    MAYOR_DEFAULT_SWING_YEARS,
    MAYOR_EXTENDED_SWING_YEARS,
  };
});
