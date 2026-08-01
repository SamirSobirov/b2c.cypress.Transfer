const { defineConfig } = require("cypress");

module.exports = defineConfig({
  chromeWebSecurity: false,
  
  e2e: {
    baseUrl: 'https://metatrip.asia/ru/',
    watchForFileChanges: false,
    viewportWidth: 1280,
    viewportHeight: 800,

    // Таймауты с запасом под GitHub Actions: ubuntu-раннер заметно медленнее
    // локальной машины, особенно на первой загрузке страницы.
    defaultCommandTimeout: 15000,   // поиск элементов / ассерты
    pageLoadTimeout: 120000,        // cy.visit на холодном раннере
    requestTimeout: 20000,          // уход запроса в сеть
    responseTimeout: 45000,         // ответ бэкенда

    // Прогон в CI перезапускается при флаке сети — локально ретраи не мешают
    retries: { runMode: 2, openMode: 0 },

    video: false,
    screenshotOnRunFailure: true,

    setupNodeEvents(on, config) {
      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          launchOptions.args.push('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        }
        return launchOptions;
      });
      return config;
    },
  },
});