const START_YEAR = 1950;
const END_YEAR = 2026;
const MIN_MANAGER_AGE = 18;
const API_BASE_URL = 'https://api.jolpi.ca/ergast/f1';
const SAVE_KEY = 'f1-manager-tycoon-save';

const seasonSelect = document.querySelector('#season-select');
const teamSelect = document.querySelector('#team-select');
const setupForm = document.querySelector('#setup-form');
const setupPanel = document.querySelector('#setup-panel');
const gamePanel = document.querySelector('#game-panel');
const saveStatus = document.querySelector('#save-status');
const birthDateInput = document.querySelector('#birth-date');
const restartButton = document.querySelector('#restart-game');

const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const cache = new Map();
let game = null;

const regulationProfiles = [
  { from: 1950, to: 1960, layout: 'Moteur avant', aero: 'Faible', powerUnit: 'Atmosphérique', accent: '#c9b27c' },
  { from: 1961, to: 1976, layout: 'Moteur arrière', aero: 'Ailerons', powerUnit: 'Atmosphérique', accent: '#e56b3f' },
  { from: 1977, to: 1988, layout: 'Effet de sol', aero: 'Jupes', powerUnit: 'Turbo', accent: '#ff3b30' },
  { from: 1989, to: 1997, layout: 'Monoplace étroite', aero: 'Diffuseur', powerUnit: 'V10/V12', accent: '#2979ff' },
  { from: 1998, to: 2008, layout: 'Rainures', aero: 'Appendices', powerUnit: 'V10/V8', accent: '#d500f9' },
  { from: 2009, to: 2013, layout: 'Aéro simplifiée', aero: 'KERS', powerUnit: 'V8', accent: '#00bcd4' },
  { from: 2014, to: 2021, layout: 'Hybride', aero: 'Complexe', powerUnit: 'V6 turbo hybride', accent: '#00c853' },
  { from: 2022, to: 2026, layout: 'Effet de sol', aero: 'Plancher', powerUnit: 'V6 turbo hybride', accent: '#ff1744' },
];

const seasons = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, index) => START_YEAR + index);

function profileForYear(year) {
  return regulationProfiles.find((profile) => year >= profile.from && year <= profile.to) ?? regulationProfiles.at(-1);
}

function setStatus(text) {
  saveStatus.textContent = text;
}

function ageAt(dateValue, year) {
  const birth = new Date(`${dateValue}T00:00:00Z`);
  return year - birth.getUTCFullYear();
}

function maxBirthDate(year) {
  return `${year - MIN_MANAGER_AGE}-12-31`;
}

function lifeExpectancy(firstName, lastName, birthDate) {
  const seed = `${firstName}${lastName}${birthDate}`.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return 72 + (seed % 24);
}

function baseBudget(year, teamCount) {
  const eraMultiplier = 1 + ((year - START_YEAR) / 45);
  return Math.round((8_000_000 + teamCount * 650_000) * eraMultiplier);
}

function createSeasonShell(year) {
  return { year, constructors: [], drivers: [], races: [], constructorDrivers: new Map() };
}

