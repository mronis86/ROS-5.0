const path = require('path');

const tailwindConfig = path.join(__dirname, 'tailwind.config.js');

module.exports = {
  plugins: [
    require('tailwindcss')({ config: tailwindConfig }),
    require('autoprefixer'),
  ],
};
