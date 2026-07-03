const bcrypt = require("bcryptjs");

const config = require("../../admin/config");
const { statements, nowSeconds } = require("./client");

function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function getUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return sanitizeUser(statements.getUserByEmail.get(normalizedEmail));
}

function getUserById(id) {
  return sanitizeUser(statements.getUserById.get(id));
}

function createUser(email, password, displayName) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const safeName = String(displayName || "").trim() || "MetroMark User";

  if (!normalizedEmail || !password) {
    return null;
  }

  const existing = statements.getUserByEmail.get(normalizedEmail);
  if (existing) {
    return null;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = nowSeconds();

  const result = statements.createUser.run(normalizedEmail, passwordHash, safeName, createdAt);
  return getUserById(result.lastInsertRowid);
}

function verifyUser(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = statements.getUserByEmail.get(normalizedEmail);

  if (!user) {
    return null;
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  return ok ? sanitizeUser(user) : null;
}

function seedDemoUser() {
  const existing = statements.getUserByEmail.get(config.DEMO_USER_EMAIL.toLowerCase());
  if (existing) {
    return sanitizeUser(existing);
  }

  const passwordHash = bcrypt.hashSync(config.DEMO_USER_PASSWORD, 10);
  const createdAt = nowSeconds();
  const result = statements.createUser.run(
    config.DEMO_USER_EMAIL.toLowerCase(),
    passwordHash,
    config.DEMO_USER_NAME,
    createdAt
  );

  return getUserById(result.lastInsertRowid);
}

module.exports = {
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  seedDemoUser
};
