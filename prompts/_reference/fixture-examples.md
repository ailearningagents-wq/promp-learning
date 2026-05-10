# Fixture Reference Examples

Used by Stage 7 (Test File Generation). Stage 7 inlines only the canonical
Playwright TypeScript fixture; per-framework variants live here.

## Selenium Java — `BaseTest.java`

```java
public abstract class BaseTest {
    protected WebDriver driver;
    protected String baseUrl;

    @BeforeMethod  // or @BeforeEach for JUnit 5
    public void setUp() {
        driver  = WebDriverFactory.create();   // project's existing factory
        baseUrl = System.getenv("BASE_URL");
        AuthHelper.injectStorageState(driver, baseUrl);  // from Stage 2
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) driver.quit();
    }
}
```

## Selenium C# / .NET — `BaseTest.cs`

```csharp
public abstract class BaseTest
{
    protected IWebDriver Driver = null!;
    protected string BaseUrl = null!;

    [SetUp]                       // [TestInitialize] for MSTest
    public void SetUp()
    {
        Driver  = WebDriverFactory.Create();
        BaseUrl = Environment.GetEnvironmentVariable("BASE_URL")!;
        AuthHelper.InjectStorageState(Driver, BaseUrl);
    }

    [TearDown]
    public void TearDown() => Driver?.Quit();
}
```

## selenium-js — `test/base-test.js`

A module that exports a `setUp()` / `tearDown()` pair plus a helper that
builds the driver and calls `injectStorageState()` from Stage 2's
`auth-helper.js`.

```javascript
const { Builder } = require('selenium-webdriver');
const { injectStorageState } = require('../output/auth/auth-helper');

async function setUp() {
  const driver = await new Builder().forBrowser('chrome').build();
  await injectStorageState(driver, process.env.BASE_URL);
  return driver;
}

async function tearDown(driver) {
  if (driver) await driver.quit();
}

module.exports = { setUp, tearDown };
```

## WebdriverIO

WebdriverIO's `wdio.conf.js` already provides `before` / `beforeEach`
hooks. The fixture artifact is the project's `auth-helper.js` (from
Stage 2) plus a small `pageObjects.js` module that exports
lazily-instantiated POM singletons for specs to import.

```javascript
// pageObjects.js
const RequestCreatePage = require('./pages/RequestCreatePage');
let requestCreatePage;

module.exports = {
  get requestCreatePage() {
    if (!requestCreatePage) requestCreatePage = new RequestCreatePage(browser, process.env.BASE_URL);
    return requestCreatePage;
  },
};
```
