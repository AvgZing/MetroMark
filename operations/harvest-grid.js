const START_ZOOM = Number(process.env.WORLD_HARVEST_START_ZOOM || 4);
const MAX_ZOOM = Number(process.env.WORLD_HARVEST_MAX_ZOOM || 9);
const CITY_SPAN_DEGREES = Number(process.env.WORLD_CITY_SPAN_DEGREES || 0.7);
const MAX_CELL_FAILURES = 5;

function cellBbox(z, x, y) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [west, (southRad * 180) / Math.PI, east, (northRad * 180) / Math.PI];
}

function childrenOf(z, x, y) {
  return [
    [z + 1, x * 2, y * 2],
    [z + 1, x * 2 + 1, y * 2],
    [z + 1, x * 2, y * 2 + 1],
    [z + 1, x * 2 + 1, y * 2 + 1]
  ];
}

function cityBbox(city) {
  const half = CITY_SPAN_DEGREES / 2;
  return [
    city.lon - half,
    Math.max(-85, city.lat - half),
    city.lon + half,
    Math.min(85, city.lat + half)
  ];
}

function seedQuadTree() {
  const queue = [];
  const n = 2 ** START_ZOOM;
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      queue.push([START_ZOOM, x, y]);
    }
  }
  return queue;
}

module.exports = {
  START_ZOOM,
  MAX_ZOOM,
  CITY_SPAN_DEGREES,
  MAX_CELL_FAILURES,
  cellBbox,
  childrenOf,
  cityBbox,
  seedQuadTree
};
