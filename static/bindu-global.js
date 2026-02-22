// Shared handler for global create-bindu button and modal
function setupCreateBinduGlobal() {
  const createBtn = document.getElementById('create-bindu-global');
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      const modal = new bootstrap.Modal(document.getElementById('createBinduModal'));
      modal.show();
    });
  }
  const createSubmit = document.getElementById('create-bindu-submit');
  if (createSubmit) {
    createSubmit.addEventListener('click', function () {
      const form = document.getElementById('create-bindu-form');
      const fd = new FormData(form);
      fetch(window.createBinduUrl || '/bindu/create', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.json()).then(data => {
          const alertEl = document.getElementById('create-bindu-alert');
          if (data && data.status === 'ok') {
            window.location.href = '/bindu/' + encodeURIComponent(data.note_name);
          } else {
            alertEl.style.display = 'block';
            alertEl.className = 'text-danger';
            alertEl.innerText = (data && data.message) ? data.message : 'Failed to create bindu';
          }
        }).catch(err => {
          const alertEl = document.getElementById('create-bindu-alert');
          alertEl.style.display = 'block';
          alertEl.className = 'text-danger';
          alertEl.innerText = String(err);
        });
    });
  }
}
document.addEventListener('DOMContentLoaded', setupCreateBinduGlobal);
// Lightweight [[link]] autocomplete for create/edit textareas
function setupLinkAutocomplete_simple(textarea) {
  if (!textarea) return;
  const box = document.createElement('div');
  box.className = 'autocomplete-box';
  box.style.position = 'absolute';
  box.style.zIndex = 9999;
  box.style.background = 'var(--card)';
  box.style.border = '1px solid var(--border)';
  box.style.display = 'none';
  box.style.maxHeight = '240px';
  box.style.overflow = 'auto';
  box.style.minWidth = '200px';
  document.body.appendChild(box);
  function positionBox() {
    const rect = textarea.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = rect.bottom + window.scrollY;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = Math.max(200, rect.width) + 'px';
  }
  textarea.addEventListener('input', function () {
    const pos = textarea.selectionStart;
    const before = textarea.value.substring(0, pos);
    const tokenMatch = before.match(/\[\[([^\]]*)$/);
    if (tokenMatch) {
      const q = tokenMatch[1].toLowerCase();
      const matches = (typeof window.allNotes !== 'undefined' ? window.allNotes : []).filter(n => n.toLowerCase().includes(q)).slice(0, 12);
      box.innerHTML = '';
      matches.forEach(m => {
        const el = document.createElement('div');
        el.className = 'suggestion-item';
        el.style.padding = '6px 10px';
        el.style.cursor = 'pointer';
        el.textContent = m;
        el.addEventListener('mousedown', function () {
          const beforeToken = textarea.value.substring(0, pos - tokenMatch[0].length);
          const afterToken = textarea.value.substring(pos);
          textarea.value = beforeToken + '[[' + m + ']]' + afterToken;
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd = (beforeToken + '[[' + m + ']]').length;
          box.style.display = 'none';
        });
        box.appendChild(el);
      });
      positionBox();
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  });
  textarea.addEventListener('blur', function () {
    setTimeout(() => { box.style.display = 'none'; }, 120);
  });
}
document.addEventListener('DOMContentLoaded', function () {
  const ta = document.querySelector('#createBinduModal textarea[name="markdown"]');
  if (ta) setupLinkAutocomplete_simple(ta);
});
