/**
 * Anti-Delete Command - Toggle message recovery and send deleted messages only to owner
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'antidelete',
  aliases: ['antidelete', 'ad'],
  description: 'Toggle automatic recovery of deleted messages',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const isEnable = args[0]?.toLowerCase() === 'on';
    const isDisable = args[0]?.toLowerCase() === 'off';

    try {
      if (!isEnable && !isDisable) {
        return extra.reply(`*Usage:* .antidelete on / off\n*Current:* ${config.antiDelete ? 'ON ✅' : 'OFF ❌'}`);
      }

      const status = isEnable;
      
      // Update config file
      const configPath = path.join(__dirname, '../config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');
      configContent = configContent.replace(/(antiDelete:\s*)(true|false)/g, `$1${status}`);
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Update runtime
      config.antiDelete = status;

      // Also store owner JID for sending deleted messages
      const ownerJid = config.ownerNumber + '@s.whatsapp.net';

      await sock.sendMessage(extra.from, {
        text: `🛡️ *ANTI-DELETE PROTECTION*\n\n` +
             `Status: *${status ? 'ENABLED' : 'DISABLED'}*\n` +
             `The bot will ${status ? 'now' : 'no longer'} monitor deleted messages.\n\n` +
             `📨 *Deleted messages will be sent ONLY to the bot owner*`,
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
