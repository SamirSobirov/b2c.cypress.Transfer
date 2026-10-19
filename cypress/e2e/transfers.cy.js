Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('Transfer Search Flow', () => {

  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Параметры поиска — исправлен регистр для прохождения проверки have.value
  const ROUTE = {
    FROM: 'Аэропорт Ташкент-Хумо',
    TO: 'Центральный железнодорожный вокзал Ташкента',
  };

  const FROM_INPUT = '.transfer-search input[placeholder*="Откуда"]';
  const TO_INPUT = '.transfer-search input[placeholder*="Куда"]';

  // Карточка оффера на странице результатов.
  const OFFER_CARD = 'article.offer-card';

  const T = {
    PAGE: 120000,
    UI: 30000,
    API: 45000,
    LOGOUT: 30000,
    SEARCH: 60000,   
    RESULTS: 30000,  
  };

  const PAUSE = {
    MODAL: 1000,
    FIELD: 500,
    SUBMIT: 800,
    TAB: 1000,
    OVERLAY: 800,   
    NAVIGATE: 2500, 
    SETTLE: 2000,   
    HYDRATE: 2000,
    TYPE: 40,
    GEOCODE: 1500,
  };

  const PLACE_OPTION = '.p-autocomplete-overlay li.p-autocomplete-option';

  const selectPlace = (selector, value, options = {}) => {
    const { attempts = 6, wait = 4000, poll = 250 } = options;

    const hasOption = ($body) =>
      [...$body.find(PLACE_OPTION)].some((el) => el.innerText.includes(value));

    const waitForOption = (deadline) =>
      cy.get('body', { log: false }).then(($body) => {
        if (hasOption($body)) return cy.wrap(true, { log: false });
        if (Date.now() >= deadline) return cy.wrap(false, { log: false });

        cy.wait(poll, { log: false });
        return waitForOption(deadline);
      });

    const attempt = (n) => {
      cy.fillInput(selector, value, { timeout: T.UI, delay: PAUSE.TYPE });

      cy.then(() => waitForOption(Date.now() + wait)).then((found) => {
        if (found) {
          cy.contains(PLACE_OPTION, value, { timeout: T.UI })
            .should('be.visible')
            .click({ timeout: T.UI });
          return;
        }

        if (n >= attempts) {
          cy.get('body', { log: false }).then(($body) => {
            const texts = [...$body.find(PLACE_OPTION)]
              .map((el) => el.innerText.trim().replace(/\s+/g, ' '));

            throw new Error(
              `🆘 Yandex ни разу не вернул "${value}" за ${attempts} попыт(ок). ` +
              `В последнем списке: ${texts.join(' | ') || '(пусто)'}`
            );
          });
          return;
        }

        cy.log(`Подсказки без "${value}" — повтор ${n + 1} из ${attempts}`);
        attempt(n + 1);
      });
    };

    attempt(1);

    cy.get('.p-autocomplete-overlay', { timeout: T.UI }).should('not.exist');
    cy.wait(PAUSE.GEOCODE);
  };

  before(() => {
    expect(EMAIL, 'секрет CYPRESS_LOGIN_EMAIL не задан').to.be.a('string').and.not.be.empty;
    expect(PASSWORD, 'секрет CYPRESS_LOGIN_PASSWORD не задан').to.be.a('string').and.not.be.empty;
  });

  beforeEach(() => {
    cy.writeFile('auth_api_status.txt', 'UNKNOWN');
    cy.writeFile('api_status.txt', 'UNKNOWN');
    cy.writeFile('offers_count.txt', 'N/A');
  });

  it('Авторизация и поиск трансфера', () => {
    cy.viewport(1280, 800);

    // 1. ПЕРЕХВАТ API
    cy.intercept({ method: 'POST', url: '**/login**' }).as('apiAuth');
    cy.intercept({ method: 'POST', url: '**/api/v1/search/transfer**' }).as('apiSearch');

    // 2. ПЕРЕХОД НА ГЛАВНУЮ
    cy.visit('https://metatrip.asia/ru/', { timeout: T.PAGE });
    cy.wait(PAUSE.HYDRATE);

    // 3. ОТКРЫТИЕ МОДАЛКИ "ВХОД В ПРОФИЛЬ"
    cy.clickUntilVisible('nav button', '.p-dialog', {
      text: 'Войти',
      timeout: T.UI,
      pause: PAUSE.MODAL,
    });

    cy.get('.p-dialog', { timeout: T.UI }).should('be.visible').within(() => {
      cy.contains('Вход в профиль', { timeout: T.UI }).should('be.visible');

      // 4. ВВОД ПОЧТЫ
      cy.fillInput('input[name="email"]', EMAIL, { timeout: T.UI });
      cy.wait(PAUSE.FIELD);

      // 5. ВВОД ПАРОЛЯ
      cy.fillInput('input[name="password"]', PASSWORD, { timeout: T.UI });
      cy.wait(PAUSE.SUBMIT);

      // 6. КЛИК "ВОЙТИ"
      cy.get('button[aria-label="Войти"]', { timeout: T.UI })
        .should('be.visible')
        .and('have.attr', 'data-p-disabled', 'false')
        .click({ timeout: T.UI });
    });

    // 7. УМНАЯ ПРОВЕРКА ОТВЕТА СЕРВЕРА
    cy.wait('@apiAuth', { timeout: T.API }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('auth_api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при авторизации: HTTP ${statusCode}`);
      }
    });

    // 8. ПРОВЕРКА УСПЕШНОГО ВХОДА (UI)
    cy.get('.p-dialog', { timeout: T.LOGOUT }).should('not.exist');
    cy.get('body', { timeout: T.UI })
      .should('not.contain', 'Неверный логин')
      .and('not.contain', 'Ошибка');

    cy.log('✅ Авторизация прошла успешно');

    cy.wait(PAUSE.HYDRATE);

    // 9. ВКЛАДКА "ТРАНСФЕРЫ" НА ГЛАВНОЙ
    cy.clickUntilVisible('button[role="tab"]', '.transfer-search', {
      text: 'Трансферы',
      timeout: T.UI,
      pause: PAUSE.TAB,
    });

    cy.get('.transfer-search', { timeout: T.UI }).should('be.visible');

    // 10. "ОТКУДА"
    selectPlace(FROM_INPUT, ROUTE.FROM);

    // 11. "КУДА"
    selectPlace(TO_INPUT, ROUTE.TO);

    cy.get(FROM_INPUT, { timeout: T.UI }).should('have.value', ROUTE.FROM);
    cy.get(TO_INPUT, { timeout: T.UI }).should('have.value', ROUTE.TO);

    // 12. ПОИСК (сразу, без ожидания)
    cy.get('.transfer-search__submit', { timeout: T.UI })
      .should('be.visible')
      .click(); // Мгновенный клик после проверки полей

    cy.url({ timeout: T.PAGE }).should('include', '/transfer');
    cy.get('main h1', { timeout: T.PAGE })
      .should('contain.text', ROUTE.FROM)
      .and('contain.text', ROUTE.TO);

    // 14. СТАТУС ПОИСКОВОГО API
    cy.wait('@apiSearch', { timeout: T.SEARCH }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при поиске трансфера: HTTP ${statusCode}`);
      }
    });

    cy.log('✅ Поиск запущен');

    cy.countWhenStable(OFFER_CARD, { timeout: T.RESULTS, settle: PAUSE.SETTLE }).then((count) => {
      cy.writeFile('offers_count.txt', count.toString());
      cy.log(`✅ Найдено предложений по трансферу: ${count}`);

      expect(count, 'офферов в выдаче').to.be.greaterThan(0);
    });

    cy.screenshot('after-search', { capture: 'viewport' });
  });
});