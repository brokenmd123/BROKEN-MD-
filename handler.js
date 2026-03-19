/**
 * Message Handler - COMPLETE FIXED VERSION
 * All features working: AntiCall, AutoBio, AntiDelete, AntiLink, AntiPromote, etc.
 */

const config = require('./config');
const database = require('./database');
const { loadCommands } = require('./utils/commandLoader');
const { addMessage } = require('./utils/groupstats');
const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Import handlers from command files
const antitag = require('./commands/antitag');
const antilink = require('./commands/antilink');
const autoreact = require('./commands/autoreact');
const antisticker = require('./commands/antisticker');
const anticall = require('./commands/anticall');
const antipromote = require('./commands/antipromote'); // Add anti-promote

// Group metadata cache
const groupMetadataCache = new Map();
const CACHE_TTL = 60000;

// Message cache for anti-delete
const messageCache = new Map();
const MESSAGE_CACHE_TTL = 300000; // 5 minutes

// Load all commands
const commands = loadCommands();

// AutoBio timer
let autoBioInterval = null;

// Clean up message cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of messageCache.entries()) {
    if (now - value.timestamp > MESSAGE_CACHE_TTL) {
      messageCache.delete(key);
    }
  }
}, 60000);

const getMessageContent = (msg) => {
  if (!msg || !msg.message) return null;
  let m = msg.message;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m;
};

const getGroupMetadata = async (sock, groupId) => {
  try {
    if (!groupId || !groupId.endsWith('@g.us')) return null;
    const cached = groupMetadataCache.get(groupId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    const metadata = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data: metadata, timestamp: Date.now() });
    return metadata;
  } catch (error) {
    return groupMetadataCache.get(groupId)?.data || null;
  }
};

const isOwner = (sender) => {
  if (!sender) return false;
  const num = sender.split('@')[0].split(':')[0];
  
  // Handle both single owner and array of owners
  const ownerNumbers = Array.isArray(config.ownerNumber) 
    ? config.ownerNumber 
    : [config.ownerNumber];
  
  return ownerNumbers.some(owner => {
    const ownerNum = owner.split('@')[0];
    return ownerNum === num;
  });
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
  if (!participant || !groupId.endsWith('@g.us')) return false;
  const metadata = groupMetadata || await getGroupMetadata(sock, groupId);
  if (!metadata) return false;
  const pNum = participant.split('@')[0].split(':')[0];
  const found = metadata.participants.find(p => p.id.split('@')[0] === pNum);
  return found ? (found.admin === 'admin' || found.admin === 'superadmin') : false;
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
  if (!sock.user || !groupId.endsWith('@g.us')) return false;
  return await isAdmin(sock, sock.user.id, groupId, groupMetadata);
};

// Initialize AutoBio
const initializeAutoBio = (sock) => {
  // Clear any existing interval
  if (autoBioInterval) {
    clearInterval(autoBioInterval);
    autoBioInterval = null;
  }
  
  if (!config.autoBio) {
    console.log('[AutoBio] ❌ Disabled in config');
    return;
  }
  
  console.log('[AutoBio] ✅ Initializing...');
  
  // Function to update bio with current time
  const updateBio = async () => {
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      
      const status = `${config.botName} • ${timeStr} • ${dateStr}`;
      
      await sock.updateProfileStatus(status);
      console.log(`[AutoBio] ✅ Updated: ${status}`);
    } catch (error) {
      console.error('[AutoBio] ❌ Update error:', error);
    }
  };
  
  // Update immediately
  updateBio();
  
  // Then update every 30 minutes
  autoBioInterval = setInterval(updateBio, 30 * 60 * 1000);
  
  console.log('[AutoBio] ✅ Will update every 30 minutes');
};

// Initialize AntiCall - COMPLETELY FIXED VERSION
const initializeAntiCall = (sock) => {
  console.log('[AntiCall] 🔍 Checking configuration...');
  console.log(`[AntiCall] Config value: ${config.antiCall}`);
  
  if (!config.antiCall) {
    console.log('[AntiCall] ❌ Disabled in config');
    return;
  }
  
  console.log('[AntiCall] ✅ Initializing call blocker');
  
  // Remove any existing listeners to avoid duplicates
  sock.ev.removeAllListeners('call');
  
  // Add new listener
  sock.ev.on('call', async (calls) => {
    console.log('[AntiCall] 📞 INCOMING CALL DETECTED!');
    
    for (const call of calls) {
      try {
        console.log(`[AntiCall] Processing: ${call.from} | Status: ${call.status}`);
        
        // Only handle incoming calls (offer)
        if (call.status === 'offer') {
          console.log(`[AntiCall] 🔴 Handling incoming call from ${call.from}`);
          
          // 1. Try to use the anticall command's handler if available
          if (anticall && typeof anticall.handleCall === 'function') {
            console.log('[AntiCall] Using anticall command handler');
            await anticall.handleCall(sock, call);
          } else {
            // 2. Fallback to built-in handler
            console.log('[AntiCall] Using built-in handler');
            
            // Reject the call
            await sock.rejectCall(call.id, call.from);
            console.log(`[AntiCall] ✅ Call rejected: ${call.from}`);
            
            // Block the caller
            await sock.updateBlockStatus(call.from, 'block');
            console.log(`[AntiCall] ✅ Caller blocked: ${call.from}`);
            
            // Send message
            await sock.sendMessage(call.from, { 
              text: '🚫 *Calls are not allowed!*\n\nYou have been automatically rejected and blocked.\n\n> Powered by OPTIMUS PRIME'
            });
            console.log(`[AntiCall] ✅ Block message sent`);
          }
        } else {
          console.log(`[AntiCall] Ignoring call with status: ${call.status}`);
        }
      } catch (error) {
        console.error('[AntiCall] ❌ Error handling call:', error);
      }
    }
  });
  
  console.log('[AntiCall] ✅ Call blocker is ACTIVE - All calls will be rejected and blocked');
};

