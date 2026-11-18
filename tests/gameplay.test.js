import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strategyFor, retirementChance, developmentGain, trainingGain, facilityCost, raceIncome,
  raceWeather, tyreFor, tyreModifiers, sponsorFor, sponsorPayout, pointsForYear, seasonTitleBonus, difficultyFor, aiCompetition
} from '../src/gameplay.js';

test('stratégies: attaque plus rapide mais risquée', () => {
  assert.equal(strategyFor('invalid').id, 'equilibre');
  assert.ok(strategyFor('attaque').speedBonus > strategyFor('prudent').speedBonus);
  assert.ok(retirementChance(80,'attaque') > retirementChance(80,'equilibre'));
  assert.ok(retirementChance(80,'prudent') < retirementChance(80,'equilibre'));
  assert.ok(retirementChance(100,'attaque') < retirementChance(0,'attaque'));
});

test('météo simulée stable et pneus adaptés à la pluie', () => {
  const race = { round: 1, name: 'GP Test', circuit: 'Test Circuit' };
  assert.deepEqual(raceWeather(2026,race), raceWeather(2026,race));
  assert.ok(['wet','cloudy','dry'].includes(raceWeather(2026,race).condition));
  assert.equal(tyreFor('unknown').id,'medium');
  assert.ok(tyreModifiers('wet','wet').speedBonus > tyreModifiers('soft','wet').speedBonus);
  assert.ok(tyreModifiers('soft','dry').speedBonus > tyreModifiers('hard','dry').speedBonus);
  assert.ok(tyreModifiers('hard','dry').incidentMultiplier < tyreModifiers('soft','dry').incidentMultiplier);
});

test('barème de points selon chaque époque', () => {
  assert.deepEqual([1,2,3,4,5,6].map(p => pointsForYear(1955,p)), [8,6,4,3,2,0]);
  assert.deepEqual([1,2,3,4,5,6].map(p => pointsForYear(1985,p)), [9,6,4,3,2,1]);
  assert.deepEqual([1,2,3,4,5,6,7,8].map(p => pointsForYear(2005,p)), [10,8,6,5,4,3,2,1]);
  assert.deepEqual([1,2,3,4,5,6,7,8,9,10].map(p => pointsForYear(2026,p)), [25,18,15,12,10,8,6,4,2,1]);
  assert.equal(pointsForYear(2026,20),0);
});

test('écurie: installations et staff rendent la progression utile', () => {
  assert.ok(developmentGain('aero',{windTunnel:5}) > developmentGain('aero',{windTunnel:1}));
  assert.ok(developmentGain('engine',{factory:5}) > developmentGain('engine',{factory:1}));
  assert.ok(trainingGain({simulator:5}) > trainingGain({simulator:1}));
  assert.ok(facilityCost(4) > facilityCost(1));
});

test('finances: récompense les bons résultats et respecte les objectifs sponsors', () => {
  const podium = [{constructorId:'a',position:1,points:25,status:'Terminé'}, {constructorId:'a',position:3,points:15,status:'Terminé'}];
  const abandon = [{constructorId:'a',position:17,points:0,status:'Abandon'}];
  assert.ok(raceIncome(podium,'a') > raceIncome(abandon,'a'));
  assert.ok(sponsorPayout('podium',podium,'a').bonus > 0);
  assert.equal(sponsorPayout('podium',abandon,'a').bonus,0);
  assert.ok(sponsorPayout('points',podium,'a').bonus > 0);
  assert.equal(sponsorPayout('regularite',abandon,'a').bonus,0);
  assert.equal(sponsorFor('unknown').id,'regularite');
  assert.ok(seasonTitleBonus(1,10) > seasonTitleBonus(8,10));
});

test('difficulté : budget, revenus et adversaires évolutifs', () => {
  assert.equal(difficultyFor('unknown').id, 'pro');
  assert.ok(difficultyFor('rookie').budgetFactor > difficultyFor('legend').budgetFactor);
  assert.ok(aiCompetition(0, 'legend') > aiCompetition(0, 'rookie'));
  assert.ok(aiCompetition(15, 'pro') > aiCompetition(0, 'pro'));
});
