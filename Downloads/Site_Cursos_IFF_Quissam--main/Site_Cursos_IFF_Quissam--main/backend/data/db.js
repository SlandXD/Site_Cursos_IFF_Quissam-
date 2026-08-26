/**
 * Camada de dados — armazena tudo em arquivos JSON locais.
 * Em produção, substitua por PostgreSQL/MongoDB.
 */
const fs   = require('fs');
const path = require('path');

const FILES = {
  users:    path.join(__dirname, 'users.json'),
  courses:  path.join(__dirname, 'courses.json'),
  progress: path.join(__dirname, 'progress.json'),
  activity: path.join(__dirname, 'activity_log.json'),
};

function read(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  // Users
  getUsers:   ()     => read(FILES.users),
  saveUsers:  (data) => write(FILES.users, data),

  // Courses
  getCourses:  ()     => read(FILES.courses),
  saveCourses: (data) => write(FILES.courses, data),

  // Progress
  getProgress:  ()     => read(FILES.progress),
  saveProgress: (data) => write(FILES.progress, data),

  // Activity log
  getActivityLog:  ()     => read(FILES.activity),
  saveActivityLog: (data) => write(FILES.activity, data),
};
