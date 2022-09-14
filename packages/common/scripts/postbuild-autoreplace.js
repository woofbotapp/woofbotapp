const fs = require('fs');
const path = require('path');
const rootPackage = require('../../../package.json');

function main() {
  const buildPath = path.join(__dirname, '../build/index.js');
  // eslint-disable-next-line no-console
  console.info(`Fixing: ${buildPath}`);
  const payload = fs.readFileSync(buildPath).toString();
  fs.writeFileSync(buildPath, payload.replaceAll('%VERSION%', rootPackage.version));
  // eslint-disable-next-line no-console
  console.info('Fix completed');
}

if (require.main === module) {
  main();
}
