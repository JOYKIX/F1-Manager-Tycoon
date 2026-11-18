import { STRATEGIES, strategyFor, retirementChance, developmentGain, trainingGain, facilityCost, raceIncome, TYRES, tyreFor, tyreModifiers, raceWeather, SPONSORS, sponsorFor, sponsorPayout, pointsForYear, seasonTitleBonus, DIFFICULTIES, difficultyFor, aiCompetition } from './gameplay.js';

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
  ['home', 'Dashboard', '◈'],
  ['race', 'Course', '⚑'],
  ['results', 'Résultats', '▤'],
  ['standings', 'Classements', '▥'],
  ['team', 'Mon écurie', '♟'],
  ['car', 'Développement', '⚙'],
  ['calendar', 'Calendrier', '▦'],
  ['finance', 'Finances', '€'],
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
function teamCarStats(team) { const base = team.strength ?? 60; return { chassis: base, aero: base, engine: base, reliability: 70 }; }
function carAverage(car) { return (car.chassis + car.aero + car.engine + car.reliability) / 4; }
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); setStatus('Sauvegarde automatique ✓'); } catch { setStatus('Sauvegarde impossible : stockage indisponible'); } }
function isValidGame(data) {
  return Boolean(data && typeof data === 'object'
    && Number.isInteger(data.year) && data.year >= START_YEAR && data.year <= END_YEAR
    && data.team && typeof data.team.id === 'string' && typeof data.team.name === 'string'
    && data.manager && typeof data.manager.firstName === 'string' && typeof data.manager.lastName === 'string'
    && typeof data.manager.birthDate === 'string' && Array.isArray(data.calendar)
    && data.calendar.length > 0 && data.calendar.length <= 100 && data.calendar.every((race) => race && Number.isInteger(race.round) && typeof race.name === 'string' && typeof race.circuit === 'string' && typeof race.date === 'string' && Number.isFinite(Date.parse(race.date))) && Array.isArray(data.drivers)
    && Array.isArray(data.entrants) && data.drivers.every((driver) => driver && typeof driver.id === 'string' && typeof driver.name === 'string' && Number.isFinite(driver.rating) && Number.isFinite(driver.potential)) && data.entrants.every((entry) => entry && entry.team && typeof entry.team.id === 'string' && entry.driver && typeof entry.driver.id === 'string' && Number.isFinite(entry.driver.rating) && entry.car && Number.isFinite(entry.car.reliability)) && Number.isInteger(data.raceIndex)
    && data.raceIndex >= 0 && data.raceIndex <= data.calendar.length
    && data.car && ['chassis','aero','engine','reliability'].every((key) => Number.isFinite(data.car[key]) && data.car[key] >= 0 && data.car[key] <= 100)
    && data.staff && ['engineering','strategy','pitStop'].every((key) => Number.isFinite(data.staff[key]))
    && data.finance && ['budget','income','expenses'].every((key) => Number.isFinite(data.finance[key]))
    && data.facilities && ['factory','simulator','windTunnel'].every((key) => Number.isFinite(data.facilities[key])));
}
function normalizeGame(data) {
  if (!isValidGame(data)) return null;
  data.results ??= {};
  if (!Array.isArray(data.seasonTeams) || !data.seasonTeams.length) data.seasonTeams = [data.team];
  data.raceStrategies ??= {};
  data.raceTyres ??= {};
  data.racePitPlans ??= {};
  data.sponsor = sponsorFor(data.sponsor).id;
  data.difficulty = difficultyFor(data.difficulty).id;
  data.career ??= { races: data.raceIndex, wins: 0, podiums: 0, titles: 0, history: [] };
  data.finance.lastIncome ??= null;
  if (!Array.isArray(data.career.history)) data.career.history = [];
  data.career.history = data.career.history.filter((record) => record && Number.isInteger(record.year) && typeof record.team === 'string' && Number.isFinite(record.place) && Number.isFinite(record.bonus)).slice(0, 100);
  for (const key of ['races', 'wins', 'podiums', 'titles']) {
    if (!Number.isFinite(data.career[key])) data.career[key] = key === 'races' ? data.raceIndex : 0;
  }
  return data;
}
function loadSavedGame() {
  try { const saved = localStorage.getItem(SAVE_KEY); return saved ? normalizeGame(JSON.parse(saved)) : null; }
  catch { return null; }
}
function metric(label, value) { return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
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
  const [driversData, constructorsData, racesData] = await Promise.all([fetchTable(year, 'drivers'), fetchTable(year, 'constructors'), fetchTable(year, 'races')]);
  season.drivers = driversData.MRData.DriverTable.Drivers.map((driver) => mapDriver(driver, year)).sort((a, b) => a.name.localeCompare(b.name));
  season.constructors = constructorsData.MRData.ConstructorTable.Constructors.map((constructor, index) => ({ id: constructor.constructorId, name: constructor.name, nationality: constructor.nationality, strength: 55 + ((constructor.constructorId.length * 7 + index + year) % 36) })).sort((a, b) => a.name.localeCompare(b.name));
  season.races = racesData.MRData.RaceTable.Races.map((race) => ({ round: Number(race.round), name: race.raceName, circuit: race.Circuit.circuitName, locality: race.Circuit.Location.locality, country: race.Circuit.Location.country, date: race.date }));
  cache.set(year, season);
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
function selectedRaceDrivers() {
  const ids = game.driverSelection ?? {};
  const first = game.drivers.find((driver) => driver.id === ids.first) ?? game.drivers[0];
  const second = game.drivers.find((driver) => driver.id === ids.second && driver.id !== first?.id) ?? game.drivers.find((driver) => driver.id !== first?.id);
  return [first, second].filter(Boolean);
}
function ensureDriverSelection() {
  if (!game?.drivers?.length) return;
  const [first, second] = selectedRaceDrivers();
  game.driverSelection = { first: first?.id ?? '', second: second?.id ?? '' };
}
function syncPlayerEntrants() {
  if (!game?.entrants) return;
  ensureDriverSelection();
  const selected = selectedRaceDrivers().map((driver) => ({ driver, team: game.team, car: game.car }));
  game.entrants = [...game.entrants.filter((entry) => entry.team.id !== game.team.id), ...selected];
}
function changeRaceDriver(slot, driverId) {
  ensureDriverSelection();
  const otherSlot = slot === 'first' ? 'second' : 'first';
  if (game.driverSelection[otherSlot] === driverId) game.driverSelection[otherSlot] = game.driverSelection[slot];
  game.driverSelection[slot] = driverId;
  game.raceTyres ??= {};
  syncPlayerEntrants();
  saveGame();
  renderGame();
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
      if (row.position === 1 && row.status !== 'Abandon') { driver.wins += 1; constructor.wins += 1; }
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
  syncPlayerEntrants();
  const strategySeed = Object.entries(game.raceStrategies ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, choice]) => `${id}:${choice}`).join('|') + JSON.stringify(game.raceTyres ?? {}) + JSON.stringify(game.racePitPlans ?? {});
  const random = createRandom(seedFrom(`${game.year}-${race.round}-${game.team.id}-${game.car.chassis}-${game.car.aero}-${game.car.engine}-${game.car.reliability}-${strategySeed}`));
  const totalLaps = 50 + (seedFrom(`${race.name}-${race.circuit}`) % 26);
  const weather = raceWeather(game.year, race);
  const rows = game.entrants.map((entry) => {
    const isPlayerTeam = entry.team.id === game.team.id;
    const car = isPlayerTeam ? game.car : entry.car;
    const driverRating = entry.driver.rating;
    const carScore = carAverage(car) + (isPlayerTeam ? 0 : aiCompetition(game.raceIndex,game.difficulty));
    const staffScore = isPlayerTeam ? ((game.staff.strategy + game.staff.pitStop) / 2) : entry.team.strength;
    const reliability = car.reliability;
    const strategyId = isPlayerTeam ? game.raceStrategies?.[entry.driver.id] : 'equilibre';
    const strategy = strategyFor(strategyId);
    const tyre = isPlayerTeam ? tyreFor(game.raceTyres?.[entry.driver.id] ?? (weather.condition === 'wet' ? 'wet' : 'medium')).id : (weather.condition === 'wet' ? 'wet' : 'medium');
    const pitPlan = isPlayerTeam ? Number(game.racePitPlans?.[entry.driver.id]) === 2 ? 2 : 1 : 1;
    const modifiers = tyreModifiers(tyre, weather);
    const incidentRoll = random();
    const risk = Math.min(.65, retirementChance(reliability, strategy.id) * modifiers.incidentMultiplier * (pitPlan === 1 && tyre === 'soft' ? 1.25 : 1));
    const retired = incidentRoll < risk;
    const laps = retired ? Math.max(1, Math.floor(totalLaps * (.35 + random() * .58))) : totalLaps;
    const pitBonus = pitPlan === 2 ? (tyre === 'soft' ? 6 : 1) + (isPlayerTeam ? (game.staff.pitStop - 60) / 8 : 0) : (tyre === 'soft' ? -4 : tyre === 'hard' ? 2 : 0);
    const score = (driverRating * 1.15) + (carScore * 1.45) + (staffScore * .45) + strategy.speedBonus + modifiers.speedBonus + pitBonus + ((random() - .5) * 28);
    const qualifying = (driverRating * 1.1) + (carScore * 1.2) + ((random() - .5) * 32);
    return { entry, score, qualifying, laps, retired, tyre, pitPlan };
  });
  const qualifyingGrid = new Map([...rows].sort((a, b) => b.qualifying - a.qualifying).map((row, index) => [row, index + 1]));
  rows.forEach((row) => { row.score += Math.max(0, 12 - qualifyingGrid.get(row)) * .35; });
  rows.sort((a, b) => Number(a.retired) - Number(b.retired) || (a.retired ? b.laps - a.laps : b.score - a.score));
  const results = rows.map((row, index) => ({
    position: index + 1,
    grid: qualifyingGrid.get(row),
    tyre: row.tyre,
    pitPlan: row.pitPlan,
    laps: row.laps,
    status: row.retired ? 'Abandon' : 'Terminé',
    driverId: row.entry.driver.id,
    driver: row.entry.driver.name,
    constructorId: row.entry.team.id,
    constructor: row.entry.team.name,
    nationality: row.entry.team.nationality,
    points: row.retired ? 0 : pointsForYear(game.year, index + 1),
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
  const level = document.querySelector('#difficulty-level');
  if (level) level.textContent = difficultyFor(game.difficulty).label;
  pageNav.replaceChildren(...pages.map(([key, label, symbol]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.page = key; button.className = key === activePage ? 'active' : '';
    button.setAttribute('aria-current', key === activePage ? 'page' : 'false');
    const glyph = document.createElement('span'); glyph.className = 'nav-glyph'; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = symbol;
    const caption = document.createElement('span'); caption.textContent = label;
    button.append(glyph, caption);
    return button;
  }));
  const tag = document.querySelector('#header-season');
  if (tag) tag.textContent = 'SAISON ' + game.year;
  const exportButton = document.querySelector('#export-save');
  if (exportButton) exportButton.disabled = false;
}

function renderGame() {
  if (!game) return;
  renderShell();
  const profile = profileForYear(game.year);
  const race = game.calendar[game.raceIndex] ?? game.calendar.at(-1);
  const renders = { home: () => renderHome(profile, race), race: () => renderRace(race), results: renderResults, standings: renderStandings, team: renderTeam, car: () => renderCar(profile), calendar: renderCalendar, finance: renderFinance };
  workspace.innerHTML = renders[activePage]?.() ?? renders.home();
  if (activePage === 'results') renderResultsTable();
  if (activePage === 'standings') renderStandingsTables();
  document.title = `${game.year} · ${pages.find(([key]) => key === activePage)?.[1] ?? 'F1 Manager'} | F1 Manager Tycoon`;
}

function renderHome(profile, race) {
  const completed = game.raceIndex;
  const total = game.calendar.length;
  const standings = seasonStandings();
  const teamRank = standings.constructors.find((item) => item.constructor === game.team.name);
  const points = teamRank?.points ?? 0;
  const weather = race ? raceWeather(game.year, race) : null;
  const champion = completed >= total;
  const percent = total ? Math.round(completed / total * 100) : 0;
  const career = game.career ?? {};
  const last = game.finance.lastIncome;
  const topTeams = standings.constructors.slice(0, 5);
  const upcoming = game.calendar.slice(completed, completed + 3);
  const title = champion ? 'Saison terminée' : 'Prochain Grand Prix';
  const subtitle = champion ? 'Une saison entre dans la légende.' : 'La grille est en place. À toi de décider de la suite.';
  return `<div class="home-layout">
    <section class="hero panel">
      <div class="hero-content">
        <div class="eyebrow"><span class="signal-dot"></span> PADDOCK / SAISON ${game.year} <span class="hero-round">${champion ? 'FIN DE SAISON' : 'MANCHE ' + (completed + 1) + ' / ' + total}</span></div>
        <p class="hero-label">${title}</p>
        <h2 class="hero-title">${escapeHtml(champion ? 'Championnat bouclé' : race?.name ?? 'À venir')}</h2>
        <p class="hero-subtitle">${escapeHtml(subtitle)}</p>
        <div class="hero-tags"><span>◈ ${escapeHtml(race?.circuit ?? game.team.name)}</span><span>${escapeHtml(difficultyFor(game.difficulty).label)}</span><span>${weather?.icon ?? '★'} ${weather?.label ?? 'Bilan'}</span><span>${weather?.temperature ?? '—'}°C</span></div>
        <button class="primary-cta" type="button" data-page-jump="${champion ? 'finance' : 'race'}">${champion ? 'Préparer la saison suivante' : 'Préparer la course'} <span aria-hidden="true">→</span></button>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-number">${String(game.year).slice(-2)}</div><div class="hero-watermark">RACE<br>CONTROL</div></div>
      <div class="hero-bottom"><span>${escapeHtml(game.team.name.toUpperCase())}</span><span>${profile.layout} · ${profile.powerUnit}</span></div>
    </section>
    <section class="kpi-grid">
      <article class="kpi"><span class="kpi-label">Budget disponible</span><strong>${money.format(game.finance.budget)}</strong><span class="kpi-foot">Trésorerie de l'écurie</span></article>
      <article class="kpi"><span class="kpi-label">Classement constructeur</span><strong>${teamRank ? '#' + teamRank.position : '—'}</strong><span class="kpi-foot">${points} points cette saison</span></article>
      <article class="kpi"><span class="kpi-label">Performance voiture</span><strong>${Math.round(carAverage(game.car))}<small>/100</small></strong><span class="kpi-foot">Moyenne des 4 attributs</span></article>
      <article class="kpi"><span class="kpi-label">Avancement</span><strong>${percent}<small>%</small></strong><div class="tiny-track"><span style="width:${percent}%"></span></div></article>
    </section>
    <section class="home-bottom">
      <article class="panel detail-panel">
        <div class="section-title"><div><span class="eyebrow">TOUR DE CONTRÔLE</span><h3>Calendrier à venir</h3></div><span class="subtle-text">${completed} / ${total} terminées</span></div>
        <div class="schedule-list">${upcoming.length ? upcoming.map((round, index) => `<div class="schedule-item"><span class="schedule-index">${String(completed + index + 1).padStart(2,'0')}</span><div><strong>${escapeHtml(round.name)}</strong><span>${escapeHtml(round.circuit)} · ${dateFormat.format(new Date(round.date+'T12:00:00Z'))}</span></div><span class="weather-icon" title="Météo fictive de gameplay">${raceWeather(game.year, round).icon}</span></div>`).join('') : '<p class="empty-copy">Toutes les courses sont terminées. Rendez-vous aux finances pour poursuivre.</p>'}</div>
      </article>
      <article class="panel detail-panel">
        <div class="section-title"><div><span class="eyebrow">LIVE STANDINGS</span><h3>Top constructeurs</h3></div><button class="text-link" type="button" data-page-jump="standings">Classement →</button></div>
        <div class="leader-list">${topTeams.length ? topTeams.map((team,index) => `<div class="leader-item ${team.constructor === game.team.name ? 'my-team' : ''}"><span class="leader-rank">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(team.constructor)}</strong><span>${team.points} pts</span></div>`).join('') : '<p class="empty-copy">Les classements apparaissent après le premier Grand Prix.</p>'}</div>
      </article>
      <article class="panel detail-panel recap-panel">
        <div class="section-title"><div><span class="eyebrow">CARRIÈRE</span><h3>Ton palmarès</h3></div><span class="season-stamp">${game.year}</span></div>
        <div class="mini-stats"><div><strong>${career.races ?? 0}</strong><span>Courses</span></div><div><strong>${career.podiums ?? 0}</strong><span>Podiums</span></div><div><strong>${career.wins ?? 0}</strong><span>Victoires</span></div><div><strong>${career.titles ?? 0}</strong><span>Titres</span></div></div>
        <p class="recap-text">${last ? 'Dernier GP : ' + escapeHtml(last.race) + ' · +' + money.format(last.total) : 'À toi d’écrire l’histoire de cette écurie.'}</p>
      </article>
    </section>
  </div>`;
}

function renderCar(profile) {
  const stats = [
    { key:'chassis', name:'Châssis', icon:'◈', detail:'Stabilité et équilibre' },
    { key:'aero', name:'Aérodynamique', icon:'≋', detail:'Appui et efficacité' },
    { key:'engine', name:'Moteur', icon:'ϟ', detail:'Puissance et vitesse de pointe' },
    { key:'reliability', name:'Fiabilité', icon:'✦', detail:'Réduit le risque d’abandon' },
  ];
  return `<div class="screen-stack">
    <div class="screen-heading"><div><span class="eyebrow">ENGINEERING DEPARTMENT</span><h2>Développement <em>R&D</em></h2><p>Investis dans ta monoplace. Les installations renforcent les gains à chaque amélioration.</p></div><div class="screen-score">${Math.round(carAverage(game.car))}<span>/100</span></div></div>
    <div class="car-workshop panel"><div class="workshop-head"><span class="eyebrow">CHASSIS DESIGN / ${game.year}</span><span class="tag-outline">${escapeHtml(profile.layout)} · ${escapeHtml(profile.powerUnit)}</span></div>
      <div class="car-stage"><div class="car-stage-grid"></div><div class="car-shape"><span></span></div><div class="car-stage-mark">TYCOON RACING</div></div>
      <div class="workshop-specs"><span>${escapeHtml(game.team.name)}</span><span>POWER UNIT / ${escapeHtml(profile.powerUnit)}</span><span>ÉVOLUTION / ${Math.round(carAverage(game.car))}%</span></div>
    </div>
    <div class="upgrade-grid">${stats.map((stat) => `<article class="panel upgrade-card"><div class="upgrade-top"><span class="upgrade-icon">${stat.icon}</span><span class="upgrade-level">${game.car[stat.key]} / 100</span></div><h3>${stat.name}</h3><p>${stat.detail}</p><progress max="100" value="${game.car[stat.key]}" aria-label="Niveau ${stat.name}"></progress><div class="upgrade-bottom"><span>Gain +${developmentGain(stat.key, game.facilities) + engineeringBonus()}</span>${action('Améliorer', 'car', stat.key)}</div></article>`).join('')}</div>
  </div>`;
}

function renderTeam() {
  const staff = [
    { key:'engineering', label:'Ingénierie', detail:'Potentiel du département technique' },
    { key:'strategy', label:'Stratégie', detail:'Impact sur la performance en course' },
    { key:'pitStop', label:'Arrêts aux stands', detail:'Efficacité des plans à deux arrêts' }
  ];
  const facilities = [
    { key:'factory', label:'Usine', detail:'Booste châssis et moteur' },
    { key:'simulator', label:'Simulateur', detail:'Booste fiabilité et entraînement' },
    { key:'windTunnel', label:'Soufflerie', detail:'Booste l’aérodynamique' }
  ];
  return `<div class="screen-stack">
    <div class="screen-heading"><div><span class="eyebrow">TEAM OPERATIONS</span><h2>Ton <em>écurie</em></h2><p>Développe les talents, recrute l’expertise interne et investis intelligemment.</p></div><span class="tag-outline">${escapeHtml(game.team.name)}</span></div>
    <div class="team-layout">
      <section class="panel roster-panel"><div class="section-title"><div><span class="eyebrow">DRIVER LINE-UP</span><h3>Effectif des pilotes</h3></div><span class="tag-outline">${game.drivers.length} pilotes</span></div>
        <div class="driver-grid">${game.drivers.map((driver,index) => `<div class="driver-tile"><div class="driver-portrait"><span>${String(index+1).padStart(2, '0')}</span><div>${escapeHtml(driver.name.split(' ').map(part => part[0] ?? '').slice(0,2).join(''))}</div></div><div class="driver-info"><strong>${escapeHtml(driver.name)}</strong><span>${escapeHtml(driver.nationality ?? '')} · Potentiel ${driver.potential}</span><div class="ability"><span>Note ${driver.rating}/100</span><progress max="100" value="${driver.rating}"></progress></div><button type="button" data-driver="${escapeHtml(driver.id)}" ${driver.rating >= driver.potential || raceIsCommitted() || game.finance.budget < 500_000 ? 'disabled' : ''}>Entraîner +${trainingGain(game.facilities)} · ${money.format(500_000)}</button></div></div>`).join('')}</div>
      </section>
      <div class="team-column"><article class="panel"><div class="section-title"><div><span class="eyebrow">PIT WALL</span><h3>Personnel</h3></div></div>
        <div class="staff-list">${staff.map((item) => `<div class="staff-row"><div><strong>${item.label}</strong><span>${item.detail}</span></div><div class="staff-right"><span>${game.staff[item.key]}/100</span><button type="button" data-staff="${item.key}" ${game.staff[item.key]>=100 || raceIsCommitted() || game.finance.budget<750000 ? 'disabled':''}>+4 · ${money.format(750000)}</button></div></div>`).join('')}</div>
      </article>
      <article class="panel"><div class="section-title"><div><span class="eyebrow">FACILITIES</span><h3>Infrastructures</h3></div></div>
        <div class="facility-list">${facilities.map((item) => `<div class="facility-row"><div><strong>${item.label}</strong><span>${item.detail} · Niveau ${game.facilities[item.key]}/10</span></div>${action('Améliorer', 'facility', item.key)}</div>`).join('')}</div>
      </article></div>
    </div>
  </div>`;
}

function renderRace(race) {
  if (game.raceIndex >= game.calendar.length) return '<section class="panel empty-state"><strong>Saison terminée !</strong><p>Rends-toi aux finances pour préparer le prochain chapitre de ta carrière.</p><button type="button" data-page-jump="finance">Voir le bilan →</button></section>';
  if (!race) return '<section class="panel empty-state">Aucun Grand Prix à disputer.</section>';
  ensureDriverSelection();
  const weather = raceWeather(game.year, race);
  const replay = raceReplay?.round === race.round ? raceReplay : null;
  const locked = Boolean(replay || game.results?.[race.round]);
  const sponsor = sponsorFor(game.sponsor);
  const driverOptions = (selectedId) => game.drivers.map((driver) => `<option value="${escapeHtml(driver.id)}" ${driver.id === selectedId ? 'selected' : ''}>${escapeHtml(driver.name)} · ${driver.rating}</option>`).join('');
  const selected = selectedRaceDrivers();
  const selectedIds = new Set(selected.map((driver) => driver.id));
  const otherDrivers = game.drivers.filter((driver) => !selectedIds.has(driver.id)).map((driver) => escapeHtml(driver.name)).join(' · ');
  const selections = [
    { key:'first', label:'01 · PILOTE TITULAIRE' },
    { key:'second', label:'02 · SECOND PILOTE' },
  ].map(({key,label},index) => {
    const driver = selected[index];
    if (!driver) return '';
    const tyre = tyreFor(game.raceTyres?.[driver.id] ?? (weather.condition === 'wet' ? 'wet' : 'medium'));
    return `<div class="tactic-card">
      <div class="tactic-head"><span>${label}</span><strong>${escapeHtml(driver.name)}</strong></div>
      <label>Choix du pilote<select data-race-driver="${key}" ${locked ? 'disabled' : ''}>${driverOptions(game.driverSelection[key])}</select></label>
      <div class="tactic-selects">
        <label>Mode de course<select data-strategy-driver="${escapeHtml(driver.id)}" ${locked ? 'disabled' : ''}>${Object.values(STRATEGIES).map((strategy) => `<option value="${strategy.id}" ${strategyFor(game.raceStrategies?.[driver.id]).id === strategy.id ? 'selected' : ''}>${strategy.label}</option>`).join('')}</select></label>
        <label>Gomme<select data-tyre-driver="${escapeHtml(driver.id)}" ${locked ? 'disabled' : ''}>${Object.values(TYRES).map((compound) => `<option value="${compound.id}" ${tyre.id === compound.id ? 'selected' : ''}>${compound.label}</option>`).join('')}</select></label>
        <label>Arrêts prévus<select data-pit-driver="${escapeHtml(driver.id)}" ${locked ? 'disabled' : ''}><option value="1" ${Number(game.racePitPlans?.[driver.id]) !== 2 ? 'selected' : ''}>1 arrêt · Conservateur</option><option value="2" ${Number(game.racePitPlans?.[driver.id]) === 2 ? 'selected' : ''}>2 arrêts · Attaque</option></select></label>
      </div>
      <div class="tactic-note">${escapeHtml(strategyFor(game.raceStrategies?.[driver.id]).description)} · ${escapeHtml(tyre.description)}</div>
    </div>`;
  }).join('');
  const board = replay ? replay.live.map((entry,index) => `<tr class="${entry.issue ? 'race-issue' : ''} ${positionClass(index)} ${entry.constructorId === game.team.id ? 'highlight-row' : ''}"><td class="position-cell">${String(index+1).padStart(2,'0')}</td><td><strong>${escapeHtml(entry.driver)}</strong></td><td>${escapeHtml(entry.constructor)}</td><td><span class="tyre-chip tyre-${entry.tyre ?? 'medium'}">${escapeHtml(tyreFor(entry.tyre).label)}</span></td><td>${escapeHtml(entry.delta)}</td><td>${escapeHtml(entry.lastLap || '—')}</td><td>${escapeHtml(entry.issue || 'En piste')}</td></tr>`).join('') : '';
  const events = replay?.events?.length ? replay.events.slice(-MAX_RACE_EVENTS).reverse().map((event) => `<li><span class="event-lap">TOUR ${event.lap}</span><strong>${escapeHtml(event.text)}</strong></li>`).join('') : '<li><span class="event-lap">EN ATTENTE</span><strong>La course n’a pas encore commencé.</strong></li>';
  return `<div class="screen-stack race-screen">
    <section class="race-hero panel"><div class="race-hero-main"><span class="eyebrow"><span class="signal-dot"></span> RACE WEEKEND / ROUND ${race.round}</span><h2>${escapeHtml(race.name)}</h2><p>${escapeHtml(race.circuit)} · ${escapeHtml(race.locality)}, ${escapeHtml(race.country)}</p><div class="race-date">${dateFormat.format(new Date(race.date+'T12:00:00Z'))}</div></div>
      <div class="race-weather"><span class="weather-giant">${weather.icon}</span><div><span class="eyebrow">CONDITIONS SIMULÉES</span><strong>${weather.label}</strong><span>${weather.temperature}°C · ${weather.condition === 'wet' ? 'Privilégie les pneus pluie' : 'Piste plutôt sèche'}</span></div></div></section>
    <div class="race-layout">
      <section class="panel"><div class="section-title"><div><span class="eyebrow">PIT WALL / STRATEGY</span><h3>Préparation de course</h3></div><span class="tag-outline">${locked ? 'Stratégies verrouillées' : 'Modifiable avant le départ'}</span></div>
        <div class="tactic-grid">${selections}</div><p class="strategy-help">Le mode moteur, les pneus et le nombre d'arrêts influencent la vitesse et le risque d'abandon. La météo est fictive et calculée pour le gameplay.</p>
        <div class="race-button-bar"><button type="button" data-live="start" ${replay?.progress >= 100 ? 'disabled' : ''}>${replay ? '▶ Reprendre' : '▶ Départ de la course'}</button><button type="button" data-live="pause" class="btn-secondary">Ⅱ Pause</button><button type="button" data-live="speed" class="btn-secondary">Vitesse ×${raceSpeed}</button><button type="button" id="next-race" class="btn-quiet">${replay?.progress >= 100 ? 'Valider les résultats →' : 'Simuler & valider →'}</button></div>
      </section>
      <section class="panel race-briefing"><div class="section-title"><div><span class="eyebrow">RACE INTELLIGENCE</span><h3>Briefing</h3></div></div>
        <div class="briefing-stats"><div><span>Distance estimée</span><strong>${50 + (seedFrom(race.name + '-' + race.circuit) % 26)} tours</strong></div><div><span>État du ciel</span><strong>${weather.icon} ${weather.label}</strong></div><div><span>Objectif sponsor</span><strong>${escapeHtml(sponsor.label)}</strong></div><div><span>Prime potentielle</span><strong>${money.format(sponsor.upfront + sponsor.bonus)}</strong></div></div>
        <p class="briefing-note">${escapeHtml(sponsor.description)} Choisis tes gommes en fonction de la météo et de ton niveau de fiabilité.</p>
        <div class="weekend-list"><span class="eyebrow">WEEKEND PROGRAM</span>${weekendSessions(game.year,race).map(([name,date]) => `<div><span>${escapeHtml(name)}</span><strong>${escapeHtml(date)}</strong></div>`).join('')}</div>
        ${otherDrivers ? `<p class="bench-drivers">Réservistes / autres pilotes : ${otherDrivers}</p>` : ''}
      </section>
    </div>
    <section class="panel live-board"><div class="section-title"><div><span class="eyebrow"><span class="signal-dot"></span> LIVE TIMING</span><h3>Chronométrage</h3></div><div class="live-status"><strong>${replay ? 'TOUR ' + replay.currentLap + ' / ' + replay.totalLaps : 'AVANT COURSE'}</strong><span>${replay?.progress ?? 0}%</span></div></div>
      <progress max="100" value="${replay?.progress ?? 0}" aria-label="Progression de la course"></progress>
      <div class="table-scroll">${board ? renderTable(['POS', 'PILOTE', 'ÉCURIE', 'PNEUS', 'ÉCART', 'DERNIER TOUR', 'STATUT'], [board]) : '<div class="live-empty"><strong>FEUX ÉTEINTS DANS...</strong><p>Configure tes pilotes et clique sur « Départ de la course » pour lancer la simulation en direct.</p><div class="starting-lights">● ● ● ● ●</div></div>'}</div>
    </section>
    <section class="panel race-event-panel"><div class="section-title"><div><span class="eyebrow">RACE DIRECTOR</span><h3>Journal de course</h3></div></div><ol class="event-feed">${events}</ol></section>
  </div>`;
}

function renderCalendar() {
  return `<div class="screen-stack"><div class="screen-heading"><div><span class="eyebrow">WORLD CHAMPIONSHIP / ${game.year}</span><h2>Calendrier <em>F1</em></h2><p>${game.calendar.length} Grands Prix prévus pour la saison ${game.year}.</p></div><span class="tag-outline">${game.raceIndex} / ${game.calendar.length} disputés</span></div>
  <div class="calendar-grid">${game.calendar.map((race,index) => {const weather = raceWeather(game.year, race);return `<article class="calendar-tile ${index < game.raceIndex ? 'is-completed' : index === game.raceIndex ? 'is-next' : ''}"><div class="calendar-top"><span>ROUND ${String(race.round).padStart(2,'0')}</span><span>${index < game.raceIndex ? '✓ TERMINÉ' : index === game.raceIndex ? '● À VENIR' : 'PROGRAMMÉ'}</span></div><h3>${escapeHtml(race.name)}</h3><p>${escapeHtml(race.circuit)}</p><div class="calendar-footer"><span>${dateFormat.format(new Date(race.date+'T12:00:00Z'))}</span><span title="Météo de jeu simulée">${weather.icon} ${weather.label}</span></div></article>`;}).join('')}</div></div>`;
}

function renderResults() {
  const completed = game.calendar.slice(0,game.raceIndex);
  const current = completed.find((race) => Number(race.round) === Number(game.viewRound)) ?? completed.at(-1);
  const options = completed.map((race) => `<option value="${race.round}" ${race.round === current?.round ? 'selected' : ''}>${escapeHtml(race.name)}</option>`).join('');
  return `<div class="screen-stack"><div class="screen-heading"><div><span class="eyebrow">OFFICIAL CLASSIFICATION</span><h2>Résultats <em>GP</em></h2><p>Qualifications, arrivées, abandons et points par Grand Prix.</p></div>${current ? `<label>Choisir un Grand Prix<select id="results-race-select">${options}</select></label>` : ''}</div><section class="panel"><div id="results-table"></div></section></div>`;
}

function renderStandings() {
  return `<div class="screen-stack"><div class="screen-heading"><div><span class="eyebrow">CHAMPIONSHIP CLASSIFICATION</span><h2>Classements <em>${game.year}</em></h2><p>Le titre se gagne à la régularité. Les barèmes de points suivent l'époque.</p></div><span class="tag-outline">${game.raceIndex} / ${game.calendar.length} courses</span></div><section class="standings-grid"><article class="panel table-panel"><div class="section-title"><div><span class="eyebrow">DRIVERS CHAMPIONSHIP</span><h3>Pilotes</h3></div></div><div id="driver-standings" class="table-scroll"></div></article><article class="panel table-panel"><div class="section-title"><div><span class="eyebrow">CONSTRUCTORS CHAMPIONSHIP</span><h3>Constructeurs</h3></div></div><div id="constructor-standings" class="table-scroll"></div></article></section></div>`;
}

function renderFinance() {
  const done = game.raceIndex >= game.calendar.length;
  const last = game.finance.lastIncome;
  const sponsor = sponsorFor(game.sponsor);
  const teams = (game.nextSeasonTeams?.length ? game.nextSeasonTeams : game.seasonTeams ?? []).map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === game.team.id ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('');
  const next = done ? (game.year >= END_YEAR ? '<p class="empty-copy">Tu as atteint 2026, dernière saison actuellement disponible.</p>' : `<div class="next-season-panel"><span class="eyebrow">PROCHAIN CHAPITRE</span><h3>Passer à ${game.year+1}</h3><label>Choisir une écurie<select id="next-team-select">${teams}</select></label><button id="next-season" type="button">Commencer la saison ${game.year+1} →</button></div>`) : '';
  return `<div class="screen-stack">
    <div class="screen-heading"><div><span class="eyebrow">TEAM ECONOMY / COMMERCIAL</span><h2>Finances <em>& sponsors</em></h2><p>Chaque résultat compte. Investis tes revenus et relève les défis commerciaux.</p></div><span class="tag-outline">${money.format(game.finance.budget)}</span></div>
    <section class="finance-stats"><article class="finance-stat"><span>Trésorerie</span><strong>${money.format(game.finance.budget)}</strong><small>Budget disponible</small></article><article class="finance-stat"><span>Revenus cumulés</span><strong>${money.format(game.finance.income)}</strong><small>Primes de course, sponsors et saisons</small></article><article class="finance-stat"><span>Dépenses cumulées</span><strong>${money.format(game.finance.expenses)}</strong><small>R&D et personnel</small></article></section>
    <div class="finance-layout">
      <section class="panel"><div class="section-title"><div><span class="eyebrow">COMMERCIAL PARTNERSHIPS</span><h3>Contrat sponsor</h3></div><span class="tag-outline">Par course</span></div>
        <p class="muted-paragraph">Choisis ton partenaire avant le départ. Plus l'objectif est difficile, plus la prime est élevée.</p>
        <label>Ton partenaire actuel<select id="sponsor-select" ${raceReplay || game.results?.[game.calendar[game.raceIndex]?.round] ? 'disabled' : ''}>${Object.values(SPONSORS).map((entry) => `<option value="${entry.id}" ${entry.id === sponsor.id ? 'selected' : ''}>${entry.label}</option>`).join('')}</select></label>
        <div class="sponsor-details"><div><span>Allocation garantie</span><strong>${money.format(sponsor.upfront)}</strong></div><div><span>Prime d'objectif</span><strong>${money.format(sponsor.bonus)}</strong></div></div>
        <p class="briefing-note">${escapeHtml(sponsor.description)}</p>
        ${last ? `<div class="last-receipt"><span class="eyebrow">DERNIER GRAND PRIX / ${escapeHtml(last.race)}</span><div><span>Prime de classement</span><strong>+${money.format(last.prize)}</strong></div><div><span>Sponsor ${last.goalReached ? '✓ Objectif atteint' : '· objectif manqué'}</span><strong>+${money.format(last.sponsor)}</strong></div></div>` : ''}
      </section>
      <section class="panel finance-side"><div class="section-title"><div><span class="eyebrow">HALL OF FAME</span><h3>Historique de carrière</h3></div></div>
        <div class="career-history">${game.career?.history?.length ? game.career.history.slice(0,12).map((record) => `<div><span class="history-year">${record.year}</span><strong>${escapeHtml(record.team)} · P${record.place}</strong><span>+${money.format(record.bonus)}</span></div>`).join('') : '<p class="empty-copy">Termine une saison pour inscrire une ligne au palmarès.</p>'}</div>
        ${next}
        <div class="save-actions"><button type="button" data-export-save class="btn-secondary">Exporter ma sauvegarde ↓</button><button type="button" id="restart-game" class="btn-danger">Effacer et recommencer</button></div>
      </section>
    </div>
  </div>`;
}

function action(label, dataName, key) {
  const isFacility = dataName === 'facility';
  const level = isFacility ? (game.facilities[key] ?? 1) : game.car[key];
  const cost = isFacility ? facilityCost(level) : 1_000_000;
  const capped = isFacility ? level >= 10 : level >= 100;
  const gain = isFacility ? 'Niveau ' + level + '/10' : 'Niveau ' + level + '/100 · +' + (developmentGain(key, game.facilities) + engineeringBonus());
  return `<button type="button" data-${dataName}="${key}" ${capped || raceIsCommitted() || game.finance.budget < cost ? 'disabled' : ''}>${label} · ${gain} · ${capped ? 'MAX' : money.format(cost)}</button>`;
}

function renderResultsTable() {
  const container = document.querySelector('#results-table');
  if (!container || !game) return;
  const completed = game.calendar.slice(0, game.raceIndex);
  if (!completed.length) { container.innerHTML = '<div class="empty-state"><strong>Aucun Grand Prix disputé.</strong><p>Lance ta première course pour afficher les résultats ici.</p></div>'; return; }
  const race = completed.find((item) => Number(item.round) === Number(game.viewRound)) ?? completed.at(-1);
  const results = game.results?.[race.round] ?? [];
  const weather = raceWeather(game.year, race);
  const rows = results.map((r,index) => `<tr class="${positionClass(index)} ${r.constructorId === game.team.id ? 'highlight-row' : ''}"><td class="position-cell">${r.position}</td><td>${r.grid ?? '—'}</td><td><strong>${escapeHtml(r.driver)}</strong></td><td>${escapeHtml(r.constructor)}</td><td>${r.tyre ? escapeHtml(tyreFor(r.tyre).label) : '—'}</td><td>${r.laps}</td><td><span class="${r.status === 'Abandon' ? 'status-danger' : 'status-success'}">${escapeHtml(r.status)}</span></td><td class="points-cell">${r.points}</td></tr>`);
  container.innerHTML = `<div class="results-head"><div><span class="eyebrow">ROUND ${race.round} · ${weather.icon} ${weather.label}</span><h3>${escapeHtml(race.name)}</h3><p>${escapeHtml(race.circuit)}</p></div><span class="tag-outline">${results.length} pilotes classés</span></div><div class="table-scroll">${renderTable(['POS', 'GRILLE', 'PILOTE', 'ÉCURIE', 'GOMME', 'TOURS', 'STATUT', 'PTS'], rows, 'Aucun résultat.')}</div>`;
}

function renderStandingsTables() {
  const driverContainer = document.querySelector('#driver-standings');
  const constructorContainer = document.querySelector('#constructor-standings');
  if (!driverContainer || !constructorContainer || !game) return;
  if (!game.raceIndex) { driverContainer.innerHTML = '<p class="empty-copy">En attente du premier Grand Prix.</p>'; constructorContainer.innerHTML = '<p class="empty-copy">En attente du premier Grand Prix.</p>'; return; }
  const standings = seasonStandings();
  const driverRows = standings.drivers.map((standing,index) => `<tr class="${positionClass(index)} ${game.drivers.some((driver) => driver.name === standing.driver) ? 'highlight-row' : ''}"><td class="position-cell">${standing.position}</td><td><strong>${escapeHtml(standing.driver)}</strong></td><td>${escapeHtml(standing.constructor)}</td><td>${standing.wins}</td><td class="points-cell">${standing.points}</td></tr>`);
  const constructorRows = standings.constructors.map((standing,index) => `<tr class="${positionClass(index)} ${standing.constructor === game.team.name ? 'highlight-row' : ''}"><td class="position-cell">${standing.position}</td><td><strong>${escapeHtml(standing.constructor)}</strong></td><td>${escapeHtml(standing.nationality)}</td><td>${standing.wins}</td><td class="points-cell">${standing.points}</td></tr>`);
  driverContainer.innerHTML = renderTable(['POS', 'PILOTE', 'ÉCURIE', 'V', 'PTS'],driverRows);
  constructorContainer.innerHTML = renderTable(['POS', 'ÉCURIE', 'PAYS', 'V', 'PTS'],constructorRows);
}

function raceIsCommitted() {
  const race = game?.calendar?.[game.raceIndex];
  return Boolean(race && game.results?.[race.round]);
}
function spend(amount) {
  if (raceIsCommitted()) { setStatus('Course lancée : valide les résultats avant d’investir.'); return false; }
  if (game.finance.budget < amount) { setStatus('Budget insuffisant'); return false; }
  game.finance.budget -= amount; game.finance.expenses += amount; return true;
}
function engineeringBonus() { return Math.floor(Math.max(0, game.staff.engineering - 60) / 20); }
function developCar(key) { if (!Object.hasOwn(game.car, key) || game.car[key] >= 100 || !spend(1_000_000)) return; game.car[key] = Math.min(100, game.car[key] + developmentGain(key, game.facilities) + engineeringBonus()); saveGame(); renderGame(); }
function upgradeFacility(key) { if (!Object.hasOwn(game.facilities, key) || game.facilities[key] >= 10 || !spend(facilityCost(game.facilities[key]))) return; game.facilities[key] += 1; game.staff.engineering = Math.min(100, game.staff.engineering + 1); saveGame(); renderGame(); }
function developDriver(id) { const driver = game.drivers.find((item) => item.id === id); if (!driver || driver.rating >= driver.potential || !spend(500_000)) return; driver.rating = Math.min(driver.potential, driver.rating + trainingGain(game.facilities)); saveGame(); renderGame(); }
function developStaff(key) {
  if (!['engineering', 'strategy', 'pitStop'].includes(key) || game.staff[key] >= 100 || !spend(750_000)) return;
  game.staff[key] = Math.min(100, game.staff[key] + 4);
  saveGame(); renderGame();
}

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
    const issue = entry.status === 'Abandon' ? (Number(entry.laps) < nextLap ? 'Abandon' : '') : issueLabel(entry, nextLap, raceReplay.totalLaps);
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
    const pitStops = Number(entry.pitPlan) === 2 ? [Math.round(raceReplay.totalLaps * .32), Math.round(raceReplay.totalLaps * .68)] : [Math.round(raceReplay.totalLaps * .54)];
    pitStops.forEach((stopLap, stopIndex) => {
      const pitId = entry.driverId + '-pit-' + stopIndex;
      if (nextLap >= stopLap && nextLap <= Number(entry.laps) && !raceReplay.events.some((event) => event.driverId === pitId)) {
        raceReplay.events.push({ lap: nextLap, driverId: pitId, text: entry.driver + ' · arrêt aux stands (' + tyreFor(entry.tyre).label + ')' });
      }
    });
    if (entry.issue && !raceReplay.events.some((event) => event.driverId === `${entry.driverId}-issue`)) {
      raceReplay.events.push({ lap: nextLap, driverId: `${entry.driverId}-issue`, text: `${entry.driver} · ${entry.issue}` });
    }
    entry.runningPosition = index + 1;
  });
}

