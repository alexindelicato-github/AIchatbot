// The admin console's API: people, roles, usage and a full export, for
// users with the admin role only.
import express from "express";
import { requireRole } from "./accounts.js";

export function createAdmin({ db, logger }) {
  const router = express.Router();
  router.use("/admin", requireRole("admin"));

  router.get("/admin/users", (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.login, u.name, u.email, u.role, u.last_login_at, t.name AS team, t.plan
         FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.login`
      )
      .all();
    res.json({ users });
  });

  router.patch("/admin/users/:id/role", express.json(), (req, res) => {
    const { role } = req.body;
    if (!["member", "admin"].includes(role)) return res.status(400).json({ error: "role is member or admin" });
    if (Number(req.params.id) === req.user.id && role !== "admin") return res.status(400).json({ error: "You cannot remove your own admin role" });
    const changed = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
    logger.info("Role changed", { by: req.user.id, user: Number(req.params.id), role });
    res.json({ updated: changed.changes });
  });

  router.get("/admin/usage", (_req, res) => {
    const usage = db
      .prepare(
        `SELECT u.login, COUNT(g.id) AS messages, SUM(g.tokens) AS tokens, SUM(g.tool_calls) AS tool_calls
         FROM usage g JOIN users u ON u.id = g.user_id
         WHERE g.created_at >= date('now', '-30 days') GROUP BY u.login ORDER BY tokens DESC`
      )
      .all();
    res.json({ usage });
  });

  // Every conversation, for compliance requests. Logged, since it is everyone's data.
  router.get("/admin/export/conversations", (req, res) => {
    logger.warn("Full conversation export", { by: req.user.id });
    const rows = db
      .prepare(
        `SELECT c.session_id, m.title, u.login, c.role, c.content, c.created_at
         FROM conversations c
         LEFT JOIN conversation_meta m ON m.session_id = c.session_id
         LEFT JOIN users u ON u.id = m.user_id
         ORDER BY c.session_id, c.created_at`
      )
      .all();
    res.setHeader("Content-Disposition", "attachment; filename=conversations.json");
    res.json(rows);
  });

  return router;
}
