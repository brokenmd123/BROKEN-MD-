/**
 * AntiSticker Command - Block/Allow stickers in groups
 */

const fs = require('fs');
const path = require('path');

// Database path
const DB_PATH = path.join(__dirname, '../database/antisticker.json');

// Default settings
const defaultSettings = {
  enabled: false,
  enabledGroups: [],
  action: 'delete', // 'delete', 'warn', 'kick'
  warnCount: 3, // Number of warnings before kick
  allowedStickerIds: [], // Specific sticker IDs to allow
  ignoreAdmins: true,
  ignoreOwner: true,
  customMessage: '❌ Stickers are not allowed in this group!',
  stats: {
    totalDeleted: 0,
    totalWarned: 0,
    totalKicked: 0
  }
};

// Load settings
const loadSettings = () => {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return { ...defaultSettings, ...JSON.parse(data) };
    } else {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultSettings, null, 2));
    }
  } catch (error) {
    console.error('Error loading antisticker settings:', error);
  }
  return { ...defaultSettings };
};

// Save settings
const saveSettings = (settings) => {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving antisticker settings:', error);
    return false;
  }
};

// Warning tracking
const userWarnings = new Map();

// Handle sticker detection
async function handleAntiSticker(sock, msg, extra) {
  try {
    const chatId = extra.from;
    const sender = extra.sender;
    const isGroup = extra.isGroup;
    const isAdmin = extra.isAdmin;
    const isOwner = extra.isOwner;
    const isBotAdmin = extra.isBotAdmin;
    
    // Only process in groups
    if (!isGroup) return false;
    
    // Load settings
    const settings = loadSettings();
    
    // Check if enabled for this group
    if (!settings.enabled) return false;
    if (!settings.enabledGroups || !settings.enabledGroups.includes(chatId)) return false;
    
    // Check if message is a sticker
    const content = msg.message;
    if (!content?.stickerMessage) return false;
    
    // Get sticker info
    const stickerMsg = content.stickerMessage;
    const stickerId = stickerMsg.fileSha256?.toString('base64') || 'unknown';
    
    // Check if sticker is allowed
    if (settings.allowedStickerIds && settings.allowedStickerIds.includes(stickerId)) {
      return false;
    }
    
    // Check if sender should be ignored
    if (settings.ignoreAdmins && isAdmin) return false;
    if (settings.ignoreOwner && isOwner) return false;
    
    // Check if bot is admin (required for delete/kick actions)
    if ((settings.action === 'delete' || settings.action === 'kick') && !isBotAdmin) {
      await sock.sendMessage(chatId, {
        text: '⚠️ *Anti-Sticker Warning:*\n\nI need to be admin to delete stickers!'
      });
      return false;
    }
    
    // Handle based on action
    if (settings.action === 'delete') {
      // Delete the sticker
      await sock.sendMessage(chatId, { delete: msg.key });
      
      // Update stats
      settings.stats.totalDeleted++;
      saveSettings(settings);
      
      // Send notification (optional)
      await sock.sendMessage(chatId, {
        text: `❌ *Sticker Deleted*\n\n👤 User: @${sender.split('@')[0]}\n📌 Reason: Stickers not allowed`,
        mentions: [sender]
      });
      
      return true;
    }
    
    if (settings.action === 'warn') {
      // Get current warnings
      const key = `${chatId}_${sender}`;
      const current = userWarnings.get(key) || { count: 0, warnings: [] };
      
      current.count++;
      current.warnings.push({
        reason: 'Sticker sent',
        time: Date.now()
      });
      
      userWarnings.set(key, current);
      
      // Delete the sticker
      await sock.sendMessage(chatId, { delete: msg.key });
      
      // Check if reached warning limit
      if (current.count >= settings.warnCount) {
        // Kick user
        if (isBotAdmin) {
          await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
          settings.stats.totalKicked++;
          
          await sock.sendMessage(chatId, {
            text: `👢 *User Kicked*\n\n👤 @${sender.split('@')[0]}\n📌 Reason: Reached ${settings.warnCount} sticker warnings`,
            mentions: [sender]
          });
          
          // Clear warnings
          userWarnings.delete(key);
        }
      } else {
        // Send warning
        settings.stats.totalWarned++;
        await sock.sendMessage(chatId, {
          text: `⚠️ *Warning ${current.count}/${settings.warnCount}*\n\n👤 @${sender.split('@')[0]}\n❌ Stickers are not allowed!\n\n${current.count >= settings.warnCount ? '🚫 Next warning will result in kick!' : ''}`,
          mentions: [sender]
        });
      }
      
      saveSettings(settings);
      return true;
    }
    
    if (settings.action === 'kick') {
      // Delete the sticker
      await sock.sendMessage(chatId, { delete: msg.key });
      
      // Kick user
      if (isBotAdmin) {
        await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
        settings.stats.totalKicked++;
        saveSettings(settings);
        
        await sock.sendMessage(chatId, {
          text: `👢 *User Kicked*\n\n👤 @${sender.split('@')[0]}\n📌 Reason: Stickers not allowed in this group`,
          mentions: [sender]
        });
      }
      
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('AntiSticker handler error:', error);
    return false;
  }
}

// Command execute
async function execute(sock, msg, args, extra) {
  try {
    const chatId = extra.from;
    const isGroup = extra.isGroup;
    const isAdmin = extra.isAdmin;
    const isOwner = extra.isOwner;
    
    // Check if in group
    if (!isGroup) {
      return extra.reply('❌ *Anti-Sticker can only be used in groups!*');
    }
    
    // Check permissions
    if (!isAdmin && !isOwner) {
      return extra.reply('❌ *Only group admins can use this command!*');
    }
    
    const settings = loadSettings();
    const isEnabled = settings.enabled && settings.enabledGroups?.includes(chatId);
    
    if (!args[0]) {
      const actionText = {
        'delete': '🗑️ Delete',
        'warn': '⚠️ Warn',
        'kick': '👢 Kick'
      }[settings.action] || settings.action;
      
      return extra.reply(`╔══════════════════════╗
║  🚫 *ANTI-STICKER*  🚫  ║
╚══════════════════════╝

📊 *Status:* ${isEnabled ? '✅ Enabled' : '❌ Disabled'}
⚙️ *Action:* ${actionText}
⚠️ *Warn Count:* ${settings.warnCount}
👑 *Ignore Admins:* ${settings.ignoreAdmins ? '✅' : '❌'}
👤 *Ignore Owner:* ${settings.ignoreOwner ? '✅' : '❌'}

━━━━━━━━━━━━━━━━━━━
📋 *Commands:*
• .as on - Enable anti-sticker
• .as off - Disable anti-sticker
• .as action delete - Delete stickers
• .as action warn - Warn users
• .as action kick - Kick users
• .as warncount 3 - Set warnings before kick
• .as ignore admins on/off
• .as ignore owner on/off
• .as stats - Show statistics
• .as allow - Add sticker to whitelist (reply)
• .as list - Show allowed stickers

━━━━━━━━━━━━━━━━━━━
💡 *Actions:*
• delete - Silently delete stickers
• warn - Warn and track offenders
• kick - Immediately kick offenders

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝑂𝑃𝑇𝐼𝑀𝑈𝑆 𝑃𝑅𝐼𝑀𝐸*`);
    }
    
    const opt = args[0].toLowerCase();
    
    // Handle on/off
    if (opt === 'on') {
      settings.enabled = true;
      settings.enabledGroups = settings.enabledGroups || [];
      if (!settings.enabledGroups.includes(chatId)) {
        settings.enabledGroups.push(chatId);
      }
      saveSettings(settings);
      return extra.reply(`✅ *Anti-Sticker enabled for this group!*\n\nAction: ${settings.action}\nI will ${settings.action} any stickers sent.`);
    }
    
    if (opt === 'off') {
      settings.enabledGroups = (settings.enabledGroups || []).filter(id => id !== chatId);
      settings.enabled = settings.enabledGroups.length > 0;
      saveSettings(settings);
      return extra.reply(`❌ *Anti-Sticker disabled for this group!*`);
    }
    
    // Handle action
    if (opt === 'action') {
      const action = args[1]?.toLowerCase();
      if (!action || !['delete', 'warn', 'kick'].includes(action)) {
        return extra.reply('❌ *Invalid action!*\n\nAvailable: delete, warn, kick');
      }
      settings.action = action;
      saveSettings(settings);
      return extra.reply(`✅ *Action set to ${action}!*`);
    }
    
    // Handle warncount
    if (opt === 'warncount') {
      const count = parseInt(args[1]);
      if (!count || count < 1 || count > 10) {
        return extra.reply('❌ *Invalid warn count!*\n\nPlease provide a value between 1 and 10.');
      }
      settings.warnCount = count;
      saveSettings(settings);
      return extra.reply(`✅ *Warn count set to ${count}!*`);
    }
    
    // Handle ignore settings
    if (opt === 'ignore') {
      const target = args[1]?.toLowerCase();
      const value = args[2]?.toLowerCase();
      
      if (target === 'admins') {
        if (value === 'on' || value === 'true') {
          settings.ignoreAdmins = true;
          saveSettings(settings);
          return extra.reply('✅ *Admins will now be ignored*');
        } else if (value === 'off' || value === 'false') {
          settings.ignoreAdmins = false;
          saveSettings(settings);
          return extra.reply('❌ *Admins will now be checked*');
        }
      }
      
      if (target === 'owner') {
        if (value === 'on' || value === 'true') {
          settings.ignoreOwner = true;
          saveSettings(settings);
          return extra.reply('✅ *Owner will now be ignored*');
        } else if (value === 'off' || value === 'false') {
          settings.ignoreOwner = false;
          saveSettings(settings);
          return extra.reply('❌ *Owner will now be checked*');
        }
      }
      
      return extra.reply('❌ *Invalid ignore option!*\n\nUse: .as ignore admins on/off\n.as ignore owner on/off');
    }
    
    // Handle stats
    if (opt === 'stats') {
      return extra.reply(`📊 *ANTI-STICKER STATISTICS*\n\n` +
        `🗑️ Deleted: ${settings.stats.totalDeleted}\n` +
        `⚠️ Warnings: ${settings.stats.totalWarned}\n` +
        `👢 Kicked: ${settings.stats.totalKicked}\n\n` +
        `📌 *Group Status:* ${isEnabled ? '✅ Active' : '❌ Inactive'}`);
    }
    
    // Handle allow sticker
    if (opt === 'allow') {
      // Check if replying to a sticker
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMessage = quotedMsg?.quotedMessage;
      
      if (!quotedMessage?.stickerMessage) {
        return extra.reply('❌ *Please reply to a sticker to allow it!*');
      }
      
      const stickerMsg = quotedMessage.stickerMessage;
      const stickerId = stickerMsg.fileSha256?.toString('base64') || 'unknown';
      
      settings.allowedStickerIds = settings.allowedStickerIds || [];
      if (!settings.allowedStickerIds.includes(stickerId)) {
        settings.allowedStickerIds.push(stickerId);
        saveSettings(settings);
        return extra.reply('✅ *Sticker added to whitelist!*\n\nThis sticker will no longer be blocked.');
      } else {
        return extra.reply('❌ *This sticker is already in the whitelist!*');
      }
    }
    
    // Handle list allowed stickers
    if (opt === 'list') {
      const allowed = settings.allowedStickerIds || [];
      if (allowed.length === 0) {
        return extra.reply('📋 *Allowed Stickers*\n\nNo stickers in whitelist.\n\nUse .as allow while replying to a sticker to add it.');
      }
      
      return extra.reply(`📋 *Allowed Stickers (${allowed.length})*\n\n${allowed.map((id, i) => `${i+1}. ${id.substring(0, 20)}...`).join('\n')}`);
    }
    
    extra.reply('❌ *Invalid option.* Use .as for help.');
    
  } catch (error) {
    console.error('[AntiSticker] error:', error);
    extra.reply(`❌ Error: ${error.message}`);
  }
}

// Export
module.exports = {
  name: 'antisticker',
  aliases: ['as', 'nosticker'],
  category: 'admin',
  description: 'Block stickers in groups',
  usage: '.as <on/off/action/stats>',
  
  async execute(sock, msg, args, extra) {
    return execute(sock, msg, args, extra);
  },
  
  handleAntiSticker
};
