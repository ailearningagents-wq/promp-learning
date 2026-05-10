# BasePage Reference Examples

Used by Stage 6 (POM Generator). Stage 6 inlines only the canonical
TypeScript BasePage; the rest of the per-framework examples live here.

## TypeScript / Playwright (`src/pages/BasePage.ts`)

```typescript
import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  protected readonly page: Page;
  readonly url: string;

  constructor(page: Page, url: string) {
    this.page = page;
    this.url = url;
  }

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    // Do NOT use 'networkidle' — Kendo/Angular Material apps poll APIs continuously;
    // networkidle never resolves within test timeouts. Use 'load' instead.
    await this.page.waitForLoadState('load');
  }

  async getPageTitle(): Promise<string> { return this.page.title(); }
  async getHeading(): Promise<string> {
    return await this.page.locator('h1').first().textContent() ?? '';
  }
  async isOnPage(urlFragment: string): Promise<boolean> {
    return this.page.url().includes(urlFragment);
  }
  async waitForUrl(urlFragment: string): Promise<void> {
    await this.page.waitForURL(`**${urlFragment}**`);
  }
  async getToastMessage(): Promise<string> {
    const toast = this.page.locator('[role="alert"], .toast, .notification, .snackbar').first();
    return await toast.textContent() ?? '';
  }
  async getErrorMessage(): Promise<string> {
    const error = this.page.locator('[role="alert"].error, .error-message, .alert-danger').first();
    return await error.textContent() ?? '';
  }
}
```

## JavaScript / Playwright

Same shape; drop the TypeScript types.

## WebdriverIO (`pages/BasePage.js`)

```javascript
class BasePage {
    constructor(url) { this.url = url; }
    async open() {
        await browser.url(this.url);
        await this.waitForPageLoad();
    }
    async waitForPageLoad() {
        await browser.waitUntil(
            async () => (await browser.execute(() => document.readyState)) === 'complete',
            { timeout: 10000, timeoutMsg: 'Page did not load in time' }
        );
    }
    async getTitle() { return browser.getTitle(); }
    async getCurrentUrl() { return browser.getUrl(); }
    async getToastMessage() {
        const toast = await $('[role="alert"], .toast, .notification, .snackbar');
        return toast.getText();
    }
}
module.exports = BasePage;
```

## selenium-js (`pages/BasePage.js`)

Plain JS class accepting `driver` and `url` — same pattern as the Java
BasePage but in JavaScript. Use `By.id()`, `By.css()`,
`driver.findElement()` throughout.

## Selenium Java

```java
public abstract class BasePage {
    protected WebDriver driver;
    protected String url;

    public BasePage(WebDriver driver, String url) {
        this.driver = driver;
        this.url = url;
        PageFactory.initElements(driver, this);
    }
    public void navigate() {
        driver.get(url);
        waitForPageLoad();
    }
    protected void waitForPageLoad() {
        new WebDriverWait(driver, Duration.ofSeconds(10))
            .until(d -> ((JavascriptExecutor) d)
                .executeScript("return document.readyState").equals("complete"));
    }
    public String getPageTitle() { return driver.getTitle(); }
    public String getCurrentUrl() { return driver.getCurrentUrl(); }
}
```

## Selenium C# / .NET (`BasePage.cs`)

```csharp
using OpenQA.Selenium;
using OpenQA.Selenium.Support.UI;
using System;

namespace [ProjectNamespace].Pages
{
    public abstract class BasePage
    {
        protected readonly IWebDriver Driver;
        protected readonly string Url;

        protected BasePage(IWebDriver driver, string url) { Driver = driver; Url = url; }

        public virtual void Navigate()
        {
            Driver.Navigate().GoToUrl(Url);
            WaitForPageLoad();
        }
        protected void WaitForPageLoad()
        {
            new WebDriverWait(Driver, TimeSpan.FromSeconds(10))
                .Until(d => ((IJavaScriptExecutor)d)
                    .ExecuteScript("return document.readyState").Equals("complete"));
        }
        public string GetPageTitle()  => Driver.Title;
        public string GetCurrentUrl() => Driver.Url;

        protected IWebElement FindElement(By locator)
            => new WebDriverWait(Driver, TimeSpan.FromSeconds(10))
                   .Until(d => d.FindElement(locator));

        public string GetToastMessage()
        {
            try { return FindElement(By.CssSelector("[role='alert'], .toast, .notification")).Text; }
            catch { return string.Empty; }
        }
    }
}
```
