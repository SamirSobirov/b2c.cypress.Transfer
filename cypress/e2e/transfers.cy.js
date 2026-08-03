// ResizeObserver loop — известный шум браузера на Nuxt-страницах: он приходит
// при открытии выпадающих списков. К доступности сайта отношения не имеет,
// тест из-за него ронять нельзя.
Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('Transfer Search Flow', () => {

  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Параметры поиска — менять здесь.
  const ROUTE = {
    FROM: 'Центральный железнодорожный вокзал Ташкента',
    TO: 'Международный аэропорт Ташкента имени Ислама Каримова',
  };

  // Поля "Откуда"/"Куда" — PrimeVue AutoComplete. Их id (pv_id_0_330) Vue
  // генерирует заново при каждом монтировании, класс один на оба поля —
  // остаётся placeholder: он различает поля и переживает пересборку.
  const FROM_INPUT = '.transfer-search input[placeholder*="Откуда"]';
  const TO_INPUT = '.transfer-search input[placeholder*="Куда"]';

  // Карточка оффера на странице результатов.
  const OFFER_CARD = 'article.offer-card';

  const T = {
    PAGE: 120000,
    UI: 30000,
    API: 45000,
    LOGOUT: 30000,
    SEARCH: 60000,   // поиск трансферов: метапоиск опрашивает поставщиков
    RESULTS: 30000,  // бюджет на наполнение выдачи, после которого она считается пустой
  };

  const PAUSE = {
    MODAL: 1000,
    FIELD: 500,
    SUBMIT: 800,
    TAB: 1000,
    OVERLAY: 800,   // анимация открытия/закрытия оверлеев PrimeVue
    NAVIGATE: 2500, // запас на переход на выдачу перед повторным кликом "Поиск"
    SETTLE: 2000,   // окно, за которое проверяем, что выдача перестала пополняться
  };

  /**
   * Заполнение поля "Откуда"/"Куда" с выбором подсказки.
   *
   * Просто напечатать адрес недостаточно: бэкенду нужен id места, а он
   * проставляется только когда пользователь выбрал вариант из выпадающего
   * списка. Без выбора кнопка "Поиск" молча ничего не делает.
   */
  const selectPlace = (selector, value) => {
    cy.fillInput(selector, value, { timeout: T.UI });

    // Список подсказок приходит с бэкенда — ждём именно опции, а не оверлей:
    // пустой оверлей PrimeVue успевает отрисоваться раньше ответа.
    cy.get('.p-autocomplete-overlay li.p-autocomplete-option', { timeout: T.UI })
      .should('have.length.greaterThan', 0);

    // Берём подсказку по тексту, а не первую в списке. Подсказки отдаёт Yandex
    // (suggest-maps.yandex.ru), и ранжирует он их по-своему: на запрос
    // "Центральный железнодорожный вокзал Ташкента" первым приходит "Южный
    // вокзал города Ташкент", а нужный вариант стоит вторым. Порядок к тому же
    // не постоянный — поиск по позиции даёт разный маршрут от прогона к прогону.
    //
    // cy.contains сам перезапрашивает список, пока совпадение не появится:
    // подсказки долетают не разом, и нужная может прийти позже первых.
    cy.contains('.p-autocomplete-overlay li.p-autocomplete-option', value, { timeout: T.UI })
      .should('be.visible')
      .click({ timeout: T.UI });

    cy.get('.p-autocomplete-overlay', { timeout: T.UI }).should('not.exist');
    cy.wait(PAUSE.FIELD);
  };

  before(() => {
    expect(EMAIL, 'секрет CYPRESS_LOGIN_EMAIL не задан').to.be.a('string').and.not.be.empty;
    expect(PASSWORD, 'секрет CYPRESS_LOGIN_PASSWORD не задан').to.be.a('string').and.not.be.empty;
  });

  beforeEach(() => {
    // Значения по умолчанию: если прогон упадёт раньше, в отчёте останется
    // явный UNKNOWN / N/A, а не результат предыдущего запуска.
    cy.writeFile('auth_api_status.txt', 'UNKNOWN');
    cy.writeFile('api_status.txt', 'UNKNOWN');
    cy.writeFile('offers_count.txt', 'N/A');
  });

  // Авторизация и поиск — один тест, а не два: между тестами Cypress чистит
  // куки и localStorage (test isolation), и вторая часть осталась бы без сессии.
  it('Авторизация и поиск трансфера', () => {
    cy.viewport(1280, 800);

    // 1. ПЕРЕХВАТ API
    cy.intercept({ method: 'POST', url: '**/login**' }).as('apiAuth');
    cy.intercept({ method: 'POST', url: '**/api/v1/search/transfer**' }).as('apiSearch');

    // 2. ПЕРЕХОД НА ГЛАВНУЮ
    cy.visit('https://metatrip.asia/ru/', { timeout: T.PAGE });

    // 3. ОТКРЫТИЕ МОДАЛКИ "ВХОД В ПРОФИЛЬ"
    // Клик с повтором: страница на Nuxt приходит с сервера уже отрисованной,
    // и до окончания гидратации кнопка кликается вхолостую — модалка не встаёт.
    // На раннере GitHub Actions это ловилось стабильно, локально почти никогда.
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

    // 9. ВКЛАДКА "ТРАНСФЕРЫ" НА ГЛАВНОЙ
    // Клик с повтором: форма поиска монтируется только после гидратации вкладок.
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

    // Оба места действительно проставлены — ловим промах по подсказке здесь,
    // а не через пустую выдачу шагом ниже.
    cy.get(FROM_INPUT, { timeout: T.UI }).should('have.value', ROUTE.FROM);
    cy.get(TO_INPUT, { timeout: T.UI }).should('have.value', ROUTE.TO);

    // 12. ПОИСК
    // Клик с повтором: до гидратации Nuxt кнопка кликается вхолостую, а признака
    // "поиск идёт" у формы нет — сработавший клик виден только по смене адреса.
    cy.clickUntilUrl('.transfer-search__submit', '/transfer', {
      timeout: T.UI,
      pause: PAUSE.NAVIGATE,
    });

    // 13. ПОИСК ДЕЙСТВИТЕЛЬНО УШЁЛ С НУЖНЫМ МАРШРУТОМ
    // Проверка обязательна: при незаполненном поле кнопка молча ничего не
    // делает, клик проходит без ошибки и тест выглядит зелёным.
    // Маршрут сверяем по заголовку выдачи, а не по query-строке: адреса в ней
    // приходят в url-кодировке вперемешку с координатами точек.
    cy.url({ timeout: T.PAGE }).should('include', '/transfer');
    cy.get('main h1', { timeout: T.PAGE })
      .should('contain.text', ROUTE.FROM)
      .and('contain.text', ROUTE.TO);

    // 14. СТАТУС ПОИСКОВОГО API
    // Запрос уходит уже со страницы результатов, после перехода.
    cy.wait('@apiSearch', { timeout: T.SEARCH }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при поиске трансфера: HTTP ${statusCode}`);
      }
    });

    cy.log('✅ Поиск запущен');

    // 15. ПОДСЧЁТ ОФФЕРОВ
    // Берём не первое значение, а стабилизировавшееся: карточки дорисовываются
    // после гидратации, иначе в отчёт попадёт случайное число.
    // Число пишем в файл до проверки: при пустой выдаче отчёт должен показать
    // "⚪ No Offers" с нулём, а не "🔴 Unknown Test Failure" без числа.
    cy.countWhenStable(OFFER_CARD, { timeout: T.RESULTS, settle: PAUSE.SETTLE }).then((count) => {
      cy.writeFile('offers_count.txt', count.toString());
      cy.log(`✅ Найдено предложений по трансферу: ${count}`);

      expect(count, 'офферов в выдаче').to.be.greaterThan(0);
    });

    cy.screenshot('after-search', { capture: 'viewport' });
  });
});
