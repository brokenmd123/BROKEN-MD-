/**
 * Auto-React Command - Toggle automatic reactions to messages
 */

const config = require('../config');

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

module.exports = {
  name: 'autoreact',
  aliases: ['ar', 'autovv'],
  category: 'owner',
  description: 'Toggle automatic reaction to messages',
  usage: '.autoreact on/off',
  
  async execute(sock, msg, args, extra) {
    try {
      // ===== SIMPLE OWNER CHECK - ADD THIS =====
      if (!extra.isOwner) {
        await extra.reply('❌ This command is only for the bot owner!');
        return;
      }
      // =========================================

      // Check if message has already been processed
      if (processedMessages.has(msg.key.id)) {
        return;
      }
      processedMessages.add(msg.key.id);
      
      // Clean up old message IDs after 5 minutes
      setTimeout(() => {
        processedMessages.delete(msg.key.id);
      }, 5 * 60 * 1000);

      const input = args[0]?.toLowerCase();
      
      // Toggle logic for the config variable
      if (input === 'on') {
        config.autoReact = true;
        await extra.reply('✅ *Auto-React* has been enabled.');
      } else if (input === 'off') {
        config.autoReact = false;
        await extra.reply('❌ *Auto-React* has been disabled.');
      } else {
        const status = config.autoReact ? 'ON' : 'OFF';
        await extra.reply(`Usage: .autoreact on/off\nCurrent Status: *${status}*`);
      }

      // React to the command message itself to confirm execution
      await sock.sendMessage(extra.from, {
        react: { text: '⚙️', key: msg.key }
      });

    } catch (error) {
      console.error('Error in AutoReact command:', error);
      await extra.reply('An error occurred while toggling Auto-React.');
    }
  }
};
