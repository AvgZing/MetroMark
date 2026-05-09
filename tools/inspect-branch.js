const m = require('../public/scripts/line-view-stop-ordering');
const { buildOptimalBranchMergeRankMap, buildTripPatternRankMap, buildDirectionRankMap, buildPolylineProjectedRankMap } = m;
function makeStop(id,name,lng,lat){ return { type:'Feature', geometry:{type:'Point', coordinates:[lng,lat]}, properties:{ stop_id: id, stop_name: name, station_name: name } } }
// Minimal globals expected by ordering module
global.stopKeyForFeature = function (feature) { return String((feature && feature.properties && (feature.properties.stop_id || feature.properties.station_name || feature.properties.stop_name)) || '').trim(); };
global.stopFeatureDisplayName = function (feature) { return String((feature && feature.properties && (feature.properties.station_name || feature.properties.stop_name)) || ''); };
global.lineTerminalHints = function () { return []; };
function setRouteGeometry(lineKey, coords) {
	global.state = global.state || {};
	global.state.transit = global.state.transit || {};
	global.state.transit.routesGeoJson = { type: 'FeatureCollection', features: [ { type: 'Feature', properties: { line_key: lineKey }, geometry: { type: 'LineString', coordinates: coords } } ] };
}
const branchStops = [ makeStop('B1','B1',0.0,0.0), makeStop('B2','B2',0.01,0.0), makeStop('B3','B3',0.02,0.0), makeStop('B4','B4',0.02,0.01), makeStop('B5','B5',0.02,-0.01) ];
const directions = { '0': [ { id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' } ], '1': [ { id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B5' } ] };
setRouteGeometry('branch', [[0,0],[0.02,0]]);
const branchCheck = buildOptimalBranchMergeRankMap(branchStops, directions, 'branch');
console.log('branchCheck:', branchCheck);
const { orderStopsForLineView } = require('../public/scripts/line-view-stop-ordering');
(async () => {
	const outTrip = await orderStopsForLineView(branchStops, 'branch', directions, 'trip-pattern');
	console.log('trip-pattern order:', outTrip.map(f=>f.properties.stop_id));
	const outDir = await orderStopsForLineView(branchStops, 'branch', directions, 'direction');
	console.log('direction order:', outDir.map(f=>f.properties.stop_id));
	const outGeom = await orderStopsForLineView(branchStops, 'branch', directions, 'geometry-revised');
	console.log('geometry-revised order:', outGeom.map(f=>f.properties.stop_id));
	const outSmart = await orderStopsForLineView(branchStops, 'branch', directions, 'geometry-smart');
	console.log('geometry-smart order:', outSmart.map(f=>f.properties.stop_id));
})();
