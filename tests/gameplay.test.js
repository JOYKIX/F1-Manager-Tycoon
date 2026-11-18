import test from 'node:test';
import assert from 'node:assert/strict';
import { strategyFor, retirementChance, developmentGain, trainingGain, facilityCost, raceIncome } from '../src/gameplay.js';

test('stratégie invalide : mode équilibré par défaut', () => {
  assert.equal(strategyFor('inconnue').id, 'equilibre');
  assert.ok(strategyFor('attaque').speedBonus > strategyFor('prudent').speedBonus);
});
test('attaque plus risquée, prudent plus sûr', () => {
  assert.ok(retirementChance(70, 'prudent') < retirementChance(70, 'equilibre'));
  assert.ok(retirementChance(70, 'equilibre') < retirementChance(70, 'attaque'));
  assert.ok(retirementChance(100, 'attaque') < retirementChance(0, 'attaque'));
});
test('les infrastructures améliorent réellement les développements', () => {
  assert.ok(developmentGain('aero', { windTunnel: 5 }) > developmentGain('aero', { windTunnel: 1 }));
  assert.ok(developmentGain('engine', { factory: 5 }) > developmentGain('engine', { factory: 1 }));
  assert.ok(trainingGain({ simulator: 5 }) > trainingGain({ simulator: 1 }));
  assert.equal(developmentGain('unknown'), 0);
});
test('coûts progressifs et revenus fondés sur les résultats', () => {
  assert.ok(facilityCost(4) > facilityCost(1));
  const podium = [{ constructorId: 'a', position: 1, points: 25 }, { constructorId: 'a', position: 3, points: 15 }];
  const back = [{ constructorId: 'a', position: 17, points: 0 }];
  assert.ok(raceIncome(podium, 'a') > raceIncome(back, 'a'));
  assert.equal(raceIncome(podium, 'b'), 500000);
});
