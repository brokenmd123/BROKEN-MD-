/**
 * AutoBio Command - Toggle automatic bio updates
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'autobio',
  aliases: ['setbio'],
  description: 'Toggle automatic profile bio',
  ownerOnly: true,
  
  async execute(sock, msg, args, extra) {
    const isEnable = args[0]?.toLowerCase() === 'on';
    const isDisable = args[0]?.toLowerCase() === 'off';

    try {
      if (!isEnable && !isDisable) {
        return extra.reply(`*Usage:* .autobio on / .autobio off\n*Current:* ${config.autoBio ? 'ON ✅' : 'OFF ❌'}`);
      }

      const status = isEnable;
      
      // Update config file
      const configPath = path.join(__dirname, '../config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');
      configContent = configContent.replace(/(autoBio:\s*)(true|false)/g, `$1${status}`);
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Update runtime
      config.autoBio = status;

      if (status) {
        const newBio = `${config.botName} | 𝑂𝑃𝑇𝐼𝑀𝑈𝑆 𝑃𝑅𝐼𝑀𝐸 𝐴𝑐𝑡𝑖𝑣𝑒 🤖`;
        await sock.updateProfileStatus(newBio);
      }

      await sock.sendMessage(extra.from, {
        text: `🤖 *AUTOBIO UPDATED*\n\nStatus: *${status ? 'ENABLED' : 'DISABLED'}*\n${status ? 'Bio set to active status.' : 'Auto-updates stopped.'}`,
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

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
