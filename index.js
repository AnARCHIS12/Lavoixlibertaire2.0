require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// Charger la configuration depuis config.json
const config = require('./config.json');
const defaultQuestions = config.defaultQuestions;
const scoreThresholds = config.scoreThresholds;
const penalites = config.penalites;

// Map pour stocker les questions actives
const activeQuestions = new Map();
const userResponses = new Map();

// Fonction pour obtenir une question aléatoire d'une catégorie
function getRandomQuestion(category) {
  const questions = config.questions[category];
  return questions[Math.floor(Math.random() * questions.length)];
}

// Fonction pour obtenir un ensemble de questions pour le test
function generateQuestionSet(numberOfQuestions = 10) {
  const categories = Object.keys(config.questions);
  let questions = [];
  
  // Assurer au moins une question par catégorie principale
  categories.forEach(category => {
    questions.push({
      category: category,
      question: getRandomQuestion(category)
    });
  });
  
  // Compléter avec des questions aléatoires si nécessaire
  while (questions.length < numberOfQuestions) {
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    questions.push({
      category: randomCategory,
      question: getRandomQuestion(randomCategory)
    });
  }
  
  // Mélanger les questions
  return questions.sort(() => Math.random() - 0.5);
}

// Chemin vers le fichier de configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Structure de configuration par serveur
let serverConfigs = {};

// Charger les configurations
try {
  if (fs.existsSync(CONFIG_FILE)) {
    serverConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (error) {
  console.error('Erreur lors du chargement des configurations:', error);
}

// Fonction pour sauvegarder les configurations
const saveConfigs = () => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 2));
    console.log('Configurations sauvegardées');
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des configurations:', error);
  }
};

// Fonction pour obtenir la configuration d'un serveur
const getServerConfig = (guildId) => {
  if (!serverConfigs.servers) {
    serverConfigs.servers = {};
  }
  
  if (!serverConfigs.servers[guildId]) {
    serverConfigs.servers[guildId] = {
      channelId: null,
      logChannelId: null,  // Ajout du canal de logs
      roles: {
        droite: null,
        gauche: null
      },
      questions: generateQuestionSet(10),
      activeTests: 0,
      totalTests: 0
    };
    saveConfigs();
  }
  return serverConfigs.servers[guildId];
};

