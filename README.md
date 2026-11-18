# F1 Manager Tycoon · Race Control Edition

Un jeu indépendant de gestion de Formule 1 en français, jouable dans ton navigateur. Monte ton écurie, prépare tes pilotes, investis dans la R&D, négocie tes primes et affronte l'histoire de la F1 de **1950 à 2026**.

> Le jeu est un projet de fans, non affilié à Formula One. Les **pilotes, constructeurs, Grands Prix et dates** proviennent de [Jolpica F1](https://api.jolpi.ca/ergast/f1/). Les **météos, performances, qualifications, chronos, abandons et résultats** sont des simulations fictives.

## Démarrer

Aucune dépendance de production et aucune clé API nécessaires. Démarre un serveur statique local à la racine du dépôt :

```bash
python3 -m http.server 8000
```

Ouvre ensuite http://localhost:8000. Une connexion Internet est nécessaire pour récupérer les données des saisons auprès de Jolpica. Ouvrir directement `index.html` par `file://` n'est pas recommandé (modules JavaScript/CORS).

## Nouveautés majeures

### Graphismes et navigation
- Une interface de **cockpit/paddock** entièrement revisitée, avec barre de navigation et responsive mobile.
- Accueil stratégique : prochain GP, circuit, météo simulée, performance de la voiture, classement, planning et palmarès.
- Écrans dédiés aux pilotes, au personnel, à la R&D, au calendrier, au chronométrage, aux résultats et à l'économie.

### Gameplay
- **Trois difficultés** : Rookie (budget supplémentaire, IA plus douce), Pro (équilibrée), Légende (budget réduit, IA renforcée). Les rivaux progressent pendant la saison.
- **Choix par pilote** avant la course : mode Préserver / Équilibrée / Attaquer, pneus Tendres / Médiums / Durs / Intermédiaires / Pluie et plan à 1 ou 2 arrêts.
- **Météo de gameplay** déterministe selon le Grand Prix. La pluie change l'efficacité des gommes.
- **Qualifications** simulées avec une grille unique ; abandons classés derrière les pilotes à l'arrivée, sans points.
- **Barèmes de points selon l'époque** (approximation ; point du meilleur tour non simulé).
- **R&D** : usine, soufflerie et simulateur apportent de vrais bonus ; les compétences de l'équipe améliorent aussi la voiture et la stratégie.
- **Sponsoring** : choisis entre régularité, performance et prestige, avec primes conditionnelles.
- **Carrière** : historique des saisons, gains et classement, podiums, victoires, titres et prime de fin de saison.
- **Simulateur live** : évolution tour après tour, pauses, accélération, incidents, arrêts aux stands et classement en direct.

### Sauvegardes
- Sauvegarde locale automatique (même navigateur / même appareil).
- Export de carrière en **JSON** et import pour reprendre une partie ailleurs.
- Compatibilité avec les sauvegardes créées avant cette refonte via migration des champs manquants.
- Confirmation avant effacement de la carrière.

## Comment jouer

1. Choisis l'année, l'écurie, la difficulté et l'identité de ton manager.
2. Depuis **Mon écurie** et **Développement**, améliore tes installations, ton personnel et tes pilotes en respectant le budget.
3. Dans **Finances**, choisis ton sponsor et son objectif avant chaque Grand Prix.
4. Dans **Course**, analyse la météo, prépare les deux pilotes, les pneus et les arrêts, puis lance la simulation live ou valide directement.
5. Consulte les **Résultats** et **Classements**, puis passe à la saison suivante une fois le calendrier terminé.

Les résultats sont recalculables uniquement tant que la course n'a pas démarré : les choix de course sont verrouillés au lancement et conservés dans la sauvegarde.

## Développement et tests

Prérequis de test : Node.js 22 ou version récente.

```bash
npm run check
```

La commande vérifie la syntaxe et lance les tests Node.js, y compris un test simulé de création de carrière et de navigation. Un workflow GitHub Actions s'exécute sur les commits de la branche de refonte et sur les pull requests.

```bash
npm test
```

Les règles du jeu sont dans `src/gameplay.js`, l'application dans `src/main.js`, le thème dans `src/styles.css`, les tests dans `tests/`.

## Limites actuelles

Cette version reste un **jeu de gestion solo côté navigateur** : pas de multijoueur, pas de compte cloud, pas de données météo historiques et pas de simulation physique des voitures. Une vérification manuelle sur un vrai navigateur et plusieurs tailles d'écran reste recommandée en plus des tests automatisés.
