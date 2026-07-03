const express = require("express");

const { cities } = require("../processors/city-presets");

const router = express.Router();

router.get("/catalog/cities", (req, res) => {
  res.json({
    cities
  });
});

module.exports = router;