// Fonction pour valider la configuration d'un serveur
const validateConfig = (guildId) => {
  const config = getServerConfig(guildId);
  const errors = [];

  // Vérifier le canal de test
  if (!config.channelId) {
    errors.push('Canal de test non configuré (/setchannel)');
  }

  // Vérifier le canal de logs
  if (!config.logChannelId) {
    errors.push('Canal de logs non configuré (/setlogs)');
  }

  // Vérifier les rôles
  if (!config.roles.droite || !config.roles.gauche) {
    errors.push('Rôles non configurés (/setroles)');
  }

  // Vérifier les questions
  if (!config.questions || config.questions.length === 0) {
    errors.push('Aucune question configurée (/questions add)');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
};

// Fonction pour vérifier si le canal de logs est valide
const validateLogChannel = async (guild, config) => {
  if (!config.logChannelId) return false;
  
  try {
    const channel = await guild.channels.fetch(config.logChannelId);
    return channel && channel.isTextBased();
  } catch (error) {
    console.error(`Erreur lors de la vérification du canal de logs pour le serveur ${guild.id}:`, error);
    return false;
  }
};

// Fonction pour envoyer un log
const sendLog = async (guild, embed) => {
  const config = getServerConfig(guild.id);
  
  if (!config.logChannelId) {
    console.warn(`Pas de canal de logs configuré pour le serveur ${guild.id}`);
    return false;
  }

  try {
    const logChannel = await guild.channels.fetch(config.logChannelId);
    if (!logChannel || !logChannel.isTextBased()) {
      console.warn(`Canal de logs invalide pour le serveur ${guild.id}`);
      return false;
    }

    await logChannel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.error(`Erreur lors de l'envoi du log pour le serveur ${guild.id}:`, error);
    return false;
  }
};

// Modifier la gestion des questions actives pour supporter plusieurs serveurs
const antiRaid = {
  serverData: new Map(), // Stocke les données par serveur
  
  getServerData: function(guildId) {
    if (!this.serverData.has(guildId)) {
      this.serverData.set(guildId, {
        joinCount: 0,
        lastReset: Date.now(),
        joinQueue: new Map(),
        commandCooldowns: new Map(),
        spamProtection: new Map(),
        questionnaireCooldown: new Map()
      });
    }
    return this.serverData.get(guildId);
  },
  
  canJoin: function(member) {
    const serverData = this.getServerData(member.guild.id);
    const now = Date.now();
    
    if (now - serverData.lastReset > 60000) {
      serverData.joinCount = 0;
      serverData.lastReset = now;
    }
    
    const accountAge = now - member.user.createdTimestamp;
    if (accountAge < 3 * 24 * 60 * 60 * 1000) {
      return { allowed: false, reason: 'Votre compte doit avoir au moins 3 jours d\'ancienneté.' };
    }
    
    serverData.joinCount++;
    if (serverData.joinCount > 5) {
      return { allowed: false, reason: 'Trop de nouveaux membres. Patientez quelques minutes.' };
    }
    
    return { allowed: true, reason: 'Le compte remplit tous les critères de sécurité.' };
  },
  
  canTakeTest: function(guildId, userId) {
    const serverData = this.getServerData(guildId);
    const now = Date.now();
    const lastTest = serverData.questionnaireCooldown.get(userId) || 0;
    
    if (now - lastTest < 12 * 60 * 60 * 1000) {
      const remainingHours = Math.ceil((12 * 60 * 60 * 1000 - (now - lastTest)) / (1000 * 60 * 60));
      return { 
        allowed: false, 
        reason: `Vous devez attendre ${remainingHours} heures avant de refaire le test.`
      };
    }
    
    serverData.questionnaireCooldown.set(userId, now);
    return { allowed: true };
  },
  
  canUseCommand: function(guildId, userId) {
    const serverData = this.getServerData(guildId);
    const now = Date.now();
    const lastUse = serverData.commandCooldowns.get(userId) || 0;
    
    if (now - lastUse < 10000) {
      return false;
    }
    
    serverData.commandCooldowns.set(userId, now);
    return true;
  },
  
  isSpamming: function(guildId, userId) {
    const serverData = this.getServerData(guildId);
    const now = Date.now();
    const userMessages = serverData.spamProtection.get(userId) || [];
    
    const recentMessages = userMessages.filter(timestamp => now - timestamp < 10000);
    recentMessages.push(now);
    serverData.spamProtection.set(userId, recentMessages);
    
    return recentMessages.length > 3;
  }
};

const commands = [
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Définir le salon pour le test politique')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Le canal où le test sera effectué')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Définir le salon pour les logs de modération')
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('Le salon pour les logs')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('setroles')
    .setDescription('Définir les rôles pour le test politique')
    .addRoleOption(option => 
      option.setName('droite')
        .setDescription('Le rôle pour la droite')
        .setRequired(true)
    )
    .addRoleOption(option => 
      option.setName('gauche')
        .setDescription('Le rôle pour la gauche')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Démarrer le questionnaire'),
  new SlashCommandBuilder()
    .setName('questions')
    .setDescription('Gérer les questions du test politique')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Voir la liste des questions actuelles')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Ajouter une nouvelle question')
        .addStringOption(option =>
          option.setName('question')
            .setDescription('La question à ajouter')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Supprimer une question')
        .addIntegerOption(option =>
          option.setName('index')
            .setDescription('L\'index de la question à supprimer (commence à 1)')
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  new SlashCommandBuilder()
    .setName('resetconfig')
    .setDescription('Réinitialiser la configuration du serveur')
    .addBooleanOption(option =>
      option.setName('confirm')
        .setDescription('Confirmer la réinitialisation')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Voir l\'état du bot sur ce serveur'),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Lancer manuellement le test politique pour un membre')
    .addUserOption(option =>
      option.setName('membre')
        .setDescription('Le membre à tester')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('addquestion')
    .setDescription('Ajoute une nouvelle question au test politique')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('La question à ajouter')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('removequestion')
    .setDescription('Supprime une question du test politique')
    .addIntegerOption(option =>
      option.setName('numero')
        .setDescription('Le numéro de la question à supprimer')
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('listquestions')
    .setDescription('Liste toutes les questions actuelles'),
  new SlashCommandBuilder()
    .setName('resetquestions')
    .setDescription('Réinitialise les questions aux questions par défaut d\'extrême gauche')
];

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
  try {
    console.log('Début de l\'enregistrement des commandes...');

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log('Commandes enregistrées avec succès !');
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement des commandes:', error);
  }
})();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId } = interaction;
  const config = getServerConfig(guildId);

  try {
    if (commandName === 'setchannel') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          ephemeral: true
        });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      config.channelId = channel.id;
      saveConfigs();
      
      await interaction.reply(`Canal configuré sur ${channel}`);
    }
    else if (commandName === 'setlogs') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          ephemeral: true
        });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      
      // Vérifier que c'est un canal textuel
      if (!channel.isTextBased()) {
        await interaction.reply({
          content: 'Le canal doit être un canal textuel.',
          ephemeral: true
        });
        return;
      }

      // Vérifier que le bot a les permissions nécessaires
      const permissions = channel.permissionsFor(interaction.client.user);
      if (!permissions.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        await interaction.reply({
          content: 'Je n\'ai pas les permissions nécessaires dans ce canal. J\'ai besoin de : Voir le salon, Envoyer des messages, Intégrer des liens.',
          ephemeral: true
        });
        return;
      }

      // Sauvegarder l'ancien canal pour le message de transition
      const oldLogChannelId = config.logChannelId;
      
      // Mettre à jour la configuration
      config.logChannelId = channel.id;
      saveConfigs();
      
      // Préparer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Canal de logs configuré')
        .setDescription(`Les logs de modération seront envoyés dans ${channel}`)
        .addFields(
          { name: 'ID du canal', value: channel.id },
          { name: 'Configuré par', value: interaction.member.toString() }
        )
        .setTimestamp();

      // Envoyer la confirmation
      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Si il y avait un ancien canal, envoyer un message de transition
      if (oldLogChannelId) {
        try {
          const oldChannel = await interaction.guild.channels.fetch(oldLogChannelId);
          if (oldChannel) {
            await oldChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor('#FFA500')
                  .setTitle('📢 Changement de canal de logs')
                  .setDescription(`Les logs de modération seront désormais envoyés dans ${channel}`)
                  .setTimestamp()
              ]
            });
          }
        } catch (error) {
          console.warn('Impossible d\'envoyer le message de transition dans l\'ancien canal:', error);
        }
      }

      // Envoyer un message test dans le nouveau canal
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔧 Configuration des logs')
            .setDescription('Ce canal a été configuré pour recevoir les logs de modération du test politique.')
            .addFields(
              { name: 'Serveur', value: interaction.guild.name },
              { name: 'ID du serveur', value: interaction.guild.id }
            )
            .setTimestamp()
        ]
      });
    }
    else if (commandName === 'setroles') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          ephemeral: true
        });
        return;
      }

      const droite = interaction.options.getRole('droite');
      const gauche = interaction.options.getRole('gauche');
      
      config.roles.droite = droite.id;
      config.roles.gauche = gauche.id;
      saveConfigs();
      
      await interaction.reply(`Rôles configurés : Droite = ${droite}, Gauche = ${gauche}`);
    }
    else if (commandName === 'start') {
      if (!config.channelId) {
        await interaction.reply({
          content: 'Le canal pour le test n\'a pas été configuré. Utilisez /setchannel d\'abord.',
          ephemeral: true
        });
        return;
      }
      
      if (!config.roles.droite || !config.roles.gauche) {
        await interaction.reply({
          content: 'Les rôles n\'ont pas été configurés. Utilisez /setroles d\'abord.',
          ephemeral: true
        });
        return;
      }

      const userKey = `${guildId}-${interaction.member.id}`;
      if (activeQuestions.has(userKey)) {
        await interaction.reply({
          content: 'Vous avez déjà un test en cours.',
          ephemeral: true
        });
        return;
      }

      // Répondre immédiatement à l'interaction
      await interaction.reply({ 
        content: 'Le test va commencer...',
        ephemeral: true 
      });

      // Envoyer le message de début de test dans le canal configuré
      const channel = interaction.guild.channels.cache.get(config.channelId);
      if (channel) {
        const startEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('Début du test')
          .setDescription(`${interaction.member}, votre test politique va commencer.`)
          .setFooter({ text: 'Préparez-vous à répondre aux questions' });

        await channel.send({ embeds: [startEmbed] });
        
        // Attendre un peu avant d'envoyer la première question
        setTimeout(() => {
          if (!activeQuestions.has(userKey)) {
            sendQuestion(interaction.member, 0, guildId);
          }
        }, 2000);
      }
    }
    else if (commandName === 'questions') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur pour modifier les questions.',
          ephemeral: true
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'list': {
          const questionsList = config.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
          const embed = new EmbedBuilder()
            .setColor('#ff0000')  // Rouge
            .setTitle('Questions du test politique')
            .setDescription(questionsList);
          
          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'add': {
          const newQuestion = interaction.options.getString('question');
          if (config.questions.length >= 20) {
            await interaction.reply({
              content: 'Vous ne pouvez pas avoir plus de 20 questions.',
              ephemeral: true
            });
            return;
          }
          
          config.questions.push(newQuestion);
          saveConfigs();
          
          await interaction.reply({
            content: `Question ajoutée ! Nombre total de questions : ${config.questions.length}`,
            ephemeral: true
          });
          break;
        }

        case 'remove': {
          const index = interaction.options.getInteger('index') - 1;
          if (index >= config.questions.length) {
            await interaction.reply({
              content: 'Ce numéro de question n\'existe pas.',
              ephemeral: true
            });
            return;
          }
          
          if (config.questions.length <= 5) {
            await interaction.reply({
              content: 'Vous devez garder au moins 5 questions.',
              ephemeral: true
            });
            return;
          }
          
          const removed = config.questions.splice(index, 1)[0];
          saveConfigs();
          
          await interaction.reply({
            content: `Question supprimée : "${removed}"`,
            ephemeral: true
          });
          break;
        }
      }
    }
    else if (commandName === 'resetconfig') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur pour réinitialiser la configuration.',
          ephemeral: true
        });
        return;
      }

      const confirm = interaction.options.getBoolean('confirm');
      if (!confirm) {
        await interaction.reply({
          content: 'La réinitialisation a été annulée.',
          ephemeral: true
        });
        return;
      }

      // Réinitialiser la configuration
      serverConfigs.servers[guildId] = {
        channelId: null,
        logChannelId: null,  // Ajout du canal de logs
        roles: {
          droite: null,
          gauche: null
        },
        questions: generateQuestionSet(10),
        activeTests: 0,
        totalTests: 0
      };
      
      // Sauvegarder la nouvelle configuration
      saveConfigs();

      // Nettoyer les questions actives et les réponses pour ce serveur
      for (const [key, value] of activeQuestions.entries()) {
        if (key.startsWith(`${guildId}-`)) {
          activeQuestions.delete(key);
        }
      }
      
      for (const [key, value] of userResponses.entries()) {
        if (key.startsWith(`${guildId}-`)) {
          userResponses.delete(key);
        }
      }

      await interaction.reply({
        content: 'La configuration du serveur a été réinitialisée avec succès.',
        ephemeral: true
      });
    }
    else if (commandName === 'status') {
      const config = getServerConfig(interaction.guildId);
      const validation = validateConfig(interaction.guildId);
      
      // Vérifier l'état du canal de test
      const testChannel = config.channelId ? 
        interaction.guild.channels.cache.get(config.channelId) : null;
      
      // Vérifier l'état du canal de logs
      const logChannel = config.logChannelId ? 
        interaction.guild.channels.cache.get(config.logChannelId) : null;

      // Vérifier l'état des rôles
      const roleGauche = config.roles.gauche ? 
        interaction.guild.roles.cache.get(config.roles.gauche) : null;
      const roleDroite = config.roles.droite ? 
        interaction.guild.roles.cache.get(config.roles.droite) : null;

      const embed = new EmbedBuilder()
        .setColor(validation.isValid ? '#00FF00' : '#FF0000')
        .setTitle('📊 État du bot')
        .setDescription(validation.isValid ? 
          '✅ Le bot est correctement configuré' : 
          '❌ Le bot n\'est pas correctement configuré')
        .addFields(
          { 
            name: '📝 Canal de test', 
            value: testChannel ? 
              `✅ Configuré (${testChannel})` : 
              '❌ Non configuré'
          },
          { 
            name: '📜 Canal de logs', 
            value: logChannel ? 
              `✅ Configuré (${logChannel})` : 
              '❌ Non configuré'
          },
          { 
            name: '🎭 Rôles', 
            value: `Gauche: ${roleGauche ? `✅ (${roleGauche.name})` : '❌ Non configuré'}\nDroite: ${roleDroite ? `✅ (${roleDroite.name})` : '❌ Non configuré'}`
          },
          {
            name: '❓ Questions',
            value: `${config.questions.length} questions configurées`
          },
          {
            name: '📊 Statistiques',
            value: `Tests actifs: ${config.activeTests}\nTests complétés: ${config.totalTests}`
          }
        )
        .setFooter({ text: 'Utilisez /help pour voir les commandes disponibles' })
        .setTimestamp();

      // Ajouter les erreurs si présentes
      if (validation.errors.length > 0) {
        embed.addFields({
          name: '⚠️ Erreurs de configuration',
          value: validation.errors.map(error => `- ${error}`).join('\n')
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'test') {
      // Vérifier les permissions de l'utilisateur
      if (!interaction.member.permissions.has('MANAGE_ROLES')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer les rôles pour utiliser cette commande.',
          ephemeral: true
        });
        return;
      }

      const targetMember = interaction.options.getMember('membre');
      if (!targetMember) {
        await interaction.reply({
          content: 'Membre introuvable.',
          ephemeral: true
        });
        return;
      }

      // Vérifier si le canal est configuré
      if (!config.channelId) {
        await interaction.reply({
          content: 'Le canal pour le test n\'a pas été configuré. Utilisez /setchannel d\'abord.',
          ephemeral: true
        });
        return;
      }

      const channel = interaction.guild.channels.cache.get(config.channelId);
      if (!channel) {
        await interaction.reply({
          content: 'Le canal configuré n\'existe plus. Veuillez reconfigurer avec /setchannel.',
          ephemeral: true
        });
        return;
      }

      // Vérifier si le membre n'a pas déjà un test en cours
      const userKey = `${guildId}-${targetMember.id}`;
      if (activeQuestions.has(userKey)) {
        await interaction.reply({
          content: 'Ce membre a déjà un test en cours.',
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: `Le test va commencer pour ${targetMember}.`,
        ephemeral: true
      });

      // Lancer le test
      await sendQuestion(targetMember, 0, guildId);
    }
    else if (commandName === 'addquestion') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent utiliser cette commande.',
          ephemeral: true
        });
        return;
      }

      const newQuestion = interaction.options.getString('question');
      const serverConfig = getServerConfig(interaction.guildId);
      serverConfig.questions.push(newQuestion);
      saveConfigs();
      await interaction.reply({ 
        content: `Question ajoutée: "${newQuestion}"`,
        ephemeral: true 
      });
    }
    else if (commandName === 'removequestion') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent utiliser cette commande.',
          ephemeral: true
        });
        return;
      }

      const index = interaction.options.getInteger('numero') - 1;
      const serverConfig = getServerConfig(interaction.guildId);
      
      if (index < 0 || index >= serverConfig.questions.length) {
        await interaction.reply({ 
          content: `Numéro invalide. Utilisez un nombre entre 1 et ${serverConfig.questions.length}`,
          ephemeral: true 
        });
        return;
      }

      const removedQuestion = serverConfig.questions.splice(index, 1)[0];
      saveConfigs();
      await interaction.reply({ 
        content: `Question supprimée: "${removedQuestion}"`,
        ephemeral: true 
      });
    }
    else if (commandName === 'listquestions') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent utiliser cette commande.',
          ephemeral: true
        });
        return;
      }

      const guildConfig = getServerConfig(interaction.guildId);
      let questionList = 'Questions actuelles:\n';
      guildConfig.questions.forEach((question, idx) => {
        questionList += `${idx + 1}. ${question}\n`;
      });
      
      // Si la liste est trop longue, on la divise en plusieurs messages
      if (questionList.length > 2000) {
        const chunks = questionList.match(/.{1,2000}/g);
        await interaction.reply({ content: chunks[0], ephemeral: true });
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
      } else {
        await interaction.reply({ content: questionList, ephemeral: true });
      }
    }
    else if (commandName === 'resetquestions') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent utiliser cette commande.',
          ephemeral: true
        });
        return;
      }

      const guildConf = getServerConfig(interaction.guildId);
      guildConf.questions = [...defaultQuestions];
      saveConfigs();
      await interaction.reply({ 
        content: 'Questions réinitialisées aux questions par défaut d\'extrême gauche.',
        ephemeral: true 
      });
    }
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: 'Une erreur est survenue.',
      ephemeral: true
    });
  }
});

