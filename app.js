/* ==========================================================================
   FOCUS — Student Growth System
   Main application script
   - Data lives in localStorage (key below)
   - Full CRUD for tasks, habits, goals, and journal entries
   - Optional GitHub backup/sync via js/github-sync.js
   ========================================================================== */
'use strict';

/* ---------- Constants & state ---------- */
const KEY = 'focus-student-growth-v2';
const LEGACY_KEY = 'levelup-os-v1';
const CATEGORIES = ['Study', 'Thinking', 'Health', 'Relationships', 'Personal', 'Projects'];
const STARTER_HABITS = [
  { name: 'Focused study', detail: 'One distraction-free learning session', symbol: '01' },
  { name: 'Active recall', detail: 'Recall an idea before checking notes', symbol: '02' },
  { name: 'Read or reflect', detail: 'Spend a few minutes learning something', symbol: '03' }
];
const COLLECTIONS = { task: 'tasks', habit: 'habits', goal: 'goals', journal: 'journal' };
const EMPTY_DB = () => ({ tasks: [], habits: [], goals: [], journal: [], reflections: {} });

let db = EMPTY_DB();
let storageAvailable = false;
let modalType = 'task';
let editId = null;
let toastTimer = null;
let lastFocused = null;

/* ---------- Utilities ---------- */
const $ = id => document.getElementById(id);
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clampPct = v => Math.max(0, Math.min(100, Number(v) || 0));
const today = dateKey();

function notify(message, isError = false) {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- Storage layer ---------- */
function setStorageStatus(ok, detail = '') {
  storageAvailable = ok;
  $('statusDot').classList.toggle('bad', !ok);
  $('storageTitle').textContent = ok ? 'Local storage ready' : 'Storage unavailable';
  $('storageText').textContent = ok ? 'Saved in this browser' : 'Changes may not persist';
  $('storageBanner').classList.toggle('show', !ok);
  $('settingsStorage').textContent = detail || (ok
    ? 'Browser storage is available. Your data remains on this browser and profile.'
    : 'Browser storage could not be accessed. Data may be lost when you refresh.');
  $('storagePill').textContent = ok ? 'AVAILABLE' : 'UNAVAILABLE';
  $('storagePill').style.color = ok ? 'var(--accent)' : 'var(--red)';
}

function canWriteStorage() {
  try {
    const k = KEY + '-test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}

// Turns any parsed object into a safe database shape.
function normalizeData(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    habits: Array.isArray(d.habits) ? d.habits : [],
    goals: Array.isArray(d.goals) ? d.goals : [],
    journal: Array.isArray(d.journal) ? d.journal : [],
    reflections: d.reflections && typeof d.reflections === 'object' && !Array.isArray(d.reflections) ? d.reflections : {}
  };
}

function load() {
  const ok = canWriteStorage();
  setStorageStatus(ok);
  if (!ok) { db = EMPTY_DB(); return; }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      db = normalizeData(JSON.parse(raw));
    } else {
      // One-time migration from the earlier LEVEL UP version (original data is not deleted).
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      db = legacyRaw ? normalizeData(JSON.parse(legacyRaw)) : EMPTY_DB();
      seedHabits(false);
      persist();
    }
  } catch (e) {
    db = EMPTY_DB();
    setStorageStatus(false, 'Could not read saved data. The stored value may be damaged or storage may be blocked. Export or recover a backup if you have one.');
  }
}

function persist() {
  if (!canWriteStorage()) { setStorageStatus(false); return false; }
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    setStorageStatus(true);
    return true;
  } catch (e) {
    setStorageStatus(false, 'The browser refused to save changes. Storage may be full or disabled. Export a backup if possible.');
    return false;
  }
}

function seedHabits(save = true) {
  const names = new Set(db.habits.map(h => String(h.name || '').toLowerCase()));
  STARTER_HABITS.forEach(h => {
    if (!names.has(h.name.toLowerCase())) db.habits.push({ ...h, id: uid(), checks: {}, created: Date.now() });
  });
  if (save) persist();
}

