
    function showToast(message, type = 'error') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; font-size:24px;"></i> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
