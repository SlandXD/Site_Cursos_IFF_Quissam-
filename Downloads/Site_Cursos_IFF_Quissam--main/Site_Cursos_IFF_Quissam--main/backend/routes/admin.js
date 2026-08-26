const express  = require('express');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(adminOnly);

// GET /api/admin/overview
router.get('/overview', (req, res) => {
  const users    = db.getUsers().filter(u => u.role !== 'admin');
  const progress = db.getProgress();
  const log      = db.getActivityLog();
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
router.get('/courses', (req, res) => {
  const courses  = db.getCourses();
  const progress = db.getProgress();
  res.json({
    courses: courses.map(c => ({
      ...c,
      enrollments: progress.filter(p => p.courseId === c.id).length,
    })),
  });
});

// GET /api/admin/courses/:id
router.get('/courses/:id', (req, res) => {
  const courses = db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  res.json({ course });
});

// POST /api/admin/courses
router.post('/courses', (req, res) => {
  const { name, shortDesc, description, level, emoji, duration, featured } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

  const courses = db.getCourses();
  const course = {
    id: uuid(), name, shortDesc, description,
    level: level || 'Iniciante', emoji: emoji || '🎮',
    duration, featured: !!featured,
    lessons: [],
    createdAt: new Date().toISOString(),
  };
  courses.push(course);
  db.saveCourses(courses);
  res.status(201).json({ course });
});

// PUT /api/admin/courses/:id
router.put('/courses/:id', (req, res) => {
  const courses = db.getCourses();
  const idx     = courses.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });

  const allowed = ['name','shortDesc','description','level','emoji','duration','featured'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) courses[idx][key] = req.body[key];
  });
  db.saveCourses(courses);
  res.json({ course: courses[idx] });
});

// DELETE /api/admin/courses/:id
router.delete('/courses/:id', (req, res) => {
  const courses = db.getCourses();
  const idx     = courses.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });
  courses.splice(idx, 1);
  db.saveCourses(courses);
  // Remove progresso vinculado
  const progress = db.getProgress().filter(p => p.courseId !== req.params.id);
  db.saveProgress(progress);
  res.json({ message: 'Excluído.' });
});

// ── LESSONS ──────────────────────────────────────────────

// GET /api/admin/courses/:id/lessons
router.get('/courses/:id/lessons', (req, res) => {
  const courses = db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  res.json({ lessons: course.lessons || [] });
});

// GET /api/admin/courses/:id/lessons/:lessonId
router.get('/courses/:id/lessons/:lessonId', (req, res) => {
  const courses = db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Não encontrado.' });
  const lesson  = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson)  return res.status(404).json({ message: 'Aula não encontrada.' });
  res.json({ lesson });
});

// POST /api/admin/courses/:id/lessons
router.post('/courses/:id/lessons', (req, res) => {
  const courses = db.getCourses();
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
  db.saveCourses(courses);
  res.status(201).json({ lesson });
});

// PUT /api/admin/courses/:id/lessons/:lessonId
router.put('/courses/:id/lessons/:lessonId', (req, res) => {
  const courses  = db.getCourses();
  const cIdx     = courses.findIndex(c => c.id === req.params.id);
  if (cIdx < 0) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lIdx = (courses[cIdx].lessons || []).findIndex(l => l.id === req.params.lessonId);
  if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

  const allowed = ['title','type','videoType','videoUrl','duration','requiredPercent','description','activityTitle','questions'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) courses[cIdx].lessons[lIdx][key] = req.body[key];
  });
  db.saveCourses(courses);
  res.json({ lesson: courses[cIdx].lessons[lIdx] });
});

// DELETE /api/admin/courses/:id/lessons/:lessonId
router.delete('/courses/:id/lessons/:lessonId', (req, res) => {
  const courses = db.getCourses();
  const cIdx    = courses.findIndex(c => c.id === req.params.id);
  if (cIdx < 0) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lIdx = (courses[cIdx].lessons || []).findIndex(l => l.id === req.params.lessonId);
  if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

  courses[cIdx].lessons.splice(lIdx, 1);
  db.saveCourses(courses);
  res.json({ message: 'Aula excluída.' });
});

// ── USERS ─────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
  const { q } = req.query;
  const progress = db.getProgress();
  let users = db.getUsers().filter(u => u.role !== 'admin');
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
router.delete('/users/:id', (req, res) => {
  const users = db.getUsers();
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });
  if (users[idx].role === 'admin') return res.status(403).json({ message: 'Não é possível excluir administrador.' });

  users.splice(idx, 1);
  db.saveUsers(users);
  const progress = db.getProgress().filter(p => p.userId !== req.params.id);
  db.saveProgress(progress);
  res.json({ message: 'Aluno removido.' });
});

module.exports = router;
