function copyRegistrationUrl() {
        const urlInput = document.getElementById('registration-url');
        urlInput.select();
        urlInput.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(urlInput.value);
        
        // Visual feedback
        const btn = event.target.closest('button');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-success');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('btn-success');
          btn.classList.add('btn-outline-secondary');
        }, 2000);
      }