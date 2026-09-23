const express = require("express");

const router = express.Router();

router.use(require("./auth").router);
router.use(require("./stats"));
router.use(require("./actions"));
router.use(require("./accounts"));
router.use(require("./overrides"));
router.use(require("./reviews"));
router.use(require("./reharvest"));
router.use(require("./routes"));
router.use(require("./cities"));
router.use(require("./issues"));

module.exports = router;
