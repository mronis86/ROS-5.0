const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const tailwindConfig = path.join(__dirname, 'tailwind.config.js');

module.exports = {
  plugins: [
    require(path.join(repoRoot, 'node_modules', 'tailwindcss'))({ config: tailwindConfig }),
    require(path.join(repoRoot, 'node_modules', 'autoprefixer')),
  ],
};
