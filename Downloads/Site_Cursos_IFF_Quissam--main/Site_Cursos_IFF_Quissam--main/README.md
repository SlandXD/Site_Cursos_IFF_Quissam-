# Construct Academy

Plataforma de cursos sobre Construct 3 com sistema de progresso sequencial.

## Instalação e uso

```bash
cd backend
npm install
npm start
```

Acesse: http://localhost:3000

## Credenciais padrão do admin

- **E-mail:** admin@constructacademy.com
- **Senha:** admin123

> Altere a senha assim que fizer o primeiro acesso!

## Estrutura

```
backend/
  server.js          — Servidor principal
  routes/            — Rotas da API
  middleware/        — Auth JWT
  data/              — Banco de dados em JSON
frontend/
  public/
    index.html       — Landing page
    pages/           — Todas as páginas
    assets/          — CSS e JS
```

## Funcionalidades

- Site principal com landing page
- Cadastro e login de alunos (JWT)
- Sistema de progresso sequencial (vídeo → atividade → próxima aula)
- Player de vídeo com rastreamento de progresso
- Atividades/quizzes pós-vídeo com feedback imediato
- Sistema de XP e níveis
- Badges de conquistas
- Certificados de conclusão (imprimíveis)
- Painel admin completo (criar trilhas, aulas, gerenciar alunos)
- Streak de dias consecutivos
