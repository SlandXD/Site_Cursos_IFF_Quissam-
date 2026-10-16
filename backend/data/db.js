/**
 * Camada de dados — PostgreSQL via Neon (pacote pg).
 *
 * API pública idêntica à versão SQLite, mas agora assíncrona (todas as
 * funções retornam Promise). As rotas já usam await implicitamente via
 * express async handlers, portanto nenhuma rota precisa ser alterada.
 *
 * Campos complexos (badges, lessons, completedLessons, activityScores)
 * são armazenados como JSONB no Postgres.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

// ── Criação de tabelas ────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      password     TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'student',
      xp           INTEGER NOT NULL DEFAULT 0,
      level        INTEGER NOT NULL DEFAULT 1,
      streak       INTEGER NOT NULL DEFAULT 0,
      "createdAt"  TEXT NOT NULL,
      "lastLogin"  TEXT,
      "resetToken" TEXT,
      "resetExpires" TEXT,
      avatar       TEXT,
      badges       JSONB NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS courses (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      "shortDesc"  TEXT,
      description  TEXT,
      level        TEXT,
      emoji        TEXT,
      duration     TEXT,
      featured     BOOLEAN NOT NULL DEFAULT false,
      lessons      JSONB NOT NULL DEFAULT '[]',
      "createdAt"  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS progress (
      "userId"           TEXT NOT NULL,
      "courseId"         TEXT NOT NULL,
      "completedLessons" JSONB NOT NULL DEFAULT '[]',
      "activityScores"   JSONB NOT NULL DEFAULT '{}',
      completed          BOOLEAN NOT NULL DEFAULT false,
      "enrolledAt"       TEXT NOT NULL,
      "completedAt"      TEXT,
      "certificateId"    TEXT,
      PRIMARY KEY ("userId", "courseId")
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id           SERIAL PRIMARY KEY,
      "userId"     TEXT NOT NULL,
      "userName"   TEXT NOT NULL,
      action       TEXT NOT NULL,
      "courseName" TEXT,
      "createdAt"  TEXT NOT NULL
    );
  `);
}

// ── Helpers ───────────────────────────────────────────────
const nullable = v => (v === undefined || v === null) ? null : v;

// ── Users ─────────────────────────────────────────────────
async function getUsers() {
  const { rows } = await pool.query('SELECT * FROM users');
  return rows.map(r => {
    const u = {
      id: r.id,
      name: r.name,
      email: r.email,
      password: r.password,
      role: r.role,
      xp: r.xp,
      level: r.level,
      streak: r.streak,
      createdAt: r.createdAt,
    };
    if (r.lastLogin    != null) u.lastLogin    = r.lastLogin;
    if (r.resetToken   != null) u.resetToken   = r.resetToken;
    if (r.resetExpires != null) u.resetExpires = r.resetExpires;
    if (r.avatar       != null) u.avatar       = r.avatar;
    const badges = Array.isArray(r.badges) ? r.badges : [];
    if (badges.length) u.badges = badges;
    return u;
  });
}

async function saveUsers(users) {
  const rows = Array.isArray(users) ? users : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM users');
    for (const u of rows) {
      await client.query(
        `INSERT INTO users (id, name, email, password, role, xp, level, streak, "createdAt", "lastLogin", "resetToken", "resetExpires", avatar, badges)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          u.id, u.name, u.email, u.password, u.role,
          u.xp ?? 0, u.level ?? 1, u.streak ?? 0,
          u.createdAt,
          nullable(u.lastLogin), nullable(u.resetToken), nullable(u.resetExpires),
          nullable(u.avatar),
          JSON.stringify(u.badges || []),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Courses ───────────────────────────────────────────────
async function getCourses() {
  const { rows } = await pool.query('SELECT * FROM courses');
  return rows.map(r => {
    const c = {
      id: r.id,
      name: r.name,
      featured: Boolean(r.featured),
      lessons: Array.isArray(r.lessons) ? r.lessons : [],
      createdAt: r.createdAt,
    };
    if (r.shortDesc   != null) c.shortDesc   = r.shortDesc;
    if (r.description != null) c.description = r.description;
    if (r.level       != null) c.level       = r.level;
    if (r.emoji       != null) c.emoji       = r.emoji;
    if (r.duration    != null) c.duration    = r.duration;
    return c;
  });
}

async function saveCourses(courses) {
  const rows = Array.isArray(courses) ? courses : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM courses');
    for (const c of rows) {
      await client.query(
        `INSERT INTO courses (id, name, "shortDesc", description, level, emoji, duration, featured, lessons, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          c.id, c.name,
          nullable(c.shortDesc), nullable(c.description),
          nullable(c.level), nullable(c.emoji), nullable(c.duration),
          c.featured ? true : false,
          JSON.stringify(c.lessons || []),
          c.createdAt,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Progress ──────────────────────────────────────────────
async function getProgress() {
  const { rows } = await pool.query('SELECT * FROM progress');
  return rows.map(r => {
    const p = {
      userId: r.userId,
      courseId: r.courseId,
      completedLessons: Array.isArray(r.completedLessons) ? r.completedLessons : [],
      activityScores: (r.activityScores && typeof r.activityScores === 'object') ? r.activityScores : {},
      completed: Boolean(r.completed),
      enrolledAt: r.enrolledAt,
    };
    if (r.completedAt   != null) p.completedAt   = r.completedAt;
    if (r.certificateId != null) p.certificateId = r.certificateId;
    return p;
  });
}

async function saveProgress(progress) {
  const rows = Array.isArray(progress) ? progress : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM progress');
    for (const p of rows) {
      await client.query(
        `INSERT INTO progress ("userId", "courseId", "completedLessons", "activityScores", completed, "enrolledAt", "completedAt", "certificateId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          p.userId, p.courseId,
          JSON.stringify(p.completedLessons || []),
          JSON.stringify(p.activityScores || {}),
          p.completed ? true : false,
          p.enrolledAt,
          nullable(p.completedAt), nullable(p.certificateId),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Activity log ──────────────────────────────────────────
async function getActivityLog() {
  const { rows } = await pool.query('SELECT * FROM activity_log ORDER BY id ASC');
  return rows.map(r => {
    const entry = {
      userId: r.userId,
      userName: r.userName,
      action: r.action,
      createdAt: r.createdAt,
    };
    if (r.courseName != null) entry.courseName = r.courseName;
    return entry;
  });
}

async function saveActivityLog(log) {
  const rows = Array.isArray(log) ? log : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM activity_log');
    for (const e of rows) {
      await client.query(
        `INSERT INTO activity_log ("userId", "userName", action, "courseName", "createdAt")
         VALUES ($1,$2,$3,$4,$5)`,
        [e.userId, e.userName, e.action, nullable(e.courseName), e.createdAt]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  initDB,
  getUsers,    saveUsers,
  getCourses,  saveCourses,
  getProgress, saveProgress,
  getActivityLog, saveActivityLog,
};
