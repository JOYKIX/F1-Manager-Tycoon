import test from 'node:test';
import assert from 'node:assert/strict';

test('parcours de base : création de carrière, navigation, course, résultats et finances', async () => {
  class MockElement {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.dataset = {};
      this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {} };
      this.listeners = new Map();
      this.children = [];
      this.innerHTML = '';
      this.value = '';
      this.disabled = false;
      this.textContent = '';
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    remove() {}
    click() {}
    setAttribute() {}
    closest(type) { return type === 'button' && this.tagName === 'BUTTON' ? this : null; }
  }
  class MockButton extends MockElement { constructor() { super('button'); } }
  class MockSelect extends MockElement { constructor() { super('select'); } }
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector,
      selector === '#season-select' || selector === '#team-select' ? new MockSelect() : new MockElement());
    return elements.get(selector);
  };
  const documentEvents = new Map();
  globalThis.Element = MockElement;
  globalThis.HTMLButtonElement = MockButton;
  globalThis.HTMLSelectElement = MockSelect;
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  globalThis.FormData = class {
    get(key) {
      return {
        season: '2026', team: 'alpha', firstName: 'Test', lastName: 'Manager', birthDate: '1988-04-12'
      }[key];
    }
  };
  globalThis.document = {
    querySelector: get,
    createElement: (tag) => tag === 'button' ? new MockButton() : new MockElement(tag),
    documentElement: { style: { setProperty() {} } },
    body: { dataset: {}, append() {} },
    addEventListener(type, fn) { documentEvents.set(type, fn); },
    title: '',
  };
  globalThis.window = { scrollTo() {}, confirm: () => true };
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  const drivers = [
    { driverId:'alice',givenName:'Alice',familyName:'Rossi',nationality:'French',dateOfBirth:'2000-04-01' },
    { driverId:'bob',givenName:'Bob',familyName:'Moreau',nationality:'French',dateOfBirth:'1999-03-01' }
  ];
  const constructors = [
    { constructorId:'alpha',name:'Alpha Racing',nationality:'French' },
    { constructorId:'beta',name:'Beta Motorsport',nationality:'British' }
  ];
  const races = [{
    round:'1', raceName:'Grand Prix Test',
    date:'2026-06-18',
    Circuit:{ circuitName:'Circuit du Test',Location:{locality:'Paris',country:'France'} }
  }];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    let table;
    if (path.endsWith('/drivers.json')) table = { DriverTable:{ Drivers:drivers } };
    else if (path.endsWith('/constructors.json')) table = { ConstructorTable:{ Constructors:constructors } };
    else if (path.endsWith('/races.json')) table = { RaceTable:{ Races:races } };
    else throw new Error('Unknown API fixture ' + path);
    return { ok:true, json:async () => ({ MRData:table }) };
  };
  await import('../src/main.js');
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  await tick();
  assert.equal(get('#team-select').disabled, false, 'équipes chargées');

  const form = get('#setup-form');
  form.listeners.get('submit')({ preventDefault() {} });
  await tick();
  assert.match(get('#workspace').innerHTML,/Calendrier à venir/);
  assert.ok(storage.has('f1-manager-tycoon-save'));

  const click = (data, id = '') => {
    const button = new MockButton();
    button.dataset = data; button.id = id;
    documentEvents.get('click')({ target:button });
  };
  click({ pageJump:'race' });
  assert.match(get('#workspace').innerHTML,/Préparation de course/);
  assert.match(get('#workspace').innerHTML,/pneus pluie|Piste plutôt sèche/);

  const tyre = new MockSelect();
  tyre.dataset.tyreDriver = 'alice'; tyre.value = 'hard';
  documentEvents.get('change')({ target:tyre });
  assert.equal(JSON.parse(storage.get('f1-manager-tycoon-save')).raceTyres.alice,'hard');

  click({}, 'next-race');
  await tick();
  const saved = JSON.parse(storage.get('f1-manager-tycoon-save'));
  assert.equal(saved.raceIndex,1);
  assert.ok(saved.results['1'].length > 0);
  assert.ok(saved.finance.income > 0);
  assert.equal(saved.career.races,1);

  click({ page:'results' });
  assert.match(get('#results-table').innerHTML,/Grand Prix Test/);
  click({ page:'standings' });
  assert.match(get('#driver-standings').innerHTML,/<table>/);
  click({ page:'finance' });
  assert.match(get('#workspace').innerHTML,/Finances/);
  assert.match(get('#workspace').innerHTML,/Contrat sponsor/);
});
