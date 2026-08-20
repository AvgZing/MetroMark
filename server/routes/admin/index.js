const express = require("express");

const router = express.Router();

router.use(require("./auth").router);
router.use(require("./stats"));
router.use(require("./actions"));
router.use(require("./overrides"));
router.use(require("./reviews"));

module.exports = router;
