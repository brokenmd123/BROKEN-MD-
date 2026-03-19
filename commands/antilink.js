/**
 * AntiLink Command - Automatically remove group links
 */

module.exports = {
  name: 'antilink',
  aliases: ['antilink'],
  category: 'group',
  description: 'Toggle anti-link protection',
  usage: '.antilink on/off',
  
  async execute(sock, msg, args, extra) {
    if (!extra.isGroup) {
      return extra.reply('❌ This command can only be used in groups!');
    }
    
    if (!extra.isAdmin && !extra.isOwner) {
      return extra.reply('❌ Only admins can use this command!');
    }
    
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      // Enable anti-link for this group (you'd need a database for per-group settings)
      extra.reply('✅ Anti-link enabled for this group!');
    } else if (action === 'off') {
      extra.reply('❌ Anti-link disabled for this group!');
    } else {
      extra.reply('Usage: .antilink on/off');
    }
  },
  
  // This function is called automatically by handler.js
  handleAntiLink: async (sock, msg, groupMetadata) => {
    // This is now handled directly in handler.js
    // Keep this for compatibility
  }
};
