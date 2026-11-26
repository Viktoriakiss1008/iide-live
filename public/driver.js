const STORAGE_KEY = 'minibus-live-board-v1';
const form = document.querySelector('#driver-form');
const message = document.querySelector('#driver-message');
const activePanel = document.querySelector('#active-trip-panel');
const activeName = document.querySelector('#active-trip-name');
const activeSummary = document.querySelector('#active-trip-summary');
const endTripButton = document.querySelector('#end-trip');

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('is-error', isError);
}

async function readTrips() {
  try {
    const response = await fetch('/api/trips', { cache: 'no-store' });
    if (!response.ok) throw new Error(`сервер повернув статус ${response.status}`);
    const saved = await response.json();
    if (!Array.isArray(saved)) throw new Error('неочікуваний формат даних');
    return saved;
  } catch (error) {
    setMessage(`Не вдалося отримати рейси із сервера: ${error.message}`, true);
    return null;
  }
}

async function saveTrip(trip) {
  try {
    const response = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `сервер повернув статус ${response.status}`);
    }
    return true;
  } catch (error) {
    setMessage(`Не вдалося опублікувати рейс: ${error.message}`, true);
    return false;
  }
}

async function deleteTrip(tripId) {
  try {
    const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`сервер повернув статус ${response.status}`);
    return true;
  } catch (error) {
    setMessage(`Не вдалося завершити рейс: ${error.message}`, true);
    return false;
  }
}

function renderActiveTrip(trip) {
  activePanel.hidden = !trip;
  if (!trip) return;
  activeName.textContent = trip.routeName;
  activeSummary.textContent = `${trip.vehicleName ? `Маршрутка ${trip.vehicleName} · ` : ''}${trip.direction ? `${trip.direction} · ` : ''}наступна зупинка: ${trip.nextStop}, прибуття приблизно за ${trip.etaMinutes} хв.`;
}

function getDriverTripId() {
  try {
    return sessionStorage.getItem('minibus-driver-trip-id');
  } catch (error) {
    setMessage(`Не вдалося відновити активний рейс: ${error.message}`, true);
    return null;
  }
}

function rememberDriverTripId(id) {
  try {
    sessionStorage.setItem('minibus-driver-trip-id', id);
  } catch (error) {
    setMessage(`Рейс збережено, але його не вдалося запам’ятати: ${error.message}`, true);
  }
}

function restoreForm(trip) {
  if (!trip) return;
  document.querySelector('#route-name').value = trip.routeName;
  document.querySelector('#vehicle-name').value = trip.vehicleName || '';
  document.querySelector('#direction').value = trip.direction || '';
  document.querySelector('#next-stop').value = trip.nextStop;
  document.querySelector('#eta-minutes').value = String(trip.etaMinutes);
  document.querySelector('#trip-status').value = trip.status || 'on-time';
}

async function refreshActiveTrip() {
  const trips = await readTrips();
  if (!trips) return;
  const tripId = getDriverTripId();
  const trip = trips.find((item) => item.id === tripId) || null;
  renderActiveTrip(trip);
  if (trip) restoreForm(trip);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const trips = await readTrips();
  if (!trips) return;

  const id = getDriverTripId() || (
    globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `trip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const trip = {
    id,
    routeName: document.querySelector('#route-name').value.trim(),
    vehicleName: document.querySelector('#vehicle-name').value.trim(),
    direction: document.querySelector('#direction').value.trim(),
    nextStop: document.querySelector('#next-stop').value.trim(),
    etaMinutes: Number(document.querySelector('#eta-minutes').value),
    status: document.querySelector('#trip-status').value,
    updatedAt: new Date().toISOString()
  };
  if (!Number.isInteger(trip.etaMinutes) || trip.etaMinutes < 0 || trip.etaMinutes > 180) {
    setMessage('Вкажіть час прибуття від 0 до 180 хвилин.', true);
    return;
  }

  if (!(await saveTrip(trip))) return;
  rememberDriverTripId(id);
  renderActiveTrip(trip);
  setMessage('Час прибуття опубліковано на спільному табло.');
});

endTripButton.addEventListener('click', async () => {
  const trips = await readTrips();
  if (!trips) return;
  const tripId = getDriverTripId();
  if (!tripId) {
    setMessage('Не вдалося знайти активний рейс.', true);
    return;
  }
  if (!(await deleteTrip(tripId))) return;
  try {
    sessionStorage.removeItem('minibus-driver-trip-id');
  } catch (error) {
    setMessage(`Рейс завершено, але активний рейс не вдалося очистити: ${error.message}`, true);
  }
  form.reset();
  document.querySelector('#eta-minutes').value = '10';
  renderActiveTrip(null);
  setMessage('Рейс завершено та прибрано з табло.');
});

refreshActiveTrip();