client.on('guildMemberAdd', async member => {
  const joinCheck = antiRaid.canJoin(member);
  
  const embed = new EmbedBuilder()
    .setColor(joinCheck.allowed ? '#00FF00' : '#FF0000')
    .setTitle('Nouveau membre')
    .setDescription(`${member.user.tag} a rejoint le serveur\n\n**Statut**: ${joinCheck.allowed ? 'Accepté' : 'Refusé'}\n**Raison**: ${joinCheck.allowed ? 'Le compte remplit tous les critères de sécurité.' : joinCheck.reason}`)
    .setTimestamp();
  
  await sendLog(member.guild, embed);
  
  try {
    // Vérifier la configuration
    const config = getServerConfig(member.guild.id);
    const validation = validateConfig(member.guild.id);
    
    if (!validation.isValid) {
      console.error('Configuration invalide:', validation.errors.join(', '));
      return;
    }

    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) {
      console.error('Le salon configuré n\'existe pas');
      return;
    }

    // Message de bienvenue
    const welcomeEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('Bienvenue !')
      .setDescription(`${member}, votre test politique va commencer dans quelques secondes...`)
      .setFooter({ text: 'Préparez-vous à répondre aux questions' });

    await channel.send({ embeds: [welcomeEmbed] });

    // Petit délai avant de commencer le questionnaire
    setTimeout(async () => {
      try {
        const userKey = `${member.guild.id}-${member.id}`;
        if (!activeQuestions.has(userKey)) {
          sendQuestion(member, 0, member.guild.id);
        }
      } catch (error) {
        console.error('Erreur lors du démarrage du questionnaire:', error);
        channel.send(`Désolé ${member}, une erreur est survenue lors du démarrage du questionnaire.`);
      }
    }, 5000);

  } catch (error) {
    console.error('Erreur lors de l\'accueil du nouveau membre:', error);
    try {
      const channel = member.guild.channels.cache.get(getServerConfig(member.guild.id).channelId);
      if (channel) {
        await channel.send(`Désolé ${member}, une erreur est survenue. Veuillez contacter un administrateur.`);
      }
    } catch (innerError) {
      console.error('Erreur lors de l\'envoi du message d\'erreur:', innerError);
    }
  }
});

