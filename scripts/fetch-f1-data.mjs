import { writeFile, mkdir } from 'node:fs/promises';

const START_YEAR = 1950;
const END_YEAR = 2026;
const BASE_URL = 'https://api.jolpi.ca/ergast/f1';

async function fetchTable(path) {
  const response = await fetch(`${BASE_URL}${path}.json?limit=2000`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${path}`);
  }

  return response.json();
}

async function fetchSeason(year) {
  const [driversData, constructorsData] = await Promise.all([
    fetchTable(`/${year}/drivers`),
    fetchTable(`/${year}/constructors`),
  ]);

  const drivers = driversData.MRData.DriverTable.Drivers.map((driver) => ({
    id: driver.driverId,
    code: driver.code ?? '',
    number: driver.permanentNumber ?? '',
    givenName: driver.givenName,
    familyName: driver.familyName,
    dateOfBirth: driver.dateOfBirth,
    nationality: driver.nationality,
  })).sort((a, b) => `${a.familyName} ${a.givenName}`.localeCompare(`${b.familyName} ${b.givenName}`));

  const constructors = constructorsData.MRData.ConstructorTable.Constructors.map((constructor) => ({
    id: constructor.constructorId,
    name: constructor.name,
    nationality: constructor.nationality,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { year, drivers, constructors };
}

const seasons = [];
for (let year = START_YEAR; year <= END_YEAR; year += 1) {
  seasons.push(await fetchSeason(year));
  console.log(`${year}`);
}

await mkdir('data', { recursive: true });
await writeFile('data/f1-history.json', `${JSON.stringify({
  source: 'https://api.jolpi.ca/ergast/f1',
  startYear: START_YEAR,
  endYear: END_YEAR,
  generatedAt: new Date().toISOString(),
  seasons,
}, null, 2)}\n`);
