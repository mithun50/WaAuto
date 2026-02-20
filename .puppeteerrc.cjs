const { join } = require('path');

/**
 * Keep Puppeteer's Chrome download inside the project directory
 * so it persists on Render's filesystem between build and runtime.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