const toxicKeywords = [
  // Mots et phrases toxiques généraux
  'nazi', 'hitler', 'fasciste', 'génocide', 'extermination',
  'suprématie', 'race supérieure', 'épuration', 'nettoyage ethnique',
  'antisémite', 'antisémitisme', 'racisme', 'raciste',
  'haine', 'suprémaciste', 'supériorité raciale',
  // Expressions de haine
  'mort aux', 'éliminer les', 'dehors les', 'à bas les',
  'sale', 'tous les', 'ces', // suivi de groupes ethniques/religieux
  // Violence explicite
  'tuer', 'exterminer', 'éliminer', 'purger', 'violence',
  'terrorisme', 'terroriste', 'attentat'
];

const extremeKeywords = {
  droite: [
    // Idéologie
    'dictature', 'autoritarisme', 'totalitaire',
    'nationalisme extrême', 'ultra-nationalisme',
    // Discrimination
    'xénophobie', 'islamophobie', 'antisémitisme',
    'homophobie', 'lgbtphobie', 'phobie',
    // Immigration
    'remigration', 'grand remplacement', 'invasion',
    'anti-immigration', 'fermer les frontières', 'déportation',
    // Économie et société
    'corporatisme', 'oligarchie', 'élites mondialistes',
    'ordre moral', 'dégénérescence', 'décadence'
  ],
  gauche: [
    // Idéologie
    'révolution violente', 'dictature du prolétariat',
    'anarchisme violent', 'insurrection', 'sabotage',
    // Actions
    'abolition totale', 'expropriation forcée',
    'collectivisation forcée', 'rééducation forcée',
    // Économie et société
    'destruction du capitalisme', 'élimination des classes',
    'suppression de la propriété', 'confiscation', // Ajout de la virgule manquante
    // Violence politique
    'action directe violente', 'guérilla urbaine',
    'lutte armée', 'terrorisme révolutionnaire'
  ]
};

