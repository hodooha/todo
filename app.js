(() => {
  'use strict';

  const STORAGE_KEY = 'todo-app/v1';
  const FILTER_KEY = 'todo-app/filter';
  const FILTERS = {
    all: () => true,
    active: (t) => !t.done,
    done: (t) => t.done,
  };
  const EMPTY_MESSAGES = {
    all: '할 일이 없습니다. 위에서 새로 추가해 보세요.',
    active: '진행 중인 할 일이 없습니다. 🎉',
    done: '아직 완료한 할 일이 없습니다.',
  };

  const $ = (id) => document.getElementById(id);
  const form = $('new-todo-form');
  const textInput = $('new-todo-text');
  const dueInput = $('new-todo-due');
  const list = $('todo-list');
  const empty = $('empty');
  const count = $('count');
  const clearDone = $('clear-done');
  const toggleAll = $('toggle-all');
  const filterButtons = document.querySelectorAll('.filters button');

  let todos = load(STORAGE_KEY, []);
  if (!Array.isArray(todos)) todos = [];
  let filter = load(FILTER_KEY, 'all');
  if (!FILTERS[filter]) filter = 'all';
  let editingId = null;

  // ---------- 저장소 ----------

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
      localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch {
      // 저장 불가(사생활 보호 모드 등) — 메모리에서만 동작
    }
  }

  // ---------- 날짜 ----------

  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function describeDue(due) {
    const today = new Date();
    const todayKey = toDateKey(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (due === todayKey) return { label: '오늘까지', overdue: false };
    if (due === toDateKey(tomorrow)) return { label: '내일까지', overdue: false };

    const [y, m, d] = due.split('-').map(Number);
    const label = `${y !== today.getFullYear() ? `${y}년 ` : ''}${m}월 ${d}일까지`;
    return { label: due < todayKey ? `${label} · 기한 지남` : label, overdue: due < todayKey };
  }

  // ---------- 상태 변경 ----------

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function update(fn) {
    fn();
    save();
    render();
  }

  function addTodo(text, due) {
    update(() => {
      todos.push({ id: newId(), text, done: false, due: due || null, createdAt: Date.now() });
    });
  }

  function findTodo(id) {
    return todos.find((t) => t.id === id);
  }

  function removeTodo(id) {
    update(() => { todos = todos.filter((t) => t.id !== id); });
  }

  function commitEdit(id, value) {
    if (editingId !== id) return; // 이미 처리됨 (Enter 후 blur 등)
    editingId = null;
    const text = value.trim();
    if (!text) {
      removeTodo(id);
      return;
    }
    update(() => { findTodo(id).text = text; });
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  // ---------- 렌더링 ----------

  function renderTodo(todo) {
    const li = document.createElement('li');
    li.className = 'todo' + (todo.done ? ' done' : '');
    li.dataset.id = todo.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'toggle';
    checkbox.checked = todo.done;
    checkbox.setAttribute('aria-label', `"${todo.text}" 완료 표시`);

    const body = document.createElement('div');
    body.className = 'todo-body';

    if (editingId === todo.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'todo-edit';
      input.value = todo.text;
      input.maxLength = 200;
      input.setAttribute('aria-label', '할 일 수정');
      body.append(input);
    } else {
      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = todo.text;
      text.title = '더블클릭하여 수정';
      body.append(text);
    }

    if (todo.due) {
      const { label, overdue } = describeDue(todo.due);
      const due = document.createElement('span');
      due.className = 'todo-due' + (overdue && !todo.done ? ' overdue' : '');
      due.textContent = label;
      body.append(due);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = '×';
    del.setAttribute('aria-label', `"${todo.text}" 삭제`);

    li.append(checkbox, body, del);
    return li;
  }

  function render() {
    const visible = todos.filter(FILTERS[filter]);
    list.replaceChildren(...visible.map(renderTodo));
    empty.textContent = visible.length ? '' : EMPTY_MESSAGES[filter];

    const remaining = todos.filter((t) => !t.done).length;
    const doneCount = todos.length - remaining;
    count.textContent = todos.length
      ? `${remaining}개 남음 · 전체 ${todos.length}개`
      : '';
    clearDone.disabled = doneCount === 0;
    clearDone.hidden = todos.length === 0;

    toggleAll.checked = todos.length > 0 && remaining === 0;
    toggleAll.disabled = todos.length === 0;

    filterButtons.forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.filter === filter));
    });

    const editInput = list.querySelector('.todo-edit');
    if (editInput) {
      editInput.focus();
      editInput.setSelectionRange(editInput.value.length, editInput.value.length);
    }
  }

  // ---------- 이벤트 ----------

  // 한글 조합 중 Enter는 조합이 끝난 뒤 처리한다 (마지막 글자 누락/중복 방지).
  // 브라우저에 따라 Enter가 두 번 들어올 수 있으므로 action은 반복 호출에 안전해야 한다.
  let pendingEnter = null;

  function onEnter(e, action) {
    if (e.key !== 'Enter') return false;
    e.preventDefault();
    if (e.isComposing) pendingEnter = { target: e.target, action };
    else action();
    return true;
  }

  document.addEventListener('compositionend', (e) => {
    if (!pendingEnter || pendingEnter.target !== e.target) return;
    const { action } = pendingEnter;
    pendingEnter = null;
    setTimeout(action, 0);
  });

  function submitNewTodo() {
    const text = textInput.value.trim();
    if (!text) return;
    if (filter === 'done') filter = 'all'; // 새 항목이 바로 보이도록
    addTodo(text, dueInput.value);
    textInput.value = '';
    dueInput.value = '';
    textInput.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitNewTodo();
  });

  textInput.addEventListener('keydown', (e) => onEnter(e, submitNewTodo));

  list.addEventListener('change', (e) => {
    if (!e.target.classList.contains('toggle')) return;
    const id = e.target.closest('.todo').dataset.id;
    update(() => {
      const todo = findTodo(id);
      todo.done = !todo.done;
    });
  });

  list.addEventListener('click', (e) => {
    if (!e.target.classList.contains('delete')) return;
    removeTodo(e.target.closest('.todo').dataset.id);
  });

  list.addEventListener('dblclick', (e) => {
    if (!e.target.classList.contains('todo-text')) return;
    editingId = e.target.closest('.todo').dataset.id;
    render();
  });

  list.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('todo-edit')) return;
    const input = e.target;
    const id = input.closest('.todo').dataset.id;
    if (onEnter(e, () => commitEdit(id, input.value))) return;
    if (e.key === 'Escape') cancelEdit();
  });

  list.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('todo-edit')) return;
    commitEdit(e.target.closest('.todo').dataset.id, e.target.value);
  });

  toggleAll.addEventListener('change', () => {
    const done = toggleAll.checked;
    update(() => { todos.forEach((t) => { t.done = done; }); });
  });

  clearDone.addEventListener('click', () => {
    const n = todos.filter((t) => t.done).length;
    if (!n || !confirm(`완료한 할 일 ${n}개를 삭제할까요?`)) return;
    update(() => { todos = todos.filter((t) => !t.done); });
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => update(() => { filter = btn.dataset.filter; }));
  });

  // 다른 탭에서 변경되면 동기화
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    todos = load(STORAGE_KEY, []);
    editingId = null;
    render();
  });

  $('today').textContent = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  render();
})();
