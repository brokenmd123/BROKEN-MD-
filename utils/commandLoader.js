/**
 * Command Loader - Separate module to avoid circular dependencies
 */

const fs = require('fs');
const path = require('path');

// Load all commands directly from the commands folder
const loadCommands = () => {
  const commands = new Map();
  const commandsPath = path.join(__dirname, '..', 'commands');
  
  if (!fs.existsSync(commandsPath)) {
    console.log('Commands directory not found');
    return commands;
  }
  
  // Read all .js files directly from the commands folder
  const files = fs.readdirSync(commandsPath).filter(file => 
    file.endsWith('.js')
  );
  
  files.forEach(file => {
    try {
      const commandPath = path.join(commandsPath, file);
      const command = require(commandPath);
      
      if (command.name) {
        commands.set(command.name, command);
        
        // Also set aliases if they exist
        if (command.aliases && Array.isArray(command.aliases)) {
          command.aliases.forEach(alias => {
            commands.set(alias, command);
          });
        }
        
        console.log(`Loaded command: ${command.name}`);
      } else {
        console.log(`Skipped ${file}: No command name specified`);
      }
    } catch (error) {
      console.error(`Error loading command ${file}:`, error.message);
    }
  });
  
  console.log(`Loaded ${commands.size} commands (including aliases)`);
  return commands;
};

module.exports = { loadCommands };