// Contextes aggravants qui augmentent le score de toxicité
const toxicContexts = [
  'tous les', 'ces gens', 'cette race', 'ces races',
  'naturellement', 'biologiquement', 'génétiquement',
  'toujours', 'jamais', 'sans exception'
];

const checkToxicContent = (text) => {
  text = text.toLowerCase();
  let toxicScore = 0;
  
  // Vérifier les mots toxiques directs
  for (const keyword of toxicKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      return {
        isToxic: true,
        reason: `Contenu inapproprié détecté: "${keyword}"`
      };
    }
  }
  
  // Vérifier les contextes aggravants
  for (const context of toxicContexts) {
    if (text.includes(context.toLowerCase())) {
      toxicScore += 0.5;
    }
  }
  
  // Vérifier le contenu extrême
  let extremeScores = {
    droite: 0,
    gauche: 0
  };

  for (const side in extremeKeywords) {
    for (const keyword of extremeKeywords[side]) {
      if (text.includes(keyword.toLowerCase())) {
        extremeScores[side] += 1;
      }
    }
  }

  // Détecter si le message est extrême
  if (extremeScores.droite >= 2 || extremeScores.gauche >= 2) {
    const side = extremeScores.droite > extremeScores.gauche ? 'droite' : 'gauche';
    return {
      isToxic: true,
      reason: `Positions politiques extrêmes détectées (${side})`
    };
  }

  // Vérifier le score toxique global
  if (toxicScore >= 1) {
    return {
      isToxic: true,
      reason: "Langage potentiellement discriminatoire détecté"
    };
  }

  return {
    isToxic: false
  };
};

