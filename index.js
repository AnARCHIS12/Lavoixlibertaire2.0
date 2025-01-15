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

// Structure de configuration par serveur
const defaultConfig = {
  channelId: null,
  logChannelId: null,
  roles: {
    droite: null,
    gauche: null,
    quarantaine: null
  },
  questions: defaultQuestions,
  activeTests: 0,
  totalTests: 0
};

// Map pour stocker les données par serveur
const serverData = new Map();

function getServerData(guildId) {
  if (!serverData.has(guildId)) {
    serverData.set(guildId, {
      activeQuestions: new Map(),
      userResponses: new Map(),
      lastCommandTime: new Map(),
      lastMessageTime: new Map()
    });
  }
  return serverData.get(guildId);
}

// Fonction pour générer un ensemble de questions aléatoires pour un serveur
const generateQuestionSet = (guildId) => {
  const allQuestions = [...defaultQuestions]; // Copie des questions par défaut
  const serverQuestions = [];
  const numberOfQuestions = 10; // Nombre de questions par test
  
  // Mélanger les questions de manière aléatoire
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }
  
  // Sélectionner les premières X questions
  return allQuestions.slice(0, numberOfQuestions);
};

// Fonction pour obtenir la configuration d'un serveur
const getServerConfig = (guildId) => {
  if (!serverConfigs.servers) {
    serverConfigs.servers = {};
  }
  
  if (!serverConfigs.servers[guildId]) {
    serverConfigs.servers[guildId] = {
      ...defaultConfig,
      questions: generateQuestionSet(guildId)
    };
    saveConfigs();
  }

  // Si les questions n'existent pas, les générer
  if (!serverConfigs.servers[guildId].questions || 
      serverConfigs.servers[guildId].questions.length === 0) {
    serverConfigs.servers[guildId].questions = generateQuestionSet(guildId);
    saveConfigs();
  }

  return serverConfigs.servers[guildId];
};

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
  if (!config.roles.droite || !config.roles.gauche || !config.roles.quarantaine) {
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
async function sendLog(guild, embed) {
  try {
    const config = getServerConfig(guild.id);
    if (!config.logChannelId) return;

    const logChannel = guild.channels.cache.get(config.logChannelId);
    if (logChannel) {
      await logChannel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi du log:', error);
  }
}

// Fonction pour envoyer les logs de configuration
async function logConfigChange(guild, user, action, details) {
  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('📝 Modification de Configuration')
    .setDescription(`Action: ${action}`)
    .addFields(
      { name: 'Détails', value: details },
      { name: 'Par', value: `<@${user.id}>` }
    )
    .setTimestamp();

  await sendLog(guild, embed);
}

// Fonction pour les logs de test
async function logTestAction(guild, user, action, details) {
  const embed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle('🎯 Action de Test')
    .setDescription(`Utilisateur: <@${user.id}>`)
    .addFields(
      { name: 'Action', value: action },
      { name: 'Détails', value: details }
    )
    .setTimestamp();

  await sendLog(guild, embed);
}

// Fonction pour les logs de sécurité
async function logSecurityEvent(guild, user, reason, details) {
  const embed = new EmbedBuilder()
    .setColor('#FF0000')
    .setTitle('🚨 Alerte de Sécurité')
    .setDescription(`Utilisateur: <@${user.id}>`)
    .addFields(
      { name: 'Raison', value: reason },
      { name: 'Détails', value: details }
    )
    .setTimestamp();

  await sendLog(guild, embed);
}

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
    if (accountAge < 7 * 24 * 60 * 60 * 1000) {
      // Attribuer le rôle quarantaine
      const config = getServerConfig(member.guild.id);
      if (config && config.roles.quarantaine) {
        member.roles.add(config.roles.quarantaine).catch(console.error);
        
        // Créer un embed pour le log
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('⚠️ Compte Suspect Détecté')
          .setDescription(`Le membre ${member.user.tag} a été mis en quarantaine.`)
          .addFields(
            { name: 'Raison', value: 'Compte trop récent' },
            { name: 'Age du compte', value: `${Math.floor(accountAge / (24 * 60 * 60 * 1000))} jours` }
          )
          .setTimestamp();

        // Envoyer le log
        sendLog(member.guild, embed);
      }
      return false;
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
    
    if (recentMessages.length > 3) {
      const guild = client.guilds.cache.get(guildId);
      const user = client.users.cache.get(userId);
      if (guild && user) {
        logSecurityEvent(guild, user, 'Spam Détecté', 
          `${recentMessages.length} messages en ${10000 / 1000} secondes`);
      }
    }
    
    return recentMessages.length > 3;
  }
};

const commands = [
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('☭ Désignez le canal officiel pour l\'évaluation idéologique des camarades')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Le canal de la révolution numérique')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('☭ Établissez le canal des archives du Parti')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Le canal des archives révolutionnaires')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('setroles')
    .setDescription('☭ Configurez les rôles idéologiques du collectif')
    .addRoleOption(option =>
      option
        .setName('droite')
        .setDescription('Rôle pour les éléments réactionnaires')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('gauche')
        .setDescription('Rôle pour les camarades progressistes')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('quarantaine')
        .setDescription('Rôle pour les comptes suspects')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('☭ Lancez l\'évaluation idéologique révolutionnaire'),
  new SlashCommandBuilder()
    .setName('questions')
    .setDescription('☭ Gérez les questions du test politique')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('☭ Voir la liste des questions actuelles')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('☭ Ajouter une nouvelle question')
        .addStringOption(option =>
          option
            .setName('question')
            .setDescription('La question à ajouter')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('☭ Supprimer une question')
        .addIntegerOption(option =>
          option
            .setName('index')
            .setDescription('L\'index de la question à supprimer (commence à 1)')
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  new SlashCommandBuilder()
    .setName('resetconfig')
    .setDescription('☭ Réinitialisez la configuration du Parti Digital'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('☭ Voir l\'état du bot sur ce serveur'),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('☭ Administrez le test idéologique à un camarade')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Le camarade à évaluer')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('resetquestions')
    .setDescription('☭ Réinitialisez les questions aux questions par défaut d\'extrême gauche'),
  new SlashCommandBuilder()
    .setName('regeneratequestions')
    .setDescription('☭ Générer un nouveau set de questions pour ce serveur'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('☭ Guide de configuration et d\'utilisation du bot'),
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
  
  // Vérifier si la configuration du serveur existe
  if (!serverConfigs.servers[guildId]) {
    serverConfigs.servers[guildId] = defaultConfig;
    saveConfigs();
  }
  
  const config = getServerConfig(guildId);
  
  try {
    if (commandName === 'setchannel') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          flags: [1 << 6]
        });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        await interaction.reply({
          content: 'Veuillez spécifier un canal valide.',
          flags: [1 << 6]
        });
        return;
      }

      config.channelId = channel.id;
      saveConfigs();

      await interaction.reply({
        content: `Le canal de test a été configuré sur ${channel}.`,
        flags: [1 << 6]
      });

      await logConfigChange(interaction.guild, interaction.user, 'Configuration du Canal', 
        `Canal de test défini: <#${channel.id}>`);
    }
    else if (commandName === 'setlogs') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          flags: [1 << 6]
        });
        return;
      }

      const channel = interaction.options.getChannel('channel');
      
      // Vérifier que c'est un canal textuel
      if (!channel.isTextBased()) {
        await interaction.reply({
          content: 'Le canal doit être un canal textuel.',
          flags: [1 << 6]
        });
        return;
      }

      // Vérifier que le bot a les permissions nécessaires
      const permissions = channel.permissionsFor(interaction.client.user);
      if (!permissions.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        await interaction.reply({
          content: 'Je n\'ai pas les permissions nécessaires dans ce canal. J\'ai besoin de : Voir le salon, Envoyer des messages, Intégrer des liens.',
          flags: [1 << 6]
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
          { name: 'Configuré par', value: `<@${interaction.user.id}>` }
        )
        .setTimestamp();

      // Envoyer la confirmation
      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

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

      await logConfigChange(interaction.guild, interaction.user, 'Configuration du Canal de Logs', 
        `Canal de logs défini: <#${channel.id}>`);
    }
    else if (commandName === 'setroles') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          flags: [1 << 6]
        });
        return;
      }

      const droiteRole = interaction.options.getRole('droite');
      const gaucheRole = interaction.options.getRole('gauche');
      const quarantaineRole = interaction.options.getRole('quarantaine');
      
      config.roles = {
        droite: droiteRole.id,
        gauche: gaucheRole.id,
        quarantaine: quarantaineRole.id
      };
      saveConfigs();
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Configuration des rôles')
        .addFields(
          { name: 'Rôle Droite', value: `<@&${droiteRole.id}>` },
          { name: 'Rôle Gauche', value: `<@&${gaucheRole.id}>` },
          { name: 'Rôle Quarantaine', value: `<@&${quarantaineRole.id}>` }
        );

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      await logConfigChange(interaction.guild, interaction.user, 'Configuration des Rôles', 
        `Rôle Gauche: <@&${gaucheRole.id}>\nRôle Droite: <@&${droiteRole.id}>\nRôle Quarantaine: <@&${quarantaineRole.id}>`);
    }
    else if (commandName === 'start') {
      if (!config.channelId) {
        await interaction.reply({
          content: 'Le canal pour le test n\'a pas été configuré. Utilisez /setchannel d\'abord.',
          flags: [1 << 6]
        });
        return;
      }
      
      if (!config.roles.droite || !config.roles.gauche || !config.roles.quarantaine) {
        await interaction.reply({
          content: 'Les rôles n\'ont pas été configurés. Utilisez /setroles d\'abord.',
          flags: [1 << 6]
        });
        return;
      }

      const userKey = `${guildId}-${interaction.member.id}`;
      const serverDataInstance = getServerData(guildId);
      if (serverDataInstance.activeQuestions.has(userKey)) {
        await interaction.reply({
          content: 'Vous avez déjà un test en cours.',
          flags: [1 << 6]
        });
        return;
      }

      // Répondre immédiatement à l'interaction
      await interaction.reply({ 
        content: 'Le test va commencer...',
        flags: [1 << 6] 
      });

      // Envoyer le message de début de test dans le canal configuré
      const channel = interaction.guild.channels.cache.get(config.channelId);
      if (channel) {
        const startEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('☭ Début du test')
          .setDescription(`${interaction.member}, votre test politique va commencer.`)
          .setFooter({ text: 'Préparez-vous à répondre aux questions' });

        await channel.send({ embeds: [startEmbed] });
        
        // Attendre un peu avant d'envoyer la première question
        setTimeout(() => {
          if (!serverDataInstance.activeQuestions.has(userKey)) {
            sendQuestion(interaction.member, 0, guildId);
          }
        }, 2000);
      }

      await logTestAction(interaction.guild, interaction.user, 'Début de Test', 
        `Test commencé dans <#${config.channelId}>`);
    }
    else if (commandName === 'questions') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur pour modifier les questions.',
          flags: [1 << 6]
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'list': {
          const questionsList = config.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
          const embed = new EmbedBuilder()
            .setColor('#ff0000')  // Rouge
            .setTitle('☭ Questions du test politique')
            .setDescription(questionsList);
          
          await interaction.reply({ embeds: [embed], flags: [1 << 6] });
          break;
        }

        case 'add': {
          const newQuestion = interaction.options.getString('question');
          if (config.questions.length >= 20) {
            await interaction.reply({
              content: 'Vous ne pouvez pas avoir plus de 20 questions.',
              flags: [1 << 6]
            });
            return;
          }
          
          config.questions.push(newQuestion);
          saveConfigs();
          
          await interaction.reply({
            content: `Question ajoutée ! Nombre total de questions : ${config.questions.length}`,
            flags: [1 << 6]
          });
          break;
        }

        case 'remove': {
          const index = interaction.options.getInteger('index') - 1;
          if (index >= config.questions.length) {
            await interaction.reply({
              content: 'Ce numéro de question n\'existe pas.',
              flags: [1 << 6]
            });
            return;
          }
          
          if (config.questions.length <= 5) {
            await interaction.reply({
              content: 'Vous devez garder au moins 5 questions.',
              flags: [1 << 6]
            });
            return;
          }
          
          const removed = config.questions.splice(index, 1)[0];
          saveConfigs();
          
          await interaction.reply({
            content: `Question supprimée : "${removed}"`,
            flags: [1 << 6]
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
          flags: [1 << 6]
        });
        return;
      }

      const confirm = interaction.options.getBoolean('confirm');
      if (!confirm) {
        await interaction.reply({
          content: 'La réinitialisation a été annulée.',
          flags: [1 << 6]
        });
        return;
      }

      // Réinitialiser la configuration
      serverConfigs.servers[guildId] = defaultConfig;
      
      // Sauvegarder la nouvelle configuration
      saveConfigs();

      // Nettoyer les questions actives et les réponses pour ce serveur
      const serverDataInstance = getServerData(guildId);
      for (const [key, value] of serverDataInstance.activeQuestions.entries()) {
        if (key.startsWith(`${guildId}-`)) {
          serverDataInstance.activeQuestions.delete(key);
        }
      }
      
      for (const [key, value] of serverDataInstance.userResponses.entries()) {
        if (key.startsWith(`${guildId}-`)) {
          serverDataInstance.userResponses.delete(key);
        }
      }

      await interaction.reply({
        content: 'La configuration du serveur a été réinitialisée avec succès.',
        flags: [1 << 6]
      });

      await logConfigChange(interaction.guild, interaction.user, 'Réinitialisation de la Configuration', 
        'La configuration du serveur a été réinitialisée.');
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
      const roleQuarantaine = config.roles.quarantaine ? 
        interaction.guild.roles.cache.get(config.roles.quarantaine) : null;

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
            value: `Gauche: ${roleGauche ? `✅ (${roleGauche.name})` : '❌ Non configuré'}\nDroite: ${roleDroite ? `✅ (${roleDroite.name})` : '❌ Non configuré'}\nQuarantaine: ${roleQuarantaine ? `✅ (${roleQuarantaine.name})` : '❌ Non configuré'}`
          },
          {
            name: '❓ Questions',
            value: `Total: ${config.questions.length}\nUniques: Oui\nExemples:\n${config.questions.slice(0, 2).join('\n')}`
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

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });
    }
    else if (commandName === 'test') {
      // Vérifier les permissions de l'utilisateur
      if (!interaction.member.permissions.has('MANAGE_ROLES')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer les rôles pour utiliser cette commande.',
          flags: [1 << 6]
        });
        return;
      }

      const targetMember = interaction.options.getMember('user');
      if (!targetMember) {
        await interaction.reply({
          content: 'Membre introuvable.',
          flags: [1 << 6]
        });
        return;
      }

      // Vérifier si le canal est configuré
      if (!config.channelId) {
        await interaction.reply({
          content: 'Le canal pour le test n\'a pas été configuré. Utilisez /setchannel d\'abord.',
          flags: [1 << 6]
        });
        return;
      }

      const channel = interaction.guild.channels.cache.get(config.channelId);
      if (!channel) {
        await interaction.reply({
          content: 'Le canal configuré n\'existe plus. Veuillez reconfigurer avec /setchannel.',
          flags: [1 << 6]
        });
        return;
      }

      // Vérifier si le membre n'a pas déjà un test en cours
      const userKey = `${guildId}-${targetMember.id}`;
      const serverDataInstance = getServerData(guildId);
      if (serverDataInstance.activeQuestions.has(userKey)) {
        await interaction.reply({
          content: 'Ce membre a déjà un test en cours.',
          flags: [1 << 6]
        });
        return;
      }

      await interaction.reply({
        content: `Le test va commencer pour ${targetMember}.`,
        flags: [1 << 6]
      });

      // Lancer le test
      await sendQuestion(targetMember, 0, guildId);

      await logTestAction(interaction.guild, targetMember.user, 'Début de Test', 
        `Test commencé pour ${targetMember.user.tag} dans <#${config.channelId}>`);
    }
    else if (commandName === 'resetquestions') {
      // Vérifier les permissions
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({
          content: 'Seuls les administrateurs peuvent utiliser cette commande.',
          flags: [1 << 6]
        });
        return;
      }

      const guildConf = getServerConfig(interaction.guildId);
      guildConf.questions = [...defaultQuestions];
      saveConfigs();
      await interaction.reply({ 
        content: 'Questions réinitialisées aux questions par défaut d\'extrême gauche.',
        flags: [1 << 6] 
      });

      await logConfigChange(interaction.guild, interaction.user, 'Réinitialisation des Questions', 
        'Questions réinitialisées aux questions par défaut d\'extrême gauche.');
    }
    else if (commandName === 'regeneratequestions') {
      if (!interaction.member.permissions.has('MANAGE_GUILD')) {
        await interaction.reply({
          content: 'Vous devez avoir la permission de gérer le serveur.',
          flags: [1 << 6]
        });
        return;
      }

      const oldQuestions = [...config.questions];
      config.questions = generateQuestionSet(guildId);
      
      // Vérifier que les nouvelles questions sont différentes des anciennes
      while (JSON.stringify(config.questions) === JSON.stringify(oldQuestions)) {
        config.questions = generateQuestionSet(guildId);
      }
      
      saveConfigs();

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('☭ Questions Régénérées')
        .setDescription('Un nouveau set de questions a été généré pour ce serveur.')
        .addFields(
          { name: 'Nombre de questions', value: `${config.questions.length}` },
          { name: 'Exemple de questions', value: config.questions.slice(0, 3).join('\n') }
        );

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      await logConfigChange(interaction.guild, interaction.user, 'Régénération des Questions', 
        `${config.questions.length} nouvelles questions générées`);
    }
    else if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('☭ Guide du Bot Idéologique')
        .setDescription('Guide de configuration et d\'utilisation du test idéologique')
        .addFields(
          { 
            name: '1️⃣ Configuration initiale', 
            value: '```\n1. /setchannel - Définir le salon pour passer le test\n2. /setlog - Définir le salon pour les logs\n3. /setroles - Configurer les rôles (Progressiste, Réactionnaire, Quarantaine)```'
          },
          {
            name: '2️⃣ Commandes de gestion', 
            value: '```\n/start - Démarrer un test\n/stop - Arrêter un test en cours\n/status - Vérifier la configuration\n/reset - Réinitialiser la configuration```'
          },
          {
            name: '3️⃣ Sécurité', 
            value: '• Les comptes de moins de 7 jours reçoivent automatiquement le rôle Quarantaine\n• Le spam est automatiquement détecté et bloqué'
          },
          {
            name: '4️⃣ Fonctionnement du test', 
            value: '• Les réponses sont analysées automatiquement\n• Le score final est affiché en pourcentage\n• 100% Progressiste = Extrême gauche\n• 100% Réactionnaire = Extrême droite'
          },
          {
            name: '⚠️ Important', 
            value: 'Assurez-vous que le bot a les permissions nécessaires :\n• Gérer les rôles\n• Voir et envoyer des messages\n• Gérer les messages'
          }
        )
        .setFooter({ text: 'Pour plus d\'aide, contactez les administrateurs' });

      await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: 'Une erreur est survenue.',
      flags: [1 << 6]
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
        const serverDataInstance = getServerData(member.guild.id);
        if (!serverDataInstance.activeQuestions.has(userKey)) {
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
  'sale', 'tous les', 
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
    'confiscation',
    // Violence politique
    'action directe violente', 'guérilla urbaine',
    'lutte armée', 'terrorisme révolutionnaire'
  ]
};

