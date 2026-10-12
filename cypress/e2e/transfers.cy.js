Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('Transfer Search Flow', () => {

  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Параметры поиска — менять здесь.
  const ROUTE = {
    FROM: 'аэропорт Ташкент-Хумо',
    TO: 'аэропорт Ташкент имени Ислама Каримова',
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

    // Пауза после загрузки страницы. Разметка на Nuxt приходит с сервера
    // готовой, а обработчики Vue навешиваются позже — до этого клики уходят
    // вхолостую. Команды с повтором это переживают, но каждый лишний клик по
    // вкладке или кнопке "Войти" рискует переоткрыть уже открытое.
    HYDRATE: 2000,

    // Задержка между символами в полях с подсказками. Мгновенный ввод всей
    // строки не похож на живой набор: автокомплит рассчитан на поток событий.
    TYPE: 40,

    // Пауза после выбора подсказки. Выбор — не конец: сайт следом геокодит
    // место через geocode-maps.yandex.ru, и до ответа у точки нет координат.
    // Кнопка "Поиск" без координат молча ничего не делает, поэтому уходить с
    // поля раньше, чем геокодер ответил, нельзя.
    GEOCODE: 1500,
  };

 
  const PLACE_OPTION = '.p-autocomplete-overlay li.p-autocomplete-option';

  /**
   * Заполнение поля "Откуда"/"Куда" с выбором подсказки.
   *
   * Просто напечатать адрес недостаточно: бэкенду нужны координаты точки, а их
   * сайт берёт из выбранной подсказки (геокодит её через Yandex). Без выбора
   * форма считает поле незаполненным, и кнопка "Поиск" молча ничего не делает.
   *
   * Подсказку берём по тексту, а не первую в списке: Yandex ранжирует выдачу
   * по-своему, и на "Центральный железнодорожный вокзал Ташкента" первым
   * приходит "Южный вокзал города Ташкент".
   *
   * Повтор нужен из-за самого Yandex: на один и тот же запрос он примерно в
   * трети случаев отвечает HTTP 200 с одним случайным вариантом вместо полного
   * списка (проверено серией прямых запросов: 5 из 8 удачных по вокзалу, 6 из 8
   * по аэропорту). Это не ошибка сайта и не гонка в тесте, поэтому ждать дольше
   * бесполезно — нужен новый запрос. Его порождает повторный ввод: clear()
   * сбрасывает подсказки, а печать заново запускает debounce (300 мс) и новый
   * вызов suggest.
   *
   * При 6 попытках шанс так и не получить нужную подсказку падает с ~38% до
   * ~0.3% на поле.
   */
  const selectPlace = (selector, value, options = {}) => {
    const { attempts = 6, wait = 4000, poll = 250 } = options;

    const hasOption = ($body) =>
      [...$body.find(PLACE_OPTION)].some((el) => el.innerText.includes(value));

    // Опрос вместо фиксированной паузы: когда список пришёл нормальный, идём
    // дальше сразу, а не досиживаем бюджет ожидания до конца.
    const waitForOption = (deadline) =>
      cy.get('body', { log: false }).then(($body) => {
        if (hasOption($body)) return cy.wrap(true, { log: false });
        if (Date.now() >= deadline) return cy.wrap(false, { log: false });

        cy.wait(poll, { log: false });
        return waitForOption(deadline);
      });

    const attempt = (n) => {
      cy.fillInput(selector, value, { timeout: T.UI, delay: PAUSE.TYPE });

      // Отсчёт бюджета — внутри cy.then, иначе Date.now() сработал бы в момент
      // постановки команд в очередь, то есть ДО того, как отработает fillInput.
      // Печать с задержкой занимает пару секунд и съедала бы бюджет целиком:
      // опрос начинался бы с уже истёкшим сроком и сразу уходил на повтор.
      cy.then(() => waitForOption(Date.now() + wait)).then((found) => {
        if (found) {
          // Кликаем через cy.contains, а не по сохранённой ноде: список мог
          // перерисоваться, и она оказалась бы detached.
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
    cy.wait(PAUSE.HYDRATE);

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

    // После входа шапка перерисовывается под вошедшего пользователя — даём ей
    // устояться, прежде чем целиться в вкладки.
    cy.wait(PAUSE.HYDRATE);

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
    // Обе точки выбраны и геокодированы — даём форме собрать модель до клика.
    cy.wait(PAUSE.SUBMIT);

    // Клик с повтором: до гидратации Nuxt кнопка кликается вхолостую, а признака
    // "поиск идёт" у формы нет — сработавший клик виден только по смене адреса.
    cy.clickUntilUrl('.transfer-search__submit', '/transfer', {
      timeout: T.UI,
      pause: PAUSE.NAVIGATE,
    });

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

     cy.countWhenStable(OFFER_CARD, { timeout: T.RESULTS, settle: PAUSE.SETTLE }).then((count) => {
      cy.writeFile('offers_count.txt', count.toString());
      cy.log(`✅ Найдено предложений по трансферу: ${count}`);

      expect(count, 'офферов в выдаче').to.be.greaterThan(0);
    });

    cy.screenshot('after-search', { capture: 'viewport' });
  });
});