async function startLiveRace() {
  const race = game.calendar[game.raceIndex];
  if (!race) return;
  if (!raceReplay || raceReplay.round !== race.round) { await createReplay(race); saveGame(); }
  if (raceReplay.progress >= 100) return;
  clearInterval(raceTimer);
  raceTimer = setInterval(() => {
    updateRaceReplay();
    if (raceReplay.progress >= 100) pauseLiveRace();
    renderGame();
  }, RACE_TICK_MS);
  renderGame();
}

function pauseLiveRace() { clearInterval(raceTimer); raceTimer = null; }
function changeRaceSpeed() { raceSpeed = raceSpeed === 1 ? 2 : raceSpeed === 2 ? 4 : raceSpeed === 4 ? 8 : 1; renderGame(); }

async function nextRace() {
  if (game.raceIndex >= game.calendar.length) return;
  pauseLiveRace();
  const race = game.calendar[game.raceIndex];
  simulateRaceResults(race);
  const prize = Math.round(raceIncome(game.results[race.round], game.team.id) * difficultyFor(game.difficulty).incomeFactor);
  const sponsor = sponsorPayout(game.sponsor, game.results[race.round], game.team.id);
  const income = prize + sponsor.total;
  game.finance.income += income;
  game.finance.budget += income;
  game.finance.lastIncome = { race: race.name, prize, sponsor: sponsor.total, goalReached: sponsor.goalReached, total: income };
  game.career ??= { races: 0, wins: 0, podiums: 0, titles: 0, history: [] };
  const teamResults = game.results[race.round].filter((result) => result.constructorId === game.team.id);
  game.career.races += 1;
  game.career.wins += teamResults.filter((result) => result.position === 1 && result.status !== 'Abandon').length;
  game.career.podiums += teamResults.filter((result) => result.position <= 3 && result.status !== 'Abandon').length;
  game.raceIndex += 1;
  game.raceStrategies = {};
  game.raceTyres = {};
  game.racePitPlans = {};
  if (game.raceIndex === game.calendar.length) {
    const standings = seasonStandings();
    const rank = standings.constructors.find((entry) => entry.constructor === game.team.name)?.position ?? game.seasonTeams.length;
    const bonus = seasonTitleBonus(rank, game.seasonTeams.length);
    game.finance.income += bonus;
    game.finance.budget += bonus;
    game.career.titles += rank === 1 ? 1 : 0;
    game.career.history.unshift({ year: game.year, team: game.team.name, place: rank, bonus });
  }
  const finishedSeason = game.raceIndex >= game.calendar.length && game.year < END_YEAR;
  raceReplay = null;
  saveGame();
  renderGame();
  if (finishedSeason) {
    try {
      const nextSeasonData = await fetchSeason(game.year + 1);
      game.nextSeasonTeams = nextSeasonData.constructors;
      saveGame();
      renderGame();
    } catch {
      game.nextSeasonTeams = null;
      setStatus('Saison terminée. La liste des prochaines écuries sera chargée à la transition.');
    }
  }
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
  game.driverSelection = { first: game.drivers[0]?.id ?? '', second: game.drivers[1]?.id ?? '' };
  game.entrants = await buildEntrants(game.year, game.seasonTeams, game.team.id, selectedRaceDrivers());
  game.car = { ...teamCarStats(team), reliability: Math.max(45, Math.round(((game.car?.reliability ?? 70) + teamCarStats(team).reliability) / 2) - 8) };
  game.results = {};
  game.viewRound = null;
  game.raceStrategies = {};
  game.raceTyres = {};
  game.racePitPlans = {};
  game.nextSeasonTeams = null;
  raceReplay = null;
  saveGame();
  renderGame();
}

