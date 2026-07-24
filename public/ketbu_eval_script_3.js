
function showCustomConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const messageEl = document.getElementById('customConfirmMessage');
        const btnOk = document.getElementById('customConfirmOk');
        const btnCancel = document.getElementById('customConfirmCancel');

        messageEl.textContent = message;
        modal.style.display = 'flex';

        const handleOk = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', handleOk);
            btnCancel.removeEventListener('click', handleCancel);
        };

        btnOk.addEventListener('click', handleOk);
        btnCancel.addEventListener('click', handleCancel);
    });
}
