const STORAGE_KEY = 'minibus-gps-tracker-v1';

const routeForm = document.querySelector('#route-form');
const routeNameInput = document.querySelector('#route-name');
const vehicleNameInput = document.querySelector('#vehicle-name');
const radiusInput = document.querySelector('#geofence-radius');
const stopEditorList = document.querySelector('#stop-editor-list');
const addStopButton = document.querySelector('#add-stop');
const trackingPanel = document.querySelector('#tracking-panel');
const trackingRoute = document.querySelector('#tracking-route');
const gpsStatus = document.querySelector('#gps-status');
const gpsPosition = document.querySelector('#gps-position');
const stopTimeline = document.querySelector('#stop-timeline');
const historyList = document.querySelector('#history-list');
const message = document.querySelector('#message');

let history = [];
let activeTrip = null;
let watchId = null;
let nextStopId = 0;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('is-error', isError);
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ history, activeTrip }));
    return true;
  } catch (error) {
    setMessage(`Не вдалося зберегти дані в браузері: ${error.message}`, true);
    return false;
  }
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    history = Array.isArray(saved.history) ? saved.history : [];
    activeTrip = saved.activeTrip && Array.isArray(saved.activeTrip.stops) ? saved.activeTrip : null;
  } catch (error) {
    setMessage(`Не вдалося прочитати збережені дані: ${error.message}`, true);
  }
}

