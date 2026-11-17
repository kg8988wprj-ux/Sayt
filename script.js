const form = document.getElementById('lead-form');
const status = document.getElementById('form-status');
const phone = document.getElementById('phone');
const submitButton = form.querySelector('button[type="submit"]');

phone.addEventListener('input', () => {
  phone.value = phone.value.replace(/[^\d+()\-\s]/g, '').slice(0, 24);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const payload = {
    name: data.get('name'),
    phone: data.get('phone'),
    email: data.get('email'),
    direction: data.get('direction'),
    consent: data.get('consent') === 'on',
    website: data.get('website') || ''
  };

  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  status.textContent = '';
  status.style.color = '#276346';

  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'Не удалось отправить заявку.');
    status.textContent = result.message;
    form.reset();
  } catch (error) {
    status.style.color = '#9c3e35';
    status.textContent = error.message || 'Ошибка соединения. Попробуйте ещё раз.';
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Заказать диплом <span>→</span>';
  }
});
