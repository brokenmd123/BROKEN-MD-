/**
 * Antigroupmention Command - Prevents mass tagging in groups
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'antigroupmention',
  aliases: ['antihidetag', 'antitagall'],
  description: 'Automatically delete mass mentions or hidden tags',
  category: 'admin',
  adminOnly: true,
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    const isEnable = args[0]?.toLowerCase() === 'on';
    const isDisable = args[0]?.toLowerCase() === 'off';

    try {
      if (!isEnable && !isDisable) {
        return extra.reply(`*Usage:* .antigroupmention on / off\n*Current:* ${config.antiTag ? 'ON ✅' : 'OFF ❌'}`);
      }

      const status = isEnable;
      
      // Update config file to ensure persistence
      const configPath = path.join(__dirname, '../config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');
      configContent = configContent.replace(/(antiTag:\s*)(true|false)/g, `$1${status}`);
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Update runtime config for immediate effect
      config.antiTag = status;

      await sock.sendMessage(extra.from, {
        text: `🛡️ *GROUP MENTION PROTECTION*\n\n` +
             `Status: *${status ? 'ENABLED' : 'DISABLED'}*\n` +
             `Note: Mass mentions will be auto-deleted.`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363405724402785@newsletter',
            newsletterName: config.botName,
            serverMessageId: -1
          }
        }
      }, { quoted: msg });

      // Visual confirmation
      await sock.sendMessage(extra.from, { react: { text: status ? '🛡️' : '🔓', key: msg.key } });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