function makeStopEditor(stop = {}) {
  const row = document.createElement('div');
  row.className = 'stop-editor';
  row.dataset.stopId = String(nextStopId++);
  row.innerHTML = `
    <label class="stop-name-label">
      <span class="visually-hidden">Назва зупинки</span>
      <input class="stop-name" type="text" placeholder="Назва зупинки" value="${escapeHtml(stop.name || '')}" required>
    </label>
    <button class="secondary-button capture-location" type="button">Записати моє місце</button>
    <span class="coordinate-label">${stop.lat != null && stop.lng != null ? 'GPS збережено' : 'GPS не задано'}</span>
    <button class="remove-stop" type="button" aria-label="Видалити зупинку">×</button>
  `;
  row.dataset.lat = stop.lat ?? '';
  row.dataset.lng = stop.lng ?? '';

  row.querySelector('.capture-location').addEventListener('click', () => {
    if (!canUseGeolocation()) {
      return;
    }
    setMessage('Отримуємо координати з GPS…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        row.dataset.lat = String(position.coords.latitude);
        row.dataset.lng = String(position.coords.longitude);
        row.querySelector('.coordinate-label').textContent =
          `GPS: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
        setMessage('Координати зупинки збережено.');
      },
      showGeolocationError,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  row.querySelector('.remove-stop').addEventListener('click', () => {
    if (stopEditorList.children.length <= 2) {
      setMessage('У маршруті має залишатися щонайменше дві зупинки.', true);
      return;
    }
    row.remove();
  });
  stopEditorList.append(row);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function collectStops() {
  return [...stopEditorList.querySelectorAll('.stop-editor')].map((row) => {
    const hasCoordinates = row.dataset.lat !== '' && row.dataset.lng !== '';
    return {
      name: row.querySelector('.stop-name').value.trim(),
      lat: hasCoordinates ? Number(row.dataset.lat) : Number.NaN,
      lng: hasCoordinates ? Number(row.dataset.lng) : Number.NaN,
      arrivalAt: null,
      departureAt: null
    };
  });
}

function validateRoute(stops, radius) {
  if (!routeNameInput.value.trim()) {
    return 'Вкажіть назву маршруту.';
  }
  if (stops.length < 2 || stops.some((stop) => !stop.name)) {
    return 'Додайте щонайменше дві зупинки та вкажіть їхні назви.';
  }
  if (stops.some((stop) => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng))) {
    return 'Запишіть GPS-координати для кожної зупинки.';
  }
  if (!Number.isFinite(radius) || radius < 30 || radius > 1000) {
    return 'Радіус має бути від 30 до 1000 метрів.';
  }
  return '';
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function canUseGeolocation() {
  if (!window.isSecureContext) {
    setMessage('Геолокація працює лише на HTTPS-сайті. Відкрийте безпечну HTTPS-адресу.', true);
    return false;
  }
  if (!navigator.geolocation) {
    setMessage('Цей браузер або пристрій не підтримує геолокацію.', true);
    return false;
  }
  return true;
}

function startWatching() {
  if (!canUseGeolocation()) return;
  watchId = navigator.geolocation.watchPosition(onPosition, showGeolocationError, {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 20000
  });
}

function showGeolocationError(error) {
  const explanations = {
    1: 'Доступ до геолокації заборонено. Дозвольте його в налаштуваннях браузера.',
    2: 'GPS-координати зараз недоступні. Перевірте сигнал і налаштування геолокації.',
    3: 'Час очікування GPS вичерпано. Перевірте сигнал і спробуйте ще раз.'
  };
  const description = explanations[error.code] || `Помилка геолокації: ${error.message}`;
  gpsStatus.textContent = 'Немає GPS-сигналу';
  setMessage(description, true);
}

function distanceInMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371000;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function onPosition(position) {
  if (!activeTrip) return;
  const current = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };
  const accuracy = position.coords.accuracy;
  gpsStatus.textContent = `GPS працює · точність приблизно ${Math.round(accuracy)} м`;
  gpsPosition.textContent = `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)} · ${formatDateTime(new Date(position.timestamp).toISOString())}`;
  const stop = activeTrip.stops.find((item) => !item.departureAt);

  if (stop) {
    const distance = distanceInMeters(current, stop);
    if (accuracy > activeTrip.radius / 2) {
      gpsStatus.textContent = `Сигнал GPS неточний (${Math.round(accuracy)} м) · очікуємо точніше місце`;
    } else if (!stop.arrivalAt && distance <= activeTrip.radius) {
      stop.arrivalAt = new Date().toISOString();
      const saved = persistState();
      if (saved) setMessage(`Зафіксовано прибуття: ${stop.name}.`);
      renderTracking();
    } else if (stop.arrivalAt && distance >= activeTrip.radius * 1.5) {
      stop.departureAt = new Date().toISOString();
      const saved = persistState();
      if (saved) setMessage(`Зафіксовано відправлення: ${stop.name}.`);
      renderTracking();
    } else if (!stop.arrivalAt) {
      gpsStatus.textContent = `Очікуємо зупинку «${stop.name}» · ${Math.round(distance)} м`;
    } else {
      gpsStatus.textContent = `На зупинці «${stop.name}» · ${Math.round(distance)} м`;
    }
  } else {
    gpsStatus.textContent = 'Усі зупинки пройдено · завершіть рейс';
  }
}

function renderTracking() {
  trackingPanel.hidden = !activeTrip;
  routeForm.hidden = Boolean(activeTrip);
  if (!activeTrip) return;

  trackingRoute.textContent = `${activeTrip.routeName}${activeTrip.vehicleName ? ` · ${activeTrip.vehicleName}` : ''} · початок ${formatDateTime(activeTrip.startedAt)}`;
  stopTimeline.replaceChildren();
  activeTrip.stops.forEach((stop) => {
    const item = document.createElement('li');
    item.className = `timeline-stop${stop.arrivalAt ? ' is-arrived' : ''}${stop.departureAt ? ' is-departed' : ''}`;
    const title = document.createElement('strong');
    title.textContent = stop.name;
    const detail = document.createElement('span');
    detail.textContent = stop.departureAt
      ? `Прибуття ${formatDateTime(stop.arrivalAt)} · Відправлення ${formatDateTime(stop.departureAt)}`
      : stop.arrivalAt
        ? `Прибуття ${formatDateTime(stop.arrivalAt)} · очікуємо відправлення`
        : 'Очікуємо прибуття';
    item.append(title, detail);
    stopTimeline.append(item);
  });
}

function renderHistory() {
  historyList.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Завершені рейси з’являться тут.';
    historyList.append(empty);
    return;
  }

  history.slice().reverse().forEach((trip) => {
    const card = document.createElement('article');
    card.className = 'history-card';
    const heading = document.createElement('strong');
    heading.textContent = trip.routeName;
    const vehicle = document.createElement('span');
    vehicle.className = 'history-meta';
    vehicle.textContent = `${trip.vehicleName || 'Без номера'} · ${formatDateTime(trip.startedAt)} — ${formatDateTime(trip.finishedAt)}`;
    const stops = document.createElement('span');
    stops.className = 'history-meta';
    stops.textContent = `${trip.stops.filter((stop) => stop.arrivalAt).length}/${trip.stops.length} зупинок відвідано`;
    card.append(heading, vehicle, stops);
    historyList.append(card);
  });
}

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

routeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const stops = collectStops();
  const radius = Number(radiusInput.value);
  const validationMessage = validateRoute(stops, radius);
  if (validationMessage) {
    setMessage(validationMessage, true);
    return;
  }
  if (!canUseGeolocation()) return;

  activeTrip = {
    routeName: routeNameInput.value.trim(),
    vehicleName: vehicleNameInput.value.trim(),
    radius,
    startedAt: new Date().toISOString(),
    stops
  };
  const saved = persistState();
  renderTracking();
  startWatching();
  if (saved) setMessage('Рейс розпочато. Дозвольте геолокацію та залиште цю вкладку відкритою.');
});

document.querySelector('#finish-trip').addEventListener('click', () => {
  if (!activeTrip) return;
  const completedTrip = { ...activeTrip, finishedAt: new Date().toISOString() };
  history.push(completedTrip);
  activeTrip = null;
  stopWatching();
  const saved = persistState();
  renderTracking();
  renderHistory();
  if (saved) setMessage('Рейс завершено та збережено на цьому пристрої.');
});

addStopButton.addEventListener('click', () => makeStopEditor());

document.querySelector('#export-history').addEventListener('click', () => {
  if (history.length === 0) {
    setMessage('Немає рейсів для експорту.', true);
    return;
  }
  const rows = [['Маршрут', 'Номер', 'Початок рейсу', 'Кінець рейсу', 'Зупинка', 'Прибуття', 'Відправлення']];
  history.forEach((trip) => {
    trip.stops.forEach((stop) => rows.push([
      trip.routeName, trip.vehicleName, formatDateTime(trip.startedAt), formatDateTime(trip.finishedAt),
      stop.name, formatDateTime(stop.arrivalAt), formatDateTime(stop.departureAt)
    ]));
  });
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const download = document.createElement('a');
  download.href = url;
  download.download = 'рейси-маршрутки.csv';
  download.click();
  URL.revokeObjectURL(url);
  setMessage('Журнал рейсів експортовано у CSV.');
});

readState();
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .catch((error) => setMessage(`Не вдалося ввімкнути офлайн-режим: ${error.message}`, true));
}
if (activeTrip) {
  routeNameInput.value = activeTrip.routeName;
  vehicleNameInput.value = activeTrip.vehicleName;
  radiusInput.value = String(activeTrip.radius);
  activeTrip.stops.forEach((stop) => makeStopEditor(stop));
  startWatching();
  setMessage('Відновлено активний рейс. GPS-відстеження продовжується.');
} else {
  makeStopEditor({ name: 'Початкова зупинка' });
  makeStopEditor({ name: 'Кінцева зупинка' });
}
renderTracking();
renderHistory();