const analyzeResponse = (response) => {
  response = response.toLowerCase();
  let score = 0;
  
  // Réponses positives d'extrême gauche (bonus fort)
  if (
    response.includes('oui') || 
    response.includes('absolument') || 
    response.includes('tout à fait') ||
    response.includes('je suis d\'accord')
  ) {
    score -= 2.0; // Gros bonus pour être d'accord avec les questions d'extrême gauche
    console.log('Réponse positive à une question d\'extrême gauche: -2.0');
  }

  // Réponses négatives ou modérées (pénalités très fortes)
  if (
    response.includes('non') || 
    response.includes('pas d\'accord') ||
    response.includes('contre') ||
    response.includes('modéré') ||
    response.includes('nuancé') ||
    response.includes('peut-être') ||
    response.includes('ça dépend')
  ) {
    score += 3.0; // Forte pénalité pour ne pas être totalement d'accord
    console.log('Réponse négative ou modérée détectée: +3.0');
  }
  
  // Mots-clés extrême gauche (bonus)
  const extremeGaucheKeywords = [
    'révolution', 'prolétariat', 'anticapitaliste', 'collectivisation',
    'lutte des classes', 'exploitation', 'bourgeoisie', 'communisme',
    'abolition', 'expropriation', 'collectif', 'camarade', 'marxisme',
    'socialisme', 'anticapitalisme', 'prolétaire', 'révolutionnaire'
  ];
  
  // Mots-clés droite (pénalités très fortes)
  const droiteKeywords = [
    'marché', 'privé', 'entreprise', 'profit', 'mérite', 'individuel',
    'propriété', 'liberté économique', 'compétition', 'responsabilité',
    'travail', 'effort', 'réussite', 'initiative', 'entrepreneur'
  ];
  
  // Mots-clés extrême droite (pénalités maximales)
  const extremeDroiteKeywords = [
    'ordre', 'autorité', 'tradition', 'nation', 'identité', 'sécurité',
    'force', 'discipline', 'hiérarchie', 'élite', 'mérite', 'patrie',
    'valeurs', 'famille', 'moral'
  ];
  
  // Bonus pour mots extrême gauche
  extremeGaucheKeywords.forEach(keyword => {
    if (response.includes(keyword)) {
      score -= 0.5; // Plus gros bonus pour vocabulaire d'extrême gauche
      console.log(`Mot-clé extrême gauche "${keyword}" détecté: -0.5`);
    }
  });
  
  // Pénalités très fortes pour mots de droite
  droiteKeywords.forEach(keyword => {
    if (response.includes(keyword)) {
      score += 4.0; // Pénalité augmentée pour vocabulaire de droite
      console.log(`Mot-clé de droite "${keyword}" détecté: +4.0`);
    }
  });
  
  // Pénalités maximales pour mots d'extrême droite
  extremeDroiteKeywords.forEach(keyword => {
    if (response.includes(keyword)) {
      score += 5.0; // Pénalité maximale pour vocabulaire d'extrême droite
      console.log(`Mot-clé d'extrême droite "${keyword}" détecté: +5.0`);
    }
  });

  // Pénalités pour les réponses trop courtes ou évasives
  if (response.length < 10) {
    score += 2.0; // Pénalité pour réponse trop courte
    console.log('Réponse trop courte: +2.0');
  }

  console.log(`Score final pour la réponse "${response}": ${score}`);
  return score;
};

