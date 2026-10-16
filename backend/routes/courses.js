const express  = require('express');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/courses — lista todos os cursos (com progresso do aluno) e suporte a paginação
router.get('/', async (req, res) => {
  const courses  = await db.getCourses();
  const progress = (await db.getProgress()).filter(p => p.userId === req.user.id);

  const result = courses.map(c => {
    const p   = progress.find(p => p.courseId === c.id);
    const tot = c.lessons ? c.lessons.length : 0;
    const done= p ? (p.completedLessons || []).length : undefined;
    return {
      id:           c.id,
      name:         c.name,
      shortDesc:    c.shortDesc,
      level:        c.level,
      emoji:        c.emoji,
      duration:     c.duration,
      featured:     c.featured,
      totalLessons: tot,
      myProgress:   p ? (tot > 0 ? (done / tot) * 100 : 0) : undefined,
    };
  });

  // Paginação
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = req.query.limit
    ? Math.min(50, Math.max(1, parseInt(req.query.limit)))
    : result.length; // sem ?limit retorna todos (compatibilidade)
  const total = result.length;
  const pages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const paged = result.slice(start, start + limit);

  res.json({
    courses: paged,
    pagination: { page, limit, total, pages },
  });
});

// GET /api/courses/:id — detalhe do curso com status de cada aula
router.get('/:id', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const progress = (await db.getProgress()).find(p => p.userId === req.user.id && p.courseId === course.id);
  const enrolled = !!progress;
  const completed = progress ? (progress.completedLessons || []) : [];

  const lessons = (course.lessons || []).map((l, i) => {
    let status = 'locked';
    if (completed.includes(l.id)) status = 'completed';
    else if (i === 0 || completed.includes((course.lessons[i - 1] || {}).id)) status = 'current';
    return { ...l, status, questions: undefined };
  });

  const total    = lessons.length;
  const done     = completed.length;
  const progPct  = total > 0 ? (done / total) * 100 : 0;
  const nextLesson = lessons.find(l => l.status === 'current');

  res.json({
    ...course,
    lessons,
    enrolled,
    progress: enrolled ? progPct : 0,
    nextLesson: nextLesson ? nextLesson.id : null,
  });
});

// POST /api/courses/:id/enroll — matricular aluno
router.post('/:id/enroll', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const progress = await db.getProgress();
  if (progress.find(p => p.userId === req.user.id && p.courseId === course.id))
    return res.status(409).json({ message: 'Já matriculado.' });

  progress.push({
    userId:           req.user.id,
    courseId:         course.id,
    completedLessons: [],
    activityScores:   {},
    completed:        false,
    enrolledAt:       new Date().toISOString(),
  });
  await db.saveProgress(progress);

  // Log
  const users = await db.getUsers();
  const user  = users.find(u => u.id === req.user.id);
  const log   = await db.getActivityLog();
  log.push({ userId: req.user.id, userName: user?.name || '—', action: 'Matriculou-se', courseName: course.name, createdAt: new Date().toISOString() });
  await db.saveActivityLog(log);

  res.json({ message: 'Matriculado com sucesso.' });
});

