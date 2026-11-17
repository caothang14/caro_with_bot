// Node: loads the registry + every bot in the manifest. Usage: const CaroBots = require('./bots');
const path = require('path');
require('./registry');
for (const f of require('./manifest')) require(path.join(__dirname, f));
module.exports = globalThis.CaroBots;