const calculateFinalScore = (responses) => {
  if (!responses || responses.length === 0) return 0;
  
  // Filtrer les réponses non définies
  const validResponses = responses.filter(score => score !== undefined);
  if (validResponses.length === 0) return 0;
  
  // Calculer la moyenne des scores
  const totalScore = validResponses.reduce((acc, score) => acc + score, 0);
  const averageScore = totalScore / validResponses.length;
  
  console.log(`Calcul du score final:
    Réponses: ${JSON.stringify(validResponses)}
    Score total: ${totalScore}
    Moyenne: ${averageScore}
  `);
  
  return averageScore;
};

const determineOrientation = (totalScore, numberOfQuestions) => {
  const averageScore = totalScore / numberOfQuestions;
  
  if (averageScore <= -1.5) return 'camarade révolutionnaire';
  if (averageScore <= -0.5) return 'militant de gauche';
  if (averageScore <= 0.5) return 'gauchiste modéré';
  if (averageScore <= 2.0) return 'droitard';
  return 'réactionnaire';
};

const assignRole = async (member, score, guildId) => {
  try {
    // Retirer les anciens rôles
    if (getServerConfig(guildId).roles.droite) await member.roles.remove(getServerConfig(guildId).roles.droite);
    if (getServerConfig(guildId).roles.gauche) await member.roles.remove(getServerConfig(guildId).roles.gauche);

    // Déterminer l'orientation et le rôle
    let orientation, roleId, color;
    const strength = Math.abs(score);

    if (score < 0) {
      // Gauche
      orientation = 'de gauche';
      roleId = getServerConfig(guildId).roles.gauche;
      color = '#ff0000';
    } else {
      // Droite
      orientation = 'de droite';
      roleId = getServerConfig(guildId).roles.droite;
      color = '#0000ff';
    }

    // Déterminer l'intensité
    let tendance = '';
    if (strength >= 0.8) tendance = 'fortement ';
    else if (strength >= 0.6) tendance = 'clairement ';
    else if (strength >= 0.4) tendance = 'modérément ';
    else tendance = 'légèrement ';
    
    // Ajouter le rôle
    if (roleId) {
      await member.roles.add(roleId);
    }

    const channel = member.guild.channels.cache.get(getServerConfig(guildId).channelId);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Résultat du questionnaire')
        .setDescription(`${member}, vous êtes ${tendance}${orientation}`)
        .addFields(
          { name: 'Score détaillé', value: `${(Math.abs(score) * 100).toFixed(1)}% ${score < 0 ? '(gauche)' : '(droite)'}` }
        )
        .setFooter({ text: 'Merci d\'avoir participé au questionnaire !' });
      
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Erreur lors de l\'attribution du rôle:', error);
  }
};

