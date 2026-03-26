const fs = require('fs');

const columns = 4;

function toMatrix(arr, columns) {
  let matrix = [];
  for (let i = 0; i < arr.length; i += columns) {
    matrix.push(arr.slice(i, i + columns));
  }
  return matrix;
}

function readFileLinesSync(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8'); // Read file synchronously
    return data.split(/\r?\n/).filter(Boolean).filter(line => !line.startsWith('#')); // Split into an array of lines (handles both \n and \r\n)
  } catch (err) {
    console.error("Error reading file:", err);
    return [];
  }
}

function printMeteorAtmospherePackages(appPath) {
  const atmsData = readFileLinesSync(`${appPath}/.meteor/versions`);

  const atmsPackages = atmsData;
  const atmsMatrix = toMatrix(atmsPackages, columns);
  console.log("\n☄️  Atmosphere\n");
  if (atmsMatrix.length) {
    console.table(atmsMatrix);
  } else {
    console.log("No found\n");
  }
}

function printMeteorNpmPackages(appPath) {
  const rawData = fs.readFileSync(`${appPath}/package.json`);
  const jsonData = JSON.parse(rawData);

  const depPackages = Object.entries(Object.assign({}, jsonData.dependencies)).map(([k, v]) => `${k}@${v}`);
  const depMatrix = toMatrix(depPackages, columns);
  console.log("\n📦️  Dependencies\n");
  if (depMatrix.length) {
    console.table(depMatrix);
  } else {
    console.log("No found\n");
  }

  const devPackages = Object.entries(Object.assign({}, jsonData.devDependencies)).map(([k, v]) => `${k}@${v}`);
  const devMatrix = toMatrix(devPackages, columns);
  console.log("\n🛠️  DevDependencies\n");
  if (devMatrix.length) {
    console.table(devMatrix);
  } else {
    console.log("No found\n");
  }
}

function printMeteorPackages(appPath, npmOrAtmosphere = 'npm') {
  if (npmOrAtmosphere === 'npm') {
    printMeteorNpmPackages(appPath);
  } else {
    printMeteorAtmospherePackages(appPath);
  }
}

// Check if script is run directly
if (require.main === module) {
  const appPath = process.argv[2];
  const npmOrAtmosphere = process.argv[3] || 'npm';
  printMeteorPackages(appPath, npmOrAtmosphere);
}

// Export the function for external execution
module.exports = printMeteorPackages;
