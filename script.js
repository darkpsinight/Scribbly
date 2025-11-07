const STORAGE_KEY = 'scribbly.notes';
const LAST_SELECTED_KEY = 'scribbly.lastSelected';

const els = {
  newNoteBtn: document.getElementById('newNoteBtn'),
  notesList: document.getElementById('notesList'),
  noteTitle: document.getElementById('noteTitle'),
  noteContent: document.getElementById('noteContent'),
  searchInput: document.getElementById('searchInput'),
  status: document.getElementById('status'),
  infoBtn: document.getElementById('infoBtn'),
  contextMenu: document.getElementById('contextMenu'),
  contextPin: document.getElementById('contextPin'),
  contextDelete: document.getElementById('contextDelete'),
  editDateBtn: document.getElementById('editDateBtn'),
  aboutModal: document.getElementById('aboutModal'),
  aboutClose: document.getElementById('aboutClose'),
};

const state = {
  notes: [],
  currentNoteId: null,
  filter: '',
  dirty: false,
  contextTargetId: null,
};

function loadNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const notes = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(notes)) return [];
    return notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (_) {
    return [];
  }
}

function saveNotes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
}

function generateId() {
  return 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function setStatus(text) {
  els.status.textContent = text || '';
}

function renderNotesList() {
  const q = state.filter.trim().toLowerCase();
  els.notesList.innerHTML = '';
  const frag = document.createDocumentFragment();
  const filtered = state.notes.filter(n => !q || (n.title + ' ' + n.content).toLowerCase().includes(q));
  filtered
    .sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (new Date(b.updatedAt) - new Date(a.updatedAt)))
    .forEach(n => {
      const li = document.createElement('li');
      li.dataset.id = n.id;
      if (n.id === state.currentNoteId) li.classList.add('selected');
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = (n.title || 'Untitled');
      if (n.pinned) {
        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = '📌';
        title.appendChild(pin);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = formatDate(n.updatedAt || Date.now());
      li.appendChild(title);
      li.appendChild(meta);
      frag.appendChild(li);
    });
  els.notesList.appendChild(frag);
}

function selectNote(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  state.currentNoteId = id;
  els.noteTitle.value = note.title || '';
  els.noteContent.value = note.content || '';
  localStorage.setItem(LAST_SELECTED_KEY, id);
  state.dirty = false;
  setStatus('Opened "' + ((note.title || 'Untitled')) + '"');
  renderNotesList();
}

function newNote() {
  state.currentNoteId = null;
  els.noteTitle.value = '';
  els.noteContent.value = '';
  state.dirty = false;
  setStatus('New note');
  renderNotesList();
  els.noteTitle.focus();
}

function saveCurrentNote() {
  const title = els.noteTitle.value.trim();
  const content = els.noteContent.value.trim();
  if (!title && !content) {
    setStatus('Nothing to save');
    return;
  }
  const now = new Date().toISOString();
  if (!state.currentNoteId) {
    const id = generateId();
    const note = { id, title: title || 'Untitled', content, updatedAt: now, pinned: false };
    state.notes.unshift(note);
    state.currentNoteId = id;
    localStorage.setItem(LAST_SELECTED_KEY, id);
  } else {
    const idx = state.notes.findIndex(n => n.id === state.currentNoteId);
    if (idx !== -1) {
      state.notes[idx] = {
        ...state.notes[idx],
        title: title || 'Untitled',
        content,
        updatedAt: now,
      };
    }
  }
  saveNotes();
  renderNotesList();
  state.dirty = false;
  setStatus('Saved');
}

function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  const id = state.currentNoteId;
  const idx = state.notes.findIndex(n => n.id === id);
  if (idx === -1) return;
  state.notes.splice(idx, 1);
  saveNotes();
  const last = localStorage.getItem(LAST_SELECTED_KEY);
  if (last === id) localStorage.removeItem(LAST_SELECTED_KEY);
  newNote();
  setStatus('Deleted');
}

function initWelcomeNote() {
  if (state.notes.length) return;
  const now = new Date().toISOString();
  state.notes = [{
    id: generateId(),
    title: 'Welcome to Scribbly',
    content: 'Write, save, and delete notes. Your data stays in your browser.',
    updatedAt: now,
  }];
  saveNotes();
}

function restoreLastSelected() {
  const last = localStorage.getItem(LAST_SELECTED_KEY);
  if (last && state.notes.some(n => n.id === last)) {
    selectNote(last);
  } else if (state.notes.length) {
    selectNote(state.notes[0].id);
  } else {
    newNote();
  }
}