function restartGame() {
  if (!window.confirm('Effacer ta carrière et recommencer ? Exporte ta sauvegarde avant de continuer si tu veux la conserver.')) return;
  pauseLiveRace(); raceReplay = null; game = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* Stockage indisponible */ }
  document.querySelector('#export-save').disabled = true;
  gamePanel.classList.add('hidden'); setupPanel.classList.remove('hidden');
  document.title = 'F1 Manager Tycoon — Race Control';
  setStatus('Nouvelle carrière prête');
}

function exportSave() {
  if (!game) return;
  const content = JSON.stringify(game, null, 2);
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  link.href = url; link.download = 'f1-manager-' + game.year + '-sauvegarde.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  setStatus('Sauvegarde exportée');
}

async function importSaveFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) { setStatus('Fichier trop volumineux (maximum 2 Mo).'); return; }
  let imported;
  try { imported = normalizeGame(JSON.parse(await file.text())); }
  catch { setStatus('Fichier JSON invalide.'); return; }
  if (!imported) { setStatus('Ce fichier ne contient pas une carrière compatible.'); return; }
  if (game && !window.confirm('Remplacer la carrière actuelle par cette sauvegarde ?')) return;
  pauseLiveRace(); raceReplay = null;
  game = imported; activePage = 'home'; ensureDriverSelection(); syncPlayerEntrants();
  setupPanel.classList.add('hidden'); gamePanel.classList.remove('hidden');
  saveGame(); renderGame(); setStatus('Carrière importée avec succès');
}

