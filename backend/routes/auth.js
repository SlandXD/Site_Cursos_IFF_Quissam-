const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db         = require('../data/db');
const { JWT_SECRET } = require('../middleware/auth');
const rateLimit  = require('express-rate-limit');
const validator  = require('validator');

const router = express.Router();

// Rate limiter específico para login: máx 10 tentativas por 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

// ── POST /api/auth/register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Preencha todos os campos.' });
    if (!validator.isEmail(email))
      return res.status(400).json({ message: 'Formato de e-mail inválido.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres.' });

    const existing = await db.getUserByEmail(email);
    if (existing)
      return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuid(), name, email: email.toLowerCase(),
      password: hash, role: 'student',
      xp: 0, level: 1, streak: 0,
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await db.insertUser(user);
    await db.appendActivityLog({
      userId: user.id, userName: user.name,
      action: 'Cadastrou-se', createdAt: new Date().toISOString(),
    });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('POST /auth/register', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Preencha todos os campos.' });

    const user = await db.getUserByEmail(email);
    if (!user)
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' });

    // Atualiza último login e streak
    const now  = new Date();
    const last = user.lastLogin ? new Date(user.lastLogin) : null;
    const toDay = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const fields = { lastLogin: now.toISOString() };

    if (last) {
      const nowDay  = toDay(now);
      const lastDay = toDay(last);
      if (nowDay !== lastDay) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        user.streak = toDay(yesterday) === lastDay ? (user.streak || 0) + 1 : 1;
        if (user.streak >= 7) {
          if (!user.badges) user.badges = [];
          if (!user.badges.find(b => b.id === 'streak_7')) {
            user.badges.push({ id: 'streak_7', grantedAt: new Date().toISOString() });
          }
          fields.badges = user.badges;
        }
        fields.streak = user.streak;
      }
    } else {
      fields.streak = 1;
      user.streak   = 1;
    }

    await db.updateUser(user.id, fields);
    await db.appendActivityLog({
      userId: user.id, userName: user.name,
      action: 'Fez login', createdAt: now.toISOString(),
    });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = { ...user, ...fields };
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('POST /auth/login', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────
// Gera token de 6 dígitos e armazena no usuário.
// Em demo: retorna o código na resposta. Em produção: integrar envio por e-mail.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Informe o e-mail.' });

    const user = await db.getUserByEmail(email);
    // Por segurança: sempre retornar 200 (não revela se o e-mail existe)
    if (!user) return res.json({ message: 'Se o e-mail existir, você receberá o código.' });

    const token     = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.updateUser(user.id, { resetToken: token, resetExpires: expiresAt });

    // Em demo: retorna o token na resposta. Em produção: enviar por e-mail e não retornar aqui.
    res.json({ message: 'Código gerado com sucesso.', token, expiresAt });
  } catch (err) {
    console.error('POST /auth/forgot-password', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword)
      return res.status(400).json({ message: 'Preencha todos os campos.' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres.' });

    const user = await db.getUserByEmail(email);
    if (!user || !user.resetToken || user.resetToken !== token)
      return res.status(400).json({ message: 'Código inválido.' });
    if (new Date() > new Date(user.resetExpires))
      return res.status(400).json({ message: 'Código expirado. Solicite um novo.' });

    await db.updateUser(user.id, {
      password:     await bcrypt.hash(newPassword, 10),
      resetToken:   null,
      resetExpires: null,
    });

    res.json({ message: 'Senha redefinida com sucesso. Faça login.' });
  } catch (err) {
    console.error('POST /auth/reset-password', err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

module.exports = router;
