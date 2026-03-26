const fs = require('fs');

function printMeteorConfig(appPath) {
  const rawData = fs.readFileSync(`${appPath}/package.json`);
  const jsonData = JSON.parse(rawData);
  const meteorConfig = jsonData?.meteor;

  console.log(JSON.stringify(meteorConfig, null, 2));
}

if (require.main === module) {
  const appPath = process.argv[2];
  printMeteorConfig(appPath);
}

// Export the function for external execution
module.exports = printMeteorConfig;
