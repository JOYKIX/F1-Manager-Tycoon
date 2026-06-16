const START_YEAR = 1950;
const END_YEAR = 2026;
const MIN_MANAGER_AGE = 18;
const API_BASE_URL = 'https://api.jolpi.ca/ergast/f1';
const SAVE_KEY = 'f1-manager-tycoon-save';
const RACE_TICK_MS = 900;
const MAX_RACE_EVENTS = 8;

const seasonSelect = document.querySelector('#season-select');
const teamSelect = document.querySelector('#team-select');
const setupForm = document.querySelector('#setup-form');
const setupPanel = document.querySelector('#setup-panel');
const gamePanel = document.querySelector('#game-panel');
const saveStatus = document.querySelector('#save-status');
const birthDateInput = document.querySelector('#birth-date');
const workspace = document.querySelector('#workspace');
const pageNav = document.querySelector('#page-nav');

const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const cache = new Map();
let game = null;
let activePage = 'home';
let raceTimer = null;
let raceSpeed = 1;
let raceReplay = null;

const pages = [
  ['home', 'Accueil'],
  ['race', 'Course'],
  ['results', 'Résultats'],
  ['standings', 'Classements'],
  ['team', 'Équipe'],
  ['car', 'Voiture'],
  ['calendar', 'Calendrier'],
  ['finance', 'Finances'],
];

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