/* ---------- Navigation ---------- */
const VIEW_COPY = {
  dashboard: ['Make room for what matters.', 'A clear plan for learning, building useful habits, and moving forward one step at a time.', 'OVERVIEW'],
  tasks: ['Tasks', 'Capture work, choose a priority, and make the next action clear.', 'TASKS'],
  habits: ['Habits', 'Make good actions small enough to repeat on ordinary days.', 'HABITS'],
  goals: ['Goals', 'Turn a broad ambition into a clear next step.', 'GOALS'],
  journal: ['Journal', 'Keep useful lessons, questions, and reflections in one place.', 'JOURNAL'],
  toolkit: ['Student toolkit', 'Practical methods for learning and thinking. Use what helps; ignore what doesn’t.', 'TOOLKIT'],
  settings: ['Data & settings', 'Your information is stored locally in this browser. Optionally back it up to GitHub.', 'DATA']
};

function switchView(view) {
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const data = VIEW_COPY[view] || ['FOCUS', '', 'OVERVIEW'];
  $('pageTitle').textContent = data[0];
  $('pageSubtitle').textContent = data[1];
  $('topSection').textContent = data[2];
  if (view === 'tasks') renderTasks();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) switchView(b.dataset.view);
});
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.goto)));

/* ---------- Form schema & modal (Create / Update) ---------- */
const FIELD = (name, label, type = 'text', opts = {}) => ({ name, label, type, ...opts });

function fieldHTML(f, value = '') {
  const full = f.full ? ' full' : '';
  const required = f.required ? ' required' : '';
  const placeholder = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const id = `field-${f.name}`;
  let control = '';
  if (f.type === 'textarea') {
    control = `<textarea id="${id}" name="${f.name}"${required}${placeholder} maxlength="${f.maxlength || 4000}">${esc(value)}</textarea>`;
  } else if (f.type === 'select') {
    control = `<select id="${id}" name="${f.name}"${required}>${f.options.map(o =>
      `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else {
    control = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(value)}"${required}${placeholder}` +
      `${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}` +
      `${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.step ? ` step="${f.step}"` : ''}>`;
  }
  return `<div class="form-field${full}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${control}</div>`;
}

function schema(type) {
  const categoryOptions = CATEGORIES.map(x => ({ value: x, label: x }));
  if (type === 'task') return [
    FIELD('title', 'Task title', 'text', { required: true, full: true, placeholder: 'e.g. Review algebra notes', maxlength: 200 }),
    FIELD('category', 'Area', 'select', { options: categoryOptions, required: true }),
    FIELD('priority', 'Priority', 'select', { options: ['High', 'Medium', 'Low'].map(x => ({ value: x, label: x })), required: true }),
    FIELD('due', 'Due date', 'date'),
    FIELD('minutes', 'Estimated minutes', 'number', { min: 0, max: 1440, placeholder: '25' }),
    FIELD('notes', 'Notes / next action', 'textarea', { full: true, placeholder: 'What exactly needs to be done?' })
  ];
  if (type === 'habit') return [
    FIELD('name', 'Habit name', 'text', { required: true, full: true, placeholder: 'e.g. Recall what I learned', maxlength: 120 }),
    FIELD('detail', 'Small version of the habit', 'text', { full: true, placeholder: 'Make it easy to start', maxlength: 200 }),
    FIELD('symbol', 'Short label', 'text', { placeholder: '01', maxlength: 4 })
  ];
  if (type === 'goal') return [
    FIELD('title', 'Goal', 'text', { required: true, full: true, placeholder: 'e.g. Understand algebra deeply', maxlength: 200 }),
    FIELD('category', 'Area', 'select', { options: categoryOptions, required: true }),
    FIELD('due', 'Target date', 'date'),
    FIELD('progress', 'Progress (%)', 'number', { min: 0, max: 100, step: 1 }),
    FIELD('next', 'Next concrete step', 'text', { full: true, placeholder: 'What can you do next?', maxlength: 300 }),
    FIELD('notes', 'Why it matters / plan', 'textarea', { full: true })
  ];
  return [
    FIELD('title', 'Entry title', 'text', { required: true, full: true, placeholder: 'A question, lesson, or reflection', maxlength: 200 }),
    FIELD('category', 'Type', 'select', { options: ['Learning', 'Reflection', 'Idea', 'Question'].map(x => ({ value: x, label: x })), required: true }),
    FIELD('body', 'Entry', 'textarea', { full: true, required: true, placeholder: 'Write what you want to remember…' })
  ];
}