async function fetchTable(year, tableName) {
  const response = await fetch(`${API_BASE_URL}/${year}/${tableName}.json?limit=2000`);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

function mapDriver(driver, year) {
  return {
    id: driver.driverId,
    code: driver.code ?? '',
    name: `${driver.givenName} ${driver.familyName}`,
    dateOfBirth: driver.dateOfBirth,
    nationality: driver.nationality,
    rating: 60 + ((driver.driverId.length + year) % 31),
    potential: 65 + ((driver.familyName.length + year) % 31),
  };
}

async function fetchConstructorDrivers(year, constructorId) {
  const response = await fetch(`${API_BASE_URL}/${year}/constructors/${constructorId}/drivers.json?limit=2000`);
  if (!response.ok) throw new Error(`${response.status}`);
  const data = await response.json();
  return data.MRData.DriverTable.Drivers.map((driver) => mapDriver(driver, year))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchSeason(year) {
  if (cache.has(year)) return cache.get(year);

  const season = createSeasonShell(year);
  cache.set(year, season);

  const [driversData, constructorsData, racesData] = await Promise.all([
    fetchTable(year, 'drivers'),
    fetchTable(year, 'constructors'),
    fetchTable(year, 'races'),
  ]);

  season.drivers = driversData.MRData.DriverTable.Drivers.map((driver) => mapDriver(driver, year))
    .sort((a, b) => a.name.localeCompare(b.name));

  season.constructors = constructorsData.MRData.ConstructorTable.Constructors.map((constructor, index) => ({
    id: constructor.constructorId,
    name: constructor.name,
    nationality: constructor.nationality,
    strength: 55 + ((constructor.constructorId.length * 7 + index + year) % 36),
  })).sort((a, b) => a.name.localeCompare(b.name));

  season.races = racesData.MRData.RaceTable.Races.map((race) => ({
    round: Number(race.round),
    name: race.raceName,
    circuit: race.Circuit.circuitName,
    locality: race.Circuit.Location.locality,
    country: race.Circuit.Location.country,
    date: race.date,
  }));

  return season;
}

async function driversForTeam(year, teamId) {
  const season = await fetchSeason(year);
  if (!season.constructorDrivers.has(teamId)) {
    season.constructorDrivers.set(teamId, await fetchConstructorDrivers(year, teamId));
  }
  return season.constructorDrivers.get(teamId);
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  setStatus('Sauvegardé');
}

function loadSavedGame() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
}

function metric(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function renderGame() {
  if (!game) return;
  const profile = profileForYear(game.year);
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.body.dataset.era = String(Math.floor(game.year / 10) * 10);

  document.querySelector('#manager-name').textContent = `${game.manager.firstName} ${game.manager.lastName}`;
  document.querySelector('#manager-age').textContent = String(ageAt(game.manager.birthDate, game.year));
  document.querySelector('#manager-life').textContent = `${game.manager.lifeExpectancy} ans`;
  document.querySelector('#current-season').textContent = String(game.year);
  document.querySelector('#current-team').textContent = game.team.name;
  document.querySelector('#budget').textContent = money.format(game.finance.budget);
  document.querySelector('#era-preview').textContent = `${profile.layout} · ${profile.powerUnit} · ${profile.aero}`;

  document.querySelector('#car-stage').innerHTML = `<div class="car-shape"><span></span></div>`;
  document.querySelector('#car-metrics').innerHTML = [
    metric('Châssis', game.car.chassis), metric('Aéro', game.car.aero), metric('Moteur', game.car.engine), metric('Fiabilité', game.car.reliability),
  ].join('');
  document.querySelector('#team-metrics').innerHTML = [
    metric('Ingénierie', game.staff.engineering), metric('Stratégie', game.staff.strategy), metric('Pit-stop', game.staff.pitStop),
  ].join('');
  document.querySelector('#finance-metrics').innerHTML = [
    metric('Revenus', money.format(game.finance.income)), metric('Dépenses', money.format(game.finance.expenses)), metric('Course', `${Math.min(game.raceIndex + 1, game.calendar.length)} / ${game.calendar.length}`),
  ].join('');

  document.querySelector('#drivers-list').replaceChildren(...game.drivers.map((driver) => {
    const card = document.createElement('div');
    card.className = 'driver-card';
    card.innerHTML = `<strong>${driver.name}</strong><span>${driver.nationality}</span><progress max="100" value="${driver.rating}"></progress><button type="button" data-driver="${driver.id}">Développer</button>`;
    return card;
  }));

  renderActions('#development-actions', [['Aéro', 'aero'], ['Châssis', 'chassis'], ['Moteur', 'engine'], ['Fiabilité', 'reliability']], 'car');
  renderActions('#facility-actions', [['Usine', 'factory'], ['Simulateur', 'simulator'], ['Soufflerie', 'windTunnel']], 'facility');
  document.querySelector('#calendar-list').replaceChildren(...game.calendar.map((race, index) => {
    const item = document.createElement('li');
    item.className = index < game.raceIndex ? 'done' : index === game.raceIndex ? 'current' : '';
    item.textContent = `${race.round}. ${race.name} — ${race.circuit}`;
    return item;
  }));
}

function renderActions(selector, actions, type) {
  document.querySelector(selector).replaceChildren(...actions.map(([label, key]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset[type] = key;
    button.textContent = `${label} · ${money.format(1_000_000)}`;
    return button;
  }));
}

function spend(amount) {
  if (game.finance.budget < amount) return false;
  game.finance.budget -= amount;
  game.finance.expenses += amount;
  return true;
}

function developCar(key) {
  if (!spend(1_000_000)) return;
  game.car[key] = Math.min(100, game.car[key] + 3);
  saveGame();
  renderGame();
}

function upgradeFacility(key) {
  if (!spend(1_000_000)) return;
  game.facilities[key] += 1;
  game.staff.engineering = Math.min(100, game.staff.engineering + 1);
  saveGame();
  renderGame();
}

function developDriver(id) {
  if (!spend(500_000)) return;
  const driver = game.drivers.find((item) => item.id === id);
  driver.rating = Math.min(driver.potential, driver.rating + 2);
  saveGame();
  renderGame();
}

function nextRace() {
  if (game.raceIndex >= game.calendar.length) return;
  const performance = game.car.chassis + game.car.aero + game.car.engine + game.car.reliability + game.staff.strategy + game.staff.pitStop;
  const income = Math.max(250_000, Math.round(performance * 15_000));
  game.finance.income += income;
  game.finance.budget += income;
  game.raceIndex += 1;
  saveGame();
  renderGame();
}

async function nextSeason() {
  if (game.year >= END_YEAR) return;
  const season = await fetchSeason(game.year + 1);
  game.year += 1;
  game.calendar = season.races;
  game.raceIndex = 0;
  game.drivers = await driversForTeam(game.year, game.team.id);
  game.car.reliability = Math.max(45, game.car.reliability - 8);
  saveGame();
  renderGame();
}

function restartGame() {
  game = null;
  localStorage.removeItem(SAVE_KEY);
  gamePanel.classList.add('hidden');
  setupPanel.classList.remove('hidden');
  setStatus('');
}

async function populateTeams(year) {
  teamSelect.disabled = true;
  teamSelect.replaceChildren(new Option('Chargement', ''));
  try {
    const season = await fetchSeason(year);
    teamSelect.replaceChildren(...season.constructors.map((team) => new Option(team.name, team.id)));
    teamSelect.disabled = false;
  } catch {
    teamSelect.replaceChildren(new Option('Erreur', ''));
  }
}

async function startGame(formData) {
  const year = Number(formData.get('season'));
  const birthDate = formData.get('birthDate').toString();
  if (ageAt(birthDate, year) < MIN_MANAGER_AGE) return;

  const season = await fetchSeason(year);
  const team = season.constructors.find((constructor) => constructor.id === formData.get('team'));
  const firstName = formData.get('firstName').toString().trim();
  const lastName = formData.get('lastName').toString().trim();

  game = {
    year,
    manager: { firstName, lastName, birthDate, lifeExpectancy: lifeExpectancy(firstName, lastName, birthDate) },
    team,
    drivers: await driversForTeam(year, team.id),
    calendar: season.races,
    raceIndex: 0,
    car: { chassis: team.strength, aero: team.strength, engine: team.strength, reliability: 70 },
    staff: { engineering: 60, strategy: 60, pitStop: 60 },
    facilities: { factory: 1, simulator: 1, windTunnel: 1 },
    finance: { budget: baseBudget(year, season.constructors.length), income: 0, expenses: 0 },
  };

  setupPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
  saveGame();
  renderGame();
}

seasonSelect.replaceChildren(...seasons.map((year) => new Option(String(year), String(year))));
seasonSelect.value = String(END_YEAR);
birthDateInput.max = maxBirthDate(END_YEAR);
populateTeams(END_YEAR);

seasonSelect.addEventListener('change', () => {
  const year = Number(seasonSelect.value);
  birthDateInput.max = maxBirthDate(year);
  populateTeams(year);
});

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  startGame(new FormData(setupForm));
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !game) return;
  if (target.dataset.car) developCar(target.dataset.car);
  if (target.dataset.facility) upgradeFacility(target.dataset.facility);
  if (target.dataset.driver) developDriver(target.dataset.driver);
});

document.querySelector('#next-race').addEventListener('click', nextRace);
document.querySelector('#next-season').addEventListener('click', nextSeason);
restartButton.addEventListener('click', restartGame);

const savedGame = loadSavedGame();
if (savedGame) {
  game = savedGame;
  setupPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
  renderGame();
} else {
  setStatus('');
}
