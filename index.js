/**
 * WhatsApp MD Bot - Main Entry Point
 * COMPLETELY FIXED VERSION - All features working + Anti-Delete
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer_cache_disabled';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup } = require('./utils/cleanup');
initializeTempSystem();
startCleanup();

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const forbiddenPatternsConsole = [
  'closing session', 'closing open session', 'sessionentry', 'prekey bundle',
  'pendingprekey', '_chains', 'registrationid', 'currentratchet',
  'chainkey', 'ratchet', 'signal protocol', 'ephemeralkeypair',
  'indexinfo', 'basekey'
];

// Console filtering to prevent leaking session data
console.log = (...args) => {
  const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').toLowerCase();
  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleLog.apply(console, args);
  }
};

console.error = (...args) => {
  const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').toLowerCase();
  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleError.apply(console, args);
  }
};

const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const handler = require('./handler');
const fs = require('fs');
const path = require('path');
const { initializePermanentBlocks } = require('./commands/block');
const zlib = require('zlib');
const os = require('os');

// Import anticall for permanent blocking
let anticall;
try {
  anticall = require('./commands/anticall');
} catch (e) {
  console.log('[Index] Anticall module not loaded yet');
}

// ============================================
// ANTI-DELETE MESSAGE CACHE
// ============================================
class MessageCache {
  constructor(maxSize = 500) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value) {
    // Remove oldest if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      ...value,
      timestamp: Date.now()
    });
  }

  get(key) {
    return this.cache.get(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > 300000) { // 5 minutes
        this.cache.delete(key);
      }
    }
  }
}

// Create global message cache
const messageCache = new MessageCache();

// Clean up cache every minute
setInterval(() => {
  messageCache.cleanup();
}, 60000);
// ============================================

function cleanupPuppeteerCache() {
  try {
    const home = os.homedir();
    const cacheDir = path.join(home, '.cache', 'puppeteer');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch (err) {}
}

// In-memory store with hard limits to manage RAM
const store = {
  messages: new Map(),
  maxPerChat: 20,
  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;
        const jid = msg.key.remoteJid;
        if (!store.messages.has(jid)) store.messages.set(jid, new Map());
        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);
        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },
  loadMessage: async (jid, id) => store.messages.get(jid)?.get(id) || null
};

const processedMessages = new Set();
setInterval(() => processedMessages.clear(), 5 * 60 * 1000);

async function startBot() {
  console.log('='.repeat(50));
  console.log('🚀 STARTING OPTIMUS PRIME BOT');
  console.log('='.repeat(50));

  const sessionFolder = `./${config.sessionName}`;
  const sessionFile = path.join(sessionFolder, 'creds.json');

  // Optimus Prime Session recovery logic
  if (config.sessionID && config.sessionID.startsWith('optimus_prime!')) {
    try {
      const [header, b64data] = config.sessionID.split('!');
      const cleanB64 = b64data.replace('...', '');
      const compressedData = Buffer.from(cleanB64, 'base64');
      const decompressedData = zlib.gunzipSync(compressedData);
      if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
      fs.writeFileSync(sessionFile, decompressedData, 'utf8');
      console.log('📡 Session: 🔑 Retrieved from Optimus_Prime Session');
    } catch (e) {
      console.error('📡 Session error:', e.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    auth: state,
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: true,
    getMessage: async (key) => {
        if (store) {
            const msg = await store.loadMessage(key.remoteJid, key.id);
            return msg?.message || undefined;
        }
        return { conversation: "Optimus Prime Bot" };
    }
  });

  store.bind(sock.ev);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('\n🔐 SCAN THIS QR CODE WITH WHATSAPP:');
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('🔄 Connection closed, reconnecting in 3 seconds...');
        setTimeout(() => startBot(), 3000);
      } else {
        console.log('❌ Logged out, please scan QR code again');
      }
    } else if (connection === 'open') {
      console.log('\n' + '='.repeat(50));
      console.log('✅ BOT CONNECTED SUCCESSFULLY!');
      console.log('='.repeat(50));
      
      // === FIXED: Initialize ALL features properly ===
      
      // 1. Initialize AntiCall with proper error handling
      try {
        console.log('\n📞 Initializing AntiCall...');
        handler.initializeAntiCall(sock);
      } catch (error) {
        console.error('❌ AntiCall initialization error:', error);
      }
      
      // 2. Initialize AutoBio with interval
      try {
        console.log('🤖 Initializing AutoBio...');
        if (typeof handler.initializeAutoBio === 'function') {
          handler.initializeAutoBio(sock);
        } else {
          // Fallback simple AutoBio
          if (config.autoBio) {
            await sock.updateProfileStatus(`${config.botName} | Active 🤖`).catch(() => {});
            
            // Set up interval for AutoBio
            setInterval(async () => {
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
                console.log(`[AutoBio] Updated: ${status}`);
              } catch (e) {}
            }, 30 * 60 * 1000); // Every 30 minutes
          }
        }
      } catch (error) {
        console.error('❌ AutoBio initialization error:', error);
      }
      
      // 3. Initialize Permanent Blocks
      try {
        console.log('🔒 Initializing Permanent Blocks...');
        initializePermanentBlocks(sock);
      } catch (error) {
        console.error('❌ Permanent Blocks error:', error);
      }
      
      // 4. Initialize Anticall permanent blocks if available
      try {
        if (anticall && typeof anticall.initializePermanentCallBlocks === 'function') {
          anticall.initializePermanentCallBlocks(sock);
        }
      } catch (error) {
        console.error('❌ Anticall permanent blocks error:', error);
      }

      console.log('='.repeat(50));
      console.log('✨ ALL FEATURES INITIALIZED');
      console.log('='.repeat(50));

      // 📢 Connection Success Message to Owner
      try {
        const ownerJids = Array.isArray(config.ownerNumber) 
          ? config.ownerNumber.map(num => num.includes('@') ? num : `${num}@s.whatsapp.net`)
          : [`${config.ownerNumber}@s.whatsapp.net`];
        
        for (const ownerJid of ownerJids) {
          await sock.sendMessage(ownerJid, {
            text: `🚀 *${config.botName} CONNECTED*\n\n` +
                 `The bot is now online and ready to process commands.\n\n` +
                 `*Status:* Online\n` +
                 `*Mode:* ${config.selfMode ? 'Private' : 'Public'}\n` +
                 `*Prefix:* [ ${config.prefix} ]\n` +
                 `*AntiCall:* ${config.antiCall ? '✅ Active' : '❌ Inactive'}\n` +
                 `*AutoBio:* ${config.autoBio ? '✅ Active' : '❌ Inactive'}\n` +
                 `*AntiDelete:* ${config.antiDelete ? '✅ Active' : '❌ Inactive'}\n\n` +
                 `> 𝑃ᴏᴡᴇʀᴇᴅ ʙʏ 𝑂𝑃𝑇𝐼𝑀𝑈𝑆 𝑃𝑅𝐼𝑀𝐸`,
            contextInfo: {
              externalAdReply: {
                title: `${config.botName} Online`,
                body: 'Optimus Prime MD Ready',
                mediaType: 1,
                thumbnailUrl: 'https://files.catbox.moe/lu8rqv.jpg',
                sourceUrl: 'https://whatsapp.com/channel/0029Vagp5Yp6mYPJ7RzOay2U',
                renderLargerThumbnail: true
              }
            }
          });
        }
      } catch (error) {
        console.error('❌ Failed to send connection message:', error);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ============================================
  // ANTI-DELETE LISTENER - Sends deleted messages ONLY to owner
  // ============================================
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Handle message deletions (protocol messages of type 0 = delete)
    for (const msg of messages) {
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
            
            // Determine message type
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

            // Create deleted message report
            const sender = cachedMsg.key?.participant || cachedMsg.key?.remoteJid || 'Unknown';
            const chat = cachedMsg.key?.remoteJid || 'Unknown';
            const chatType = chat.includes('@g.us') ? 'Group' : 'Private';
            const time = new Date(cachedMsg.timestamp || Date.now()).toLocaleString();

            const deleteReport = `╔══════════════════════╗\n` +
                                `║   🗑️ *DELETED MESSAGE*   ║\n` +
                                `╚══════════════════════╝\n\n` +
                                `*From:* ${sender.split('@')[0]}\n` +
                                `*Chat:* ${chatType}\n` +
                                `*Chat ID:* ${chat.split('@')[0]}\n` +
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
            
            console.log(`📨 Deleted message from ${sender.split('@')[0]} sent to owner`);
          } catch (error) {
            console.error('❌ Error sending deleted message:', error.message);
          }
        }
      }
    }

    // Process regular messages
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;
      
      // ============================================
      // CACHE MESSAGES FOR ANTI-DELETE
      // ============================================
      if (config.antiDelete && !msg.key.fromMe) {
        messageCache.set(msg.key.id, {
          key: msg.key,
          message: msg.message,
          timestamp: msg.messageTimestamp || Date.now()
        });
      }
      
      const from = msg.key.remoteJid;

      // 1. AUTO STATUS REACT logic
      if (from === 'status@broadcast') {
        if (config.autoStatusReact) {
          const emojis = ['❤️', '🔥', '✨', '💯', '🙌', '😮'];
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await sock.sendMessage('status@broadcast', {
            react: { text: randomEmoji, key: msg.key }
          }, { statusJidList: [msg.key.participant] });
          await sock.readMessages([msg.key]);
        }
        continue;
      }

      if (from.includes('@broadcast') || from.includes('@newsletter')) continue;
      if (processedMessages.has(msg.key.id)) continue;
      processedMessages.add(msg.key.id);

      // 2. AUTO MESSAGE REACTION
      if (config.autoReact && !msg.key.fromMe) {
        await sock.sendMessage(from, { 
          react: { text: "❤️", key: msg.key } 
        });
      }

      // 3. Pass to handler
      handler.handleMessage(sock, msg).catch(err => console.error('Handler error:', err.message));

      // 4. Background tasks
      setImmediate(async () => {
        if (config.autoRead && from.endsWith('@g.us')) {
          await sock.readMessages([msg.key]).catch(() => {});
        }
      });
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    await handler.handleGroupUpdate(sock, update);
  });

  // Add call event listener directly here as backup
  if (config.antiCall) {
    console.log('[Index] 📞 Adding direct call listener (backup)');
    sock.ev.on('call', async (calls) => {
      console.log('[Index] 📞 CALL DETECTED (backup listener)');
      for (const call of calls) {
        if (call.status === 'offer') {
          try {
            await sock.rejectCall(call.id, call.from);
            await sock.updateBlockStatus(call.from, 'block');
            console.log(`[Index] ✅ Blocked and rejected call from ${call.from}`);
          } catch (e) {
            console.error('[Index] ❌ Error in backup call handler:', e);
          }
        }
      }
    });
  }

  return sock;
}

// Cleanup and start
cleanupPuppeteerCache();
console.log('='.repeat(50));
console.log('🔧 INITIALIZING BOT...');
console.log('='.repeat(50));

startBot().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  if (err.code === 'ENOSPC') {
    require('./utils/cleanup').cleanupOldFiles();
    return;
  }
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
});

module.exports = { store };