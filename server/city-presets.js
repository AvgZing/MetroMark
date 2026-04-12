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
    name: "New York",
    country: "USA",
    center: [-73.985, 40.758],
    bbox: [-74.28, 40.49, -73.67, 40.93]
  },
  {
    slug: "london",
    name: "London",
    country: "UK",
    center: [-0.1278, 51.5074],
    bbox: [-0.56, 51.27, 0.31, 51.72]
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

module.exports = {
  cities,
  getCityBySlug(slug) {
    return bySlug.get(slug) || null;
  }
};
