# 🚩 Bot Discord de Test Politique

[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green?logo=node.js)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue?logo=discord)](https://discord.js.org)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status](https://img.shields.io/badge/Status-Active-success.svg)]()
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)]()

> Un bot Discord qui effectue des tests d'orientation politique avec un biais intentionnel vers l'extrême gauche, incluant un système anti-raid et une gestion avancée des configurations par serveur. ⚔️

## 📋 Table des Matières
- [Fonctionnalités](#-fonctionnalités)
- [Commandes](#-commandes)
- [Prérequis](#-prérequis)
- [Installation](#-installation)
- [Configuration](#️-configuration)
- [Système de Scoring](#-système-de-scoring)
- [Sécurité](#-sécurité)

## ✨ Fonctionnalités

- 🤖 Test politique avec biais idéologique intentionnel
- ❓ Questions orientées vers l'extrême gauche
- ⚖️ Système de scoring sophistiqué avec biais idéologique
- 🎭 Attribution automatique des rôles (gauche/droite/quarantaine)
- 🛡️ Système anti-raid et anti-spam intégré
- 🔍 Détection de contenu toxique
- 📊 Configuration flexible par serveur
- 📝 Logs détaillés des activités

## 🔧 Commandes

### 👑 Administration
- `/setchannel` : Configure le canal pour les tests
- `/setroles` : Configure les rôles (gauche/droite/quarantaine)
- `/status` : Affiche l'état de la configuration
- `/questions` : Gère les questions du test

### 🎮 Utilisateur
- `/start` : Commence le test politique

## 🔧 Prérequis

- 📦 Node.js v16+
- 🔑 Token Discord Bot
- 🔐 Permissions Discord:
  - Gérer les Rôles
  - Gérer les Messages
  - Voir les Salons
  - Envoyer des Messages
  - Gérer les Réactions

## 📥 Installation

1. Clonez le repository :
```bash
git clone [url-du-repo]
cd discord-bot
```

2. Installez les dépendances :
```bash
npm install
```

3. Configurez les variables d'environnement :
```bash
cp .env.example .env
# Éditez le fichier .env avec :
# TOKEN=votre_token_discord
# CLIENT_ID=id_de_votre_bot
```

4. Lancez le bot :
```bash
npm start
```

## ⚙️ Configuration

Le système utilise deux fichiers de configuration principaux :

### 📄 config.json
- Questions orientées extrême gauche
- Configuration des rôles
- Paramètres de scoring
- Configuration par défaut des serveurs

### 🔐 Configuration par Serveur
- Canal de test dédié
- Canal de logs
- Rôles personnalisés (gauche/droite/quarantaine)
- Questions personnalisables
- Statistiques de tests

## 📈 Système de Scoring

Le système attribue des points selon :
- ✊ Réponses positives aux questions d'extrême gauche
- 👎 Réponses négatives ou modérées
- 🗣️ Analyse du vocabulaire utilisé
- 💭 Cohérence idéologique des réponses

## 🛡️ Sécurité

### 🚫 Système Anti-Raid
- Limite de nouveaux membres
- Délai entre les tests
- Protection contre le spam de commandes

### 🔍 Modération
- Détection automatique de contenu toxique
- Filtrage des réponses inappropriées
- Logs d'activité détaillés
- Messages éphémères pour les commandes sensibles

### 👮 Permissions
- Système de permissions hiérarchique
- Commandes administratives protégées
- Validation des configurations
# Lavoixlibertaire2.0
