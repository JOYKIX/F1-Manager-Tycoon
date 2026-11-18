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