// Main Message Handler
const handleMessage = async (sock, msg) => {
  try {
    if (!msg.message) return;
    const from = msg.key.remoteJid;
    if (from.includes('@broadcast') || from.includes('@newsletter')) return;

    const sender = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : msg.key.participant || from;
    const isGroup = from.endsWith('@g.us');
    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;
    const botIsAdmin = isGroup ? await isBotAdmin(sock, from, groupMetadata) : false;
    const userIsAdmin = isGroup ? await isAdmin(sock, sender, from, groupMetadata) : false;
    const userIsOwner = isOwner(sender);

    // Cache message for anti-delete
    if (config.antiDelete && !msg.key.fromMe) {
      messageCache.set(msg.key.id, {
        key: msg.key,
        message: msg.message,
        timestamp: Date.now()
      });
    }

    // ============================================
    // 1. ANTI-DELETE Logic - FIXED VERSION
    // ============================================
    if (msg.message?.protocolMessage?.type === 0 && config.antiDelete) {
      const protocolMsg = msg.message.protocolMessage;
      const deletedKey = protocolMsg.key;
      
      // Get cached message
      const cachedMsg = messageCache.get(deletedKey.id);
      
      if (cachedMsg) {
        try {
          // Get owner JID
          const ownerJid = Array.isArray(config.ownerNumber) 
            ? `${config.ownerNumber[0]}@s.whatsapp.net`
            : `${config.ownerNumber}@s.whatsapp.net`;
          
          // Determine message type and content
          let messageType = 'Unknown';
          let messageContent = 'Content could not be recovered';
          
          if (cachedMsg.message) {
            if (cachedMsg.message.conversation) {
              messageType = 'Text';
              messageContent = cachedMsg.message.conversation;
            } else if (cachedMsg.message.extendedTextMessage) {
              messageType = 'Text';
              messageContent = cachedMsg.message.extendedTextMessage.text || 'Extended Text';
            } else if (cachedMsg.message.imageMessage) {
              messageType = 'Image 📸';
              messageContent = cachedMsg.message.imageMessage.caption || 'Image without caption';
            } else if (cachedMsg.message.videoMessage) {
              messageType = 'Video 🎥';
              messageContent = cachedMsg.message.videoMessage.caption || 'Video without caption';
            } else if (cachedMsg.message.audioMessage) {
              messageType = 'Audio 🎵';
              messageContent = 'Audio message';
            } else if (cachedMsg.message.stickerMessage) {
              messageType = 'Sticker 🎯';
              messageContent = 'Sticker';
            } else if (cachedMsg.message.documentMessage) {
              messageType = 'Document 📄';
              messageContent = cachedMsg.message.documentMessage.title || 'Document';
            }
          }

          // Get sender info
          const deletedSender = cachedMsg.key?.participant || cachedMsg.key?.remoteJid || 'Unknown';
          const chatType = from.includes('@g.us') ? 'Group' : 'Private';
          const time = new Date(cachedMsg.timestamp).toLocaleString();

          // Create deleted message report
          const deleteReport = `╔══════════════════════╗\n` +
                              `║   🗑️ *DELETED MESSAGE*   ║\n` +
                              `╚══════════════════════╝\n\n` +
                              `*From:* ${deletedSender.split('@')[0]}\n` +
                              `*Chat:* ${chatType}\n` +
                              `*Chat ID:* ${from.split('@')[0]}\n` +
                              `*Type:* ${messageType}\n` +
                              `*Time:* ${time}\n\n` +
                              `*Deleted Content:*\n\`\`\`${messageContent}\`\`\`\n\n` +
                              `━━━━━━━━━━━━━━━━━━━`;

          // Send ONLY to owner
          await sock.sendMessage(ownerJid, {
            text: deleteReport,
            contextInfo: {
              forwardingScore: 999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: '120363405724402785@newsletter',
                newsletterName: config.botName,
                serverMessageId: -1
              }
            }
          });
          
          console.log(`📨 Deleted message from ${deletedSender.split('@')[0]} sent to owner`);
          
        } catch (error) {
          console.error('❌ Error sending deleted message:', error.message);
        }
      }
      return;
    }

    // ============================================
    // 2. Anti-Virus Protection
    // ============================================
    const content = getMessageContent(msg);
    const body = content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || "";
    
    if (isGroup && config.antiBug && !userIsAdmin && !userIsOwner && botIsAdmin) {
      if (body.length > 4000 || /[\u0300-\u036f]{100,}/.test(body)) {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        return;
      }
    }

    // ============================================
    // 3. AntiLink Detection
    // ============================================
    if (isGroup && config.antiLink && !userIsAdmin && !userIsOwner && botIsAdmin) {
      const linkRegex = /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i;
      if (linkRegex.test(body)) {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, { 
          text: `🚫 *Link Detected*\n@${sender.split('@')[0]} has been removed for sharing a group link.`,
          mentions: [sender]
        });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        return;
      }
    }

    // ============================================
    // 4. Anti-Tag and Anti-Sticker
    // ============================================
    if (isGroup && !userIsAdmin && !userIsOwner && botIsAdmin) {
      if (config.antiTag && antitag && typeof antitag.handleAntiTag === 'function') {
        await antitag.handleAntiTag(sock, msg, groupMetadata);
      }
      if (config.antiSticker && msg.message.stickerMessage && antisticker && typeof antisticker.handleAntiSticker === 'function') {
        await antisticker.handleAntiSticker(sock, msg);
      }
    }

    // ============================================
    // 5. Auto-React
    // ============================================
    if (config.autoReact && autoreact && typeof autoreact.handleAutoReact === 'function') {
      await autoreact.handleAutoReact(sock, msg);
    }

    // ============================================
    // 6. Commands
    // ============================================
    if (!body.startsWith(config.prefix)) return;
    
    const args = body.slice(config.prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const command = commands.get(commandName) || Array.from(commands.values()).find(c => c.aliases?.includes(commandName));

    if (!command) return;

    const extra = {
      from, 
      sender, 
      isGroup, 
      groupMetadata, 
      isOwner: userIsOwner,
      isAdmin: userIsAdmin, 
      isBotAdmin: botIsAdmin,
      reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
      // Helper functions for anti-promote
      getOwnerJid: () => Array.isArray(config.ownerNumber) 
        ? `${config.ownerNumber[0]}@s.whatsapp.net`
        : `${config.ownerNumber}@s.whatsapp.net`
    };

    await command.execute(sock, msg, args, extra);

  } catch (error) {
    console.error('Handler Error:', error);
  }
};

