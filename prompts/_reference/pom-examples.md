# POM Reference Examples

Used by Stage 6 (POM Generator). Stage 6 inlines only the canonical
TypeScript / Playwright POM; per-framework variants live here.

## Selenium Java POM (`RequestCreatePage.java`)

```java
// Locators follow priority: By.id > By.name > By.cssSelector > By.xpath
import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.*;
import java.time.Duration;

public class RequestCreatePage extends BasePage {

    private final By requestNameInput = By.id("request-name");
    private final By categorySelect   = By.id("category");
    private final By dueDateInput     = By.id("due-date");
    private final By descriptionInput = By.id("description");
    private final By submitButton     = By.cssSelector("[data-testid='submit-btn']");
    private final By cancelButton     = By.cssSelector("[data-testid='cancel-btn']");
    private final By requestNameError = By.cssSelector("[data-testid='request-name-error']");
    private final By successMessage   = By.cssSelector("[role='alert'].success, .success-notification");

    public RequestCreatePage(WebDriver driver, String baseUrl) {
        super(driver, baseUrl + "/requests/create");
    }

    public void fillRequestName(String value) {
        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(10))
            .until(ExpectedConditions.visibilityOfElementLocated(requestNameInput));
        el.clear();
        el.sendKeys(value);
    }
    public void selectCategory(String visibleText) {
        new Select(driver.findElement(categorySelect)).selectByVisibleText(visibleText);
    }
    public void fillDueDate(String value) { driver.findElement(dueDateInput).sendKeys(value); }
    public void fillDescription(String value) { driver.findElement(descriptionInput).sendKeys(value); }
    public void clickSubmit() { driver.findElement(submitButton).click(); }
    public void clickCancel() { driver.findElement(cancelButton).click(); }
    public String getRequestNameError() { return driver.findElement(requestNameError).getText(); }
    public String getSuccessMessage()   { return driver.findElement(successMessage).getText(); }
}
```

## Selenium C# / .NET POM (`RequestCreatePage.cs`)

```csharp
using OpenQA.Selenium;

namespace [ProjectNamespace].Pages
{
    public class RequestCreatePage : BasePage
    {
        private By RequestNameInput  => By.Id("request-name");
        private By CategorySelect    => By.Id("category");
        private By DueDateInput      => By.Id("due-date");
        private By DescriptionInput  => By.Id("description");
        private By SubmitButton      => By.CssSelector("[data-testid='submit-btn']");
        private By CancelButton      => By.CssSelector("[data-testid='cancel-btn']");
        private By RequestNameError  => By.CssSelector("[data-testid='request-name-error']");
        private By SuccessMessage    => By.CssSelector("[role='alert'].success, .success-notification");

        public RequestCreatePage(IWebDriver driver, string baseUrl)
            : base(driver, $"{baseUrl}/requests/create") { }

        public void FillRequestName(string value)  => FindElement(RequestNameInput).SendKeys(value);
        public void SelectCategory(string value)   => new SelectElement(FindElement(CategorySelect)).SelectByText(value);
        public void FillDueDate(string value)      => FindElement(DueDateInput).SendKeys(value);
        public void FillDescription(string value)  => FindElement(DescriptionInput).SendKeys(value);
        public void ClickSubmit()                  => FindElement(SubmitButton).Click();
        public void ClickCancel()                  => FindElement(CancelButton).Click();
        public string GetRequestNameError()        => FindElement(RequestNameError).Text;
        public string GetSuccessMessage()          => FindElement(SuccessMessage).Text;
    }
}
```

## C# Locator Priority

1. `id` → `By.Id("element-id")`
2. `name` → `By.Name("field-name")`
3. `data-testid` → `By.CssSelector("[data-testid='value']")`
4. `aria-label` → `By.XPath("//button[@aria-label='Submit']")`
5. CSS selector → `By.CssSelector(".specific-class")` (last resort)
