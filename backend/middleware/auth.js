const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Em produção isso deve ser um erro fatal. Em desenvolvimento, avisa claramente.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET não está definido. Defina a variável de ambiente antes de iniciar o servidor.');
  }
  console.warn('⚠️  AVISO DE SEGURANÇA: JWT_SECRET não definido. Usando segredo temporário de desenvolvimento.');
  console.warn('    Defina JWT_SECRET no arquivo .env antes de usar em produção!');
}
const SECRET = JWT_SECRET || 'dev_only_secret_' + Math.random().toString(36).slice(2);

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não fornecido.' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
}

function adminOnly(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores.' });
    }
    next();
  });
}

module.exports = { authMiddleware, adminOnly, JWT_SECRET: SECRET };
