const express  = require('express');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(adminOnly);

// ── GET /api/admin/overview ───────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [users, progress, log] = await Promise.all([
      db.getUsers(),
      db.getProgress(),
      db.getActivityLog(),
    ]);
    const students = users.filter(u => u.role !== 'admin');
    const weekAgo  = new Date(Date.now() - 7 * 86400000);

    res.json({
      totalUsers:    students.length,
      newUsersWeek:  students.filter(u => new Date(u.createdAt) > weekAgo).length,
      totalWatched:  progress.reduce((acc, p) => acc + (p.completedLessons || []).length, 0),
      totalActivity: progress.reduce((acc, p) => acc + Object.keys(p.activityScores || {}).length, 0),
      totalCerts:    progress.filter(p => p.completed).length,
      recentActivity: log.slice(-20).reverse(),
    });
  } catch (err) {
    console.error('GET /admin/overview', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/courses ────────────────────────────────
router.get('/courses', async (req, res) => {
  try {
    const [courses, progress] = await Promise.all([
      db.getCourses(),
      db.getProgress(),
    ]);
    res.json({
      courses: courses.map(c => ({
        ...c,
        enrollments: progress.filter(p => p.courseId === c.id).length,
      })),
    });
  } catch (err) {
    console.error('GET /admin/courses', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/courses/:id ────────────────────────────
router.get('/courses/:id', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });
    res.json({ course });
  } catch (err) {
    console.error('GET /admin/courses/:id', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/admin/courses ───────────────────────────────
router.post('/courses', async (req, res) => {
  try {
    const { name, shortDesc, description, level, emoji, duration, featured } = req.body;
    if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

    const course = {
      id: uuid(), name, shortDesc, description,
      level: level || 'Iniciante', emoji: emoji || '🎮',
      duration, featured: !!featured,
      lessons: [],
      createdAt: new Date().toISOString(),
    };
    await db.insertCourse(course);
    res.status(201).json({ course });
  } catch (err) {
    console.error('POST /admin/courses', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── PUT /api/admin/courses/:id ────────────────────────────
router.put('/courses/:id', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });

    const allowed = ['name','shortDesc','description','level','emoji','duration','featured'];
    const fields  = {};
    allowed.forEach(key => { if (req.body[key] !== undefined) fields[key] = req.body[key]; });

    await db.updateCourse(req.params.id, fields);
    const updated = await db.getCourseById(req.params.id);
    res.json({ course: updated });
  } catch (err) {
    console.error('PUT /admin/courses/:id', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── DELETE /api/admin/courses/:id ─────────────────────────
router.delete('/courses/:id', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });

    await Promise.all([
      db.deleteCourse(req.params.id),
      db.deleteProgressByCourse(req.params.id),
    ]);
    res.json({ message: 'Excluído.' });
  } catch (err) {
    console.error('DELETE /admin/courses/:id', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/courses/:id/lessons ────────────────────
router.get('/courses/:id/lessons', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });
    res.json({ lessons: course.lessons || [] });
  } catch (err) {
    console.error('GET /admin/courses/:id/lessons', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/courses/:id/lessons/:lessonId ──────────
router.get('/courses/:id/lessons/:lessonId', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });
    const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });
    res.json({ lesson });
  } catch (err) {
    console.error('GET /admin/courses/:id/lessons/:lessonId', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/admin/courses/:id/lessons ───────────────────
router.post('/courses/:id/lessons', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Não encontrado.' });

    const { title, type, videoType, videoUrl, duration, requiredPercent, description, activityTitle, questions } = req.body;
    if (!title) return res.status(400).json({ message: 'Título obrigatório.' });

    const lesson = {
      id: uuid(), title, type: type || 'video', description,
      ...(type !== 'activity' ? { videoType, videoUrl, duration, requiredPercent: requiredPercent || 80 } : {}),
      ...(type === 'activity' ? { activityTitle, questions: questions || [] } : {}),
      createdAt: new Date().toISOString(),
    };

    const lessons = [...(course.lessons || []), lesson];
    await db.updateCourse(req.params.id, { lessons });
    res.status(201).json({ lesson });
  } catch (err) {
    console.error('POST /admin/courses/:id/lessons', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── PUT /api/admin/courses/:id/lessons/:lessonId ──────────
router.put('/courses/:id/lessons/:lessonId', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const lIdx = (course.lessons || []).findIndex(l => l.id === req.params.lessonId);
    if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

    const allowed = ['title','type','videoType','videoUrl','duration','requiredPercent','description','activityTitle','questions'];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) course.lessons[lIdx][key] = req.body[key];
    });

    await db.updateCourse(req.params.id, { lessons: course.lessons });
    res.json({ lesson: course.lessons[lIdx] });
  } catch (err) {
    console.error('PUT /admin/courses/:id/lessons/:lessonId', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── DELETE /api/admin/courses/:id/lessons/:lessonId ───────
router.delete('/courses/:id/lessons/:lessonId', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const lIdx = (course.lessons || []).findIndex(l => l.id === req.params.lessonId);
    if (lIdx < 0) return res.status(404).json({ message: 'Aula não encontrada.' });

    course.lessons.splice(lIdx, 1);
    await db.updateCourse(req.params.id, { lessons: course.lessons });
    res.json({ message: 'Aula excluída.' });
  } catch (err) {
    console.error('DELETE /admin/courses/:id/lessons/:lessonId', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { q } = req.query;
    const [allUsers, progress] = await Promise.all([
      db.getUsers(),
      db.getProgress(),
    ]);
    let users = allUsers.filter(u => u.role !== 'admin');
    if (q) {
      const lower = q.toLowerCase();
      users = users.filter(u =>
        u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower)
      );
    }
    res.json({
      users: users.map(u => {
        const { password: _, ...safe } = u;
        return { ...safe, enrollments: progress.filter(p => p.userId === u.id).length };
      }),
    });
  } catch (err) {
    console.error('GET /admin/users', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Não encontrado.' });
    if (user.role === 'admin') return res.status(403).json({ message: 'Não é possível excluir administrador.' });

    await Promise.all([
      db.deleteUser(req.params.id),
      db.deleteProgressByUser(req.params.id),
    ]);
    res.json({ message: 'Aluno removido.' });
  } catch (err) {
    console.error('DELETE /admin/users/:id', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/admin/export/users-csv ──────────────────────
router.get('/export/users-csv', async (req, res) => {
  try {
    const [allUsers, progress] = await Promise.all([
      db.getUsers(),
      db.getProgress(),
    ]);
    const users = allUsers.filter(u => u.role !== 'admin');

    const header = ['id','nome','email','nivel','xp','streak','trilhas_matriculadas','cadastro'].join(',');
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = users.map(u => {
      const enrollments = progress.filter(p => p.userId === u.id).length;
      return [
        esc(u.id), esc(u.name), esc(u.email),
        esc(u.level), esc(u.xp), esc(u.streak),
        esc(enrollments), esc(u.createdAt),
      ].join(',');
    });

    const csv      = [header, ...rows].join('\r\n');
    const filename = `alunos_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('GET /admin/export/users-csv', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

module.exports = router;
