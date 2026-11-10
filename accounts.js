// Team accounts: sign in with GitHub (OAuth 2.0 authorization code flow),
// sessions kept in Redis, and a role per user (member or admin).
//
// Configuration:
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  an OAuth App on GitHub
//   PUBLIC_URL                              where this app is served, for the callback
//   REDIS_URL                               e.g. redis://localhost:6379
//   SESSION_SECRET                          signs the session cookie
//   ADMIN_GITHUB_LOGINS                     comma-separated logins made admin on first sign-in
import crypto from "crypto";
import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";

export function isAccountsEnabled() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.SESSION_SECRET);
}

export function migrateAccounts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id INTEGER NOT NULL UNIQUE,
      login TEXT NOT NULL,
      name TEXT,
      email TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      team_id INTEGER REFERENCES teams(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      team_id INTEGER REFERENCES teams(id),
      session_id TEXT,
      tokens INTEGER NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Session middleware backed by Redis, and the sign-in routes. */
export async function createAccounts({ db, logger }) {
  migrateAccounts(db);
  const redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
  redis.on("error", (err) => logger.error("Redis error", { error: err.message }));
  await redis.connect();

  const sessions = session({
    store: new RedisStore({ client: redis, prefix: "aichatbot:sess:" }),
    secret: process.env.SESSION_SECRET,
    name: "aichatbot.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  });

  const admins = new Set((process.env.ADMIN_GITHUB_LOGINS || "").split(",").map((login) => login.trim().toLowerCase()).filter(Boolean));
  const callbackUrl = `${process.env.PUBLIC_URL || "http://localhost:3001"}/auth/github/callback`;
  const router = express.Router();

  router.get("/auth/github", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: "read:user user:email",
      state,
    });
    res.redirect(`${GITHUB_AUTHORIZE}?${params}`);
  });

  router.get("/auth/github/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      logger.warn("OAuth callback rejected: state mismatch");
      return res.status(400).send("Sign-in failed: invalid state");
    }
    delete req.session.oauthState;
    try {
      const tokenResponse = await fetch(GITHUB_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callbackUrl,
        }),
      });
      const { access_token: accessToken } = await tokenResponse.json();
      if (!accessToken) throw new Error("GitHub returned no access token");
      const profile = await (await fetch(GITHUB_USER, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" } })).json();

      const existing = db.prepare("SELECT * FROM users WHERE github_id = ?").get(profile.id);
      let user = existing;
      if (!existing) {
        const team = db.prepare("INSERT INTO teams (name) VALUES (?)").run(`${profile.login}'s team`);
        const role = admins.has(String(profile.login).toLowerCase()) ? "admin" : "member";
        db.prepare(
          "INSERT INTO users (github_id, login, name, email, avatar_url, role, team_id, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ).run(profile.id, profile.login, profile.name, profile.email, profile.avatar_url, role, team.lastInsertRowid);
        user = db.prepare("SELECT * FROM users WHERE github_id = ?").get(profile.id);
      } else {
        db.prepare("UPDATE users SET login = ?, name = ?, avatar_url = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(
          profile.login, profile.name, profile.avatar_url, existing.id
        );
      }
      // A new session id on sign-in, so a session fixed before it is worth nothing.
      req.session.regenerate((err) => {
        if (err) throw err;
        req.session.userId = user.id;
        logger.info("User signed in", { userId: user.id, login: profile.login });
        res.redirect("/");
      });
    } catch (err) {
      logger.error("OAuth callback failed", { error: err.message });
      res.status(502).send("Sign-in failed");
    }
  });

  router.post("/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get("/api/me", requireUser, (req, res) => {
    const { id, login, name, avatar_url: avatarUrl, role, team_id: teamId } = req.user;
    const team = db.prepare("SELECT id, name, plan FROM teams WHERE id = ?").get(teamId);
    res.json({ id, login, name, avatarUrl, role, team });
  });

  /** Puts the signed-in user, if any, on `req.user`. */
  function loadUser(req, _res, next) {
    if (req.session?.userId) req.user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
    next();
  }

  return { sessions, loadUser, router };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Sign in first" });
    if (req.user.role !== role) return res.status(403).json({ error: `Requires the ${role} role` });
    next();
  };
}
