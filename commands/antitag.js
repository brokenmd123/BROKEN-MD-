/**
 * Antitag Command - Toggle tag protection in groups
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'antitag',
  aliases: ['antitags', 'antimention'],
  description: 'Delete messages that tag everyone/hidetag',
  category: 'admin',
  adminOnly: true,
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    const isEnable = args[0]?.toLowerCase() === 'on';
    const isDisable = args[0]?.toLowerCase() === 'off';

    try {
      if (!isEnable && !isDisable) {
        return extra.reply(`*Usage:* .antitag on / .antitag off\n*Current:* ${config.antiTag ? 'ON ✅' : 'OFF ❌'}`);
      }

      const status = isEnable;
      
      // Update config file to save setting
      const configPath = path.join(__dirname, '../config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');
      configContent = configContent.replace(/(antiTag:\s*)(true|false)/g, `$1${status}`);
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Update runtime config
      config.antiTag = status;

      await sock.sendMessage(extra.from, {
        text: `🛡️ *ANTITAG PROTECTION*\n\nStatus: *${status ? 'ENABLED' : 'DISABLED'}*\n\n> 𝑃ᴏᴡᴇʀᴇᴅ ʙʏ 𝑂𝑃𝑇𝐼𝑀𝑈𝑆 𝑃𝑅𝐼𝑀𝐸`,
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