// GET /api/courses/:id/lessons/:lessonId — dados da aula para o player
router.get('/:id/lessons/:lessonId', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });

  const users    = await db.getUsers();
  const user     = users.find(u => u.id === req.user.id);
  const progress = (await db.getProgress()).find(p => p.userId === req.user.id && p.courseId === course.id);

  if (!progress)
    return res.status(403).json({ message: 'Você não está matriculado nesta trilha.' });

  const completed = progress.completedLessons || [];
  const lessonIdx = course.lessons.findIndex(l => l.id === lesson.id);

  // Verifica desbloqueio
  const isLocked  = lessonIdx > 0 && !completed.includes(course.lessons[lessonIdx - 1].id);

  // Status de todas as aulas
  const allLessons = course.lessons.map((l, i) => {
    let status = 'locked';
    if (completed.includes(l.id)) status = 'completed';
    else if (i === 0 || completed.includes((course.lessons[i - 1] || {}).id)) status = 'current';
    return { id: l.id, title: l.title, type: l.type, duration: l.duration, status };
  });

  // Próxima aula
  const nextIdx   = lessonIdx + 1;
  const nextLesson = nextIdx < course.lessons.length ? course.lessons[nextIdx] : null;

  // Atividade pós-vídeo (a aula seguinte, se for activity)
  const hasActivity = nextLesson && nextLesson.type === 'activity';
  const actLesson   = hasActivity ? nextLesson : null;
  const actCompleted= actLesson ? completed.includes(actLesson.id) : false;

  const activity = actLesson ? {
    id:        actLesson.id,
    title:     actLesson.activityTitle || 'Atividade',
    questions: (actLesson.questions || []).map(q => ({
      question:     q.question,
      options:      q.options,
      correctIndex: q.correctIndex,
      explanation:  q.explanation,
    })),
  } : null;

  const xpForNext = user.level * 100;
  res.json({
    courseName:       course.name,
    userName:         user?.name || '—',
    userAvatar:       user?.avatar || null,
    userLevel:        user?.level || 1,
    userXP:           user?.xp || 0,
    lesson: {
      ...lesson,
      questions: undefined,  // Não expõe respostas do vídeo
      locked:    isLocked,
      completed: completed.includes(lesson.id),
    },
    allLessons,
    hasActivity,
    activityCompleted: actCompleted,
    activity,
    nextLesson: hasActivity ? null : (nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null),
    courseCompleted: completed.length === course.lessons.length,
  });
});

// POST /api/courses/:id/lessons/:lessonId/complete — marca aula como concluída
router.post('/:id/lessons/:lessonId/complete', async (req, res) => {
  const courses = await db.getCourses();
  const course  = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });

  const progressList = await db.getProgress();
  const pIdx = progressList.findIndex(p => p.userId === req.user.id && p.courseId === course.id);
  if (pIdx < 0) return res.status(403).json({ message: 'Não matriculado.' });

  const p = progressList[pIdx];
  const alreadyCompleted = (p.completedLessons || []).includes(lesson.id);
  if (!alreadyCompleted) {
    p.completedLessons = [...(p.completedLessons || []), lesson.id];
  }

  // XP ganho apenas se a aula não foi concluída antes
  const xpGained = alreadyCompleted ? 0 : (lesson.type === 'video' ? 10 : 15);
  const users    = await db.getUsers();
  const uIdx     = users.findIndex(u => u.id === req.user.id);
  if (!alreadyCompleted) {
    users[uIdx].xp += xpGained;
    // Level up em loop até não precisar mais subir
    let leveled = false;
    while (users[uIdx].xp >= users[uIdx].level * 100) {
      users[uIdx].xp -= users[uIdx].level * 100;
      users[uIdx].level += 1;
      leveled = true;
    }
    if (leveled) grantBadge(users[uIdx], 'level_up');
  }

  // Verifica conclusão do curso
  if (!p.completed && p.completedLessons.length === course.lessons.length) {
    p.completed     = true;
    p.completedAt   = new Date().toISOString();
    p.certificateId = uuid();
    grantBadge(users[uIdx], 'first_course');

    // Badge speed_run: concluiu o curso em menos de 3 dias após matrícula
    if (p.enrolledAt) {
      const diffMs  = new Date() - new Date(p.enrolledAt);
      const diffDays = diffMs / 86400000;
      if (diffDays < 3) grantBadge(users[uIdx], 'speed_run');
    }
  }

  // Badge primeira aula
  if (!alreadyCompleted && p.completedLessons.length === 1) grantBadge(users[uIdx], 'first_lesson');

  await db.saveProgress(progressList);
  await db.saveUsers(users);

  // Próxima aula
  const lessonIdx  = course.lessons.findIndex(l => l.id === lesson.id);
  const nextIdx    = lessonIdx + 1;
  const nextLesson = nextIdx < course.lessons.length ? course.lessons[nextIdx] : null;
  const hasActivity= nextLesson && nextLesson.type === 'activity';

  const updatedAllLessons = course.lessons.map((l, i) => {
    let status = 'locked';
    if (p.completedLessons.includes(l.id)) status = 'completed';
    else if (i === 0 || p.completedLessons.includes((course.lessons[i - 1] || {}).id)) status = 'current';
    return { id: l.id, title: l.title, type: l.type, duration: l.duration, status };
  });

  const actLesson = hasActivity ? nextLesson : null;
  const activity  = actLesson ? {
    id: actLesson.id, title: actLesson.activityTitle || 'Atividade',
    questions: (actLesson.questions || []).map(q => ({
      question: q.question, options: q.options,
      correctIndex: q.correctIndex, explanation: q.explanation,
    })),
  } : null;

  // Log
  const log = await db.getActivityLog();
  log.push({ userId: req.user.id, userName: users[uIdx].name, action: 'Concluiu aula', courseName: course.name, createdAt: new Date().toISOString() });
  await db.saveActivityLog(log);

  res.json({
    xpGained,
    userXP:    users[uIdx].xp,
    userLevel: users[uIdx].level,
    allLessons: updatedAllLessons,
    hasActivity,
    activityCompleted: false,
    activity,
    nextLesson: !hasActivity && nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
    courseCompleted: p.completed,
  });
});