function profileForYear(year) { return regulationProfiles.find((profile) => year >= profile.from && year <= profile.to) ?? regulationProfiles.at(-1); }
function setStatus(text) { saveStatus.textContent = text; }
function ageAt(dateValue, year) { return year - new Date(`${dateValue}T00:00:00Z`).getUTCFullYear(); }
function maxBirthDate(year) { return `${year - MIN_MANAGER_AGE}-12-31`; }
function lifeExpectancy(firstName, lastName, birthDate) { return 72 + (`${firstName}${lastName}${birthDate}`.split('').reduce((total, char) => total + char.charCodeAt(0), 0) % 24); }
function baseBudget(year, teamCount) { return Math.round((8_000_000 + teamCount * 650_000) * (1 + ((year - START_YEAR) / 45))); }
function createSeasonShell(year) { return { year, constructors: [], drivers: [], races: [], constructorDrivers: new Map() }; }
function pointsForPosition(position) { return [25, 18, 15, 12, 10, 8, 6, 4, 2, 1][position - 1] ?? 0; }
function teamCarStats(team) { const base = team.strength ?? 60; return { chassis: base, aero: base, engine: base, reliability: 70 }; }
function carAverage(car) { return (car.chassis + car.aero + car.engine + car.reliability) / 4; }
function saveGame() { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); setStatus('Sauvegardé'); }
function loadSavedGame() { const saved = localStorage.getItem(SAVE_KEY); if (!saved) return null; try { return JSON.parse(saved); } catch { return null; } }
function metric(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function seedFrom(value) { return String(value).split('').reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261); }
function createRandom(seed) { let state = seed || 1; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }; }
function formatDelta(value) { if (value <= 0) return 'Leader'; return `+${value.toFixed(1)}s`; }
function positionClass(index) { return index < 3 ? `podium podium-${index + 1}` : ''; }
function renderTable(headers, rows, emptyText = '') {
  if (!rows.length) return emptyText ? `<div class="empty-state">${escapeHtml(emptyText)}</div>` : '';
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function issueLabel(entry, lap, totalLaps) {
  if (/accident|collision|spun|crash/i.test(entry.status)) return 'Accident';
  if (/engine|gearbox|transmission|hydraulics|electrical|brake|clutch|fuel|oil|power|turbo|overheating/i.test(entry.status)) return 'Problème';
  if (!/finished|\+\d+ lap|lap/i.test(entry.status) && Number(entry.laps) < totalLaps) return entry.status;
  if (lap > Math.max(2, Math.round(totalLaps * .15)) && Number(entry.laps) < lap) return 'Abandon';
  return '';
}

async function fetchTable(year, tableName) {
  const response = await fetch(`${API_BASE_URL}/${year}/${tableName}.json?limit=2000`);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

function mapDriver(driver, year) {
  return { id: driver.driverId, code: driver.code ?? '', name: `${driver.givenName} ${driver.familyName}`, dateOfBirth: driver.dateOfBirth, nationality: driver.nationality, rating: 60 + ((driver.driverId.length + year) % 31), potential: 65 + ((driver.familyName.length + year) % 31) };
}

async function fetchConstructorDrivers(year, constructorId) {
  const response = await fetch(`${API_BASE_URL}/${year}/constructors/${constructorId}/drivers.json?limit=2000`);
  if (!response.ok) throw new Error(`${response.status}`);
  const data = await response.json();
  return data.MRData.DriverTable.Drivers.map((driver) => mapDriver(driver, year)).sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchSeason(year) {
  if (cache.has(year)) return cache.get(year);
  const season = createSeasonShell(year);
  cache.set(year, season);
  const [driversData, constructorsData, racesData] = await Promise.all([fetchTable(year, 'drivers'), fetchTable(year, 'constructors'), fetchTable(year, 'races')]);
  season.drivers = driversData.MRData.DriverTable.Drivers.map((driver) => mapDriver(driver, year)).sort((a, b) => a.name.localeCompare(b.name));
  season.constructors = constructorsData.MRData.ConstructorTable.Constructors.map((constructor, index) => ({ id: constructor.constructorId, name: constructor.name, nationality: constructor.nationality, strength: 55 + ((constructor.constructorId.length * 7 + index + year) % 36) })).sort((a, b) => a.name.localeCompare(b.name));
  season.races = racesData.MRData.RaceTable.Races.map((race) => ({ round: Number(race.round), name: race.raceName, circuit: race.Circuit.circuitName, locality: race.Circuit.Location.locality, country: race.Circuit.Location.country, date: race.date }));
  return season;
}

async function driversForTeam(year, teamId) { const season = await fetchSeason(year); if (!season.constructorDrivers.has(teamId)) season.constructorDrivers.set(teamId, await fetchConstructorDrivers(year, teamId)); return season.constructorDrivers.get(teamId); }
async function buildEntrants(year, constructors, playerTeamId, playerDrivers) {
  const pairs = await Promise.all(constructors.map(async (team) => {
    const drivers = team.id === playerTeamId ? playerDrivers : await driversForTeam(year, team.id);
    return drivers.slice(0, 2).map((driver) => ({ driver, team, car: teamCarStats(team) }));
  }));
  return pairs.flat();
}
function seasonStandings() {
  const driverRows = new Map();
  const constructorRows = new Map();
  for (const result of Object.values(game.results ?? {})) {
    for (const row of result) {
      const driver = driverRows.get(row.driverId) ?? { driver: row.driver, constructor: row.constructor, points: 0, wins: 0 };
      const constructor = constructorRows.get(row.constructorId) ?? { constructor: row.constructor, nationality: row.nationality, points: 0, wins: 0 };
      driver.points += row.points;
      constructor.points += row.points;
      if (row.position === 1) { driver.wins += 1; constructor.wins += 1; }
      driverRows.set(row.driverId, driver);
      constructorRows.set(row.constructorId, constructor);
    }
  }
  const sortRows = (a, b) => b.points - a.points || b.wins - a.wins || a.driver?.localeCompare(b.driver) || a.constructor?.localeCompare(b.constructor);
  return {
    drivers: [...driverRows.values()].sort(sortRows).map((row, index) => ({ ...row, position: index + 1 })),
    constructors: [...constructorRows.values()].sort(sortRows).map((row, index) => ({ ...row, position: index + 1 })),
  };
}

function simulateRaceResults(race) {
  if (game.results?.[race.round]) return game.results[race.round];
  const random = createRandom(seedFrom(`${game.year}-${race.round}-${game.team.id}-${game.car.chassis}-${game.car.aero}-${game.car.engine}-${game.car.reliability}`));
  const totalLaps = 50 + (seedFrom(`${race.name}-${race.circuit}`) % 26);
  const rows = game.entrants.map((entry) => {
    const isPlayerTeam = entry.team.id === game.team.id;
    const car = isPlayerTeam ? game.car : entry.car;
    const driverRating = entry.driver.rating;
    const carScore = carAverage(car);
    const staffScore = isPlayerTeam ? ((game.staff.strategy + game.staff.pitStop) / 2) : entry.team.strength;
    const reliability = car.reliability;
    const incidentRoll = random();
    const retired = incidentRoll > Math.min(.985, .86 + reliability / 850);
    const laps = retired ? Math.max(1, Math.floor(totalLaps * (.35 + random() * .58))) : totalLaps;
    const score = (driverRating * 1.15) + (carScore * 1.45) + (staffScore * .35) + ((random() - .5) * 28) - (retired ? 120 : 0);
    return { entry, score, laps, retired };
  }).sort((a, b) => b.score - a.score);
  const results = rows.map((row, index) => ({
    position: index + 1,
    grid: Math.max(1, Math.round(index + 1 + ((random() - .5) * 8))),
    laps: row.laps,
    status: row.retired ? 'Abandon' : 'Terminé',
    driverId: row.entry.driver.id,
    driver: row.entry.driver.name,
    constructorId: row.entry.team.id,
    constructor: row.entry.team.name,
    nationality: row.entry.team.nationality,
    points: pointsForPosition(index + 1),
  }));
  game.results ??= {};
  game.results[race.round] = results;
  return results;
}

function weekendSessions(year, race) {
  const date = new Date(`${race.date}T12:00:00Z`);
  const day = (offset) => { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + offset); return dateFormat.format(copy); };
  if (year <= 1995) return [['Essais', day(-1)], ['Qualifications', day(-1)], ['Course', day(0)]];
  if (year <= 2002) return [['Essais libres 1', day(-2)], ['Essais libres 2', day(-1)], ['Qualifications', day(-1)], ['Course', day(0)]];
  if (year <= 2005) return [['Essais libres', day(-2)], ['Qualifications 1', day(-1)], ['Qualifications 2', day(0)], ['Course', day(0)]];
  if (year <= 2020) return [['Essais libres 1', day(-2)], ['Essais libres 2', day(-2)], ['Essais libres 3', day(-1)], ['Qualifications', day(-1)], ['Course', day(0)]];
  return [['Essais libres 1', day(-2)], ['Qualifications', day(-1)], ['Sprint', day(-1)], ['Course', day(0)]];
}

function renderShell() {
  const profile = profileForYear(game.year);
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.body.dataset.era = String(Math.floor(game.year / 10) * 10);
  document.querySelector('#manager-name').textContent = `${game.manager.firstName} ${game.manager.lastName}`;
  document.querySelector('#manager-age').textContent = String(ageAt(game.manager.birthDate, game.year));
  document.querySelector('#manager-life').textContent = `${game.manager.lifeExpectancy} ans`;
  document.querySelector('#current-season').textContent = String(game.year);
  document.querySelector('#current-team').textContent = game.team.name;
  document.querySelector('#budget').textContent = money.format(game.finance.budget);
  pageNav.replaceChildren(...pages.map(([key, label]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.page = key; button.className = key === activePage ? 'active' : ''; button.textContent = label; return button; }));
}

function renderGame() {
  if (!game) return;
  renderShell();
  const profile = profileForYear(game.year);
  const race = game.calendar[game.raceIndex] ?? game.calendar.at(-1);
  const renders = { home: () => renderHome(profile, race), race: () => renderRace(race), results: renderResults, standings: renderStandings, team: renderTeam, car: () => renderCar(profile), calendar: renderCalendar, finance: renderFinance };
  workspace.innerHTML = renders[activePage]?.() ?? renders.home();
}

function renderHome(profile, race) {
  return `<section class="dashboard">
    <article class="panel era-card"><h2>Décennie</h2><div class="era-preview"><span>${profile.layout}</span><span>${profile.powerUnit}</span><span>${profile.aero}</span></div></article>
    <article class="panel"><h2>Prochaine course</h2><div class="metrics">${metric('Grand Prix', race?.name ?? '')}${metric('Circuit', race?.circuit ?? '')}${metric('Date', race ? dateFormat.format(new Date(`${race.date}T12:00:00Z`)) : '')}</div></article>
    <article class="panel"><h2>Classement</h2><div class="metrics">${metric('Course', `${Math.min(game.raceIndex + 1, game.calendar.length)} / ${game.calendar.length}`)}${metric('Budget', money.format(game.finance.budget))}</div></article>
  </section>`;
}

function renderCar(profile) {
  return `<section class="dashboard"><article class="panel car-panel"><h2>Voiture</h2><div class="car-stage"><div class="car-shape"><span></span></div></div><div class="metrics">${metric('Châssis', game.car.chassis)}${metric('Aéro', game.car.aero)}${metric('Moteur', game.car.engine)}${metric('Fiabilité', game.car.reliability)}${metric('Format', `${profile.layout} · ${profile.powerUnit}`)}</div></article><article class="panel"><h2>Développement</h2><div class="actions">${action('Aéro', 'car', 'aero')}${action('Châssis', 'car', 'chassis')}${action('Moteur', 'car', 'engine')}${action('Fiabilité', 'car', 'reliability')}</div></article></section>`;
}

function renderTeam() {
  const drivers = game.drivers.map((driver) => `<div class="driver-card"><strong>${escapeHtml(driver.name)}</strong><span>${escapeHtml(driver.nationality)}</span><progress max="100" value="${driver.rating}"></progress><button type="button" data-driver="${driver.id}">Développer · ${money.format(500_000)}</button></div>`).join('');
  return `<section class="dashboard"><article class="panel"><h2>Pilotes</h2><div class="drivers">${drivers}</div></article><article class="panel"><h2>Équipe</h2><div class="metrics">${metric('Ingénierie', game.staff.engineering)}${metric('Stratégie', game.staff.strategy)}${metric('Pit-stop', game.staff.pitStop)}</div></article><article class="panel"><h2>Infrastructures</h2><div class="actions">${action('Usine', 'facility', 'factory')}${action('Simulateur', 'facility', 'simulator')}${action('Soufflerie', 'facility', 'windTunnel')}</div></article></section>`;
}

function renderRace(race) {
  if (!race) return '<section class="panel"></section>';
  const replay = raceReplay?.round === race.round ? raceReplay : null;
  const board = replay ? replay.live.map((entry, index) => `<tr class="${entry.issue ? 'race-issue' : ''} ${positionClass(index)}"><td>${index + 1}</td><td>${escapeHtml(entry.driver)}</td><td>${escapeHtml(entry.constructor)}</td><td>${entry.delta}</td><td>${entry.lastLap}</td><td>${escapeHtml(entry.issue)}</td></tr>`).join('') : '';
  const events = replay ? replay.events.slice(-MAX_RACE_EVENTS).map((event) => `<li>${event.lap}/${replay.totalLaps} · ${escapeHtml(event.text)}</li>`).join('') : '';
  return `<section class="race-grid"><article class="panel"><h2>${escapeHtml(race.name)}</h2><div class="metrics">${metric('Circuit', race.circuit)}${metric('Lieu', `${race.locality}, ${race.country}`)}${metric('Date', dateFormat.format(new Date(`${race.date}T12:00:00Z`)))}${metric('Tours', replay ? replay.totalLaps : '')}${metric('Tour', replay ? `${replay.currentLap} / ${replay.totalLaps}` : '')}</div><div class="actions race-controls"><button type="button" data-live="start">Départ</button><button type="button" data-live="pause">Pause</button><button type="button" data-live="speed">x${raceSpeed}</button><button type="button" id="next-race">Valider</button></div></article><article class="panel"><h2>Week-end</h2><ol>${weekendSessions(game.year, race).map(([name, date]) => `<li>${name} — ${date}</li>`).join('')}</ol></article><article class="panel live-panel"><h2>Temps réel</h2><progress max="100" value="${replay?.progress ?? 0}"></progress>${renderTable(['P', 'Pilote', 'Écurie', 'Delta', 'Tour', 'Problème'], board ? [board] : [], '')}</article><article class="panel events-panel"><h2>Événements</h2><ol>${events}</ol></article></section>`;
}

function renderCalendar() { return `<article class="panel calendar-panel"><h2>Calendrier</h2><ol>${game.calendar.map((race, index) => `<li class="${index < game.raceIndex ? 'done' : index === game.raceIndex ? 'current' : ''}">${race.round}. ${escapeHtml(race.name)} — ${escapeHtml(race.circuit)}</li>`).join('')}</ol></article>`; }
function renderResults() { return `<article class="panel"><h2>Résultats</h2><div id="results-table"></div></article>`; }
function renderStandings() { return `<section class="standings-grid"><article class="panel"><h2>Pilotes</h2><div id="driver-standings"></div></article><article class="panel"><h2>Constructeurs</h2><div id="constructor-standings"></div></article></section>`; }
function renderFinance() {
  const seasonDone = game.raceIndex >= game.calendar.length;
  const teams = (game.nextSeasonTeams ?? game.seasonTeams ?? []).map((team) => `<option value="${team.id}" ${team.id === game.team.id ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('');
  const next = seasonDone ? `<label>Écurie<select id="next-team-select">${teams}</select></label><button id="next-season" type="button">Saison suivante</button>` : '';
  return `<section class="dashboard"><article class="panel finance-panel"><h2>Finances</h2><div class="metrics">${metric('Revenus', money.format(game.finance.income))}${metric('Dépenses', money.format(game.finance.expenses))}${metric('Budget', money.format(game.finance.budget))}</div>${next}<button id="restart-game" type="button">Recommencer</button></article></section>`;
}
function action(label, dataName, key) { return `<button type="button" data-${dataName}="${key}">${label} · ${money.format(1_000_000)}</button>`; }

function renderResultsTable() {
  const container = document.querySelector('#results-table');
  if (!container || !game) return;
  const completed = game.calendar.slice(0, game.raceIndex);
  if (!completed.length) { container.textContent = ''; return; }
  const race = completed.at(-1);
  const results = game.results?.[race.round] ?? [];
  const rows = results.map((r, index) => `<tr class="${positionClass(index)}"><td>${r.position}</td><td>${escapeHtml(r.driver)}</td><td>${escapeHtml(r.constructor)}</td><td>${r.laps}</td><td>${escapeHtml(r.status)}</td><td>${r.points}</td></tr>`);
  container.innerHTML = `<h3>${escapeHtml(race.name)}</h3>${renderTable(['P', 'Pilote', 'Écurie', 'Tours', 'Statut', 'Pts'], rows)}`;
}
function renderStandingsTables() {
  const driverContainer = document.querySelector('#driver-standings');
  const constructorContainer = document.querySelector('#constructor-standings');
  if (!driverContainer || !constructorContainer || !game) return;
  if (!game.raceIndex) { driverContainer.textContent = ''; constructorContainer.textContent = ''; return; }
  const standings = seasonStandings();
  const driverRows = standings.drivers.map((standing, index) => `<tr class="${positionClass(index)}"><td>${standing.position}</td><td>${escapeHtml(standing.driver)}</td><td>${escapeHtml(standing.constructor)}</td><td>${standing.wins}</td><td>${standing.points}</td></tr>`);
  const constructorRows = standings.constructors.map((standing, index) => `<tr class="${positionClass(index)}"><td>${standing.position}</td><td>${escapeHtml(standing.constructor)}</td><td>${escapeHtml(standing.nationality)}</td><td>${standing.wins}</td><td>${standing.points}</td></tr>`);
  driverContainer.innerHTML = renderTable(['P', 'Pilote', 'Écurie', 'V', 'Pts'], driverRows);
  constructorContainer.innerHTML = renderTable(['P', 'Constructeur', 'Pays', 'V', 'Pts'], constructorRows);
}
function spend(amount) { if (game.finance.budget < amount) return false; game.finance.budget -= amount; game.finance.expenses += amount; return true; }
function developCar(key) { if (!spend(1_000_000)) return; game.car[key] = Math.min(100, game.car[key] + 3); saveGame(); renderGame(); }
function upgradeFacility(key) { if (!spend(1_000_000)) return; game.facilities[key] += 1; game.staff.engineering = Math.min(100, game.staff.engineering + 1); saveGame(); renderGame(); }
function developDriver(id) { if (!spend(500_000)) return; const driver = game.drivers.find((item) => item.id === id); driver.rating = Math.min(driver.potential, driver.rating + 2); saveGame(); renderGame(); }

async function createReplay(race) {
  const results = simulateRaceResults(race);
  const totalLaps = Math.max(...results.map((result) => Number(result.laps) || 0), 1);
  raceReplay = {
    round: race.round,
    tick: 0,
    currentLap: 0,
    totalLaps,
    progress: 0,
    events: [],
    live: results.map((result) => ({
      ...result,
      pace: 88 + result.position * 1.4,
      runningPosition: Math.max(1, Number(result.grid) || result.position),
      deltaValue: result.position === 1 ? 0 : result.position * 2.5,
      delta: result.position === 1 ? 'Leader' : `+${(result.position * 2.5).toFixed(1)}s`,
      lastLap: '',
      issue: '',
    })),
  };
}

function updateRaceReplay() {
  const nextLap = Math.min(raceReplay.totalLaps, raceReplay.currentLap + raceSpeed);
  const random = createRandom(seedFrom(`${game.year}-${raceReplay.round}-${nextLap}`));
  raceReplay.tick = nextLap;
  raceReplay.currentLap = nextLap;
  raceReplay.progress = Math.round((nextLap / raceReplay.totalLaps) * 100);
  raceReplay.live = raceReplay.live.map((entry) => {
    const target = entry.position * 3.2;
    const fluctuation = (random() - .5) * 2.4;
    const issue = entry.status === 'Abandon' && Number(entry.laps) < nextLap ? 'Abandon' : issueLabel(entry, nextLap, raceReplay.totalLaps);
    const lastLap = issue && Number(entry.laps) < nextLap ? '' : `1:${Math.max(8, entry.pace + fluctuation).toFixed(3)}`;
    const deltaValue = entry.position === 1 ? 0 : Math.max(0.1, (entry.deltaValue * .62) + (target * .38) + fluctuation);
    return { ...entry, issue, lastLap, deltaValue, delta: formatDelta(deltaValue) };
  }).sort((a, b) => {
    const progressA = Math.min(1, nextLap / Math.max(1, Number(a.laps)));
    const progressB = Math.min(1, nextLap / Math.max(1, Number(b.laps)));
    return ((a.position * progressA) + (a.runningPosition * (1 - progressA))) - ((b.position * progressB) + (b.runningPosition * (1 - progressB)));
  });
  raceReplay.live.forEach((entry, index) => {
    if (entry.runningPosition !== index + 1 && raceReplay.events.at(-1)?.driverId !== entry.driverId) {
      raceReplay.events.push({ lap: nextLap, driverId: entry.driverId, text: `${entry.driver} P${index + 1}` });
    }
    if (entry.issue && !raceReplay.events.some((event) => event.driverId === `${entry.driverId}-issue`)) {
      raceReplay.events.push({ lap: nextLap, driverId: `${entry.driverId}-issue`, text: `${entry.driver} · ${entry.issue}` });
    }
    entry.runningPosition = index + 1;
  });
}

async function startLiveRace() {
  const race = game.calendar[game.raceIndex];
  if (!race) return;
  if (!raceReplay || raceReplay.round !== race.round) await createReplay(race);
  clearInterval(raceTimer);
  raceTimer = setInterval(() => {
    updateRaceReplay();
    if (raceReplay.progress >= 100) clearInterval(raceTimer);
    renderGame();
  }, RACE_TICK_MS);
  renderGame();
}

function pauseLiveRace() { clearInterval(raceTimer); raceTimer = null; }
function changeRaceSpeed() { raceSpeed = raceSpeed === 1 ? 2 : raceSpeed === 2 ? 4 : raceSpeed === 4 ? 8 : 1; renderGame(); }

async function nextRace() {
  if (game.raceIndex >= game.calendar.length) return;
  const race = game.calendar[game.raceIndex];
  simulateRaceResults(race);
  const performance = game.car.chassis + game.car.aero + game.car.engine + game.car.reliability + game.staff.strategy + game.staff.pitStop;
  const income = Math.max(250_000, Math.round(performance * 15_000));
  game.finance.income += income;
  game.finance.budget += income;
  game.raceIndex += 1;
  if (game.raceIndex >= game.calendar.length && game.year < END_YEAR) {
    const nextSeasonData = await fetchSeason(game.year + 1);
    game.nextSeasonTeams = nextSeasonData.constructors;
  }
  raceReplay = null;
  pauseLiveRace();
  saveGame();
  renderGame();
}

async function nextSeason() {
  if (game.year >= END_YEAR || game.raceIndex < game.calendar.length) return;
  const nextTeamId = document.querySelector('#next-team-select')?.value ?? game.team.id;
  const season = await fetchSeason(game.year + 1);
  const team = season.constructors.find((constructor) => constructor.id === nextTeamId) ?? season.constructors[0];
  game.year += 1;
  game.team = team;
  game.seasonTeams = season.constructors;
  game.calendar = season.races;
  game.raceIndex = 0;
  game.drivers = await driversForTeam(game.year, game.team.id);
  game.entrants = await buildEntrants(game.year, game.seasonTeams, game.team.id, game.drivers);
  game.car = { ...teamCarStats(team), reliability: Math.max(45, Math.round(((game.car?.reliability ?? 70) + teamCarStats(team).reliability) / 2) - 8) };
  game.results = {};
  game.nextSeasonTeams = null;
  raceReplay = null;
  saveGame();
  renderGame();
}

function restartGame() { game = null; localStorage.removeItem(SAVE_KEY); gamePanel.classList.add('hidden'); setupPanel.classList.remove('hidden'); setStatus(''); }

async function populateTeams(year) {
  teamSelect.disabled = true;
  teamSelect.replaceChildren(new Option('Chargement', ''));
  try { const season = await fetchSeason(year); teamSelect.replaceChildren(...season.constructors.map((team) => new Option(team.name, team.id))); teamSelect.disabled = false; }
  catch { teamSelect.replaceChildren(new Option('Erreur', '')); }
}

async function startGame(formData) {
  const year = Number(formData.get('season'));
  const birthDate = formData.get('birthDate').toString();
  if (ageAt(birthDate, year) < MIN_MANAGER_AGE) return;
  const season = await fetchSeason(year);
  const team = season.constructors.find((constructor) => constructor.id === formData.get('team'));
  const firstName = formData.get('firstName').toString().trim();
  const lastName = formData.get('lastName').toString().trim();
  const drivers = await driversForTeam(year, team.id);
  game = { year, manager: { firstName, lastName, birthDate, lifeExpectancy: lifeExpectancy(firstName, lastName, birthDate) }, team, seasonTeams: season.constructors, drivers, calendar: season.races, raceIndex: 0, car: teamCarStats(team), staff: { engineering: 60, strategy: 60, pitStop: 60 }, facilities: { factory: 1, simulator: 1, windTunnel: 1 }, finance: { budget: baseBudget(year, season.constructors.length), income: 0, expenses: 0 }, results: {} };
  game.entrants = await buildEntrants(year, season.constructors, team.id, drivers);
  setupPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
  saveGame();
  renderGame();
}

seasonSelect.replaceChildren(...seasons.map((year) => new Option(String(year), String(year))));
seasonSelect.value = String(END_YEAR);
birthDateInput.max = maxBirthDate(END_YEAR);
populateTeams(END_YEAR);

seasonSelect.addEventListener('change', () => { const year = Number(seasonSelect.value); birthDateInput.max = maxBirthDate(year); populateTeams(year); });
setupForm.addEventListener('submit', (event) => { event.preventDefault(); startGame(new FormData(setupForm)); });

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (target.dataset.page) { activePage = target.dataset.page; renderGame(); if (activePage === 'results') renderResultsTable(); if (activePage === 'standings') renderStandingsTables(); return; }
  if (!game) return;
  if (target.dataset.car) developCar(target.dataset.car);
  if (target.dataset.facility) upgradeFacility(target.dataset.facility);
  if (target.dataset.driver) developDriver(target.dataset.driver);
  if (target.dataset.live === 'start') startLiveRace();
  if (target.dataset.live === 'pause') pauseLiveRace();
  if (target.dataset.live === 'speed') changeRaceSpeed();
  if (target.id === 'next-race') nextRace();
  if (target.id === 'next-season') nextSeason();
  if (target.id === 'restart-game') restartGame();
});

const savedGame = loadSavedGame();
if (savedGame) { game = savedGame; game.results ??= {}; game.seasonTeams ??= [game.team]; game.entrants ??= game.drivers.map((driver) => ({ driver, team: game.team, car: game.car })); setupPanel.classList.add('hidden'); gamePanel.classList.remove('hidden'); renderGame(); }
else { setStatus(''); }
