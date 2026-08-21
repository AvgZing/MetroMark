const crypto = require("crypto");

function geometrySourceHash(geometry) {
  if (!geometry) {
    return "";
  }

  return crypto.createHash("sha1").update(JSON.stringify(geometry)).digest("hex");
}

module.exports = {
  geometrySourceHash
};