// POST /api/courses/:id/lessons/:lessonId/activity — submete atividade
router.post('/:id/lessons/:lessonId/activity', async (req, res) => {
  const { score } = req.body;
  const courses   = await db.getCourses();
  const course    = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

  const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });

  if (score < 70) return res.json({ passed: false, message: 'Tente novamente.' });

  const progressList = await db.getProgress();
  const pIdx = progressList.findIndex(p => p.userId === req.user.id && p.courseId === course.id);
  if (pIdx < 0) return res.status(403).json({ message: 'Não matriculado.' });

  const p = progressList[pIdx];
  p.activityScores = p.activityScores || {};

  // Evita re-creditar XP se a atividade já foi concluída antes
  const activityAlreadyDone = p.completedLessons.includes(lesson.id);
  if (!activityAlreadyDone) {
    p.completedLessons.push(lesson.id);
  }
  p.activityScores[lesson.id] = score;

  const xpGained = activityAlreadyDone ? 0 : (15 + Math.floor(score / 20) * 5);
  const users    = await db.getUsers();
  const uIdx     = users.findIndex(u => u.id === req.user.id);
  if (!activityAlreadyDone) {
    users[uIdx].xp += xpGained;
    // Level up em loop
    while (users[uIdx].xp >= users[uIdx].level * 100) {
      users[uIdx].xp -= users[uIdx].level * 100;
      users[uIdx].level += 1;
      grantBadge(users[uIdx], 'level_up');
    }
  }

  // Badge quiz master: 10 atividades com 100%
  const allScores = Object.values(p.activityScores);
  const perfectActivities = allScores.filter(s => s === 100).length;
  if (perfectActivities >= 10) grantBadge(users[uIdx], 'quiz_master');

  // Badge note_taker: verificado pelo frontend ao salvar notas — aqui contamos via activityScores como proxy
  // (contagem de aulas de atividade concluídas com nota, já que notas ficam em localStorage)
  if (allScores.length >= 5) grantBadge(users[uIdx], 'note_taker');

  // Verifica conclusão do curso
  if (!p.completed && p.completedLessons.length === course.lessons.length) {
    p.completed     = true;
    p.completedAt   = new Date().toISOString();
    p.certificateId = p.certificateId || uuid();
    grantBadge(users[uIdx], 'first_course');

    // Badge speed_run
    if (p.enrolledAt) {
      const diffDays = (new Date() - new Date(p.enrolledAt)) / 86400000;
      if (diffDays < 3) grantBadge(users[uIdx], 'speed_run');
    }
  }

  await db.saveProgress(progressList);
  await db.saveUsers(users);

  const lessonIdx  = course.lessons.findIndex(l => l.id === lesson.id);
  const nextIdx    = lessonIdx + 1;
  const nextLesson = nextIdx < course.lessons.length ? course.lessons[nextIdx] : null;

  // Log
  const log = await db.getActivityLog();
  log.push({ userId: req.user.id, userName: users[uIdx].name, action: `Atividade (${score}%)`, courseName: course.name, createdAt: new Date().toISOString() });
  await db.saveActivityLog(log);

  res.json({
    passed: true, xpGained,
    userXP: users[uIdx].xp, userLevel: users[uIdx].level,
    nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
    courseCompleted: p.completed,
  });
});

function grantBadge(user, badgeId) {
  if (!user.badges) user.badges = [];
  if (!user.badges.find(b => b.id === badgeId)) {
    user.badges.push({ id: badgeId, grantedAt: new Date().toISOString() });
  }
}

module.exports = router;
