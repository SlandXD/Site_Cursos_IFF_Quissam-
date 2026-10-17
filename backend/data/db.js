/**
 * Camada de dados — PostgreSQL via Neon (pacote pg).
 *
 * Operações granulares por registro: sem DELETE+INSERT de tabela inteira.
 * Cada função altera apenas o(s) registro(s) necessário(s), evitando
 * write-amplification, race conditions e locks desnecessários.
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

function mapUser(r) {
  const u = {
    id: r.id, name: r.name, email: r.email,
    password: r.password, role: r.role,
    xp: r.xp, level: r.level, streak: r.streak,
    createdAt: r.createdAt,
  };
  if (r.lastLogin    != null) u.lastLogin    = r.lastLogin;
  if (r.resetToken   != null) u.resetToken   = r.resetToken;
  if (r.resetExpires != null) u.resetExpires = r.resetExpires;
  if (r.avatar       != null) u.avatar       = r.avatar;
  const badges = Array.isArray(r.badges) ? r.badges : [];
  if (badges.length) u.badges = badges;
  return u;
}

function mapCourse(r) {
  const c = {
    id: r.id, name: r.name,
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
}

function mapProgress(r) {
  const p = {
    userId: r.userId, courseId: r.courseId,
    completedLessons: Array.isArray(r.completedLessons) ? r.completedLessons : [],
    activityScores: (r.activityScores && typeof r.activityScores === 'object') ? r.activityScores : {},
    completed: Boolean(r.completed),
    enrolledAt: r.enrolledAt,
  };
  if (r.completedAt   != null) p.completedAt   = r.completedAt;
  if (r.certificateId != null) p.certificateId = r.certificateId;
  return p;
}

// ── Users ─────────────────────────────────────────────────

async function getUsers() {
  const { rows } = await pool.query('SELECT * FROM users');
  return rows.map(mapUser);
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows.length ? mapUser(rows[0]) : null;
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return rows.length ? mapUser(rows[0]) : null;
}

/** Insere um novo usuário. */
async function insertUser(u) {
  await pool.query(
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

/** Atualiza campos específicos de um usuário pelo id. */
async function updateUser(id, fields) {
  const allowed = ['name','email','password','xp','level','streak','lastLogin','resetToken','resetExpires','avatar','badges'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of allowed) {
    if (!(key in fields)) continue;
    const col = ['lastLogin','resetToken','resetExpires','createdAt'].includes(key) ? `"${key}"` : key;
    const val = key === 'badges' ? JSON.stringify(fields[key] || []) : nullable(fields[key]);
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

async function deleteUser(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

/** Compatibilidade legada: salva lista inteira (usado apenas pelo seed). */
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
  return rows.map(mapCourse);
}

async function getCourseById(id) {
  const { rows } = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);
  return rows.length ? mapCourse(rows[0]) : null;
}

async function insertCourse(c) {
  await pool.query(
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

async function updateCourse(id, fields) {
  const allowed = ['name','shortDesc','description','level','emoji','duration','featured','lessons'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of allowed) {
    if (!(key in fields)) continue;
    let col = key;
    if (key === 'shortDesc') col = '"shortDesc"';
    const val = key === 'lessons' ? JSON.stringify(fields[key] || []) : nullable(fields[key]);
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

async function deleteCourse(id) {
  await pool.query('DELETE FROM courses WHERE id = $1', [id]);
}

/** Compatibilidade legada: salva lista inteira (usado apenas pelo seed). */
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
  return rows.map(mapProgress);
}

async function getProgressByUser(userId) {
  const { rows } = await pool.query('SELECT * FROM progress WHERE "userId" = $1', [userId]);
  return rows.map(mapProgress);
}

async function getProgressEntry(userId, courseId) {
  const { rows } = await pool.query(
    'SELECT * FROM progress WHERE "userId" = $1 AND "courseId" = $2',
    [userId, courseId]
  );
  return rows.length ? mapProgress(rows[0]) : null;
}

async function insertProgress(p) {
  await pool.query(
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

async function updateProgress(userId, courseId, fields) {
  const allowed = ['completedLessons','activityScores','completed','completedAt','certificateId'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of allowed) {
    if (!(key in fields)) continue;
    const col = `"${key}"`;
    let val;
    if (key === 'completedLessons') val = JSON.stringify(fields[key] || []);
    else if (key === 'activityScores') val = JSON.stringify(fields[key] || {});
    else val = nullable(fields[key]);
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  }
  if (!sets.length) return;
  vals.push(userId, courseId);
  await pool.query(
    `UPDATE progress SET ${sets.join(', ')} WHERE "userId" = $${i} AND "courseId" = $${i + 1}`,
    vals
  );
}

async function deleteProgressByUser(userId) {
  await pool.query('DELETE FROM progress WHERE "userId" = $1', [userId]);
}

async function deleteProgressByCourse(courseId) {
  await pool.query('DELETE FROM progress WHERE "courseId" = $1', [courseId]);
}

/** Compatibilidade legada: salva lista inteira (usado em poucos lugares do admin). */
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
    const entry = { userId: r.userId, userName: r.userName, action: r.action, createdAt: r.createdAt };
    if (r.courseName != null) entry.courseName = r.courseName;
    return entry;
  });
}

/** Insere uma entrada no log sem apagar as existentes. */
async function appendActivityLog(entry) {
  await pool.query(
    `INSERT INTO activity_log ("userId", "userName", action, "courseName", "createdAt")
     VALUES ($1,$2,$3,$4,$5)`,
    [entry.userId, entry.userName, entry.action, nullable(entry.courseName), entry.createdAt]
  );
}

/** Compatibilidade legada. */
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
  // Users
  getUsers, getUserById, getUserByEmail,
  insertUser, updateUser, deleteUser,
  saveUsers,               // legado (seed)
  // Courses
  getCourses, getCourseById,
  insertCourse, updateCourse, deleteCourse,
  saveCourses,             // legado (seed)
  // Progress
  getProgress, getProgressByUser, getProgressEntry,
  insertProgress, updateProgress,
  deleteProgressByUser, deleteProgressByCourse,
  saveProgress,            // legado (admin bulk ops)
  // Activity log
  getActivityLog, appendActivityLog,
  saveActivityLog,         // legado
};
