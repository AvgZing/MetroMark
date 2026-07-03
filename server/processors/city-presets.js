const cities = [
  {
    slug: "seattle",
    name: "Seattle",
    country: "USA",
    center: [-122.335, 47.608],
    bbox: [-122.58, 47.48, -122.11, 47.75]
  },
  {
    slug: "new-york",
    name: "New York City",
    country: "USA",
    center: [-73.985, 40.758],
    bbox: [-74.28, 40.49, -73.67, 40.93]
  },
  {
    slug: "san-francisco",
    name: "San Francisco",
    country: "USA",
    center: [-122.4194, 37.7749],
    bbox: [-122.58, 37.69, -122.31, 37.84]
  },
  {
    slug: "chicago",
    name: "Chicago",
    country: "USA",
    center: [-87.6298, 41.8781],
    bbox: [-87.95, 41.64, -87.5, 42.04]
  },
  {
    slug: "minneapolis-st-paul",
    name: "Minneapolis-Saint Paul",
    country: "USA",
    center: [-93.265, 44.9778],
    bbox: [-93.48, 44.8, -92.98, 45.1]
  },
  {
    slug: "vancouver-bc",
    name: "Vancouver (BC)",
    country: "Canada",
    center: [-123.1207, 49.2827],
    bbox: [-123.3, 49.19, -122.96, 49.33]
  },
  {
    slug: "portland",
    name: "Portland",
    country: "USA",
    center: [-122.6765, 45.5231],
    bbox: [-122.86, 45.43, -122.5, 45.62]
  },
  {
    slug: "los-angeles",
    name: "Los Angeles",
    country: "USA",
    center: [-118.2437, 34.0522],
    bbox: [-118.67, 33.7, -117.9, 34.34]
  },
  {
    slug: "london",
    name: "London",
    country: "UK",
    center: [-0.1278, 51.5074],
    bbox: [-0.56, 51.27, 0.31, 51.72]
  },
  {
    slug: "hong-kong",
    name: "Hong Kong",
    country: "China",
    center: [114.1694, 22.3193],
    bbox: [113.82, 22.15, 114.42, 22.56]
  },
  {
    slug: "tokyo",
    name: "Tokyo",
    country: "Japan",
    center: [139.7604, 35.6812],
    bbox: [139.43, 35.51, 139.93, 35.83]
  },
  {
    slug: "paris",
    name: "Paris",
    country: "France",
    center: [2.3522, 48.8566],
    bbox: [2.15, 48.77, 2.49, 48.94]
  }
];

const bySlug = new Map(cities.map((city) => [city.slug, city]));
const defaultCoreHarvestCitySlugs = [
  "seattle",
  "new-york",
  "san-francisco",
  "paris",
  "london",
  "chicago",
  "minneapolis-st-paul",
  "vancouver-bc",
  "portland",
  "los-angeles"
];

module.exports = {
  cities,
  defaultCoreHarvestCitySlugs,
  getCityBySlug(slug) {
    return bySlug.get(String(slug || "").trim()) || null;
  }
};