// Contextes aggravants qui augmentent le score de toxicité
const toxicContexts = [
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
    'marché', 'privé', 'profit', 'mérite', 'individuel',
    'liberté économique', 'compétition', 'responsabilité',
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
  
  let totalScore = 0;
  let validResponses = 0;
  
  for (const score of responses) {
    if (score !== null && score !== undefined) {
      totalScore += score;
      validResponses++;
    }
  }
  
  if (validResponses === 0) return 0;
  return totalScore / validResponses;
};

const scoreToPercentage = (score) => {
  if (score < 0) {
    // Pour les scores négatifs (gauche)
    // -2 devient 100% progressiste
    // 0 devient 0% progressiste
    return Math.round(Math.abs(score) * 50);
  } else {
    // Pour les scores positifs (droite)
    // 0 devient 0% réactionnaire
    // +2 devient 100% réactionnaire
    return Math.round(score * 50);
  }
};

const determineOrientation = (score) => {
  return score < 0 ? 'gauche' : 'droite';
};

async function assignRole(member, score, guildId) {
  try {
    const config = getServerConfig(guildId);
    const orientation = determineOrientation(score);
    const percentage = scoreToPercentage(score);
    
    // Retirer tous les anciens rôles d'abord
    await member.roles.remove([config.roles.droite, config.roles.gauche]);

    // Choisir le nouveau rôle
    const roleId = orientation === 'gauche' ? config.roles.gauche : config.roles.droite;

    // Créer l'embed de résultat
    const resultEmbed = new EmbedBuilder()
      .setColor(orientation === 'gauche' ? '#FF0000' : '#0000FF')
      .setTitle('📊 Résultats du Test Idéologique')
      .setDescription(orientation === 'gauche' 
        ? '☭ Félicitations camarade ! Vous êtes un vrai progressiste !'
        : '⚠️ Attention ! Tendances réactionnaires détectées !')
      .addFields(
        { name: 'Score', value: `${percentage}% ${orientation === 'gauche' ? 'Progressiste' : 'Réactionnaire'}` },
        { name: 'Orientation', value: orientation === 'gauche' ? 'Progressiste ⚡' : 'Réactionnaire ⚠️' }
      )
      .setTimestamp();

    // Envoyer le résultat
    const channel = member.guild.channels.cache.get(config.channelId);
    if (channel) {
      await channel.send({ content: `${member}`, embeds: [resultEmbed] });
    }

    // Ajouter le nouveau rôle
    try {
      await member.roles.add(roleId);
    } catch (error) {
      console.error('Erreur lors de l\'ajout du rôle:', error);
    }

    // Log du résultat du test
    const testResultLog = new EmbedBuilder()
      .setColor(orientation === 'gauche' ? '#FF0000' : '#0000FF')
      .setTitle('📊 Résultat de Test')
      .setDescription(`Membre: <@${member.user.id}>`)
      .addFields(
        { name: 'Score', value: `${percentage}% ${orientation === 'gauche' ? 'Progressiste' : 'Réactionnaire'}` },
        { name: 'Rôle Attribué', value: `<@&${roleId}>` }
      )
      .setTimestamp();

    await sendLog(member.guild, testResultLog);
    
  } catch (error) {
    console.error('Erreur dans assignRole:', error);
    await logSecurityEvent(member.guild, member.user, 'Erreur d\'Attribution de Rôle', 
      `Erreur: ${error.message}`);
  }
}

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
    const serverDataInstance = getServerData(message.guild.id);
    serverDataInstance.activeQuestions.delete(userKey);
    serverDataInstance.userResponses.delete(userKey);
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

  const guildId = message.guild.id;
  const serverDataInstance = getServerData(guildId);
  const userKey = `${guildId}-${message.author.id}`;
  const activeQuestion = serverDataInstance.activeQuestions.get(userKey);
  if (!activeQuestion) return;

  if (message.channel.id !== getServerConfig(guildId).channelId) {
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

  const config = getServerConfig(guildId);
  const score = analyzeResponse(message.content);
  
  if (!serverDataInstance.userResponses.has(userKey)) {
    serverDataInstance.userResponses.set(userKey, []);
  }
  serverDataInstance.userResponses.get(userKey)[activeQuestion.questionIndex] = score;

  // Supprimer la question active
  serverDataInstance.activeQuestions.delete(userKey);
  
  await message.react('✅');

  // Vérifier si c'est la dernière question
  if (activeQuestion.questionIndex >= config.questions.length - 1) {
    // C'est la dernière question, calculer le score final
    const responses = serverDataInstance.userResponses.get(userKey);
    const finalScore = calculateFinalScore(responses);
    await assignRole(message.member, finalScore, guildId);
    serverDataInstance.userResponses.delete(userKey);
  } else {
    // Ce n'est pas la dernière question, passer à la suivante
    setTimeout(async () => {
      try {
        await sendQuestion(message.member, activeQuestion.questionIndex + 1, guildId);
      } catch (error) {
        console.error('Erreur lors de l\'envoi de la question suivante:', error);
      }
    }, 1500);
  }
});

