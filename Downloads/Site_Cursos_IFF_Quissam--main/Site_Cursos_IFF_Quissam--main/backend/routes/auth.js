const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db       = require('../data/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Preencha todos os campos.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres.' });

    const users = db.getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
      return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuid(), name, email: email.toLowerCase(),
      password: hash, role: 'student',
      xp: 0, level: 1, streak: 0,
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    db.saveUsers(users);

    // Log activity
    const log = db.getActivityLog();
    log.push({ userId: user.id, userName: user.name, action: 'Cadastrou-se', createdAt: new Date().toISOString() });
    db.saveActivityLog(log);

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Preencha todos os campos.' });

    const users = db.getUsers();
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user)
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ message: 'E-mail ou senha incorretos.' });

    // Atualiza último login e streak
    const now  = new Date();
    const last = user.lastLogin ? new Date(user.lastLogin) : null;
    if (last) {
      const diffDays = Math.floor((now - last) / 86400000);
      if (diffDays === 1) user.streak = (user.streak || 0) + 1;
      else if (diffDays > 1) user.streak = 1;
    } else {
      user.streak = 1;
    }
    user.lastLogin = now.toISOString();
    db.saveUsers(users);

    // Log
    const log = db.getActivityLog();
    log.push({ userId: user.id, userName: user.name, action: 'Fez login', createdAt: now.toISOString() });
    db.saveActivityLog(log);

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

module.exports = router;
