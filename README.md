# F1 Manager Tycoon

Jeu de gestion d'écurie de Formule 1, jouable dans le navigateur, avec saisons historiques de 1950 à 2026.

## Démarrage

Aucune installation de dépendance n'est nécessaire pour jouer :

```bash
python3 -m http.server 8000
```

Ouvrez ensuite http://localhost:8000 et créez votre manager (au moins 18 ans à la saison de départ).

Le chargement des saisons, équipes, pilotes et calendriers nécessite une connexion Internet : les données proviennent de l'API [Jolpica F1](https://api.jolpi.ca/ergast/f1/).

## Gameplay

- Choisissez une écurie, vos deux pilotes titulaires et une stratégie **par pilote** avant le départ.
- **Préserver** diminue la vitesse et le risque d'abandon ; **Équilibrée** est le compromis ; **Attaquer** augmente la vitesse et le risque.
- Développez les performances de votre monoplace et entraînez les pilotes. Les niveaux d'**usine**, de **soufflerie** et de **simulateur** améliorent les gains correspondants.
- Gérez vos finances : les courses rapportent des revenus selon les places obtenues et les points marqués ; les installations deviennent plus chères à chaque niveau.
- Suivez le direct, les résultats et les classements, puis passez à la saison suivante jusqu'en 2026.

La progression est enregistrée automatiquement dans le stockage local du navigateur. Une sauvegarde ne se synchronise pas entre appareils. Les résultats de course sont simulés : ce ne sont pas les résultats historiques.

## Vérifications

Avec Node.js récent :

```bash
npm run check
```

Cette commande contrôle la syntaxe JavaScript et lance les tests des règles de gameplay.
