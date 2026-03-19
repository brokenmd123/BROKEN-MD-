/**
 * AntiBio Command - Prevent frequent bio/status changes and bio spam
 */

const config = require('../config'); // IMPORT CONFIG FIRST
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

// Database path
const DB_PATH = path.join(__dirname, '../database/antibio.json');

// Default settings
const defaultSettings = {
  enabled: true,
  monitorAll: true,
  action: 'warn', // 'warn', 'block', 'ignore'
  maxChangesPerDay: 3,
  minTimeBetweenChanges: 3600000, // 1 hour in milliseconds
  notifyOwner: true,
  logChanges: true,
  autoBlockThreshold: 5, // Block after 5 violations
  whitelist: [], // Users allowed to change bio freely
  blacklist: [], // Users to monitor closely
  stats: {
    totalChanges: 0,
    totalViolations: 0,
    blockedUsers: 0,
    lastChange: null
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
      return { ...defaultSettings };
    }
  } catch (error) {
    console.error('Error loading antibio settings:', error);
    return { ...defaultSettings };
  }
};

// Save settings
const saveSettings = (settings) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving antibio settings:', error);
    return false;
  }
};

// Bio change database
const BIO_DB_PATH = path.join(__dirname, '../database/bio_changes.json');

// Load bio change data
const loadBioData = () => {
  try {
    const dir = path.dirname(BIO_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (fs.existsSync(BIO_DB_PATH)) {
      const data = fs.readFileSync(BIO_DB_PATH, 'utf8');
      return JSON.parse(data);
    } else {
      const defaultData = {
        users: {},
        violations: {},
        lastUpdate: null
      };
      fs.writeFileSync(BIO_DB_PATH, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
  } catch (error) {
    console.error('Error loading bio data:', error);
    return { users: {}, violations: {} };
  }
};

// Save bio change data
const saveBioData = (data) => {
  try {
    fs.writeFileSync(BIO_DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving bio data:', error);
    return false;
  }
};

// Track bio changes
const trackBioChange = async (sock, userId, oldBio, newBio, settings) => {
  try {
    const bioData = loadBioData();
    const now = Date.now();
    const today = moment().format('YYYY-MM-DD');
    
    // Initialize user data if not exists
    if (!bioData.users[userId]) {
      bioData.users[userId] = {
        changes: [],
        firstSeen: now,
        lastSeen: now,
        totalChanges: 0
      };
    }
    
    const userData = bioData.users[userId];
    userData.lastSeen = now;
    
    // Add this change
    const changeRecord = {
      timestamp: now,
      oldBio: oldBio || 'none',
      newBio: newBio || 'none',
      date: today
    };
    
    userData.changes.push(changeRecord);
    userData.totalChanges++;
    
    // Keep only last 50 changes
    if (userData.changes.length > 50) {
      userData.changes = userData.changes.slice(-50);
    }
    
    // Calculate changes today
    const changesToday = userData.changes.filter(c => c.date === today).length;
    
    // Check for violations
    let violation = false;
    let violationReason = '';
    
    if (changesToday > settings.maxChangesPerDay) {
      violation = true;
      violationReason = `Exceeded daily limit (${changesToday}/${settings.maxChangesPerDay})`;
      
      // Track violation
      if (!bioData.violations[userId]) {
        bioData.violations[userId] = [];
      }
      
      bioData.violations[userId].push({
        timestamp: now,
        reason: violationReason,
        changesToday
      });
      
      // Update stats
      settings.stats.totalViolations++;
      
      // Check if should block
      const violationCount = bioData.violations[userId].length;
      if (violationCount >= settings.autoBlockThreshold) {
        // Block the user
        await sock.updateBlockStatus(userId, 'block');
        settings.stats.blockedUsers++;
        
        // Log the block
        console.log(`[AntiBio] User ${userId} blocked for ${violationCount} violations`);
      }
    }
    
    // Check time between changes
    if (userData.changes.length >= 2) {
      const lastChange = userData.changes[userData.changes.length - 2].timestamp;
      const timeSinceLast = now - lastChange;
      
      if (timeSinceLast < settings.minTimeBetweenChanges) {
        violation = true;
        violationReason = `Changes too frequent (${Math.round(timeSinceLast / 1000)}s between)`;
      }
    }
    
    // Save updated data
    bioData.lastUpdate = now;
    saveBioData(bioData);
    saveSettings(settings);
    
    return {
      violation,
      reason: violationReason,
      changesToday,
      totalChanges: userData.totalChanges
    };
    
  } catch (error) {
    console.error('Error tracking bio change:', error);
    return { violation: false };
  }
};

// Monitor bio updates
const monitorBioUpdates = (sock) => {
  try {
    // Listen for profile updates
    sock.ev.on('contacts.update', async (updates) => {
      const settings = loadSettings();
      
      if (!settings.enabled) return;
      
      for (const update of updates) {
        const userId = update.id;
        const oldBio = update.status || '';
        const newBio = update.status || '';
        
        // Check if user is whitelisted
        if (settings.whitelist.includes(userId)) continue;
        
        // Check if user is blacklisted
        if (settings.blacklist.includes(userId)) {
          // Immediately block if on blacklist
          await sock.updateBlockStatus(userId, 'block');
          continue;
        }
        
        // Track the change
        const result = await trackBioChange(sock, userId, oldBio, newBio, settings);
        
        if (result.violation) {
          console.log(`[AntiBio] Violation: ${userId} - ${result.reason}`);
          
          // Take action based on settings
          if (settings.action === 'warn') {
            try {
              await sock.sendMessage(userId, {
                text: `⚠️ *Bio Change Warning*\n\nYou have violated bio change rules:\n• ${result.reason}\n• Changes today: ${result.changesToday}/${settings.maxChangesPerDay}\n\nPlease slow down your bio changes.`,
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363405724402785@newsletter',
                    newsletterName: 'ZUKO-MD',
                    serverMessageId: -1
                  }
                }
              });
            } catch (e) {
              // Ignore send errors
            }
          }
          
          // Notify owner if enabled
          if (settings.notifyOwner && config.ownerNumber) {
            const ownerNumbers = Array.isArray(config.ownerNumber) ? config.ownerNumber : [config.ownerNumber];
            
            for (const owner of ownerNumbers) {
              const ownerJid = owner.includes('@') ? owner : `${owner}@s.whatsapp.net`;
              
              try {
                await sock.sendMessage(ownerJid, {
                  text: `👤 *Bio Change Alert*\n\nUser: @${userId.split('@')[0]}\nViolation: ${result.reason}\nChanges today: ${result.changesToday}\nAction: ${settings.action}`,
                  mentions: [userId]
                });
              } catch (e) {
                // Ignore
              }
            }
          }
        }
      }
    });
    
    console.log('[AntiBio] ✅ Bio monitoring active');
    
  } catch (error) {
    console.error('[AntiBio] Monitoring error:', error);
  }
};

// Initialize monitoring
const initializeAntiBio = (sock) => {
  try {
    monitorBioUpdates(sock);
    console.log('[AntiBio] ✅ Initialized - Bio changes will be monitored');
  } catch (error) {
    console.error('[AntiBio] Initialization error:', error);
  }
};

// Export
module.exports = {
  name: 'antibio',
  aliases: ['abio', 'bioprotect', 'statusprotect'],
  category: 'admin',
  description: 'Prevent frequent bio/status changes and bio spam',
  usage: '.antibio <on/off/set/whitelist/blacklist/stats>',
  ownerOnly: true,
  
  async execute(sock, msg, args, extra) {
    // Command execution code here...
    // (I'll add this if you need the full command)
  },
  
  initializeAntiBio
};