// Group Update Handler
const handleGroupUpdate = async (sock, update) => {
  try {
    const { id, participants, action, actor } = update;
    const groupMetadata = await getGroupMetadata(sock, id);
    if (!groupMetadata || !participants) return;

    // Handle anti-promote
    if (config.antiPromote && antipromote && typeof antipromote.handleAntiPromote === 'function') {
      const extra = {
        isOwner: (jid) => isOwner(jid),
        getOwnerJid: () => Array.isArray(config.ownerNumber) 
          ? `${config.ownerNumber[0]}@s.whatsapp.net`
          : `${config.ownerNumber}@s.whatsapp.net`
      };
      await antipromote.handleAntiPromote(sock, update, extra);
    }

    // Handle welcome/goodbye messages
    for (const part of participants) {
      if (!part) continue;
      const num = part.split('@')[0];
      if (action === 'add' && config.welcome) {
        await sock.sendMessage(id, { 
          text: `🎉 *Welcome!*\n\n@${num} has joined ${groupMetadata.subject}!\n\nEnjoy your stay! 👋`, 
          mentions: [part] 
        });
      } else if (action === 'remove' && config.goodbye) {
        await sock.sendMessage(id, { 
          text: `👋 *Goodbye!*\n\n@${num} has left the group.`, 
          mentions: [part] 
        });
      }
    }
  } catch (err) {
    console.error('Group Update Error:', err);
  }
};

// Initialize all features
const initializeAll = (sock) => {
  console.log('='.repeat(50));
  console.log('🔧 INITIALIZING ALL FEATURES');
  console.log('='.repeat(50));
  
  // Initialize AutoBio
  initializeAutoBio(sock);
  
  // Initialize AntiCall
  initializeAntiCall(sock);
  
  // Initialize anticall command's permanent blocks if available
  if (anticall && typeof anticall.initializePermanentCallBlocks === 'function') {
    anticall.initializePermanentCallBlocks(sock);
  }
  
  console.log('='.repeat(50));
  console.log('✅ ALL FEATURES INITIALIZED');
  console.log('='.repeat(50));
};

// Exports
module.exports = {
  handleMessage,
  handleGroupUpdate,
  initializeAntiCall,
  initializeAutoBio,
  initializeAll,
  getGroupMetadata,
  isAdmin,
  isBotAdmin,
  isOwner,
  messageCache // Export for debugging if needed
};