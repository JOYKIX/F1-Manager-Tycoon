// Règles de jeu séparées de l'interface pour pouvoir les tester.
export const STRATEGIES = Object.freeze({
  prudent: Object.freeze({
    id: 'prudent', label: 'Préserver', speedBonus: -6, incidentMultiplier: 0.55,
    description: 'Moins rapide, mais réduit fortement le risque d’abandon.',
  }),
  equilibre: Object.freeze({
    id: 'equilibre', label: 'Équilibrée', speedBonus: 0, incidentMultiplier: 1,
    description: 'Le compromis entre rythme et fiabilité.',
  }),
  attaque: Object.freeze({
    id: 'attaque', label: 'Attaquer', speedBonus: 8, incidentMultiplier: 1.8,
    description: 'Plus rapide, mais augmente le risque d’abandon.',
  }),
});

export function strategyFor(id) {
  return Object.hasOwn(STRATEGIES, id) ? STRATEGIES[id] : STRATEGIES.equilibre;
}

export function retirementChance(reliability, strategyId = 'equilibre') {
  const safe = Math.max(0, Math.min(100, Number(reliability) || 0));
  const base = Math.max(0.015, 1 - Math.min(0.985, 0.86 + safe / 850));
  return Math.min(0.45, base * strategyFor(strategyId).incidentMultiplier);
}

export function developmentGain(part, facilities = {}) {
  const building = { chassis: 'factory', engine: 'factory', aero: 'windTunnel', reliability: 'simulator' }[part];
  if (!building) return 0;
  const level = Math.max(1, Math.floor(Number(facilities[building]) || 1));
  return Math.min(7, 3 + Math.floor((level - 1) / 2));
}

export function trainingGain(facilities = {}) {
  const level = Math.max(1, Math.floor(Number(facilities.simulator) || 1));
  return Math.min(5, 2 + Math.floor((level - 1) / 2));
}

export function facilityCost(level) {
  const safe = Math.max(1, Math.floor(Number(level) || 1));
  return 1_000_000 + (safe - 1) * 350_000;
}

export function raceIncome(results, constructorId) {
  const teamResults = (results ?? []).filter((row) => row.constructorId === constructorId);
  return 500_000 + teamResults.reduce((total, row) => {
    const place = Math.max(1, Number(row.position) || 21);
    const points = Math.max(0, Number(row.points) || 0);
    return total + Math.max(0, 21 - place) * 90_000 + points * 35_000;
  }, 0);
}


export const TYRES = Object.freeze({
  soft: Object.freeze({ id: 'soft', label: 'Tendres', description: 'Très rapides sur piste sèche, usure élevée.' }),
  medium: Object.freeze({ id: 'medium', label: 'Médiums', description: 'Le meilleur compromis sur piste sèche.' }),
  hard: Object.freeze({ id: 'hard', label: 'Durs', description: 'Un peu plus lents, mais très fiables.' }),
  intermediate: Object.freeze({ id: 'intermediate', label: 'Intermédiaires', description: 'Adaptés à une piste humide.' }),
  wet: Object.freeze({ id: 'wet', label: 'Pluie', description: 'Indispensables sous une forte pluie.' }),
});

export const SPONSORS = Object.freeze({
  regularite: Object.freeze({ id: 'regularite', label: 'Partenaire stabilité', upfront: 350_000, bonus: 200_000, description: 'Prime si une voiture termine la course.' }),
  points: Object.freeze({ id: 'points', label: 'Partenaire performance', upfront: 200_000, bonus: 1_400_000, description: 'Prime si l’écurie marque au moins 8 points.' }),
  podium: Object.freeze({ id: 'podium', label: 'Partenaire prestige', upfront: 100_000, bonus: 3_200_000, description: 'Prime si une voiture monte sur le podium.' }),
});

export function tyreFor(id) {
  return Object.hasOwn(TYRES, id) ? TYRES[id] : TYRES.medium;
}

export function sponsorFor(id) {
  return Object.hasOwn(SPONSORS, id) ? SPONSORS[id] : SPONSORS.regularite;
}

function hash(value) {
  return String(value).split('').reduce((n, char) => ((n * 33) + char.charCodeAt(0)) >>> 0, 5381);
}

// Météo de gameplay simulée, PAS une donnée météorologique historique.
export function raceWeather(year, race) {
  const seed = hash([year, race.round, race.circuit ?? race.name].join('-'));
  const roll = seed % 100;
  const condition = roll < 22 ? 'wet' : roll < 45 ? 'cloudy' : 'dry';
  return {
    condition,
    label: condition === 'wet' ? 'Pluie' : condition === 'cloudy' ? 'Nuageux' : 'Ensoleillé',
    icon: condition === 'wet' ? '🌧' : condition === 'cloudy' ? '☁' : '☀',
    temperature: 14 + (Math.floor(seed / 100) % 19),
  };
}

export function tyreModifiers(tyreId, weather) {
  const condition = typeof weather === 'string' ? weather : weather?.condition;
  const rain = condition === 'wet';
  const dry = {
    soft: [9, 1.30],
    medium: [3, 1],
    hard: [-3, 0.7],
    intermediate: [-7, 0.95],
    wet: [-15, 1.1],
  };
  const rainy = {
    soft: [-17, 1.9],
    medium: [-14, 1.65],
    hard: [-18, 1.6],
    intermediate: [7, 0.85],
    wet: [11, 0.7],
  };
  const [speedBonus, incidentMultiplier] = (rain ? rainy : dry)[tyreFor(tyreId).id];
  return { speedBonus, incidentMultiplier };
}

export function pointsForYear(year, position) {
  if (position < 1) return 0;
  let scale;
  if (year <= 1959) scale = [8, 6, 4, 3, 2];
  else if (year === 1960) scale = [8, 6, 4, 3, 2, 1];
  else if (year <= 1990) scale = [9, 6, 4, 3, 2, 1];
  else if (year <= 2002) scale = [10, 6, 4, 3, 2, 1];
  else if (year <= 2009) scale = [10, 8, 6, 5, 4, 3, 2, 1];
  else scale = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  return scale[position - 1] ?? 0;
}

export function sponsorPayout(id, results, constructorId) {
  const sponsor = sponsorFor(id);
  const teamResults = (results ?? []).filter((row) => row.constructorId === constructorId);
  const points = teamResults.reduce((total, row) => total + (Number(row.points) || 0), 0);
  const podium = teamResults.some((row) => row.position <= 3 && row.status !== 'Abandon');
  const finisher = teamResults.some((row) => row.status !== 'Abandon');
  const successful = sponsor.id === 'points' ? points >= 8 : sponsor.id === 'podium' ? podium : finisher;
  return { base: sponsor.upfront, bonus: successful ? sponsor.bonus : 0, goalReached: successful, total: sponsor.upfront + (successful ? sponsor.bonus : 0) };
}

export function seasonTitleBonus(place, teamCount) {
  const position = Math.max(1, Number(place) || teamCount);
  return Math.max(0, (Math.max(1, teamCount) - position + 1) * 350_000);
}