function collection(type) { return db[COLLECTIONS[type]]; }

function openModal(type, id = null) {
  modalType = type;
  editId = id;
  lastFocused = document.activeElement;
  const old = id ? collection(type).find(x => x.id === id) : null;
  const titles = { task: 'task', habit: 'habit', goal: 'goal', journal: 'journal entry' };
  $('modalTitle').textContent = (old ? 'Edit ' : 'Create ') + titles[type];
  $('modalIntro').textContent = old ? 'Update the details, then save your changes.' : 'Keep it specific and useful. You can edit this later.';
  $('submitModal').textContent = old ? 'Save changes' : 'Create ' + (type === 'journal' ? 'entry' : type);
  const defaults = {
    task: { category: 'Study', priority: 'Medium', minutes: 25 },
    habit: { symbol: '+' },
    goal: { category: 'Study', progress: 0 },
    journal: { category: 'Learning' }
  };
  const values = old ? { ...old } : defaults[type];
  $('formFields').innerHTML = schema(type).map(f => fieldHTML(f, values[f.name] ?? '')).join('');
  $('formError').classList.remove('show');
  $('formError').textContent = '';
  $('modalWrap').classList.add('show');
  document.body.style.overflow = 'hidden';
  const first = $('formFields').querySelector('input,select,textarea');
  if (first) first.focus();
}

function closeModal() {
  $('modalWrap').classList.remove('show');
  document.body.style.overflow = '';
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

function showFormError(message) {
  $('formError').textContent = message;
  $('formError').classList.add('show');
}

$('cancelModal').addEventListener('click', closeModal);
$('modalWrap').addEventListener('click', e => { if (e.target === $('modalWrap')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modalWrap').classList.contains('show')) closeModal(); });

$('modalForm').addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget).entries());
  const arr = collection(modalType);
  const existing = editId ? arr.find(x => x.id === editId) : null;
  const obj = { ...existing, ...data, id: editId || uid(), created: existing?.created || Date.now() };

  if (modalType === 'task') {
    if (!String(obj.title).trim()) return showFormError('Add a task title before saving.');
    obj.title = obj.title.trim();
    obj.minutes = Math.max(0, Number(data.minutes || 0));
    obj.done = !!existing?.done;
    obj.doneDate = existing?.doneDate || null;
  } else if (modalType === 'habit') {
    if (!String(obj.name).trim()) return showFormError('Add a habit name before saving.');
    obj.name = obj.name.trim();
    obj.symbol = (data.symbol || '+').slice(0, 4);
    obj.checks = existing?.checks || {};
  } else if (modalType === 'goal') {
    if (!String(obj.title).trim()) return showFormError('Add a goal before saving.');
    obj.title = obj.title.trim();
    obj.progress = clampPct(data.progress);
  } else {
    if (!String(obj.title).trim()) return showFormError('Add an entry title before saving.');
    if (!String(obj.body).trim()) return showFormError('Write at least a short entry before saving.');
    obj.title = obj.title.trim();
    obj.updated = Date.now();
  }

  const index = existing ? arr.findIndex(x => x.id === editId) : -1;
  if (existing) arr[index] = obj; else arr.unshift(obj);

  if (!persist()) {
    // Roll back the in-memory change so the UI never pretends an unsaved change is safe.
    if (existing) arr[index] = existing; else arr.splice(arr.findIndex(x => x.id === obj.id), 1);
    showFormError('Could not save to this browser. Your form is still open; copy your text before closing it. Check storage availability in Data & settings.');
    return;
  }
  closeModal();
  renderAll();
  notify(existing ? 'Changes saved' : 'Item created');
});

