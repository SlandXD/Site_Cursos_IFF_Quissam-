const express  = require('express');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────

/** Calcula o status (locked/current/completed) de cada aula. */
function computeLessonStatuses(lessons, completedIds) {
  return (lessons || []).map((l, i) => {
    if (completedIds.includes(l.id)) return 'completed';
    if (i === 0 || completedIds.includes((lessons[i - 1] || {}).id)) return 'current';
    return 'locked';
  });
}

/**
 * Aplica XP + level-up ao objeto de usuário (mutação in-place).
 * Retorna o xpGained efetivo.
 */
function applyXP(user, xp) {
  if (xp <= 0) return 0;
  user.xp += xp;
  let leveled = false;
  while (user.xp >= user.level * 100) {
    user.xp   -= user.level * 100;
    user.level += 1;
    leveled = true;
  }
  if (leveled) grantBadge(user, 'level_up');
  return xp;
}

/** Verifica conclusão do curso e atribui certificado/badges. */
function checkCourseCompletion(p, user, course) {
  if (p.completed) return;
  if (p.completedLessons.length < (course.lessons || []).length) return;
  p.completed     = true;
  p.completedAt   = new Date().toISOString();
  p.certificateId = p.certificateId || uuid();
  grantBadge(user, 'first_course');
  if (p.enrolledAt) {
    const diffDays = (Date.now() - new Date(p.enrolledAt).getTime()) / 86400000;
    if (diffDays < 3) grantBadge(user, 'speed_run');
  }
}

/** Constrói o payload de atividade para enviar ao cliente. */
function buildActivityPayload(lesson) {
  if (!lesson || lesson.type !== 'activity') return null;
  return {
    id:        lesson.id,
    title:     lesson.activityTitle || 'Atividade',
    questions: (lesson.questions || []).map(q => ({
      question:     q.question,
      options:      q.options,
      correctIndex: q.correctIndex,
      explanation:  q.explanation,
    })),
  };
}

/**
 * Calcula a pontuação de uma atividade a partir das respostas submetidas
 * pelo aluno, comparando com o gabarito armazenado no servidor.
 * Retorna um número entre 0 e 100.
 */
function scoreActivity(lesson, answers) {
  const questions = lesson.questions || [];
  if (!questions.length) return 0;
  if (!Array.isArray(answers) || !answers.length) return 0;
  const correct = questions.reduce((acc, q, i) => {
    return acc + (answers[i] === q.correctIndex ? 1 : 0);
  }, 0);
  return Math.round((correct / questions.length) * 100);
}

function grantBadge(user, badgeId) {
  if (!user.badges) user.badges = [];
  if (!user.badges.find(b => b.id === badgeId)) {
    user.badges.push({ id: badgeId, grantedAt: new Date().toISOString() });
  }
}

