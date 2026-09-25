    <!-- Autocomplete Script -->
      const searchInput = document.getElementById("searchInput");
      const autocompleteList = document.getElementById("autocompleteList");
      const resultsContainer = document.getElementById("resultsContainer");
      const resultsGrid = document.getElementById("resultsGrid");
      const featuredGrid = document.getElementById("featuredGrid");
      const allConceptsGrid = document.getElementById("allConceptsGrid");

      let highlightedIndex = -1;

      // Initialize featured and all concepts on page load
      function initializePage() {
        // Show featured concepts (specific selection)
        const featured = ['the three orders of śākta practice: durgā, āmnāya, mahāvidyā', 'deities', 'visarga (विसर्ग)', 'devīmahātmyam (देवीमहात्म्य)'];
        displayConcepts(featured, featuredGrid);

        // Show all concepts
        displayConcepts(allNotes, allConceptsGrid);
      }

      function displayConcepts(concepts, container) {
        container.innerHTML = '';
        concepts.forEach(note => {
          const card = createConceptCard(note);
          container.appendChild(card);
        });
      }

      function stripDiacritics(text) {
          return text.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
        }

      const searchIndex = allNotes.map(note => ({
          note,
          normalized: stripDiacritics(note.toLowerCase())
        }));
      

      function createConceptCard(noteName) {
        const card = document.createElement('div');
        card.className = 'mandala-card';
        
        // Highlight orphan bindus (no links) for admins
        if (orphanBindus && orphanBindus.includes(noteName)) {
          card.classList.add('orphan');
        }

        card.innerHTML = `
          <div class="mandala-title">${noteName}</div>
        `;
        
        card.addEventListener('click', () => {
          window.location.href = `/bindu/${encodeURIComponent(noteName)}`;
        });

        return card;
      }

      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        highlightedIndex = -1;

        if (query.length === 0) {
          autocompleteList.classList.remove('active');
          resultsContainer.style.display = 'none';
          return;
        }

        // Filter notes based on query
        const normalizedQuery = stripDiacritics(query.toLowerCase());
        const filtered = searchIndex
          .filter(entry => entry.normalized.includes(normalizedQuery))
          .slice(0, 10)
          .map(entry => entry.note);

        if (filtered.length === 0) {
          autocompleteList.classList.remove('active');
          resultsContainer.style.display = 'block';
          resultsGrid.innerHTML = '<div class="no-results" style="grid-column: 1/-1;">No concepts found matching your search.</div>';
          return;
        }

        // Display autocomplete suggestions
        autocompleteList.innerHTML = '';
        filtered.forEach((note, index) => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.textContent = note;
          item.addEventListener('click', () => selectNote(note));
          item.addEventListener('mouseenter', () => {
            highlightedIndex = index;
            updateHighlight();
          });
          autocompleteList.appendChild(item);
        });

        autocompleteList.classList.add('active');

        // Display results
        resultsContainer.style.display = 'block';
        displayConcepts(filtered, resultsGrid);
      });

      searchInput.addEventListener('keydown', (e) => {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
          updateHighlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightedIndex = Math.max(highlightedIndex - 1, -1);
          updateHighlight();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (highlightedIndex >= 0 && items[highlightedIndex]) {
            selectNote(items[highlightedIndex].textContent);
          }
        } else if (e.key === 'Escape') {
          autocompleteList.classList.remove('active');
          resultsContainer.style.display = 'none';
        }
      });

      function updateHighlight() {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
          if (index === highlightedIndex) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest' });
          } else {
            item.classList.remove('highlighted');
          }
        });
      }

      function selectNote(noteName) {
        window.location.href = `/bindu/${encodeURIComponent(noteName)}`;
      }

      // Close autocomplete when clicking outside
      document.addEventListener('click', (e) => {
        if (e.target !== searchInput && e.target !== autocompleteList) {
          autocompleteList.classList.remove('active');
        }
      });

      // Initialize on page load
      initializePage();

      document.getElementById('save-create-bindu').addEventListener('click', function() {
        const form = document.getElementById('create-bindu-form');
        const alertEl = document.getElementById('create-bindu-alert');
        const formData = new FormData(form);
        
        alertEl.style.display = 'none';
        
        fetch('/bindu/create', {
          method: 'POST',
          body: formData,
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(r => r.json()).then(data => {
          if (data && (data.status === 'ok' || data.status === 'warning')) {
            // Redirect to the new bindu
            window.location.href = data.url;
          } else {
            alertEl.className = 'alert alert-danger';
            alertEl.style.display = 'block';
            alertEl.innerText = (data && data.message) ? data.message : 'Error creating bindu';
          }
        }).catch(err => {
          alertEl.className = 'alert alert-danger';
          alertEl.style.display = 'block';
          alertEl.innerText = 'Error creating bindu';
        });
      });

