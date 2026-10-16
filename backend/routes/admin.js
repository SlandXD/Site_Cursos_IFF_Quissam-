const express  = require('express');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(adminOnly);

// GET /api/admin/overview
router.get('/overview', async (req, res) => {
  const users    = (await db.getUsers()).filter(u => u.role !== 'admin');
  const progress = await db.getProgress();
  const log      = await db.getActivityLog();
  const now      = new Date();
  const weekAgo  = new Date(now - 7 * 86400000);

  res.json({
    totalUsers:    users.length,
    newUsersWeek:  users.filter(u => new Date(u.createdAt) > weekAgo).length,
    totalWatched:  progress.reduce((acc, p) => acc + (p.completedLessons || []).length, 0),
    totalActivity: progress.reduce((acc, p) => acc + Object.keys(p.activityScores || {}).length, 0),
    totalCerts:    progress.filter(p => p.completed).length,
    recentActivity: log.slice(-20).reverse(),
  });
});

// ── COURSES ──────────────────────────────────────────────

// GET /api/admin/courses
router.get('/courses', async (req, res) => {
  const courses  = await db.getCourses();
  const progress = await db.getProgress();
  res.json({
    courses: courses.map(c => ({
      ...c,
      enrollments: progress.filter(p => p.courseId === c.id).length,
    })),
  });
});

// GET /api/admin/courses/:id
router.get('/courses/:id', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  res.json({ course });
});

// POST /api/admin/courses
router.post('/courses', async (req, res) => {
  const { name, shortDesc, description, level, emoji, duration, featured } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

  const courses = await db.getCourses();
  const course = {
    id: uuid(), name, shortDesc, description,
    level: level || 'Iniciante', emoji: emoji || '🎮',
    duration, featured: !!featured,
    lessons: [],
    createdAt: new Date().toISOString(),
  };
  courses.push(course);
  await db.saveCourses(courses);
  res.status(201).json({ course });
});

// PUT /api/admin/courses/:id
router.put('/courses/:id', async (req, res) => {
  const courses = await db.getCourses();
  const idx     = courses.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });

  const allowed = ['name','shortDesc','description','level','emoji','duration','featured'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) courses[idx][key] = req.body[key];
  });
  await db.saveCourses(courses);
  res.json({ course: courses[idx] });
});

// DELETE /api/admin/courses/:id
router.delete('/courses/:id', async (req, res) => {
  const courses = await db.getCourses();
  const idx     = courses.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });
  courses.splice(idx, 1);
  await db.saveCourses(courses);
  // Remove progresso vinculado
  const progress = (await db.getProgress()).filter(p => p.courseId !== req.params.id);
  await db.saveProgress(progress);
  res.json({ message: 'Excluído.' });
});

// ── LESSONS ──────────────────────────────────────────────

// GET /api/admin/courses/:id/lessons
router.get('/courses/:id/lessons', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  res.json({ lessons: course.lessons || [] });
});

// GET /api/admin/courses/:id/lessons/:lessonId
router.get('/courses/:id/lessons/:lessonId', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  const lesson  = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson)  return res.status(404).json({ message: 'Aula não encontrada.' });
  res.json({ lesson });
});

// POST /api/admin/courses/:id/lessons
router.post('/courses/:id/lessons', async (req, res) => {
  const courses = await db.getCourses();
  const idx     = courses.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });

  const { title, type, videoType, videoUrl, duration, requiredPercent, description, activityTitle, questions } = req.body;
  if (!title) return res.status(400).json({ message: 'Título obrigatório.' });

  const lesson = {
    id: uuid(), title, type: type || 'video',
    description,
    ...(type !== 'activity' ? { videoType, videoUrl, duration, requiredPercent: requiredPercent || 80 } : {}),
    ...(type === 'activity' ? { activityTitle, questions: questions || [] } : {}),
    createdAt: new Date().toISOString(),
  };

  if (!courses[idx].lessons) courses[idx].lessons = [];
  courses[idx].lessons.push(lesson);
  await db.saveCourses(courses);
  res.status(201).json({ lesson });
});

// PUT /api/admin/courses/:id/lessons/:lessonId
router.put('/courses/:id/lessons/:lessonId', async (req, res) => {
  const courses  = await db.getCourses();
  const cIdx     = courses.findIndex(c => c.id === req.params.id);
  if (cIdx < 0) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lIdx = (courses[cIdx].lessons || []).findIndex(l => l.id === req.params.lessonId);
  if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

  const allowed = ['title','type','videoType','videoUrl','duration','requiredPercent','description','activityTitle','questions'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) courses[cIdx].lessons[lIdx][key] = req.body[key];
  });
  await db.saveCourses(courses);
  res.json({ lesson: courses[cIdx].lessons[lIdx] });
});

// DELETE /api/admin/courses/:id/lessons/:lessonId
router.delete('/courses/:id/lessons/:lessonId', async (req, res) => {
  const courses = await db.getCourses();
  const cIdx    = courses.findIndex(c => c.id === req.params.id);
  if (cIdx < 0) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lIdx = (courses[cIdx].lessons || []).findIndex(l => l.id === req.params.lessonId);
  if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

  courses[cIdx].lessons.splice(lIdx, 1);
  await db.saveCourses(courses);
  res.json({ message: 'Aula excluída.' });
});

// ── USERS ─────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { q } = req.query;
  const progress = await db.getProgress();
  let users = (await db.getUsers()).filter(u => u.role !== 'admin');
  if (q) {
    const lower = q.toLowerCase();
    users = users.filter(u => u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower));
  }
  res.json({
    users: users.map(u => {
      const { password: _, ...safe } = u;
      return { ...safe, enrollments: progress.filter(p => p.userId === u.id).length };
    }),
  });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const users = await db.getUsers();
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });
  if (users[idx].role === 'admin') return res.status(403).json({ message: 'Não é possível excluir administrador.' });

  users.splice(idx, 1);
  await db.saveUsers(users);
  const progress = (await db.getProgress()).filter(p => p.userId !== req.params.id);
  await db.saveProgress(progress);
  res.json({ message: 'Aluno removido.' });
});

// GET /api/admin/export/users-csv — exporta alunos em formato CSV
router.get('/export/users-csv', async (req, res) => {
  const progress = await db.getProgress();
  const users = (await db.getUsers()).filter(u => u.role !== 'admin');

  const header = ['id','nome','email','nivel','xp','streak','trilhas_matriculadas','cadastro'].join(',');
  const rows = users.map(u => {
    const enrollments = progress.filter(p => p.userId === u.id).length;
    // Escapar campos com vírgulas ou aspas duplas (RFC 4180)
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(u.id),
      esc(u.name),
      esc(u.email),
      esc(u.level),
      esc(u.xp),
      esc(u.streak),
      esc(enrollments),
      esc(u.createdAt),
    ].join(',');
  });

  const csv = [header, ...rows].join('\r\n');
  const filename = `alunos_${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM para UTF-8 no Excel
});

module.exports = router;