// ── GET /api/courses ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [courses, progress] = await Promise.all([
      db.getCourses(),
      db.getProgressByUser(req.user.id),
    ]);

    const result = courses.map(c => {
      const p   = progress.find(p => p.courseId === c.id);
      const tot = c.lessons ? c.lessons.length : 0;
      const done = p ? (p.completedLessons || []).length : undefined;
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

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = req.query.limit
      ? Math.min(50, Math.max(1, parseInt(req.query.limit)))
      : result.length;
    const total = result.length;
    const pages = Math.ceil(total / limit) || 1;
    const start = (page - 1) * limit;
    const paged = result.slice(start, start + limit);

    res.json({ courses: paged, pagination: { page, limit, total, pages } });
  } catch (err) {
    console.error('GET /courses', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/courses/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const progress   = await db.getProgressEntry(req.user.id, course.id);
    const enrolled   = !!progress;
    const completed  = progress ? (progress.completedLessons || []) : [];
    const statuses   = computeLessonStatuses(course.lessons, completed);

    const lessons = (course.lessons || []).map((l, i) => ({
      ...l,
      questions: undefined,
      status: statuses[i],
    }));

    const total   = lessons.length;
    const done    = completed.length;
    const progPct = total > 0 ? (done / total) * 100 : 0;
    const nextLesson = lessons.find(l => l.status === 'current');

    res.json({
      ...course,
      lessons,
      enrolled,
      progress:   enrolled ? progPct : 0,
      nextLesson: nextLesson ? nextLesson.id : null,
    });
  } catch (err) {
    console.error('GET /courses/:id', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/courses/:id/enroll ──────────────────────────
router.post('/:id/enroll', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const existing = await db.getProgressEntry(req.user.id, course.id);
    if (existing) return res.status(409).json({ message: 'Já matriculado.' });

    await db.insertProgress({
      userId:           req.user.id,
      courseId:         course.id,
      completedLessons: [],
      activityScores:   {},
      completed:        false,
      enrolledAt:       new Date().toISOString(),
    });

    const user = await db.getUserById(req.user.id);
    await db.appendActivityLog({
      userId: req.user.id, userName: user?.name || '—',
      action: 'Matriculou-se', courseName: course.name,
      createdAt: new Date().toISOString(),
    });

    res.json({ message: 'Matriculado com sucesso.' });
  } catch (err) {
    console.error('POST /courses/:id/enroll', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── GET /api/courses/:id/lessons/:lessonId ────────────────
router.get('/:id/lessons/:lessonId', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });

    const [user, progress] = await Promise.all([
      db.getUserById(req.user.id),
      db.getProgressEntry(req.user.id, course.id),
    ]);

    if (!progress)
      return res.status(403).json({ message: 'Você não está matriculado nesta trilha.' });

    const completed  = progress.completedLessons || [];
    const lessonIdx  = course.lessons.findIndex(l => l.id === lesson.id);
    const isLocked   = lessonIdx > 0 && !completed.includes(course.lessons[lessonIdx - 1].id);
    const statuses   = computeLessonStatuses(course.lessons, completed);

    const allLessons = course.lessons.map((l, i) => ({
      id: l.id, title: l.title, type: l.type, duration: l.duration, status: statuses[i],
    }));

    const nextIdx    = lessonIdx + 1;
    const nextLesson = nextIdx < course.lessons.length ? course.lessons[nextIdx] : null;
    const hasActivity = nextLesson && nextLesson.type === 'activity';
    const actCompleted = hasActivity ? completed.includes(nextLesson.id) : false;
    const activity   = buildActivityPayload(hasActivity ? nextLesson : null);

    res.json({
      courseName:        course.name,
      userName:          user?.name || '—',
      userAvatar:        user?.avatar || null,
      userLevel:         user?.level || 1,
      userXP:            user?.xp || 0,
      lesson: { ...lesson, questions: undefined, locked: isLocked, completed: completed.includes(lesson.id) },
      allLessons,
      hasActivity,
      activityCompleted: actCompleted,
      activity,
      nextLesson: hasActivity ? null : (nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null),
      courseCompleted: completed.length === course.lessons.length,
    });
  } catch (err) {
    console.error('GET /courses/:id/lessons/:lessonId', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/courses/:id/lessons/:lessonId/complete ──────
router.post('/:id/lessons/:lessonId/complete', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });

    const progress = await db.getProgressEntry(req.user.id, course.id);
    if (!progress) return res.status(403).json({ message: 'Não matriculado.' });

    const user           = await db.getUserById(req.user.id);
    const alreadyDone    = (progress.completedLessons || []).includes(lesson.id);
    const completedLessons = alreadyDone
      ? progress.completedLessons
      : [...(progress.completedLessons || []), lesson.id];

    let xpGained = 0;
    if (!alreadyDone) {
      xpGained = lesson.type === 'video' ? 10 : 15;
      applyXP(user, xpGained);
      if (completedLessons.length === 1) grantBadge(user, 'first_lesson');
    }

    const updatedProgress = { ...progress, completedLessons };
    checkCourseCompletion(updatedProgress, user, course);

    await Promise.all([
      db.updateProgress(req.user.id, course.id, {
        completedLessons:    updatedProgress.completedLessons,
        completed:           updatedProgress.completed,
        completedAt:         updatedProgress.completedAt,
        certificateId:       updatedProgress.certificateId,
      }),
      db.updateUser(user.id, { xp: user.xp, level: user.level, badges: user.badges }),
    ]);

    const statuses   = computeLessonStatuses(course.lessons, updatedProgress.completedLessons);
    const allLessons = course.lessons.map((l, i) => ({
      id: l.id, title: l.title, type: l.type, duration: l.duration, status: statuses[i],
    }));

    const lessonIdx  = course.lessons.findIndex(l => l.id === lesson.id);
    const nextIdx    = lessonIdx + 1;
    const nextLesson = nextIdx < course.lessons.length ? course.lessons[nextIdx] : null;
    const hasActivity = nextLesson && nextLesson.type === 'activity';
    const activity   = buildActivityPayload(hasActivity ? nextLesson : null);

    await db.appendActivityLog({
      userId: req.user.id, userName: user.name,
      action: 'Concluiu aula', courseName: course.name,
      createdAt: new Date().toISOString(),
    });

    res.json({
      xpGained,
      userXP:    user.xp,
      userLevel: user.level,
      allLessons,
      hasActivity,
      activityCompleted: false,
      activity,
      nextLesson: !hasActivity && nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      courseCompleted: updatedProgress.completed,
    });
  } catch (err) {
    console.error('POST /courses/:id/lessons/:lessonId/complete', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/courses/:id/lessons/:lessonId/activity ──────
router.post('/:id/lessons/:lessonId/activity', async (req, res) => {
  try {
    const { answers } = req.body; // array de índices escolhidos pelo aluno

    const course = await db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Trilha não encontrada.' });

    const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'Aula não encontrada.' });
    if (lesson.type !== 'activity') return res.status(400).json({ message: 'Esta aula não é uma atividade.' });

    // ✅ Score calculado no servidor — não confiamos no cliente
    const score = scoreActivity(lesson, answers);
    if (score < 70) return res.json({ passed: false, score, message: 'Tente novamente.' });

    const progress = await db.getProgressEntry(req.user.id, course.id);
    if (!progress) return res.status(403).json({ message: 'Não matriculado.' });

    const user             = await db.getUserById(req.user.id);
    const alreadyDone      = (progress.completedLessons || []).includes(lesson.id);
    const completedLessons = alreadyDone
      ? progress.completedLessons
      : [...(progress.completedLessons || []), lesson.id];

    const activityScores = { ...(progress.activityScores || {}), [lesson.id]: score };

    let xpGained = 0;
    if (!alreadyDone) {
      xpGained = 15 + Math.floor(score / 20) * 5;
      applyXP(user, xpGained);
    }

    // Badges de atividade
    const allScores = Object.values(activityScores);
    if (allScores.filter(s => s === 100).length >= 10) grantBadge(user, 'quiz_master');
    if (allScores.length >= 5) grantBadge(user, 'note_taker');

    const updatedProgress = { ...progress, completedLessons, activityScores };
    checkCourseCompletion(updatedProgress, user, course);

    await Promise.all([
      db.updateProgress(req.user.id, course.id, {
        completedLessons:  updatedProgress.completedLessons,
        activityScores:    updatedProgress.activityScores,
        completed:         updatedProgress.completed,
        completedAt:       updatedProgress.completedAt,
        certificateId:     updatedProgress.certificateId,
      }),
      db.updateUser(user.id, { xp: user.xp, level: user.level, badges: user.badges }),
    ]);

    const lessonIdx  = course.lessons.findIndex(l => l.id === lesson.id);
    const nextLesson = lessonIdx + 1 < course.lessons.length ? course.lessons[lessonIdx + 1] : null;

    await db.appendActivityLog({
      userId: req.user.id, userName: user.name,
      action: `Atividade (${score}%)`, courseName: course.name,
      createdAt: new Date().toISOString(),
    });

    res.json({
      passed: true, score, xpGained,
      userXP:    user.xp,
      userLevel: user.level,
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      courseCompleted: updatedProgress.completed,
    });
  } catch (err) {
    console.error('POST /courses/:id/lessons/:lessonId/activity', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

module.exports = router;
