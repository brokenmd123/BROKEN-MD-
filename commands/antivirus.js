/**
 * Antivirus / Antibug Command - Protects the group from crash messages
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'antivirus',
  aliases: ['antibug', 'anticrash'],
  description: 'Delete messages containing virus/crash code',
  category: 'admin',
  adminOnly: true,
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    const isEnable = args[0]?.toLowerCase() === 'on';
    const isDisable = args[0]?.toLowerCase() === 'off';

    try {
      if (!isEnable && !isDisable) {
        return extra.reply(`*Usage:* .antivirus on / off\n*Current:* ${config.antiBug ? 'ON ✅' : 'OFF ❌'}`);
      }

      const status = isEnable;
      
      // Update config file for persistence
      const configPath = path.join(__dirname, '../config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');
      configContent = configContent.replace(/(antiBug:\s*)(true|false)/g, `$1${status}`);
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Update runtime config
      config.antiBug = status;

      await sock.sendMessage(extra.from, {
        text: `🛡️ *ANTIVIRUS PROTECTION*\n\n` +
             `Status: *${status ? 'ENABLED' : 'DISABLED'}*\n` +
             `The bot will now auto-delete crash/bug messages.`,
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

      await sock.sendMessage(extra.from, { react: { text: status ? '🛡️' : '🔓', key: msg.key } });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
