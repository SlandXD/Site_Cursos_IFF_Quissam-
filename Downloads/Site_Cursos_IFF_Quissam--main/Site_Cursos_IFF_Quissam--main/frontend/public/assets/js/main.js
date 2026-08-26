/* ============================================================
   CONSTRUCT ACADEMY — MAIN JS
   ============================================================ */

// ── Navbar scroll ──────────────────────────────────────────
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  });
}

// ── Mobile nav toggle ──────────────────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.querySelector('.nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
}

// ── Counter animation ──────────────────────────────────────
function animateCounter(el, target, suffix = '') {
  let current = 0;
  const step = Math.ceil(target / 60);
  const timer = setInterval(() => {
    current += step;
    if (current >= target) { current = target; clearInterval(timer); }
    el.textContent = current.toLocaleString('pt-BR') + suffix;
  }, 24);
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const target = parseInt(el.dataset.target, 10);
    animateCounter(el, target);
    observer.unobserve(el);
  });
}, { threshold: .3 });

document.querySelectorAll('[data-target]').forEach(el => observer.observe(el));

// Inicializar contadores do hero via API
const initHeroStats = async () => {
  const countAlunos   = document.getElementById('count-alunos');
  const countAulas    = document.getElementById('count-aulas');
  const countProjetos = document.getElementById('count-projetos');
  if (!countAlunos) return;

  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    countAlunos.dataset.target   = data.alunos   || 320;
    countAulas.dataset.target    = data.aulas     || 34;
    countProjetos.dataset.target = data.projetos  || 180;
  } catch {
    countAlunos.dataset.target   = 320;
    countAulas.dataset.target    = 34;
    countProjetos.dataset.target = 180;
  }
  [countAlunos, countAulas, countProjetos].forEach(el => observer.observe(el));
};
initHeroStats();

// ── Toast system ───────────────────────────────────────────
window.showToast = (msg, type = 'success') => {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '✓'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
};

// ── API helper ─────────────────────────────────────────────
window.API = {
  base: '/api',
  token: () => localStorage.getItem('ca_token'),

  async req(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.base + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro na requisição');
    return data;
  },

  get(path)        { return this.req('GET',    path); },
  post(path, body) { return this.req('POST',   path, body); },
  put(path, body)  { return this.req('PUT',    path, body); },
  del(path)        { return this.req('DELETE', path); },
};

// ── Auth guard (pages que precisam de login) ───────────────
window.requireAuth = () => {
  if (!localStorage.getItem('ca_token')) {
    window.location.href = '/pages/login.html';
    return false;
  }
  return true;
};

// ── XP gained popup ────────────────────────────────────────
window.showXPGain = (xp) => {
  const div = document.createElement('div');
  div.className = 'xp-gained';
  div.textContent = `+${xp} XP`;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity .4s, transform .4s';
    div.style.opacity = '0';
    div.style.transform = 'translateY(-24px)';
    setTimeout(() => div.remove(), 400);
  }, 1800);
};

// ── Progress ring helper ────────────────────────────────────
window.buildProgressRing = (container, percent, size = 60, stroke = 5) => {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  container.innerHTML = `
    <svg width="${size}" height="${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none"
        stroke="var(--border)" stroke-width="${stroke}" />
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none"
        stroke="var(--accent)" stroke-width="${stroke}"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
        stroke-linecap="round"
        style="transition:stroke-dashoffset .6s ease" />
    </svg>
    <span class="progress-ring-text">${Math.round(percent)}%</span>
  `;
};
