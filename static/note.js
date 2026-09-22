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
                metaEl.innerHTML = `<div><strong>${m.message}</strong></div><div>by ${m.author} on ${m.date} — <span style="font-family:monospace">${m.sha.slice(0,7)}</span></div>`;
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
      
      // Notes modal handling
      document.addEventListener('DOMContentLoaded', function () {
        const addForm = document.getElementById('add-note-form');
        const addSubmit = document.getElementById('add-note-submit');
        const addAlert = document.getElementById('add-note-alert');

        if (addSubmit) {
          addSubmit.addEventListener('click', function () {
            const formData = new FormData(addForm);
            fetch(addNoteEntryURL, {
              method: 'POST',
              body: formData,
              headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(r => r.json())
              .then(data => {
                if (data && data.status === 'ok') {
                  // close modal
                  const modalEl = document.getElementById('addNoteModal');
                  const modal = bootstrap.Modal.getInstance(modalEl);
                  modal.hide();
                  // refresh notes index
                  fetch(binduURL).then(resp => resp.text()).then(html => {
                    // parse returned HTML and extract #notes-index content
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    const newNotes = doc.getElementById('notes-index');
                    if (newNotes) {
                      document.getElementById('notes-index').innerHTML = newNotes.innerHTML;
                      attachNoteLinks();
                    }
                  });
                } else {
                  addAlert.style.display = 'block';
                  addAlert.innerText = (data && data.message) ? data.message : 'Error saving note';
                }
              }).catch(err => {
                addAlert.style.display = 'block';
                addAlert.innerText = 'Error saving note';
              });
          });
        }

        function attachNoteLinks() {
          const notesIndex = document.getElementById('notes-index');
          if (!notesIndex) return;
          notesIndex.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (href.startsWith('/notes_entries/')) {
              a.addEventListener('click', function (e) {
                e.preventDefault();
                const path = href.replace('/notes_entries/', '');
                fetch('/notes_entries/render/' + encodeURIComponent(path)).then(r => r.text()).then(html => {
                  document.getElementById('view-note-body').innerHTML = html;
                  const viewModal = new bootstrap.Modal(document.getElementById('viewNoteModal'));
                  viewModal.show();
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


    (function() {
      const autocompleteEl = document.getElementById('link-autocomplete');
      let activeTextarea = null;
      let bracketStart = -1;
      let highlightedIndex = -1;

      // Attach to all markdown textareas
      const textareas = document.querySelectorAll('textarea[name="markdown"]');

      textareas.forEach(textarea => {
        textarea.addEventListener('input', handleInput);
        textarea.addEventListener('keydown', handleKeydown);
        textarea.addEventListener('blur', () => {
          setTimeout(() => autocompleteEl.classList.remove('active'), 150);
        });
      });

      function handleInput(e) {
        const textarea = e.target;
        activeTextarea = textarea;
        const val = textarea.value;
        const pos = textarea.selectionStart;

        // Find [[ before cursor
        const beforeCursor = val.substring(0, pos);
        const lastBracket = beforeCursor.lastIndexOf('[[');
        const lastClose = beforeCursor.lastIndexOf(']]');

        if (lastBracket > lastClose && lastBracket !== -1) {
          bracketStart = lastBracket + 2;
          const query = beforeCursor.substring(bracketStart).toLowerCase();

          const filtered = allNotes.filter(n => n.toLowerCase().includes(query)).slice(0, 8);

          if (filtered.length > 0) {
            showAutocomplete(textarea, filtered);
          } else {
            autocompleteEl.classList.remove('active');
          }
        } else {
          autocompleteEl.classList.remove('active');
          bracketStart = -1;
        }
      }

      function handleKeydown(e) {
        if (!autocompleteEl.classList.contains('active')) return;

        const items = autocompleteEl.querySelectorAll('.link-autocomplete-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
          updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightedIndex = Math.max(highlightedIndex - 1, 0);
          updateHighlight(items);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (highlightedIndex >= 0 && items[highlightedIndex]) {
            e.preventDefault();
            selectItem(items[highlightedIndex].textContent);
          }
        } else if (e.key === 'Escape') {
          autocompleteEl.classList.remove('active');
        }
      }

      function updateHighlight(items) {
        items.forEach((item, i) => {
          if (i === highlightedIndex) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest' });
          } else {
            item.classList.remove('highlighted');
          }
        });
      }

      function showAutocomplete(textarea, suggestions) {
        highlightedIndex = 0;
        autocompleteEl.innerHTML = '';
        suggestions.forEach((note, i) => {
          const item = document.createElement('div');
          item.className = 'link-autocomplete-item' + (i === 0 ? ' highlighted' : '');
          item.textContent = note;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectItem(note);
          });
          autocompleteEl.appendChild(item);
        });

        // Position near the textarea cursor
        const rect = textarea.getBoundingClientRect();
        autocompleteEl.style.left = (rect.left + 20) + 'px';
        autocompleteEl.style.top = (rect.top + 60) + 'px';
        autocompleteEl.style.minWidth = '200px';
        autocompleteEl.classList.add('active');
      }

      function selectItem(noteName) {
        if (!activeTextarea || bracketStart === -1) return;
        const val = activeTextarea.value;
        const pos = activeTextarea.selectionStart;
        const before = val.substring(0, bracketStart);
        const after = val.substring(pos);
        const newVal = before + noteName + ']]' + after;
        activeTextarea.value = newVal;
        const newPos = bracketStart + noteName.length + 2;
        activeTextarea.setSelectionRange(newPos, newPos);
        activeTextarea.focus();
        autocompleteEl.classList.remove('active');
        bracketStart = -1;
      }
    })();

        async function highlight_bindus() {
            let text = document.getElementById('rendered-content').innerHTML;

            let response = await fetch('/api/highlight');
            const data = await response.json();

            //removes the bindu from the list
            let bindu = note_name
            bindu = bindu.replace(/[\(\[].*?[\)\]]/g, "").toLowerCase().trim();
            const key_list = data.keys.filter(x => x !== bindu)
            for (key of key_list) {
                let regex = new RegExp(`<a\\s+href="[^"]*">[\\s\\S]*?<\\/a\\s*>|(?<![/\\p{L}])${key}`, 'giu');
                text = text.replaceAll(regex, match => {
                    if (/^<a\s+href=/i.test(match)) {
                        return match;
                    }
                    return `<mark>${match}</mark>`;
                });
            }
            document.getElementById('rendered-content').innerHTML = text;
        }

    document.getElementById('highlight_btn').addEventListener("click", (highlight_bindus));

     function toggleEdit() {
        const rendered = document.getElementById('rendered-content');
        const editor = document.getElementById('edit-form');
        rendered.style.display = rendered.style.display === 'none' ? 'block' : 'none';
        editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
      }