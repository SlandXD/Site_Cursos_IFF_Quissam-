/**
 * Construct Academy — Backend Server
 * Node.js + Express
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const db         = require('./data/db');
const bcrypt     = require('bcryptjs');
const { v4: uuid } = require('uuid');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Rate Limiting global: 100 req/min ─────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas requisições. Tente novamente em instantes.' },
});

// ── Middleware ────────────────────────────────────────────
app.use(globalLimiter);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve o frontend estático
// Suporta tanto execução a partir de /backend quanto da raiz do projeto
const frontendPath = path.join(__dirname, '..', 'frontend', 'public');
const frontendAlt  = path.join(__dirname, 'frontend', 'public');
const require_fs   = require('fs');
const staticPath   = require_fs.existsSync(frontendPath) ? frontendPath : frontendAlt;
app.use(express.static(staticPath));

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/student', require('./routes/student'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/admin',   require('./routes/admin'));

// Stats públicas (landing page)
app.get('/api/stats', (req, res) => {
  const users    = db.getUsers().filter(u => u.role !== 'admin');
  const courses  = db.getCourses();
  const progress = db.getProgress();
  res.json({
    alunos:   users.length,
    aulas:    courses.reduce((acc, c) => acc + (c.lessons ? c.lessons.length : 0), 0),
    projetos: progress.filter(p => p.completed).length,
  });
});

// Stats de cursos públicas (landing page)
app.get('/api/stats/courses', (req, res) => {
  const courses = db.getCourses()
    .filter(c => c.featured)
    .slice(0, 6)
    .map(c => ({
      id:           c.id,
      name:         c.name,
      shortDesc:    c.shortDesc,
      level:        c.level,
      emoji:        c.emoji,
      duration:     c.duration,
      lessonsCount: c.lessons ? c.lessons.length : 0,
      featured:     c.featured,
    }));
  res.json({ courses });
});

// SPA fallback — redireciona rotas não-API para o frontend
const p404local = path.join(__dirname, '..', 'frontend', 'public', 'pages', '404.html');
const p404alt   = path.join(__dirname, 'frontend', 'public', 'pages', '404.html');
const p404path  = require_fs.existsSync(p404local) ? p404local : p404alt;

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    // API route not matched above
    return res.status(404).json({ message: 'Rota não encontrada.' });
  }

  const indexLocal = path.join(__dirname, '..', 'frontend', 'public', 'index.html');
  const indexAlt   = path.join(__dirname, 'frontend', 'public', 'index.html');
  const indexPath  = require_fs.existsSync(indexLocal) ? indexLocal : indexAlt;

  const knownExtensions = ['.html', '.css', '.js', '.svg', '.ico', '.png', '.jpg', '.json', '.woff2', '.ttf', '.woff'];
  const ext = path.extname(req.path);
  const fileExists = require_fs.existsSync(path.join(staticPath, req.path));

  if (req.path === '/' || knownExtensions.includes(ext) || fileExists) {
    return res.sendFile(indexPath);
  }

  // Unknown route — serve 404 page with HTTP 404 status
  res.status(404).sendFile(p404path);
});

// ── Seed: cria admin padrão se não existir ────────────────
async function seedAdmin() {
  const users = db.getUsers();
  if (!users.find(u => u.role === 'admin')) {
    const hash = await bcrypt.hash('admin123', 10);
    users.push({
      id: uuid(),
      name: 'Administrador',
      email: 'admin@constructacademy.com',
      password: hash,
      role: 'admin',
      xp: 0, level: 1, streak: 0,
      createdAt: new Date().toISOString(),
    });
    db.saveUsers(users);
    console.log('✓ Admin padrão criado: admin@constructacademy.com / admin123');
  }
}

// ── Seed: cria trilha de exemplo se não existir ───────────
function seedCourse() {
  const courses = db.getCourses();
  if (courses.length === 0) {
    const courseId = uuid();
    const l1 = uuid(), l2 = uuid(), l3 = uuid(), l4 = uuid();
    courses.push({
      id:          courseId,
      name:        'Primeiros Passos no Construct 3',
      shortDesc:   'Interface, eventos básicos e seu primeiro jogo.',
      description: 'Aprenda do zero a criar projetos no Construct 3. Vamos cobrir a interface do editor, criação de sprites, lógica de eventos e exportação.',
      level:       'Iniciante',
      emoji:       '🎮',
      duration:    '~4h',
      featured:    true,
      lessons: [
        {
          id: l1, title: 'Conhecendo a interface do Construct 3',
          type: 'video', videoType: 'youtube',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          duration: '12m', requiredPercent: 80,
          description: 'Tour completo pela interface, abas principais e configurações iniciais.',
        },
        {
          id: l2, title: 'Atividade: Identifique os painéis',
          type: 'activity',
          activityTitle: 'Teste seus conhecimentos sobre a interface',
          questions: [
            {
              question: 'Qual painel exibe todos os objetos do projeto?',
              options: ['Layout', 'Project Bar', 'Event Sheet', 'Properties'],
              correctIndex: 1,
              explanation: 'A Project Bar (barra de projetos) lista todos os objetos, layouts e arquivos do projeto.',
            },
            {
              question: 'Onde você escreve a lógica do jogo no Construct 3?',
              options: ['Layout View', 'Event Sheet', 'Properties', 'Animations'],
              correctIndex: 1,
              explanation: 'O Event Sheet é onde toda a lógica é criada através de condições e ações.',
            },
            {
              question: 'O que é um "Layout" no Construct 3?',
              options: ['Um arquivo de som', 'Uma tela/fase do jogo', 'Um tipo de sprite', 'Um plugin externo'],
              correctIndex: 1,
              explanation: 'O Layout é equivalente a uma cena ou fase do seu jogo.',
            },
          ],
        },
        {
          id: l3, title: 'Criando seu primeiro sprite e movimento',
          type: 'video', videoType: 'youtube',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          duration: '18m', requiredPercent: 80,
          description: 'Importe imagens, crie animações básicas e adicione movimento com o teclado.',
        },
        {
          id: l4, title: 'Atividade: Sprite em movimento',
          type: 'activity',
          activityTitle: 'Lógica de eventos e movimento',
          questions: [
            {
              question: 'Qual behavior permite movimento 8 direções no Construct 3?',
              options: ['Platform', '8 Direction', 'Physics', 'Bullet'],
              correctIndex: 1,
              explanation: 'O behavior "8 Direction" habilita movimento em 8 direções usando o teclado.',
            },
            {
              question: 'O que é uma "condição" em um evento?',
              options: ['A ação executada', 'O gatilho que dispara a ação', 'Um tipo de objeto', 'Uma animação'],
              correctIndex: 1,
              explanation: 'A condição define QUANDO um evento deve ocorrer (ex: tecla pressionada, colisão).',
            },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    });
    db.saveCourses(courses);
    console.log('✓ Trilha de exemplo criada.');
  }
}

// ── Start ─────────────────────────────────────────────────
seedAdmin().then(() => {
  seedCourse();
  app.listen(PORT, () => {
    console.log(`\n🚀 Construct Academy rodando em http://localhost:${PORT}`);
    console.log(`   Admin: admin@constructacademy.com / admin123\n`);
  });
});