/* ---------- Rendering (Read) ---------- */
function emptyHTML(title, desc, button = '') {
  return `<div class="empty"><strong>${title}</strong>${desc}${button}</div>`;
}

function taskHTML(t) {
  const due = t.due
    ? `<span>${t.due === today ? 'Due today' : t.due < today ? 'Overdue · ' + esc(t.due) : 'Due ' + esc(t.due)}</span>`
    : '';
  const priority = ['High', 'Medium', 'Low'].includes(t.priority) ? t.priority : 'Medium';
  return `<div class="task-row ${t.done ? 'done' : ''}">
    <input class="task-check" type="checkbox" aria-label="Mark ${esc(t.title)} complete" ${t.done ? 'checked' : ''} data-action="toggle-task" data-id="${esc(t.id)}">
    <div class="task-copy"><div class="task-title">${esc(t.title)}</div><div class="task-meta"><span class="pill">${esc(t.category || 'Personal')}</span><span class="pill ${priority.toLowerCase()}">${priority} priority</span>${due}${t.minutes ? `<span>${Number(t.minutes)} min</span>` : ''}</div>${t.notes ? `<div class="panel-description" style="margin-top:7px;white-space:pre-wrap">${esc(t.notes)}</div>` : ''}</div>
    <div class="row-actions"><button class="icon-btn" title="Edit task" aria-label="Edit task" data-action="edit-task" data-id="${esc(t.id)}">↗</button><button class="icon-btn" title="Delete task" aria-label="Delete task" data-action="delete-task" data-id="${esc(t.id)}">×</button></div>
  </div>`;
}

function habitHTML(h, compact = false) {
  const done = !!h.checks?.[today];
  return `<div class="habit-row"><div class="habit-symbol">${esc(h.symbol || '+')}</div><div class="habit-copy"><strong>${esc(h.name)}</strong><small>${esc(h.detail || '')}</small></div><button class="btn btn-small habit-check ${done ? 'checked' : ''}" data-action="toggle-habit" data-id="${esc(h.id)}">${done ? '✓ Done' : 'Check in'}</button>${compact ? '' : `<button class="icon-btn" title="Edit habit" aria-label="Edit habit" data-action="edit-habit" data-id="${esc(h.id)}">↗</button><button class="icon-btn" title="Delete habit" aria-label="Delete habit" data-action="delete-habit" data-id="${esc(h.id)}">×</button>`}</div>`;
}

function goalHTML(g) {
  const pct = clampPct(g.progress);
  return `<article class="goal-card"><div class="card-top"><div><h3>${esc(g.title)}</h3><span class="pill">${esc(g.category || 'Personal')}</span>${g.due ? ` <span class="journal-date">Target ${esc(g.due)}</span>` : ''}</div><div class="row-actions"><button class="icon-btn" title="Edit goal" aria-label="Edit goal" data-action="edit-goal" data-id="${esc(g.id)}">↗</button><button class="icon-btn" title="Delete goal" aria-label="Delete goal" data-action="delete-goal" data-id="${esc(g.id)}">×</button></div></div>${g.notes ? `<p class="card-description">${esc(g.notes)}</p>` : ''}${g.next ? `<div class="goal-next"><strong>Next:</strong> ${esc(g.next)}</div>` : ''}<div class="goal-progress"><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div><strong>${pct}%</strong><button class="icon-btn" title="Decrease progress" aria-label="Decrease progress" data-action="goal-minus" data-id="${esc(g.id)}">−</button><button class="icon-btn" title="Increase progress" aria-label="Increase progress" data-action="goal-plus" data-id="${esc(g.id)}">＋</button></div></article>`;
}

