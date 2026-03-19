/**
 * AutoReact Storage
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/autoreact.json');

const defaultSettings = {
  enabled: false,
  enabledChats: [],
  reactMode: 'all', // 'bot' or 'all'
  mode: 'random', // 'random', 'sequence', 'specific'
  emojis: ['❤️', '🔥', '👍', '😂', '😊', '🥰', '😍', '🎉', '✨', '🌟'],
  customEmojis: null,
  specific: '❤️',
  sequenceIndex: 0,
  probability: 100,
  ignoreSelf: true,
  ignoreBots: false
};

// Load settings
const load = () => {
  try {
    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return { ...defaultSettings, ...JSON.parse(data) };
    } else {
      // Create default settings file
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultSettings, null, 2));
    }
  } catch (error) {
    console.error('Error loading autoreact settings:', error);
  }
  return { ...defaultSettings };
};

// Save settings
const save = (settings) => {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving autoreact settings:', error);
    return false;
  }
};

module.exports = { load, save, defaultSettings };