async function populateTeams(year) {
  teamSelect.disabled = true;
  teamSelect.replaceChildren(new Option('Chargement', ''));
  try { const season = await fetchSeason(year); teamSelect.replaceChildren(...season.constructors.map((team) => new Option(team.name, team.id))); teamSelect.disabled = false; }
  catch { teamSelect.replaceChildren(new Option('Erreur', '')); }
}

async function startGame(formData) {
  const year = Number(formData.get('season'));
  const birthDate = formData.get('birthDate').toString();
  if (ageAt(birthDate, year) < MIN_MANAGER_AGE) { setStatus('Le manager doit avoir au moins 18 ans au début de la saison.'); return; }
  const season = await fetchSeason(year);
  const team = season.constructors.find((constructor) => constructor.id === formData.get('team'));
  if (!team) { setStatus('Choisis une écurie valide.'); return; }
  const firstName = formData.get('firstName').toString().trim();
  const lastName = formData.get('lastName').toString().trim();
  const drivers = await driversForTeam(year, team.id);
  game = { raceStrategies: {}, raceTyres: {}, racePitPlans: {}, sponsor: 'regularite', difficulty: difficultyFor(formData.get('difficulty')).id, career: { races: 0, wins: 0, podiums: 0, titles: 0, history: [] }, year, manager: { firstName, lastName, birthDate, lifeExpectancy: lifeExpectancy(firstName, lastName, birthDate) }, team, seasonTeams: season.constructors, drivers, driverSelection: { first: drivers[0]?.id ?? '', second: drivers[1]?.id ?? '' }, calendar: season.races, raceIndex: 0, car: teamCarStats(team), staff: { engineering: 60, strategy: 60, pitStop: 60 }, facilities: { factory: 1, simulator: 1, windTunnel: 1 }, finance: { budget: Math.round(baseBudget(year, season.constructors.length) * difficultyFor(formData.get('difficulty')).budgetFactor), income: 0, expenses: 0 }, results: {} };
  game.entrants = await buildEntrants(year, season.constructors, team.id, selectedRaceDrivers());
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
document.querySelector('#import-button').addEventListener('click', () => document.querySelector('#import-save').click());
document.querySelector('#import-save').addEventListener('change', async (event) => {
  await importSaveFile(event.target.files?.[0]);
  event.target.value = '';
});
setupForm.addEventListener('submit', (event) => { event.preventDefault(); startGame(new FormData(setupForm)).catch(() => setStatus('Impossible de charger les données F1. Vérifie ta connexion et réessaie.')); });

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !game) return;
  if (target.dataset.pitDriver) {
    if (raceReplay || game.results?.[game.calendar[game.raceIndex]?.round]) return;
    if (!game.drivers.some((driver) => driver.id === target.dataset.pitDriver)) return;
    game.racePitPlans ??= {};
    game.racePitPlans[target.dataset.pitDriver] = target.value === '2' ? 2 : 1;
    saveGame(); renderGame();
    return;
  }
  if (target.dataset.tyreDriver) {
    if (raceReplay || game.results?.[game.calendar[game.raceIndex]?.round]) return;
    if (!game.drivers.some((driver) => driver.id === target.dataset.tyreDriver)) return;
    game.raceTyres ??= {};
    game.raceTyres[target.dataset.tyreDriver] = tyreFor(target.value).id;
    saveGame(); renderGame();
    return;
  }
  if (target.id === 'results-race-select') { game.viewRound = Number(target.value); renderResultsTable(); return; }
  if (target.id === 'sponsor-select') {
    if (raceReplay || game.results?.[game.calendar[game.raceIndex]?.round]) return;
    game.sponsor = sponsorFor(target.value).id;
    saveGame(); renderGame();
    return;
  }
  if (target.dataset.strategyDriver) {
    if (raceReplay || game.results?.[game.calendar[game.raceIndex]?.round] || !game.drivers.some((driver) => driver.id === target.dataset.strategyDriver)) return;
    game.raceStrategies ??= {};
    game.raceStrategies[target.dataset.strategyDriver] = strategyFor(target.value).id;
    saveGame();
    renderGame();
    return;
  }
  if (target.dataset.raceDriver && !raceReplay && !game.results?.[game.calendar[game.raceIndex]?.round]) changeRaceDriver(target.dataset.raceDriver, target.value);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('button') : null;
  if (!(target instanceof HTMLButtonElement)) return;
  if ((target.dataset.page || target.dataset.pageJump) && game) { activePage = target.dataset.page ?? target.dataset.pageJump; renderGame(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (!game) return;
  if (target.dataset.car) developCar(target.dataset.car);
  if (target.dataset.facility) upgradeFacility(target.dataset.facility);
  if (target.dataset.staff) developStaff(target.dataset.staff);
  if (target.dataset.driver) developDriver(target.dataset.driver);
  if (target.dataset.live === 'start') startLiveRace();
  if (target.dataset.live === 'pause') pauseLiveRace();
  if (target.dataset.live === 'speed') changeRaceSpeed();
  if (target.id === 'next-race') nextRace();
  if (target.id === 'next-season') nextSeason().catch(() => setStatus('Impossible de charger la saison suivante. Réessaie.'));
  if (target.id === 'export-save' || target.dataset.exportSave !== undefined) exportSave();
  if (target.id === 'restart-game') restartGame();
});

const savedGame = loadSavedGame();
if (savedGame) { game = savedGame; ensureDriverSelection(); syncPlayerEntrants(); setupPanel.classList.add('hidden'); gamePanel.classList.remove('hidden'); renderGame(); }
else { setStatus(''); }
