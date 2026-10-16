/**
 * Migração única: lê os 4 arquivos JSON antigos e carrega no SQLite
 * (academy.db) via as funções públicas save* do db.js.
 *
 * Idempotente: re-executar sobrescreve o estado do banco a partir dos JSONs
 * (fonte da verdade desta migração), sem duplicar dados — cada save* é uma
 * substituição completa da tabela.
 *
 * Uso (a partir de backend/):
 *   node data/migrate.js
 *
 * Os arquivos JSON são mantidos no disco como backup após a migração.
 */
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo de origem ausente: ${file} (${label}) — abortando para não migrar dados parciais.`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Falha ao analisar ${file} (${label}): ${err.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`${file} (${label}) não é um array`);
  }
  return data;
}

const dir      = __dirname;
const users    = readJson(path.join(dir, 'users.json'),         'users');
const courses  = readJson(path.join(dir, 'courses.json'),       'courses');
const progress = readJson(path.join(dir, 'progress.json'),      'progress');
const log      = readJson(path.join(dir, 'activity_log.json'),  'activity_log');

console.log('Migrando JSON -> SQLite (academy.db)...');
console.log(`  origem: users=${users.length} courses=${courses.length} progress=${progress.length} activity_log=${log.length}`);

db.saveUsers(users);
db.saveCourses(courses);
db.saveProgress(progress);
db.saveActivityLog(log);

console.log(`  banco:  users=${db.getUsers().length} courses=${db.getCourses().length} progress=${db.getProgress().length} activity_log=${db.getActivityLog().length}`);
console.log('Migração concluída.');