const handleToxicContent = async (message, toxicCheck, userKey) => {
  try {
    await message.delete();
    await message.author.send(`Votre message a été supprimé. ${toxicCheck.reason}`);
    
    // Créer l'embed pour les logs
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('⚠️ Contenu inapproprié détecté')
      .setDescription(`Utilisateur: ${message.author.tag} (${message.author.id})`)
      .addFields(
        { name: 'Raison', value: toxicCheck.reason },
        { name: 'Message original', value: message.content },
        { name: 'Canal', value: message.channel.toString() },
        { name: 'Serveur', value: message.guild.name }
      )
      .setTimestamp();
    
    // Envoyer le log
    await sendLog(message.guild, embed);

    // Terminer le test
    activeQuestions.delete(userKey);
    userResponses.delete(userKey);
  } catch (error) {
    console.error('Erreur lors de la gestion du contenu toxique:', error);
  }
};

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Vérifie le spam
  if (antiRaid.isSpamming(message.guild.id, message.author.id)) {
    try {
      await message.delete();
      await message.author.send('Attention: Vous envoyez trop de messages trop rapidement.');
    } catch (error) {
      console.error('Erreur lors de la gestion du spam:', error);
    }
    return;
  }

  const userKey = `${message.guild.id}-${message.author.id}`;
  const activeQuestion = activeQuestions.get(userKey);
  if (!activeQuestion) return;

  if (message.channel.id !== getServerConfig(message.guild.id).channelId) {
    message.author.send('Merci de répondre dans le salon dédié au questionnaire.');
    return;
  }

  if (message.content.length < 5) {
    message.reply('Merci de donner une réponse plus détaillée.');
    return;
  }

  // Vérifier le contenu toxique
  const toxicCheck = checkToxicContent(message.content);
  if (toxicCheck.isToxic) {
    await handleToxicContent(message, toxicCheck, userKey);
    return;
  }

  const config = getServerConfig(message.guild.id);
  const score = analyzeResponse(message.content);
  
  if (!userResponses.has(userKey)) {
    userResponses.set(userKey, []);
  }
  userResponses.get(userKey)[activeQuestion.questionIndex] = score;

  // Supprimer la question active avant d'envoyer la suivante
  activeQuestions.delete(userKey);
  
  await message.react('✅');

  // Attendre un peu avant d'envoyer la prochaine question
  setTimeout(() => {
    // Vérifier à nouveau qu'il n'y a pas de question active
    if (!activeQuestions.has(userKey)) {
      sendQuestion(message.member, activeQuestion.questionIndex + 1, message.guild.id);
    }
  }, 1500);
});

const sendQuestion = async (member, questionIndex, guildId) => {
  try {
    // Vérifier si member est valide
    if (!member || !member.guild) {
      console.error('Membre invalide ou guild non trouvé');
      return;
    }

    const config = getServerConfig(guildId);
    if (!config) {
      console.error('Configuration non trouvée pour le serveur:', guildId);
      return;
    }

    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) {
      console.error('Canal non trouvé:', config.channelId);
      return;
    }

    const userKey = `${guildId}-${member.id}`;

    // Vérifier si toutes les questions ont été répondues
    if (questionIndex >= config.questions.length) {
      const responses = userResponses.get(userKey) || [];
      const finalScore = calculateFinalScore(responses);
      await assignRole(member, finalScore, guildId);
      userResponses.delete(userKey);
      activeQuestions.delete(userKey);
      return;
    }

    // Vérifier si une question est déjà active
    if (activeQuestions.has(userKey)) {
      console.log('Question déjà active pour:', userKey);
      return;
    }

    // Définir la question comme active
    activeQuestions.set(userKey, {
      questionIndex,
      startTime: Date.now()
    });

    try {
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle(`Question ${questionIndex + 1}/${config.questions.length}`)
        .setDescription(config.questions[questionIndex])
        .setFooter({ text: 'Répondez directement dans ce canal' });

      await channel.send({ content: `${member}`, embeds: [embed] });
    } catch (error) {
      console.error('Erreur lors de l\'envoi de la question:', error);
      activeQuestions.delete(userKey);
    }
  } catch (error) {
    console.error('Erreur dans sendQuestion:', error);
    activeQuestions.delete(`${guildId}-${member?.id}`);
  }
};

const addQuestionCommand = new SlashCommandBuilder()
  .setName('addquestion')
  .setDescription('Ajoute une nouvelle question au test')
  .addStringOption(option =>
    option.setName('question')
      .setDescription('La question à ajouter')
      .setRequired(true));

commands.push(addQuestionCommand);

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId } = interaction;
  const config = getServerConfig(guildId);

  try {
    if (commandName === 'addquestion') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent ajouter des questions.',
          ephemeral: true
        });
        return;
      }

      const newQuestion = interaction.options.getString('question');
      config.questions = config.questions || [];
      config.questions.push(newQuestion);
      
      // Sauvegarder la configuration
      saveConfigs();
      
      // Envoyer un log
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Nouvelle question ajoutée')
        .setDescription(newQuestion)
        .setTimestamp();
      
      await sendLog(interaction.guild, embed);
      
      await interaction.reply({
        content: 'Question ajoutée avec succès !',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: 'Une erreur est survenue.',
      ephemeral: true
    });
  }
});

client.login(token);
