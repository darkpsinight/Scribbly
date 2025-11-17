const STORAGE_KEY = 'scribbly.notes';
const LAST_SELECTED_KEY = 'scribbly.lastSelected';
// IndexedDB config
const DB_NAME = 'scribbly-db';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const QUEUE_STORE = 'queue';
const SYNC_ENABLED = false; // set true when backend exists
const REMOTE_API_BASE = ''; // e.g., 'https://example.com/api'

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
  installDeferred: null,
};

// IndexedDB helpers
let _dbPromise;
function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbGet(key) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readonly');
      const store = tx.objectStore(KV_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      const store = tx.objectStore(KV_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return false;
  }
}

async function queueAction(action) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const req = store.add({ ...action, queuedAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

async function getQueuedActions() {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const store = tx.objectStore(QUEUE_STORE);
      const actions = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          actions.push({ id: cursor.key, ...cursor.value });
          cursor.continue();
        } else {
          resolve(actions);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return [];
  }
}

async function clearQueuedAction(id) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return false;
  }
}

async function loadNotes() {
  // Prefer IndexedDB, fallback to localStorage
  try {
    const idbNotes = await idbGet(STORAGE_KEY);
    const notes = Array.isArray(idbNotes)
      ? idbNotes
      : (() => {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch (_) { return []; }
        })();
    return notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (_) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
}

function saveNotes() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes)); } catch (_) {}
  // Fire-and-forget IDB write
  idbSet(STORAGE_KEY, state.notes).catch(() => {});
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
    if (!navigator.onLine) queueAction({ type: 'upsert', note }).catch(() => {});
  } else {
    const idx = state.notes.findIndex(n => n.id === state.currentNoteId);
    if (idx !== -1) {
      const updated = {
        ...state.notes[idx],
        title: title || 'Untitled',
        content,
        updatedAt: now,
      };
      state.notes[idx] = updated;
      if (!navigator.onLine) queueAction({ type: 'upsert', note: updated }).catch(() => {});
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
  if (!navigator.onLine) queueAction({ type: 'delete', id }).catch(() => {});
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

async function init() {
  state.notes = await loadNotes();
  purgeSeededTasks();
  initWelcomeNote();
  renderNotesList();
  restoreLastSelected();
  bindEvents();
  // Try to sync queued actions when back online
  window.addEventListener('online', () => {
    syncQueuedActions().catch(() => {});
    // Attempt Background Sync if supported
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.sync && reg.sync.register('scribbly-sync'))
        .catch(() => {});
    }
  });
}

init();

// Lazy prefetch non-critical assets during idle time
try {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  idle(() => {
    try {
      const img = new Image();
      img.src = 'icon.png';
      // Touch manifest for warm cache
      fetch('manifest.json').catch(() => {});
    } catch (_) { /* ignore */ }
  });
} catch (_) { /* ignore */ }

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

// Sync logic stubs
async function syncQueuedActions() {
  if (!SYNC_ENABLED) return true; // backend not configured
  if (!navigator.onLine) return false;
  const actions = await getQueuedActions();
  for (const a of actions) {
    try {
      if (a.type === 'upsert') {
        await syncNoteUpsert(a.note);
      } else if (a.type === 'delete') {
        await syncNoteDelete(a.id);
      }
      await clearQueuedAction(a.id);
    } catch (err) {
      // keep in queue; stop processing on first failure to avoid thrashing
      break;
    }
  }
}

async function syncNoteUpsert(note) {
  // Example remote sync; implement with your backend
  const url = `${REMOTE_API_BASE}/notes/${encodeURIComponent(note.id)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note)
  });
  if (!res.ok) throw new Error('Failed to sync note');
  // Conflict resolution placeholder: compare timestamps
  const remote = await res.json().catch(() => null);
  if (remote && remote.updatedAt && remote.updatedAt !== note.updatedAt) {
    const localTime = new Date(note.updatedAt).getTime();
    const remoteTime = new Date(remote.updatedAt).getTime();
    if (remoteTime > localTime) {
      // Remote newer: keep remote and store local as a duplicate to avoid loss
      const copy = { ...note, id: generateId(), title: `${note.title} (conflict copy)` };
      state.notes.unshift(copy);
      saveNotes();
    }
  }
}

async function syncNoteDelete(id) {
  const url = `${REMOTE_API_BASE}/notes/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note remotely');
}