function renderTasks() {
  const search = ($('taskSearch')?.value || '').toLowerCase().trim();
  const filter = $('taskFilter')?.value || 'all';
  const cat = $('taskCategory')?.value || 'all';
  const rank = { High: 0, Medium: 1, Low: 2 };

  const tasks = db.tasks.filter(t => {
    const text = (t.title + ' ' + (t.notes || '')).toLowerCase().includes(search);
    const match = filter === 'all'
      || (filter === 'open' && !t.done)
      || (filter === 'done' && t.done)
      || (filter === 'today' && t.due === today && !t.done)
      || (filter === 'overdue' && !!t.due && t.due < today && !t.done);
    return text && match && (cat === 'all' || t.category === cat);
  }).sort((a, b) =>
    (Number(a.done) - Number(b.done))
    || ((a.due || '9999').localeCompare(b.due || '9999'))
    || ((rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)));

  $('taskList').innerHTML = tasks.length
    ? tasks.map(taskHTML).join('')
    : emptyHTML('Nothing here right now',
        search || filter !== 'all' || cat !== 'all' ? 'Try changing your filters or add a new task.' : 'Add your first task to turn a plan into action.',
        '<button class="btn btn-primary" data-action="add-task">＋ Add task</button>');

  const due = db.tasks.filter(t => !t.done && t.due === today);
  const overdue = db.tasks.filter(t => !t.done && t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const priority = [...overdue, ...due].slice(0, 5);

  $('dashboardTasks').innerHTML = priority.length
    ? priority.map(taskHTML).join('')
    : emptyHTML('No urgent tasks', 'Nothing is due today or overdue. Add a task when you are ready.', '<button class="btn btn-small" data-action="add-task">＋ Add task</button>');

  const total = due.length + overdue.length;
  const doneToday = db.tasks.filter(t => t.done && t.doneDate === today).length;
  $('todayCount').textContent = `${Math.min(doneToday, total)} / ${total}`;
  $('todayProgress').style.width = (total ? Math.min(100, doneToday / total * 100) : 0) + '%';
  $('focusHeading').textContent = priority.length ? priority[0].title : 'Start with one useful action.';
  $('focusDescription').textContent = priority.length
    ? 'Your next priority is ready. Focus on finishing the next concrete step, then choose what comes next.'
    : 'Choose a task that moves something important forward. You do not need to fix everything today.';
  $('statLeft').textContent = db.tasks.filter(t => !t.done).length;
}

function renderHabits() {
  $('habitList').innerHTML = db.habits.length
    ? db.habits.map(h => habitHTML(h)).join('')
    : emptyHTML('No habits yet', 'Add one small habit that supports your studies or wellbeing.', '<button class="btn btn-primary" data-action="add-habit">＋ Add habit</button>');
  $('dashboardHabits').innerHTML = db.habits.slice(0, 4).map(h => habitHTML(h, true)).join('')
    || emptyHTML('Keep it simple', 'Start with one habit you can repeat.');
  const hit = db.habits.filter(h => h.checks?.[today]).length;
  $('statHabits').textContent = `${hit} / ${db.habits.length}`;
  $('habitSummary').textContent = `${hit} OF ${db.habits.length} DONE TODAY`;
}

function renderGoals() {
  const active = db.goals.filter(g => clampPct(g.progress) < 100);
  $('goalList').innerHTML = db.goals.length
    ? db.goals.map(goalHTML).join('')
    : emptyHTML('Give a goal a clear direction', 'Start with something meaningful, then define the next concrete step.', '<button class="btn btn-primary" data-action="add-goal">＋ Add goal</button>');
  $('dashboardGoals').innerHTML = active.slice(0, 2).map(g => {
    const pct = clampPct(g.progress);
    return `<div style="padding:10px 0;border-bottom:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px"><strong style="font-size:12px;overflow-wrap:anywhere">${esc(g.title)}</strong><span style="font-size:11px;color:var(--accent)">${Math.round(pct)}%</span></div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;
  }).join('') || emptyHTML('No active goals', 'Add one goal if it helps you choose what matters.');
  $('statGoals').textContent = active.length;
}

function renderJournal() {
  $('journalList').innerHTML = db.journal.length
    ? db.journal.slice().sort((a, b) => (b.updated || b.created) - (a.updated || a.created)).map(j =>
        `<article class="journal-card"><div class="card-top"><div><h3>${esc(j.title)}</h3><div class="journal-date">${esc(j.category || 'Reflection')} · ${new Date(j.updated || j.created).toLocaleDateString()}</div></div><div class="row-actions"><button class="icon-btn" title="Edit entry" aria-label="Edit entry" data-action="edit-journal" data-id="${esc(j.id)}">↗</button><button class="icon-btn" title="Delete entry" aria-label="Delete entry" data-action="delete-journal" data-id="${esc(j.id)}">×</button></div></div><p class="journal-body">${esc(j.body)}</p></article>`).join('')
    : emptyHTML('Make space to think', 'Save a useful lesson, question, or short reflection.', '<button class="btn btn-primary" data-action="add-journal">＋ New entry</button>');
}

function renderAll() {
  renderTasks();
  renderHabits();
  renderGoals();
  renderJournal();
  const r = db.reflections[today] || '';
  if (document.activeElement !== $('quickReflection')) $('quickReflection').value = r;
}

/* ---------- Update / Delete actions ---------- */
function toggleTask(id) {
  const t = db.tasks.find(x => x.id === id);
  if (!t) return;
  const prev = { done: t.done, doneDate: t.doneDate };
  t.done = !t.done;
  t.doneDate = t.done ? today : null;
  if (!persist()) {
    t.done = prev.done; t.doneDate = prev.doneDate;
    renderAll();
    notify('Could not save this change. Check browser storage.', true);
    return;
  }
  renderAll();
  notify(t.done ? 'Task completed' : 'Task reopened');
}

function toggleHabit(id) {
  const h = db.habits.find(x => x.id === id);
  if (!h) return;
  h.checks = h.checks || {};
  const was = !!h.checks[today];
  if (was) delete h.checks[today]; else h.checks[today] = true;
  if (!persist()) {
    if (was) h.checks[today] = true; else delete h.checks[today];
    notify('Could not save this change. Check browser storage.', true);
    return;
  }
  renderAll();
}

function deleteItem(type, id) {
  const arr = db[COLLECTIONS[type]];
  const i = arr.findIndex(x => x.id === id);
  if (i < 0) return;
  const label = { task: 'task', habit: 'habit', goal: 'goal', journal: 'journal entry' }[type];
  if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
  const removed = arr[i];
  arr.splice(i, 1);
  if (!persist()) {
    arr.splice(i, 0, removed);
    notify('Could not save this change. Check browser storage.', true);
    return;
  }
  renderAll();
  notify('Item deleted');
}

function updateGoal(id, delta) {
  const g = db.goals.find(x => x.id === id);
  if (!g) return;
  const prev = g.progress;
  g.progress = clampPct((Number(g.progress) || 0) + delta);
  if (!persist()) {
    g.progress = prev;
    notify('Could not save this change. Check browser storage.', true);
    return;
  }
  renderAll();
  notify('Goal progress updated');
}

/* ---------- Event wiring ---------- */
document.body.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action, id } = b.dataset;
  const actions = {
    'add-task': () => openModal('task'), 'add-habit': () => openModal('habit'),
    'add-goal': () => openModal('goal'), 'add-journal': () => openModal('journal'),
    'edit-task': () => openModal('task', id), 'edit-habit': () => openModal('habit', id),
    'edit-goal': () => openModal('goal', id), 'edit-journal': () => openModal('journal', id),
    'delete-task': () => deleteItem('task', id), 'delete-habit': () => deleteItem('habit', id),
    'delete-goal': () => deleteItem('goal', id), 'delete-journal': () => deleteItem('journal', id),
    'toggle-task': () => toggleTask(id), 'toggle-habit': () => toggleHabit(id),
    'goal-plus': () => updateGoal(id, 10), 'goal-minus': () => updateGoal(id, -10)
  };
  if (actions[action]) actions[action]();
});

['quickAdd', 'focusAdd', 'addTask'].forEach(id => $(id).addEventListener('click', () => openModal('task')));
['addHabit', 'addHabitDashboard'].forEach(id => $(id).addEventListener('click', () => openModal('habit')));
$('addGoal').addEventListener('click', () => openModal('goal'));
$('addEntry').addEventListener('click', () => openModal('journal'));
['taskSearch', 'taskFilter', 'taskCategory'].forEach(id =>
  $(id).addEventListener(id === 'taskSearch' ? 'input' : 'change', renderTasks));

$('saveReflection').addEventListener('click', () => {
  const had = Object.prototype.hasOwnProperty.call(db.reflections, today);
  const old = db.reflections[today];
  db.reflections[today] = $('quickReflection').value;
  if (!persist()) {
    if (had) db.reflections[today] = old; else delete db.reflections[today];
    $('reflectionStatus').textContent = 'Could not save. Copy your reflection before leaving.';
    notify('Reflection was not saved.', true);
    return;
  }
  $('reflectionStatus').textContent = 'Saved just now in this browser.';
  notify('Reflection saved');
});

/* ---------- Data: export / import / restore / clear ---------- */
function exportPayload() {
  return { version: 2, exportedAt: new Date().toISOString(), ...db };
}

// Validates a parsed backup and returns a clean db object, or throws.
function parseBackup(d) {
  if (!d || typeof d !== 'object') throw new Error('Invalid format');
  for (const k of ['tasks', 'habits', 'goals', 'journal']) if (!Array.isArray(d[k])) throw new Error('Invalid format');
  return normalizeData(d);
}

function replaceData(next) {
  const prev = db;
  db = next;
  if (!persist()) { db = prev; throw new Error('Storage unavailable'); }
  renderAll();
}

$('exportData').addEventListener('click', () => {
  try {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'focus-backup-' + today + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Backup exported');
  } catch (e) { notify('Could not create a backup in this browser.', true); }
});

$('importData').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const next = parseBackup(JSON.parse(await f.text()));
    if (!confirm('Replace all current data with this backup?')) { e.target.value = ''; return; }
    replaceData(next);
    notify('Backup imported');
  } catch (err) { notify('Import failed. Choose a valid FOCUS JSON backup.', true); }
  e.target.value = '';
});

$('restoreHabits').addEventListener('click', () => {
  const before = db.habits.length;
  seedHabits(false);
  if (db.habits.length === before) { notify('Starter habits are already in your list.'); return; }
  if (!persist()) { db.habits.splice(before); notify('Could not save starter habits.', true); return; }
  renderAll();
  notify('Starter habits added');
});

$('clearData').addEventListener('click', () => {
  if (!confirm('Delete all FOCUS data saved in this browser? Export a backup first if you may need it.')) return;
  const prev = db;
  db = EMPTY_DB();
  if (!persist()) { db = prev; notify('Could not clear data because storage is unavailable.', true); return; }
  renderAll();
  notify('Local data cleared');
});

/* ---------- GitHub sync UI ---------- */
function ghFormConfig() {
  return {
    owner: $('ghOwner').value,
    repo: $('ghRepo').value,
    branch: $('ghBranch').value,
    path: $('ghPath').value,
    token: $('ghToken').value,
    remember: $('ghRemember').checked
  };
}

function ghFillForm(cfg) {
  $('ghOwner').value = cfg.owner || '';
  $('ghRepo').value = cfg.repo || '';
  $('ghBranch').value = cfg.branch || 'main';
  $('ghPath').value = cfg.path || 'focus-data.json';
  $('ghToken').value = cfg.token || '';
  $('ghRemember').checked = !!cfg.remember;
}

function ghStatus(message, kind = '') {
  const el = $('ghStatus');
  el.textContent = message;
  el.className = 'gh-status' + (kind ? ' ' + kind : '');
}

function ghPill(connected) {
  const pill = $('ghPill');
  pill.textContent = connected ? 'CONNECTED' : 'NOT CONNECTED';
  pill.style.color = connected ? 'var(--accent)' : '';
}

function ghBusy(busy) {
  ['ghSave', 'ghTest', 'ghPush', 'ghPull', 'ghForget'].forEach(id => { $(id).disabled = busy; });
}

// Reads, validates, and saves the form. Returns the cleaned config or null.
function ghCommitForm() {
  const cfg = window.GitHubSync.saveConfig(ghFormConfig());
  ghFillForm(cfg);
  const problem = window.GitHubSync.validate(cfg);
  if (problem) { ghStatus(problem, 'err'); ghPill(false); return null; }
  return cfg;
}

async function ghRun(label, task) {
  const cfg = ghCommitForm();
  if (!cfg) return;
  ghBusy(true);
  ghStatus(label + '…');
  try {
    await task(cfg);
  } catch (err) {
    ghStatus(err.message || 'Something went wrong.', 'err');
    ghPill(false);
  } finally {
    ghBusy(false);
  }
}

function initGitHubUI() {
  if (!window.GitHubSync) {
    $('githubPanel').style.display = 'none';
    return;
  }
  const cfg = window.GitHubSync.loadConfig();
  ghFillForm(cfg);
  if (window.GitHubSync.validate(cfg) === '') ghStatus('Settings loaded. Choose “Test connection” to verify them.');

  $('ghForm').addEventListener('submit', e => e.preventDefault());

  $('ghSave').addEventListener('click', () => {
    const saved = window.GitHubSync.saveConfig(ghFormConfig());
    ghFillForm(saved);
    notify('GitHub settings saved');
    ghStatus(window.GitHubSync.validate(saved) ? 'Saved. Some details are still missing: ' + window.GitHubSync.validate(saved) : 'Settings saved. Choose “Test connection” to verify them.');
  });

  $('ghTest').addEventListener('click', () => ghRun('Testing connection', async cfg => {
    const info = await window.GitHubSync.testConnection(cfg);
    ghPill(true);
    ghStatus(`Connected to ${info.fullName} (${info.isPrivate ? 'private' : 'public'}). ` +
      (info.canPush ? 'The token can write to this repository.' : 'Warning: the token may not have write access.'), info.canPush ? 'ok' : 'err');
  }));

  $('ghPush').addEventListener('click', () => ghRun('Pushing to GitHub', async cfg => {
    const result = await window.GitHubSync.push(cfg, exportPayload());
    ghPill(true);
    ghStatus((result.created ? 'Created ' : 'Updated ') + cfg.path + ' on ' + cfg.branch + ' at ' + new Date().toLocaleTimeString() + '.', 'ok');
    notify('Pushed to GitHub');
  }));

  $('ghPull').addEventListener('click', () => ghRun('Pulling from GitHub', async cfg => {
    const remote = await window.GitHubSync.pull(cfg);
    if (remote === null) { ghStatus('No file named ' + cfg.path + ' exists on ' + cfg.branch + ' yet. Push first to create it.', 'err'); return; }
    const next = parseBackup(remote);
    if (!confirm('Replace all current data in this browser with the version from GitHub?')) { ghStatus('Pull cancelled. Your local data was not changed.'); return; }
    replaceData(next);
    ghPill(true);
    ghStatus('Pulled ' + cfg.path + ' from ' + cfg.branch + ' at ' + new Date().toLocaleTimeString() + '.', 'ok');
    notify('Pulled from GitHub');
  }));

  $('ghForget').addEventListener('click', () => {
    if (!confirm('Forget the saved GitHub settings and token in this browser? Your app data is not affected.')) return;
    window.GitHubSync.clearConfig();
    ghFillForm(window.GitHubSync.DEFAULTS);
    ghPill(false);
    ghStatus('GitHub settings removed from this browser.');
    notify('GitHub settings forgotten');
  });
}

/* ---------- Init ---------- */
$('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
load();
renderAll();
initGitHubUI();