const sendQuestion = async (member, questionIndex, guildId) => {
  try {
    // Vérifier si member est valide
    if (!member || !member.guild) {
      console.error('Membre invalide ou guild non trouvé');
      return;
    }

    const serverConfig = getServerConfig(guildId);
    const questions = serverConfig.questions || defaultQuestions;
    const question = questions[questionIndex];
    
    if (!question) return null;

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('☭ Évaluation Idéologique du Futur ☭')
      .setDescription(`Camarade ${member.user.username}, voici la question ${questionIndex + 1}/${questions.length}`)
      .addFields(
        { name: '📝 Question', value: question },
        { name: '⚠️ Instructions importantes', value: '1. Ne pas nuancer votre réponse\n2. Évitez de réutiliser les mots de la question\n3. Gardez une réponse courte et directe' },
        { name: '🔧 Rappel', value: 'Répondez avec sincérité pour le bien du collectif.' }
      )
      .setFooter({ text: 'Pour le progrès de notre société digitale !' });
    
    // Définir la question comme active
    const serverDataInstance = getServerData(guildId);
    serverDataInstance.activeQuestions.set(`${guildId}-${member.id}`, {
      questionIndex,
      startTime: Date.now()
    });

    try {
      const channel = member.guild.channels.cache.get(serverConfig.channelId);
      if (channel) {
        await channel.send({ content: `${member}`, embeds: [embed] });
      }
    } catch (error) {
      console.error('Erreur lors de l\'envoi de la question:', error);
      const serverDataInstance = getServerData(guildId);
      serverDataInstance.activeQuestions.delete(`${guildId}-${member?.id}`);
    }
  } catch (error) {
    console.error('Erreur dans sendQuestion:', error);
    const serverDataInstance = getServerData(guildId);
    serverDataInstance.activeQuestions.delete(`${guildId}-${member?.id}`);
  }
};

client.login(token);
