const db = require("./db");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token." });
  }

  try {
    const user = await db.getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid auth token." });
    }
    if (user.isActive === false) {
      return res.status(403).json({ error: "Account is disabled." });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired auth token." });
  }
}

module.exports = {
  authMiddleware
};
