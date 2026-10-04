// Status page for an applicant whose registration was not verified: correct the details and submit again.
(function () {
  'use strict';
  const { api } = window.NITA;
  const form = document.getElementById('resubmitForm');
  if (!form) return;
  const btn = document.getElementById('submitBtn');
  const formError = document.getElementById('formError');
  const MAX_PROOF = 500 * 1024;

  const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file')); r.readAsDataURL(file); });
  const loadImage = async (file) => { const url = await readAsDataUrl(file); return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('This image could not be opened')); i.src = url; }); };
  // Phone photos of certificates are large: shrink until under 500 KB, keeping text readable.
  async function shrinkProofImage(file) {
    const img = await loadImage(file);
    let out = '';
    for (const [side, quality] of [[1200, 0.75], [1000, 0.65], [800, 0.6]]) {
      const k = Math.min(1, side / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', quality);
      if (out.length * 0.75 <= MAX_PROOF) break;
    }
    return out;
  }
  const setError = (name, msg) => { const el = form.querySelector('.err[data-for="' + name + '"]'); if (el) el.textContent = msg || ''; const input = document.getElementById(name); if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
  const showError = (msg) => { formError.textContent = msg; formError.hidden = false; formError.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach((x) => (x.textContent = ''));
    formError.hidden = true;
    let firstBad = null;
    form.querySelectorAll('input[required], select[required]').forEach((el) => { if (!el.value.trim()) { setError(el.id, 'This is required'); firstBad = firstBad || el; } });
    if (firstBad) { firstBad.focus(); return showError('Please fill in the highlighted fields.'); }
    const data = Object.fromEntries(new FormData(form));
    const file = document.getElementById('proof').files[0];
    if (file) {
      try {
        const isImage = file.type === 'image/jpeg' || file.type === 'image/png';
        const proof = isImage ? await shrinkProofImage(file) : await readAsDataUrl(file);
        if (proof.length * 0.75 > MAX_PROOF) { setError('proof', 'This PDF is over 500 KB. Upload a photo of the certificate instead; it is shrunk automatically'); return showError('The proof document is too large.'); }
        data.proof = { name: file.name, data: proof };
      } catch (err) { setError('proof', err.message); return; }
    }
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await api('/api/v1/me/resubmit', { json: data });
      location.reload();
    } catch (err) {
      if (err.fields) Object.entries(err.fields).forEach(([k, v]) => setError(k, v));
      showError(err.message);
      btn.disabled = false; btn.textContent = 'Submit again';
    }
  });
})();
