const STORAGE_KEY = 'minibus-live-board-v1';
const routeList = document.querySelector('#route-list');
const searchInput = document.querySelector('#route-search');
const updatedLabel = document.querySelector('#board-updated');
const STATUS_LABELS = {
  'on-time': 'За графіком',
  delayed: 'Затримується',
  'at-stop': 'На зупинці'
};

async function readTrips() {
  try {
    const response = await fetch('/api/trips', { cache: 'no-store' });
    if (!response.ok) throw new Error(`сервер повернув статус ${response.status}`);
    const trips = await response.json();
    return Array.isArray(trips) ? trips.filter(isValidTrip) : [];
  } catch (error) {
    routeList.replaceChildren();
    const errorMessage = document.createElement('p');
    errorMessage.className = 'board-empty';
    errorMessage.textContent = `Не вдалося отримати рейси із сервера: ${error.message}`;
    routeList.append(errorMessage);
    return null;
  }
}

function isValidTrip(trip) {
  return trip && typeof trip.id === 'string'
    && typeof trip.routeName === 'string'
    && typeof trip.nextStop === 'string'
    && Number.isFinite(trip.etaMinutes)
    && Number.isFinite(Date.parse(trip.updatedAt));
}

function formatClock(date) {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

async function render() {
  const trips = await readTrips();
  if (!trips) return;
  const query = searchInput.value.trim().toLocaleLowerCase('uk-UA');
  const matchingTrips = trips
    .filter((trip) => `${trip.routeName} ${trip.vehicleName} ${trip.direction} ${trip.nextStop}`
      .toLocaleLowerCase('uk-UA').includes(query))
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt));

  routeList.replaceChildren();
  if (matchingTrips.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'board-empty';
    empty.textContent = trips.length === 0
      ? 'Поки немає активних рейсів. Коли водій оновить маршрут, він з’явиться тут.'
      : 'За цим запитом маршруток не знайдено.';
    routeList.append(empty);
  } else {
    matchingTrips.forEach((trip) => routeList.append(createTripCard(trip)));
  }
  updatedLabel.textContent = `Табло оновлено о ${formatClock(new Date())}`;
}

function createTripCard(trip) {
  const card = document.createElement('article');
  card.className = 'route-card';
  const main = document.createElement('div');
  main.className = 'route-card-main';
  main.append(createTextElement('h3', 'route-card-name', trip.routeName));
  const meta = document.createElement('div');
  meta.className = 'route-card-meta';
  if (trip.vehicleName) meta.append(createTextElement('span', '', `Маршрутка ${trip.vehicleName}`));
  if (trip.direction) meta.append(createTextElement('span', '', trip.direction));
  main.append(meta);

  const etaBlock = document.createElement('div');
  etaBlock.className = 'eta-block';
  const eta = document.createElement('div');
  const estimatedArrival = Date.parse(trip.updatedAt) + trip.etaMinutes * 60000;
  const etaExpired = estimatedArrival <= Date.now();
  eta.className = `eta-time${etaExpired ? ' eta-expired' : ''}`;
  const remainingMinutes = Math.max(0, trip.etaMinutes - Math.floor((Date.now() - Date.parse(trip.updatedAt)) / 60000));
  eta.append(document.createTextNode(etaExpired ? 'Час минув' : String(remainingMinutes)));
  if (remainingMinutes > 0) {
    const unit = document.createElement('small');
    unit.textContent = 'хв';
    eta.append(unit);
  }
  etaBlock.append(eta, createTextElement('div', 'eta-clock', `≈ ${formatClock(new Date(estimatedArrival))}`));
  const status = createTextElement('span', `trip-status${trip.status === 'delayed' ? ' is-delayed' : ''}${trip.status === 'at-stop' ? ' is-at-stop' : ''}`, STATUS_LABELS[trip.status] || STATUS_LABELS['on-time']);
  etaBlock.append(status);

  const stop = document.createElement('div');
  stop.className = 'route-card-stop';
  stop.append(document.createTextNode('Наступна зупинка: '), createTextElement('strong', '', trip.nextStop));
  const updated = createTextElement('div', 'route-card-updated', `Оновлено о ${formatClock(new Date(trip.updatedAt))}`);
  card.append(main, etaBlock, stop, updated);
  return card;
}

searchInput.addEventListener('input', render);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
  }
});
render();
window.setInterval(render, 15000);
