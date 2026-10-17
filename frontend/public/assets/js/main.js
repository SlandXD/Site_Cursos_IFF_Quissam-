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
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  // Constrói sem innerHTML para evitar injeção de HTML
  const iconSpan = document.createElement('span');
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icons[type] || '✓';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = msg; // textContent é sempre seguro

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
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
  window.addNotification && window.addNotification(`+${xp} XP ganhos`, 'success');
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

// ── Notification system ────────────────────────────────────
const NOTIF_KEY = 'ca_notifications';
window.addNotification = (msg, type = 'info') => {
  const notifs = JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]');
  notifs.unshift({ id: Date.now(), msg, type, read: false, createdAt: new Date().toISOString() });
  if (notifs.length > 50) notifs.length = 50;
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs));
  updateBellBadge();
};
function getNotifications() {
  return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]');
}
function updateBellBadge() {
  const badge = document.getElementById('bellBadge');
  if (!badge) return;
  const unread = getNotifications().filter(n => !n.read).length;
  badge.textContent = unread;
  badge.style.display = unread > 0 ? 'flex' : 'none';
}
window.initBell = () => {
  updateBellBadge();
  const bell = document.getElementById('bellBtn');
  if (!bell) return;
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    let panel = document.getElementById('notifPanel');
    if (panel) { panel.remove(); return; }
    const notifs = getNotifications();
    // Mark all as read
    notifs.forEach(n => n.read = true);
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs));
    updateBellBadge();
    const last10 = notifs.slice(0, 10);
    panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.style.cssText = `position:absolute;top:52px;right:0;width:300px;
      background:var(--surface);border:1px solid var(--border2);border-radius:12px;
      box-shadow:var(--shadow);z-index:200;overflow:hidden`;
    panel.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:.85rem;font-weight:700">
        Notificações
      </div>
      <div style="max-height:320px;overflow-y:auto">
        ${last10.length === 0
          ? '<div style="padding:24px;text-align:center;color:var(--text3);font-size:.83rem">Nenhuma notificação</div>'
          : last10.map(n => `
            <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:.82rem;line-height:1.5">
              <div>${n.msg}</div>
              <div style="font-size:.72rem;color:var(--text3);margin-top:3px">
                ${new Date(n.createdAt).toLocaleString('pt-BR')}
              </div>
            </div>`).join('')}
      </div>
    `;
    bell.parentElement.style.position = 'relative';
    bell.parentElement.appendChild(panel);
    document.addEventListener('click', () => panel?.remove(), { once: true });
  });
};
