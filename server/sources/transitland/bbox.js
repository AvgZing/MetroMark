function toBboxString(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

module.exports = { toBboxString };