function bindEvents() {
  els.newNoteBtn.addEventListener('click', newNote);

  els.notesList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    selectNote(li.dataset.id);
  });

  els.notesList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, li.dataset.id);
  });

  els.searchInput.addEventListener('input', () => {
    state.filter = els.searchInput.value;
    renderNotesList();
  });

  const debounced = debounce(() => {
    const title = els.noteTitle.value.trim();
    const content = els.noteContent.value.trim();
    if (!title && !content) return;
    saveCurrentNote();
    setStatus('Autosaved');
  }, 800);
  ['input', 'change'].forEach(evt => {
    els.noteTitle.addEventListener(evt, () => { state.dirty = true; debounced(); });
    els.noteContent.addEventListener(evt, () => { state.dirty = true; debounced(); });
  });

  window.addEventListener('beforeunload', () => {
    if (state.dirty) saveCurrentNote();
  });

  els.contextPin.addEventListener('click', () => {
    if (!state.contextTargetId) return;
    const note = state.notes.find(n => n.id === state.contextTargetId);
    if (!note) return;
    note.pinned = !note.pinned;
    saveNotes();
    renderNotesList();
    hideContextMenu();
  });

  els.contextDelete.addEventListener('click', () => {
    if (!state.contextTargetId) return;
    const id = state.contextTargetId;
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx === -1) { hideContextMenu(); return; }
    const wasCurrent = state.currentNoteId === id;
    state.notes.splice(idx, 1);
    saveNotes();
    const last = localStorage.getItem(LAST_SELECTED_KEY);
    if (last === id) localStorage.removeItem(LAST_SELECTED_KEY);
    if (wasCurrent) {
      newNote();
    } else {
      renderNotesList();
    }
    hideContextMenu();
    setStatus('Deleted');
  });

  document.addEventListener('click', (e) => {
    if (!els.contextMenu || els.contextMenu.hidden) return;
    if (!e.target.closest('#contextMenu')) hideContextMenu();
  });

  window.addEventListener('resize', hideContextMenu);
  window.addEventListener('scroll', hideContextMenu, true);

  // Hidden edit-date button trigger via status text
  if (els.status) {
    els.status.addEventListener('click', () => {
      if (!state.currentNoteId) return;
      if (els.editDateBtn) els.editDateBtn.click();
    });
  }

  if (els.editDateBtn) {
    els.editDateBtn.addEventListener('click', () => {
      if (!state.currentNoteId) return;
      const idx = state.notes.findIndex(n => n.id === state.currentNoteId);
      if (idx === -1) return;
      const current = state.notes[idx];
      const def = toLocalDatetimeValue(current.updatedAt || new Date());
      const input = prompt('Enter new date/time (YYYY-MM-DDTHH:mm):', def);
      if (input == null) return; // cancelled
      const d = new Date(input);
      if (isNaN(d.getTime())) { setStatus('Invalid date/time'); return; }
      state.notes[idx] = { ...current, updatedAt: d.toISOString() };
      saveNotes();
      renderNotesList();
      selectNote(state.currentNoteId);
      setStatus('Date/time updated');
    });
  }

  // About / Help modal
  if (els.infoBtn && els.aboutModal) {
    els.infoBtn.addEventListener('click', () => {
      els.aboutModal.hidden = false;
    });
  }
  if (els.aboutClose && els.aboutModal) {
    els.aboutClose.addEventListener('click', () => {
      els.aboutModal.hidden = true;
    });
  }
  if (els.aboutModal) {
    els.aboutModal.addEventListener('click', (e) => {
      if (e.target === els.aboutModal) {
        els.aboutModal.hidden = true;
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.aboutModal && !els.aboutModal.hidden) {
      els.aboutModal.hidden = true;
    }
  });
}

function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function toLocalDatetimeValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function seedFakeTasksIfNotSeeded() {
  try {
    if (localStorage.getItem('scribbly.seed.v1')) return;
    const tasks = [
      { id: generateId(), title: 'Task: Setup project structure', content: 'Scaffold files and folders.', updatedAt: new Date('2025-06-05T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Design UI wireframes', content: 'Plan layout and interactions.', updatedAt: new Date('2025-06-18T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Implement notes list', content: 'Render list and selection.', updatedAt: new Date('2025-07-02T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Add search and filter', content: 'Filter notes by text.', updatedAt: new Date('2025-07-23T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Autosave functionality', content: 'Debounce and persist changes.', updatedAt: new Date('2025-08-12T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Context menu options', content: 'Pin and open via right-click.', updatedAt: new Date('2025-09-05T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: LocalStorage persistence', content: 'Ensure CRUD persists.', updatedAt: new Date('2025-09-25T10:00:00Z').toISOString(), pinned: false },
      { id: generateId(), title: 'Task: Polish styles', content: 'Refine UI with icons.', updatedAt: new Date('2025-11-04T10:00:00Z').toISOString(), pinned: false },
    ];
    state.notes.push(...tasks);
    saveNotes();
    localStorage.setItem('scribbly.seed.v1', 'true');
  } catch (_) { /* ignore */ }
}

function purgeSeededTasks() {
  try {
    const signatures = new Set([
      'Task: Setup project structure|Scaffold files and folders.',
      'Task: Design UI wireframes|Plan layout and interactions.',
      'Task: Implement notes list|Render list and selection.',
      'Task: Add search and filter|Filter notes by text.',
      'Task: Autosave functionality|Debounce and persist changes.',
      'Task: Context menu options|Pin and open via right-click.',
      'Task: LocalStorage persistence|Ensure CRUD persists.',
      'Task: Polish styles|Refine UI with icons.',
    ]);
    const before = state.notes.length;
    state.notes = state.notes.filter(n => !signatures.has(`${n.title}|${n.content}`));
    if (state.notes.length !== before) {
      saveNotes();
    }
  } catch (_) { /* ignore */ }
}

function init() {
  state.notes = loadNotes();
  purgeSeededTasks();
  initWelcomeNote();
  renderNotesList();
  restoreLastSelected();
  bindEvents();
}

init();

function showContextMenu(x, y, id) {
  state.contextTargetId = id;
  const menu = els.contextMenu;
  if (!menu) return;
  menu.hidden = false;
  const padding = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width + padding > vw) left = vw - rect.width - padding;
  if (top + rect.height + padding > vh) top = vh - rect.height - padding;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function hideContextMenu() {
  state.contextTargetId = null;
  const menu = els.contextMenu;
  if (!menu) return;
  menu.hidden = true;
}