/**
 * Camada de dados — armazena tudo em um banco SQLite local (academy.db).
 *
 * Usa better-sqlite3 (síncrono): nenhuma função aqui é async/await, assim o
 * módulo já está utilizável assim que é carregado por server.js (que faz
 * require('./data/db') na inicialização).
 *
 * A API pública é idêntica à versão anterior (arquivos JSON):
 *   getUsers/saveUsers, getCourses/saveCourses,
 *   getProgress/saveProgress, getActivityLog/saveActivityLog
 *
 * Cada save* faz uma substituição completa da tabela (DELETE + INSERT em
 * transação), preservando a semântica read-mutate-save usada pelas rotas sem
 * alterá-las. Campos complexos (badges, lessons, completedLessons,
 * activityScores) são guardados como strings JSON. Campos escalares anuláveis
 * são omitidos do objeto retornado quando NULL, reproduzindo o comportamento
 * do JSON antigo (onde undefined era descartado pelo JSON.stringify).
 *
 * Os 4 arquivos JSON antigos (users/courses/progress/activity_log) permanecem
 * no disco como backup e não são mais lidos por este módulo.
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'academy.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    password     TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'student',
    xp           INTEGER NOT NULL DEFAULT 0,
    level        INTEGER NOT NULL DEFAULT 1,
    streak       INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL,
    lastLogin    TEXT,
    resetToken   TEXT,
    resetExpires TEXT,
    avatar       TEXT,
    badges       TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS courses (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    shortDesc   TEXT,
    description TEXT,
    level       TEXT,
    emoji       TEXT,
    duration    TEXT,
    featured    INTEGER NOT NULL DEFAULT 0,
    lessons     TEXT NOT NULL DEFAULT '[]',
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS progress (
    userId           TEXT NOT NULL,
    courseId         TEXT NOT NULL,
    completedLessons TEXT NOT NULL DEFAULT '[]',
    activityScores   TEXT NOT NULL DEFAULT '{}',
    completed        INTEGER NOT NULL DEFAULT 0,
    enrolledAt       TEXT NOT NULL,
    completedAt      TEXT,
    certificateId    TEXT,
    PRIMARY KEY (userId, courseId)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    userName   TEXT NOT NULL,
    action     TEXT NOT NULL,
    courseName TEXT,
    createdAt  TEXT NOT NULL
  );
`);

// ── Helpers ──────────────────────────────────────────────
// undefined/null -> NULL (para colunas escalares anuláveis). Nunca armazena a
// string "undefined" — importante para o fluxo de reset de senha, que faz
// user.resetToken = undefined e depois saveUsers().
const nullable = v => (v === undefined || v === null) ? null : v;

// ── Prepared statements (INSERT) ──────────────────────────
const insertUser = db.prepare(`
  INSERT INTO users (id, name, email, password, role, xp, level, streak, createdAt, lastLogin, resetToken, resetExpires, avatar, badges)
  VALUES (@id, @name, @email, @password, @role, @xp, @level, @streak, @createdAt, @lastLogin, @resetToken, @resetExpires, @avatar, @badges)
`);

const insertCourse = db.prepare(`
  INSERT INTO courses (id, name, shortDesc, description, level, emoji, duration, featured, lessons, createdAt)
  VALUES (@id, @name, @shortDesc, @description, @level, @emoji, @duration, @featured, @lessons, @createdAt)
`);

const insertProgress = db.prepare(`
  INSERT INTO progress (userId, courseId, completedLessons, activityScores, completed, enrolledAt, completedAt, certificateId)
  VALUES (@userId, @courseId, @completedLessons, @activityScores, @completed, @enrolledAt, @completedAt, @certificateId)
`);

const insertLog = db.prepare(`
  INSERT INTO activity_log (userId, userName, action, courseName, createdAt)
  VALUES (@userId, @userName, @action, @courseName, @createdAt)
`);

// ── Users ─────────────────────────────────────────────────
function getUsers() {
  return db.prepare('SELECT * FROM users').all().map(r => {
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
    const badges = JSON.parse(r.badges || '[]');
    if (badges.length) u.badges = badges;
    return u;
  });
}

function saveUsers(users) {
  const rows = Array.isArray(users) ? users : [];
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM users').run();
    for (const u of rows) {
      insertUser.run({
        id: u.id,
        name: u.name,
        email: u.email,
        password: u.password,
        role: u.role,
        xp: u.xp ?? 0,
        level: u.level ?? 1,
        streak: u.streak ?? 0,
        createdAt: u.createdAt,
        lastLogin: nullable(u.lastLogin),
        resetToken: nullable(u.resetToken),
        resetExpires: nullable(u.resetExpires),
        avatar: nullable(u.avatar),
        badges: JSON.stringify(u.badges || []),
      });
    }
  });
  replace();
}

// ── Courses ───────────────────────────────────────────────
function getCourses() {
  return db.prepare('SELECT * FROM courses').all().map(r => {
    const c = {
      id: r.id,
      name: r.name,
      featured: Boolean(r.featured),
      lessons: JSON.parse(r.lessons || '[]'),
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

function saveCourses(courses) {
  const rows = Array.isArray(courses) ? courses : [];
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM courses').run();
    for (const c of rows) {
      insertCourse.run({
        id: c.id,
        name: c.name,
        shortDesc: nullable(c.shortDesc),
        description: nullable(c.description),
        level: nullable(c.level),
        emoji: nullable(c.emoji),
        duration: nullable(c.duration),
        featured: c.featured ? 1 : 0,
        lessons: JSON.stringify(c.lessons || []),
        createdAt: c.createdAt,
      });
    }
  });
  replace();
}

// ── Progress ──────────────────────────────────────────────
function getProgress() {
  return db.prepare('SELECT * FROM progress').all().map(r => {
    const p = {
      userId: r.userId,
      courseId: r.courseId,
      completedLessons: JSON.parse(r.completedLessons || '[]'),
      activityScores: JSON.parse(r.activityScores || '{}'),
      completed: Boolean(r.completed),
      enrolledAt: r.enrolledAt,
    };
    if (r.completedAt   != null) p.completedAt   = r.completedAt;
    if (r.certificateId != null) p.certificateId = r.certificateId;
    return p;
  });
}

function saveProgress(progress) {
  const rows = Array.isArray(progress) ? progress : [];
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM progress').run();
    for (const p of rows) {
      insertProgress.run({
        userId: p.userId,
        courseId: p.courseId,
        completedLessons: JSON.stringify(p.completedLessons || []),
        activityScores: JSON.stringify(p.activityScores || {}),
        completed: p.completed ? 1 : 0,
        enrolledAt: p.enrolledAt,
        completedAt: nullable(p.completedAt),
        certificateId: nullable(p.certificateId),
      });
    }
  });
  replace();
}

// ── Activity log ──────────────────────────────────────────
function getActivityLog() {
  return db.prepare('SELECT * FROM activity_log ORDER BY id ASC').all().map(r => {
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

function saveActivityLog(log) {
  const rows = Array.isArray(log) ? log : [];
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM activity_log').run();
    for (const e of rows) {
      insertLog.run({
        userId: e.userId,
        userName: e.userName,
        action: e.action,
        courseName: nullable(e.courseName),
        createdAt: e.createdAt,
      });
    }
  });
  replace();
}

module.exports = {
  // Users
  getUsers,
  saveUsers,

  // Courses
  getCourses,
  saveCourses,

  // Progress
  getProgress,
  saveProgress,

  // Activity log
  getActivityLog,
  saveActivityLog,
};
