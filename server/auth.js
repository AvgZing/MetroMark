const jwt = require("jsonwebtoken");
const config = require("./config");
const db = require("./db");

function createAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    config.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token." });
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = db.getUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Invalid auth token." });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired auth token." });
  }
}

module.exports = {
  createAuthToken,
  authMiddleware
};
