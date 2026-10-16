const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/student/dashboard
router.get('/dashboard', async (req, res) => {
  const users    = await db.getUsers();
  const user     = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

  const courses  = await db.getCourses();
  const progress = (await db.getProgress()).filter(p => p.userId === req.user.id);

  const enrollments = progress.map(p => {
    const course = courses.find(c => c.id === p.courseId);
    if (!course) return null;
    const total     = course.lessons ? course.lessons.length : 0;
    const completed = (p.completedLessons || []).length;
    return {
      courseId:         p.courseId,
      courseName:       course.name,
      totalLessons:     total,
      completedLessons: completed,
      progress:         total > 0 ? (completed / total) * 100 : 0,
    };
  }).filter(Boolean);

  // Last active lesson
  let lastLesson = null;
  for (const p of progress) {
    const course = courses.find(c => c.id === p.courseId);
    if (!course || !course.lessons) continue;
    const nextIdx = course.lessons.findIndex(l => !(p.completedLessons || []).includes(l.id));
    if (nextIdx >= 0) {
      const lesson = course.lessons[nextIdx];
      const total  = course.lessons.length;
      const done   = (p.completedLessons || []).length;
      lastLesson = {
        courseId:    course.id,
        courseName:  course.name,
        lessonId:    lesson.id,
        lessonName:  lesson.title,
        moduleIndex: nextIdx + 1,
        progress:    total > 0 ? (done / total) * 100 : 0,
      };
      break;
    }
  }

  const { password: _, ...safeUser } = user;
  res.json({
    user:             { ...safeUser },
    completedLessons: progress.reduce((acc, p) => acc + (p.completedLessons || []).length, 0),
    activeCourses:    enrollments.filter(e => e.progress < 100).length,
    certificates:     progress.filter(p => p.completed).length,
    streak:           user.streak || 0,
    enrollments,
    lastLesson,
  });
});

// GET /api/student/profile
router.get('/profile', async (req, res) => {
  const users = await db.getUsers();
  const user  = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Não encontrado.' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// PUT /api/student/profile
router.put('/profile', async (req, res) => {
  const { name, email, avatar } = req.body;
  const users = await db.getUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });

  if (email && email !== users[idx].email) {
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== req.user.id))
      return res.status(409).json({ message: 'E-mail já em uso.' });
    users[idx].email = email.toLowerCase();
  }
  if (name) users[idx].name = name;
  // Validar e salvar avatar (máx 10 chars)
  if (avatar !== undefined) {
    const trimmed = String(avatar).trim().slice(0, 10);
    users[idx].avatar = trimmed || null;
  }
  await db.saveUsers(users);
  const { password: _, ...safe } = users[idx];
  res.json({ message: 'Perfil atualizado.', user: safe });
});

// PUT /api/student/password
router.put('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const users = await db.getUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ message: 'Não encontrado.' });

  const match = await bcrypt.compare(currentPassword, users[idx].password);
  if (!match) return res.status(400).json({ message: 'Senha atual incorreta.' });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ message: 'Nova senha muito curta.' });

  users[idx].password = await bcrypt.hash(newPassword, 10);
  await db.saveUsers(users);
  res.json({ message: 'Senha atualizada.' });
});

// GET /api/student/achievements
router.get('/achievements', async (req, res) => {
  const users    = await db.getUsers();
  const user     = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Não encontrado.' });

  const courses  = await db.getCourses();
  const progress = (await db.getProgress()).filter(p => p.userId === req.user.id && p.completed);

  const certificates = progress.map(p => {
    const course = courses.find(c => c.id === p.courseId);
    if (!course) return null;
    return {
      id:         p.certificateId || p.courseId,
      courseName: course.name,
      userName:   user.name,
      issuedAt:   p.completedAt || new Date().toISOString(),
    };
  }).filter(Boolean);

  const badges = user.badges || [];
  const { password: _, ...safe } = user;
  res.json({ user: safe, certificates, badges });
});

// GET /api/student/ranking
router.get('/ranking', async (req, res) => {
  const users = (await db.getUsers()).filter(u => u.role !== 'admin');

  const sorted = users
    .map(u => ({
      id:           u.id,
      name:         u.name,
      avatar:       u.avatar || u.name.charAt(0).toUpperCase(),
      level:        u.level || 1,
      xp:           u.xp || 0,
      badges_count: (u.badges || []).length,
      isMe:         u.id === req.user.id,
      totalXP:      (u.xp || 0) + ((u.level || 1) - 1) * 100,
    }))
    .sort((a, b) => b.totalXP - a.totalXP)
    .slice(0, 20)
    .map((u, idx) => ({
      position:     idx + 1,
      name:         u.name,
      avatar:       u.avatar,
      level:        u.level,
      xp:           u.xp,
      badges_count: u.badges_count,
      isMe:         u.isMe,
    }));

  res.json({ ranking: sorted });
});

module.exports = router;
