const START_YEAR = 1950;
const END_YEAR = 2026;
const API_BASE_URL = 'https://api.jolpi.ca/ergast/f1';

const seasonSelect = document.querySelector('#season-select');
const driversBody = document.querySelector('#drivers-body');
const constructorsBody = document.querySelector('#constructors-body');

const seasons = Array.from(
  { length: END_YEAR - START_YEAR + 1 },
  (_, index) => START_YEAR + index,
);
const cache = new Map();

function createCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function createMessageRow(columnCount, message) {
  const row = document.createElement('tr');
  const cell = createCell(message);
  cell.colSpan = columnCount;
  row.append(cell);
  return row;
}

function setLoading() {
  driversBody.replaceChildren(createMessageRow(3, 'Chargement'));
  constructorsBody.replaceChildren(createMessageRow(2, 'Chargement'));
}

function renderSeason(season) {
  driversBody.replaceChildren(...season.drivers.map((driver) => {
    const row = document.createElement('tr');
    row.append(
      createCell(`${driver.givenName} ${driver.familyName}`),
      createCell(driver.nationality),
      createCell(driver.dateOfBirth),
    );
    return row;
  }));

  constructorsBody.replaceChildren(...season.constructors.map((constructor) => {
    const row = document.createElement('tr');
    row.append(
      createCell(constructor.name),
      createCell(constructor.nationality),
    );
    return row;
  }));
}

async function fetchTable(year, tableName) {
  const response = await fetch(`${API_BASE_URL}/${year}/${tableName}.json?limit=2000`);
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }

  return response.json();
}

async function fetchSeason(year) {
  if (cache.has(year)) {
    return cache.get(year);
  }

  const [driversData, constructorsData] = await Promise.all([
    fetchTable(year, 'drivers'),
    fetchTable(year, 'constructors'),
  ]);

  const season = {
    year,
    drivers: driversData.MRData.DriverTable.Drivers.map((driver) => ({
      id: driver.driverId,
      code: driver.code ?? '',
      number: driver.permanentNumber ?? '',
      givenName: driver.givenName,
      familyName: driver.familyName,
      dateOfBirth: driver.dateOfBirth,
      nationality: driver.nationality,
    })).sort((a, b) => `${a.familyName} ${a.givenName}`.localeCompare(`${b.familyName} ${b.givenName}`)),
    constructors: constructorsData.MRData.ConstructorTable.Constructors.map((constructor) => ({
      id: constructor.constructorId,
      name: constructor.name,
      nationality: constructor.nationality,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };

  cache.set(year, season);
  return season;
}

async function loadSeason(year) {
  setLoading();

  try {
    renderSeason(await fetchSeason(year));
  } catch {
    driversBody.replaceChildren(createMessageRow(3, 'Erreur'));
    constructorsBody.replaceChildren(createMessageRow(2, 'Erreur'));
  }
}

seasonSelect.replaceChildren(...seasons.map((year) => {
  const option = document.createElement('option');
  option.value = String(year);
  option.textContent = String(year);
  return option;
}));

seasonSelect.value = String(END_YEAR);
seasonSelect.addEventListener('change', () => loadSeason(Number(seasonSelect.value)));
loadSeason(END_YEAR);
