# Spec File Reference Examples

Used by Stage 7 (Test File Generation). Stage 7 inlines only the canonical
Playwright TypeScript spec examples; per-framework variants live here.

The patterns to follow per framework:

| Framework            | Test runner    | Setup hook             | Assertion lib              |
|----------------------|----------------|------------------------|-----------------------------|
| Playwright TS/JS     | @playwright/test | `test.beforeEach`     | `expect`                    |
| Selenium Java        | TestNG / JUnit 5 | `@BeforeMethod` / `@BeforeEach` | `Assert`           |
| Selenium C# (.NET)   | NUnit / MSTest / xUnit | `[SetUp]` / `[TestInitialize]` / ctor | `Assert.That` / Fluent assertions |
| selenium-js          | Mocha / Jest   | `beforeEach`           | `assert` / `expect`         |
| WebdriverIO          | Mocha / Jasmine| `beforeEach`           | `expect` (browser global)   |

## Java TestNG Spec (`RequestsFormValidationTest.java`)

```java
import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import [your.package].pages.RequestCreatePage;
import [your.package].testdata.RequestsTestData;

public class RequestsFormValidationTest extends BaseTest {

    private RequestCreatePage requestPage;

    @BeforeMethod
    public void setUpPage() {
        requestPage = new RequestCreatePage(driver, baseUrl);
        requestPage.navigate();
    }

    @Test(groups = {"regression"}, description = "TC-REQ-002 | Submit with empty Request Name shows required error")
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() {
        requestPage.fillRequestName(RequestsTestData.CreateRequest.EMPTY_REQUEST_NAME);
        requestPage.clickSubmit();
        String error = requestPage.getRequestNameError();
        Assert.assertTrue(error.toLowerCase().contains("required"),
            "Expected required error on requestName, got: " + error);
    }
}
```

For JUnit 5: replace `@BeforeMethod` with `@BeforeEach`, group attribute
with `@Tag("regression") @Test`, and assert via `org.junit.jupiter.api.Assertions`.

## C# NUnit Spec (`RequestsFormValidationTests.cs`)

```csharp
using NUnit.Framework;
using [ProjectNamespace].Pages;
using [ProjectNamespace].TestData;

namespace [ProjectNamespace].Tests.Regression.Requests
{
    [TestFixture]
    public class RequestsFormValidationTests : BaseTest
    {
        private RequestCreatePage _requestPage;

        [SetUp]
        public void SetUp()
        {
            _requestPage = new RequestCreatePage(Driver, BaseUrl);
            _requestPage.Navigate();
        }

        [Test, Category("regression")]
        [Description("TC-REQ-002 | Submit with empty Request Name shows required error")]
        public void TC_REQ_002_EmptyRequestName_ShowsRequiredError()
        {
            _requestPage.FillRequestName(RequestsTestData.CreateRequest.EmptyRequestName);
            _requestPage.ClickSubmit();
            var error = _requestPage.GetRequestNameError();
            Assert.That(error, Does.Contain("required").IgnoreCase);
        }
    }
}
```

## C# MSTest

```csharp
[TestClass]
public class RequestsFormValidationTests : BaseTest
{
    private RequestCreatePage _requestPage;
    [TestInitialize]
    public void SetUp() { /* same as NUnit */ }

    [TestMethod]
    [TestCategory("regression")]
    [Description("TC-REQ-002 | …")]
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() { /* … */ }
}
```

## C# xUnit

```csharp
public class RequestsFormValidationTests : BaseTest
{
    [Fact]
    [Trait("Category", "regression")]
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() { /* … */ }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void TC_REQ_002b_InvalidRequestNames_ShowError(string input) { /* … */ }
}
```

> Always use the runner detected in `projectFingerprint.testRunner`.
> Never mix NUnit / MSTest / xUnit attributes.

## selenium-js Spec (Mocha)

```javascript
const { injectStorageState } = require('../../output/auth/auth-helper');
const RequestCreatePage = require('../../pages/RequestCreatePage');
const RequestsTestData = require('../../testdata/RequestsTestData');

describe('Requests — Form Validation', function () {
  let driver, requestPage;

  beforeEach(async function () {
    driver = /* driver setup from project BaseTest or shared helper */;
    await injectStorageState(driver, process.env.BASE_URL);
    requestPage = new RequestCreatePage(driver, process.env.BASE_URL);
    await requestPage.navigate();
  });

  afterEach(async function () { await driver.quit(); });

  it('TC-REQ-002 | Submit with empty Request Name shows required error', async function () {
    await requestPage.fillRequestName(RequestsTestData.EMPTY_REQUEST_NAME);
    await requestPage.clickSubmit();
    const error = await requestPage.getRequestNameError();
    assert.ok(error.toLowerCase().includes('required'));
  });
});
```

> Match the runner the project already uses (Jest etc.). Do NOT use
> Playwright `test.describe` syntax for selenium-js.

## WebdriverIO Spec

```javascript
const { injectStorageState } = require('../../output/auth/auth-helper');
const RequestCreatePage = require('../../pages/RequestCreatePage');
const RequestsTestData = require('../../testdata/RequestsTestData');

describe('Requests — Form Validation', () => {
  let requestPage;

  beforeEach(async () => {
    await injectStorageState(process.env.BASE_URL);
    requestPage = new RequestCreatePage(browser, process.env.BASE_URL);
    await requestPage.navigate();
  });

  it('TC-REQ-002 | Submit with empty Request Name shows required error', async () => {
    await requestPage.fillRequestName(RequestsTestData.EMPTY_REQUEST_NAME);
    await requestPage.clickSubmit();
    const error = await requestPage.getRequestNameError();
    expect(error.toLowerCase()).toContain('required');
  });
});
```
