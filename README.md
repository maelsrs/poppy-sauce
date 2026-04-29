# poppy.sauce 🌺

> MICHAUX Nicolas, GUARATO Kevin, SOURISSEAU Maël, JAUDINOT Martin

## Lien : https://poppy.lsblk2exa.beauty

**Site de quiz fortement inspiré de [Pop Sauce](https://jklm.fun/).**, qui propose des parties de culture générale avec des rounds chronométrés, des questions imagées, et des catégories variées.

## Fonctionnalités

- **Système de rounds** : le premier joueur à atteindre l'objectif de points remporte le round, le premier à gagner le bon nombre de rounds remporte la partie
- **Points dégressifs** : le premier qui répond correctement marque le score plein (10 points), les suivants perdent 1 point par seconde de retard.
- **Catégories à la carte** : avant de lancer la partie l'hôte peut ne garder que certaines catégories (mode `uniquement`) ou en exclure (mode `enlever`)
- **Parties publiques** listées dans un onglet dédié, rejoignables en invité (juste un pseudo)
- **Création de partie réservée aux comptes**
- **Chat in-game** pour parler aux autres joueurs pendant les rounds
- **Stats perso** : parties jouées, victoires, % de bonnes réponses, meilleur score, temps de réponse moyen
- **Leaderboards** globaux : top victoires, top temps de jeu, joueurs les plus rapides
- **Panneau admin** pour gérer les utilisateurs et la base de questions (ajout, modif, suppression, filtres par catégorie/rang)

## Prérequis

- Docker
- Docker Compose

## Installation

```bash
git clone git@github.com:maelsrs/poppy-sauce.git
cd poppy-sauce
```

Stack complète (backend + frontend + auto-update via Watchtower) :

```bash
docker compose up -d
```

Mongo en local :

```bash
cd mongo && docker compose up -d
```

Les images sont publiées sur GHCR à chaque push sur `main` par GitHub Actions :
`ghcr.io/maelsrs/poppy-back:latest` et `ghcr.io/maelsrs/poppy-front:latest`. [Watchtower](https://github.com/containrrr/watchtower) est utilisé pour pull automatiquement.

> [!IMPORTANT]
> Les ~10 000 questions ne sont pas versionnées dans le repo : elles ont été scrapées (sans autorisation 🙊) depuis [jklm.fun](https://jklm.fun/) et vous devez importer manuellement dans la base avant de lancer une partie. Beanie crée automatiquement les index Mongo au premier démarrage, mais si la collection `questions` est vide, `$sample` renverra zéro résultat.

Chaque document de la collection `questions` suit ce format :

```json
{
  "question_id": 42,
  "question_type": "image",
  "category": "Grand public",
  "question": "Quel est ce monument ?",
  "answers": ["Tour Eiffel", "Eiffel", "La Tour Eiffel"],
  "description": "Inaugurée en 1889 pour l'Exposition universelle de Paris.",
  "image_url": "https://example.com/eiffel.jpg"
}
```

Détails des champs :

- `question_type` : `text` ou `image`
- `description` et `image_url` : optionnels
- `answers` : toutes les graphies acceptées pour la réponse. La validation est insensible à la casse, aux accents et à la ponctuation.

## Structure

```
.
├── backend/app/
│   ├── main.py                # Bootstrap FastAPI + Socket.IO
│   ├── api/
│   │   ├── routes/            # auth, users, rooms, admin, stats, health
│   │   └── websockets.py      # Moteur de jeu temps réel (rounds, scoring, $sample)
│   ├── core/
│   │   ├── config.py          # Variables d'env, CORS, durées token
│   │   └── security.py        # JWT cookie, get_current_user, require_admin
│   ├── db/client.py           # Init Beanie, connexion Mongo
│   └── models/                # UserDocument, QuestionDocument, RoomDocument
├── front/src/
│   ├── App.tsx                # Routes + navbar
│   ├── pages/                 # Home, Auth, Lobby, PublicGames, Stats, Admin
│   ├── components/ui.tsx      # Modal, Field, primitives
│   ├── auth/AuthContext.tsx   # `/auth/me` au mount, logout
│   └── services/              # auth (request<T> avec cookies), rooms, stats
├── docker-compose.yml         # Stack prod (backend + front + watchtower)
├── mongo/docker-compose.yml   # Mongo local pour le dev
├── backend/Dockerfile
├── front/Dockerfile           # build pnpm + nginx
└── .github/workflows/deploy.yml # CI/CD : build + push GHCR
```

## Technologies

- **Frontend** : [React 19](https://react.dev/) / [TypeScript](https://www.typescriptlang.org/) / [Vite](https://vite.dev/) / [Socket.IO client](https://socket.io/)
- **Backend** : [FastAPI](https://fastapi.tiangolo.com/) / [Beanie](https://beanie-odm.dev/) / [Motor](https://motor.readthedocs.io/) / [python-socketio](https://python-socketio.readthedocs.io/)
- **DB** : [MongoDB](https://www.mongodb.com/)
- **Deploy** : [Docker](https://www.docker.com/) / [Caddy](https://caddyserver.com/) / [Nginx](https://nginx.org/) (front)
- **CI/CD** : [GitHub Actions](https://github.com/features/actions) → [GHCR](https://ghcr.io)
