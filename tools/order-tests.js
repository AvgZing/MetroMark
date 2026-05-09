// Provide minimal global helpers expected by the ordering module (normally present in browser)
global.stopKeyForFeature = function (feature) {
  return String((feature && feature.properties && (feature.properties.stop_id || feature.properties.station_name || feature.properties.stop_name)) || '').trim();
};
global.stopFeatureDisplayName = function (feature) {
  return String((feature && feature.properties && (feature.properties.station_name || feature.properties.stop_name)) || '');
};
global.lineTerminalHints = function (/* lineKey */) { return []; };

const { orderStopsForLineView } = require('../public/scripts/line-view-stop-ordering');

// Helper to create GeoJSON stop feature
function makeStop(id, name, lng, lat) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { stop_id: id, stop_name: name, station_name: name }
  };
}

// Utility: set global state with route geometry
function setRouteGeometry(lineKey, coords) {
  global.state = global.state || {};
  global.state.transit = global.state.transit || {};
  global.state.transit.routesGeoJson = { type: 'FeatureCollection', features: [ { type: 'Feature', properties: { line_key: lineKey }, geometry: { type: 'LineString', coordinates: coords } } ] };
}

async function run() {
  console.log('Test: Linear route');
  const linearStops = [
    makeStop('A','A',0.0,0.0),
    makeStop('B','B',0.01,0.0),
    makeStop('C','C',0.02,0.0),
  ];
  setRouteGeometry('linear', [[0,0],[0.02,0]]);
  for (const mode of ['geometry-revised','geometry-smart','geometry-projected','trip-pattern','hybrid-endpoint']) {
    try {
      const out = await orderStopsForLineView(linearStops, 'linear', { '0':[ { id: 'A' }, { id: 'B' }, { id: 'C' } ] }, mode);
      console.log(mode.padEnd(18), ':', out.map(f=>f.properties.stop_id).join(','));
    } catch(e) { console.log(mode, 'error', e.message); }
  }

  console.log('\nTest: J-shaped route');
  const jStops = [
    makeStop('S1','S1',0.0,0.0),
    makeStop('S2','S2',0.01,0.0),
    makeStop('S3','S3',0.02,0.0),
    makeStop('S4','S4',0.02,-0.02),
  ];
  // route goes out then loops back near origin causing J effect
  setRouteGeometry('jline', [[0,0],[0.02,0],[0.02,-0.02],[0.0,-0.02]]);
  for (const mode of ['geometry-revised','geometry-smart','geometry-projected','trip-pattern','hybrid-endpoint','direction']) {
    try {
      const out = await orderStopsForLineView(jStops, 'jline', { '0': [ { id: 'S1' }, { id: 'S2' }, { id: 'S3' }, { id: 'S4' } ] }, mode);
      console.log(mode.padEnd(18), ':', out.map(f=>f.properties.stop_id).join(','));
    } catch(e) { console.log(mode, 'error', e.message); }
  }

  console.log('\nTest: Loop route (start/end close)');
  const loopStops = [
    makeStop('L1','L1',0.0,0.0),
    makeStop('L2','L2',0.01,0.0),
    makeStop('L3','L3',0.01,0.01),
    makeStop('L4','L4',0.0,0.01),
  ];
  setRouteGeometry('loop', [[0,0],[0.01,0],[0.01,0.01],[0.0,0.01],[0,0]]);
  for (const mode of ['geometry-revised','geometry-smart','geometry-projected','trip-pattern','hybrid-endpoint','direction','fractions']) {
    try {
      const out = await orderStopsForLineView(loopStops, 'loop', { '0': [ { id: 'L1' }, { id: 'L2' }, { id: 'L3' }, { id: 'L4' } ] }, mode);
      console.log(mode.padEnd(18), ':', out.map(f=>f.properties.stop_id).join(','));
    } catch(e) { console.log(mode, 'error', e.message); }
  }

  console.log('\nTest: Branching route');
  const branchStops = [
    makeStop('B1','B1',0.0,0.0),
    makeStop('B2','B2',0.01,0.0),
    makeStop('B3','B3',0.02,0.0),
    makeStop('B4','B4',0.02,0.01), // branch
    makeStop('B5','B5',0.02,-0.01), // branch
  ];
  setRouteGeometry('branch', [[0,0],[0.02,0]]);
  // direction sequences simulate branching; two directions with differing stops
  const directions = {
    '0': [ { id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' } ],
    '1': [ { id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B5' } ]
  };
  for (const mode of ['geometry-revised','geometry-smart','trip-branches','trip-pattern','direction','geometry-projected']) {
    try {
        const out = await orderStopsForLineView(branchStops, 'branch', directions, mode);
      console.log(mode.padEnd(18), ':', out.map(f=>f.properties.stop_id).join(','));
    } catch(e) { console.log(mode, 'error', e.message); }
  }
  console.log('\nSimulate branch selector -> direction 0:');
  console.log((await orderStopsForLineView(branchStops,'branch',directions,'geometry-revised',null,'0')).map(f=>f.properties.stop_id));
  console.log('Simulate branch selector -> direction 1:');
  console.log((await orderStopsForLineView(branchStops,'branch',directions,'geometry-revised',null,'1')).map(f=>f.properties.stop_id));
}

run().catch((e)=>{ console.error(e); process.exit(1); });

// Performance microbench: compare orderingMode runtimes on a larger synthetic route
if (require.main === module) {
  (async () => {
    const { orderStopsForLineView } = require('../public/scripts/line-view-stop-ordering');
    // build 200 stops along a snake polyline
    const manyStops = [];
    const coords = [];
    for (let i = 0; i < 200; i++) {
      const x = (i / 200) * 0.02;
      const y = (i % 10) * 0.0005 * ((i % 20) < 10 ? 1 : -1);
      manyStops.push(makeStop('M' + i, 'M' + i, x, y));
      coords.push([x, y]);
    }
    setRouteGeometry('many', coords);
    const modes = ['geometry-revised','geometry-smart','auto','trip-pattern','geometry-projected'];
    console.log('\nPerformance microbench (200 stops):');
    for (const mode of modes) {
      const t0 = Date.now();
      await orderStopsForLineView(manyStops, 'many', { '0': manyStops.map((s) => ({ id: s.properties.stop_id })) }, mode);
      const dt = Date.now() - t0;
      console.log(mode.padEnd(18), ':', dt, 'ms');
    }
    
    // Randomized sanity checks: ensure geometry-smart defers to geometry-revised when no non-monotonic segments
    const { buildEndpointAnchoredGeometryOrder } = require('../public/scripts/line-view-stop-ordering');
    console.log('\nRandomized sanity checks (50 cases):');
    let failures = 0;
    for (let i = 0; i < 50; i++) {
      const stops = [];
      const coords2 = [];
      // create mostly linear polyline with slight noise
      for (let j = 0; j < 20; j++) {
        const x = (j / 20) * 0.02;
        const y = (Math.random() - 0.5) * 0.0005;
        stops.push(makeStop('R' + i + '_' + j, 'R' + i + '_' + j, x, y));
        coords2.push([x, y]);
      }
      setRouteGeometry('rand' + i, coords2);
      const geomOrder = await orderStopsForLineView(stops, 'rand' + i, null, 'geometry-revised');
      const smartOrder = await orderStopsForLineView(stops, 'rand' + i, null, 'geometry-smart');
      const geomIds = geomOrder.map(f => f.properties.stop_id).join(',');
      const smartIds = smartOrder.map(f => f.properties.stop_id).join(',');
      if (geomIds !== smartIds) {
        failures += 1;
        if (failures <= 10) console.log('Mismatch case', i, geomIds, '!=', smartIds);
      }
    }
    console.log('Randomized mismatches:', failures);
  })().catch(() => {});
}
