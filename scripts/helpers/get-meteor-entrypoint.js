const fs = require('fs');

function getMeteorEntrypoint(appPath, clientOrServer = 'client') {
  const rawData = fs.readFileSync(`${appPath}/package.json`);
  const jsonData = JSON.parse(rawData);
  return `${appPath}/${jsonData?.meteor?.mainModule?.[clientOrServer]}`;
}

// Check if script is run directly
if (require.main === module) {
  const appPath = process.argv[2];
  const clientOrServer = process.argv[3] || 'client';
  console.log(getMeteorEntrypoint(appPath, clientOrServer));
}

// Export the function for external execution
module.exports = getMeteorEntrypoint;
