      function toggleEdit() {
        const rendered = document.getElementById('rendered-content');
        const editor = document.getElementById('edit-form');
        rendered.style.display = rendered.style.display === 'none' ? 'block' : 'none';
        editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
      }

      function showCommit(sha) {
        const modal = new bootstrap.Modal(document.getElementById('commitModal'));
          const metaEl = document.getElementById('commit-meta');
          const diffHtmlEl = document.getElementById('commit-diff-html');
          const diffRawEl = document.getElementById('commit-diff-raw');
          metaEl.innerHTML = 'Loading...';
          diffHtmlEl.style.display = 'none';
          diffRawEl.style.display = 'none';
          diffHtmlEl.innerHTML = '';
          diffRawEl.textContent = '';
          fetch(commitBaseUrl + sha, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(r => r.json())
            .then(data => {
              if (data && data.status === 'ok') {
                const m = data.meta || {};
                metaEl.innerHTML = `<div><strong>${m.message}</strong></div><div>by <a href="/user/${encodeURIComponent(m.author)}">${m.author}</a> on ${m.date} — <span style="font-family:monospace">${m.sha.slice(0,7)}</span></div>`;
                if (data.diff_html) {
                  // show HTML diff in the styled container
                  diffHtmlEl.innerHTML = data.diff_html;
                  diffHtmlEl.style.display = 'block';
                } else {
                  diffRawEl.textContent = data.diff || '';
                  diffRawEl.style.display = 'block';
                }
                modal.show();
              } else {
                metaEl.innerHTML = '<div class="text-danger">Unable to load commit details</div>';
                diffRawEl.textContent = data && data.message ? data.message : '';
                diffRawEl.style.display = 'block';
                modal.show();
              }
            }).catch(err => {
              metaEl.innerHTML = '<div class="text-danger">Error fetching commit</div>';
              diffRawEl.textContent = String(err);
              diffRawEl.style.display = 'block';
              modal.show();
            });
      }


      const nodes = new vis.DataSet(
        rawNodes.map(note_id => ({
          id: note_id,
          label: note_id,
          shape: 'dot',
          color: { background: 'white', border: 'black', highlight: { background: 'black', border: '#black' }},
          font: { color: 'black', size: 20 }
        }))
      );
      const edges = new vis.DataSet(rawEdges);
      
      // Initialize graph when mandala tab is shown
      const mandalaTab = document.getElementById('mandala-tab');
      let graphInitialized = false;
      
      mandalaTab.addEventListener('shown.bs.tab', function () {
        if (!graphInitialized) {
          const container = document.getElementById("graph");
          if (container) {
            const data = { nodes, edges };
            const options = {
              layout: { improvedLayout: true, hierarchical: false },
              physics: { enabled: true, solver: 'forceAtlas2Based', stabilization: { iterations: 100 }},
              nodes: { shape: 'circle', size: 20 },
              interaction: { zoomView: true, dragView: true, navigationButtons: false },
              manipulation: { enabled: false }
            };
            const network = new vis.Network(container, data, options);
            network.on("click", function (params) {
              if (params.nodes.length > 0) {
                const note = params.nodes[0];
                window.location.href = "/bindu/" + note;
              }
            });
            graphInitialized = true;
          }
        }
      });
      
  // current session info (injected)
// current session info (injected) assignments are now above, no nested script tag

  // Notes modal handling
      document.addEventListener('DOMContentLoaded', function () {
        // wire the global create bindu button (admins)
        // Elegant global create-bindu handler (shared with index.html)
        function setupCreateBinduGlobal() {
          const createBtn = document.getElementById('create-bindu-global');
          if (createBtn) {
            createBtn.addEventListener('click', function () {
              const modal = new bootstrap.Modal(document.getElementById('createBinduModal'));
              modal.show();
              setTimeout(() => {
                const t = document.querySelector('#create-bindu-form input[name="title"]');
                if (t) t.focus();
              }, 100);
            });
          }
          const createSubmit = document.getElementById('create-bindu-submit');
          if (createSubmit) {
            createSubmit.addEventListener('click', function () {
              const form = document.getElementById('create-bindu-form');
              const fd = new FormData(form);
              // Removed reference to url_for('create_bindu') to resolve BuildError
              // Disabled create bindu functionality
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
        // attach link autocomplete to add-note textarea and admin edit textarea
        function setupLinkAutocomplete(textarea) {
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

          function showSuggestions(prefix) {
            const q = prefix.toLowerCase();
            const matches = allNotes.filter(n => n.toLowerCase().includes(q)).slice(0, 12);
            box.innerHTML = '';
            matches.forEach(m => {
              const el = document.createElement('div');
              el.className = 'suggestion-item';
              el.style.padding = '6px 10px';
              el.style.cursor = 'pointer';
              el.textContent = m;
              el.addEventListener('mousedown', function (ev) {
                ev.preventDefault(); // prevent blur
                // insert [[m]] replacing the current token
                const val = textarea.value;
                const pos = textarea.selectionStart;
                const before = val.substring(0, pos);
                const tokenMatch = before.match(/\[\[([^\]]*)$/);
                if (tokenMatch) {
                  const start = pos - tokenMatch[0].length;
                  const after = val.substring(pos);
                  const insert = `[[${m}]]`;
                  textarea.value = val.substring(0, start) + insert + after;
                  textarea.selectionStart = textarea.selectionEnd = start + insert.length;
                }
                box.style.display = 'none';
                textarea.focus();
              });
              box.appendChild(el);
            });
            if (matches.length) {
              positionBox();
              box.style.display = 'block';
            } else {
              box.style.display = 'none';
            }
          }

          textarea.addEventListener('input', function (e) {
            const pos = textarea.selectionStart;
            const before = textarea.value.substring(0, pos);
            const tokenMatch = before.match(/\[\[([^\]]*)$/);
            if (tokenMatch) {
              showSuggestions(tokenMatch[1]);
            } else {
              box.style.display = 'none';
            }
          });

          textarea.addEventListener('scroll', positionBox);
          window.addEventListener('resize', positionBox);
          textarea.addEventListener('blur', function () { setTimeout(() => box.style.display = 'none', 150); });
        }

        // wire known textareas
        setupLinkAutocomplete(document.querySelector('#add-note-form textarea[name="markdown"]'));
        setupLinkAutocomplete(document.querySelector('#edit-markdown'));
  // enable autocomplete for the create bindu modal textarea as well
  setupLinkAutocomplete(document.querySelector('#create-bindu-form textarea[name="markdown"]'));
        // Add Note modal and handler removed for cleanup

        function attachNoteLinks() {
          const notesIndex = document.getElementById('notes-index');
          if (!notesIndex) return;
          notesIndex.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (href.startsWith('/notes_entries/')) {
              a.addEventListener('click', function (e) {
                e.preventDefault();
                const path = href.replace('/notes_entries/', '');
                fetch('/notes_entries/render/' + encodeURIComponent(path), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                  .then(r => r.json())
                  .then(data => {
                    const body = document.getElementById('view-note-body');
                    body.innerHTML = data.html || '';

                    // attach action buttons depending on permissions
                    const actions = document.createElement('div');
                    actions.style.marginTop = '12px';
                    // owner can edit
                    if (currentUser && data.owner && currentUser === data.owner) {
                      const editBtn = document.createElement('button');
                      editBtn.className = 'btn btn-sm btn-outline-primary me-2';
                      editBtn.textContent = 'Edit';
                      editBtn.addEventListener('click', function () {
                        // fetch raw content (we can reuse the same endpoint but ask for raw by sending fetch without rendering)
                        fetch('/notes_entries/render/' + encodeURIComponent(path) + '?json=1', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                          .then(r => r.json())
                          .then(d => {
                            const raw = d.raw || null;
                            // if raw not provided, request the file directly
                            if (!raw) {
                              // fetch the file text
                              fetch('/notes_entries/' + encodeURIComponent(path)).then(r => r.text()).then(txt => {
                                openEditArea(txt);
                              });
                            } else {
                              openEditArea(raw);
                            }
                          });
                      });
                      actions.appendChild(editBtn);
                    }

                    // admin can delete
                    // allow owner or admin to delete
                    if (currentRole === 'admin' || (currentUser && data.owner && currentUser === data.owner)) {
                      const delBtn = document.createElement('button');
                      delBtn.className = 'btn btn-sm btn-outline-danger';
                      delBtn.textContent = 'Delete';
                      delBtn.addEventListener('click', function () {
                        if (!confirm('Delete this note entry?')) return;
                        fetch('/notes_entries/delete/' + encodeURIComponent(path), { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                          .then(r => r.json()).then(res => {
                            if (res && res.status === 'ok') {
                              const viewModal = bootstrap.Modal.getInstance(document.getElementById('viewNoteModal'));
                              viewModal.hide();
                              // refresh notes index
                              fetch(binduURL).then(resp => resp.text()).then(html => {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(html, 'text/html');
                                const newNotes = doc.getElementById('notes-index');
                                if (newNotes) {
                                  document.getElementById('notes-index').innerHTML = newNotes.innerHTML;
                                  attachNoteLinks();
                                }
                              });
                            } else {
                              alert('Delete failed: ' + (res && res.message ? res.message : 'unknown'));
                            }
                          });
                      });
                      actions.appendChild(delBtn);
                    }

                    if (actions.children.length) {
                      body.appendChild(actions);
                    }

                    const viewModal = new bootstrap.Modal(document.getElementById('viewNoteModal'));
                    viewModal.show();

                    function openEditArea(initialText) {
                      body.innerHTML = '';
                      const ta = document.createElement('textarea');
                      ta.className = 'form-control';
                      ta.rows = 16;
                      ta.value = initialText;
                      body.appendChild(ta);
                      // enable the [[link]] autocomplete on this dynamically created textarea
                      try { setupLinkAutocomplete(ta); } catch (e) { console.warn('autocomplete setup failed', e); }
                      const save = document.createElement('button');
                      save.className = 'btn btn-primary mt-2';
                      save.textContent = 'Save';
                      save.addEventListener('click', function () {
                        const form = new FormData();
                        form.append('markdown', ta.value);
                        fetch('/notes_entries/edit/' + encodeURIComponent(path), { method: 'POST', body: form, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                          .then(r => r.json()).then(res => {
                            if (res && res.status === 'ok') {
                              body.innerHTML = res.html || '';
                              // refresh notes index
                              fetch(binduURL).then(resp => resp.text()).then(html => {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(html, 'text/html');
                                const newNotes = doc.getElementById('notes-index');
                                if (newNotes) {
                                  document.getElementById('notes-index').innerHTML = newNotes.innerHTML;
                                  attachNoteLinks();
                                }
                              });
                            } else {
                              alert('Save failed: ' + (res && res.message ? res.message : 'unknown'));
                            }
                          });
                      });
                      body.appendChild(save);
                    }
                  }).catch(err => {
                    console.error(err);
                  });
              });
            }
          });
        }

        attachNoteLinks();
        
        // Edit note handling (admin)
        const saveEditBtn = document.getElementById('save-edit');
        if (saveEditBtn) {
          saveEditBtn.addEventListener('click', function () {
            const editForm = document.getElementById('edit-note-form');
            const formData = new FormData(editForm);
            fetch(editBinduURL, {
              method: 'POST',
              body: formData,
              headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(r => r.json()).then(data => {
              if (data && data.status === 'ok') {
                  // update rendered content
                  if (data.html) {
                    document.getElementById('rendered-content').innerHTML = data.html;
                  }
                  const modalEl = document.getElementById('editNoteModal');
                  const modal = bootstrap.Modal.getInstance(modalEl);
                  modal.hide();

                  // refresh history pane so new commit appears
                  fetch(binduURL).then(resp => resp.text()).then(html => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    const newHistory = doc.getElementById('history-pane');
                    if (newHistory) {
                      const target = document.getElementById('history-pane');
                      target.innerHTML = newHistory.innerHTML;
                    }
                  }).catch(err => {
                    console.warn('Failed to refresh history:', err);
                  });
                } else {
                  const alertEl = document.getElementById('edit-note-alert');
                  alertEl.style.display = 'block';
                  alertEl.innerText = (data && data.message) ? data.message : 'Error saving edit';
                }
            }).catch(err => {
              const alertEl = document.getElementById('edit-note-alert');
              alertEl.style.display = 'block';
              alertEl.innerText = 'Error saving edit';
            });
          });
        }
      });