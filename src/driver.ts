import {
    Builder,
    By, Capabilities, Condition,
    error,
    ILocation,
    IRectangle,
    ISize,
    Locator,
    ThenableWebDriver, WebDriver,
    WebElement,
} from "selenium-webdriver";
import NoSuchElementError = error.NoSuchElementError;
import {Config} from "./config";
import {capabilities} from "./driversCapabilities";
import * as assert from "assert";
import InvalidSelectorError = error.InvalidSelectorError;
import StaleElementReferenceError = error.StaleElementReferenceError;

enum TimeConstants  {
    /* milliseconds*/
    Zero = 0,
    QuaterASecond = 250,
    HalfASecond = 500,
    FiveSeconds = 5000,
    TenSeconds = 10000,
    HalfAMinute= 30000,
    QuarterAMinute = 15000,
    Minute = 60000
}

type expectOptions = {
    message?: string | null
    timeout?: number
    concatenateMessages?: boolean
}

function timeoutCondition(timeoutMs: number = TimeConstants.QuarterAMinute){
    const dt = +new Date();
    return ()=> (+new Date()) - dt <= timeoutMs;
}

function getCleanStack(stack: string | undefined){
    if (stack){
         return stack
             .split('\n')
             .filter(line => !line.includes('driver.ts'))
             .join('\n');
    }
}

async function retryExpect<T>(foo: ()=>Promise<T>, expected: T,
                               {message = null, concatenateMessages= false,
                                   timeout}: expectOptions): Promise<void> {
    let exception;
    const retryTimeoutCondition = timeoutCondition(timeout);
    while (retryTimeoutCondition()){
        const actual = await foo();
        try {
            assert.deepStrictEqual(actual, expected);
            return;
        } catch (e) {
            exception = e;
        }
    }
    throw new assert.AssertionError(Object.assign({}, exception,
        {stackStartFn: retryExpect,
            message: message ? concatenateMessages ? [message, exception.message].join('\n'): message : exception.message
        }));
}

class Driver {
    private _driver: ThenableWebDriver | null = null;
    private _capabilities: Capabilities | null = null;
    get driver(){
        if (!this._driver){
            this._driver = new Builder()
                .usingServer(Config.seleniumHubUrl)
                .usingWebDriverProxy(Config.webDriverProxy)
                .withCapabilities(capabilities[Config.browser])
                .build();
            this.driver.manage().window().maximize();
        }
        return this._driver;
    }
    get(url: string){
        return this.driver.get(url)
    }
    executeScript<T>(script: string|Function, ...var_args: any[]){
        return this.driver.executeScript<T>(script, ...var_args);
    }
    async retryExecuteScript<T>(script: string|Function, ...var_args: any[]){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException ;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await this.driver.executeScript<T>(script, ...var_args);
            } catch (e){
                currentException = e;
            }
        }
        throw currentException;
    }
    async quit(){
        if (this._driver){
            await this._driver.quit();
        }
    }
    wait<T>(condition: PromiseLike<T>|Condition<T>|((driver: WebDriver) => T | PromiseLike<T>)|Function,
        opt_timeout?: number, opt_message?: string): Promise<T>{
        return this.driver.wait(condition, opt_timeout, opt_message)
    };
    getCurrentUrl(){
        return this.driver.getCurrentUrl();
    }
    findElements(locator: Locator){
        return this.driver.findElements(locator);
    }
    switchTo(){
        return this.driver.switchTo()
    }
    async getCapabilities(){
        if (this._capabilities){
            return this._capabilities
        }
        const capabilities = await this.driver.getCapabilities();
        this._capabilities = capabilities;
        return capabilities;
    }
    takeScreenshot(){
        return this.driver.takeScreenshot();
    }
}

class Element {
    private ownLocator : Locator | null = null;
    private chainedLocators: Locator[] = [];
    private _webDriver: Driver;
    constructor(locator: Locator | Locator[], webDriver: Driver = driver){
        if (Array.isArray(locator)){
            this.chainedLocators.push(...locator);
            this.ownLocator = this.chainedLocators[this.chainedLocators.length - 1];
        } else {
            this.chainedLocators.push(locator);
            this.ownLocator = locator;
        }
        this._webDriver = webDriver;
    }
    get currentLocator(){
        if (this.ownLocator){
            return this.ownLocator;
        }
        throw new TypeError('Locator is null');
    }
    private getSlicedLocators(index: number){
        return this.chainedLocators.slice(0, index + 1);
    }
    private getLocators(index: number){
        return this.chainedLocators;
    }
    async retryGetElement(timeout?: number): Promise<WebElement>{
        const preservedStack = getCleanStack(new Error().stack);
        let currentException ;
        const retryTimeoutCondition = timeoutCondition(timeout);
        while (retryTimeoutCondition()){
            try {
                return await this.getElement();
            } catch (e){
                if(e instanceof InvalidSelectorError) throw e;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async getElement(): Promise<WebElement>{
        let localDriver: ThenableWebDriver | WebElement = this._webDriver.driver;
        for (const [index, locator] of this.chainedLocators.entries()){
            try {
                localDriver = await localDriver.findElement(locator);
            } catch (e) {
                e.message += `\nLocators chain: ${this.getSlicedLocators(index)}`;
                e.getElementError = true;
                throw e;
            }
        }
        return localDriver as WebElement;
    }
    async findElements(locator: Locator){
        try {
            return await (await this.getElement()).findElements(locator);
        } catch (e){
            e.message += `\nLocators chain: ${this.chainedLocators} All: ${locator}`;
            e.getElementError = true;
            throw e;
        }
    }
    async simpleClick(): Promise<void>{
        /*
        * Ordinary click without retries only retries on getting the element
        * */
        return (await this.retryGetElement()).click();
    }
    async click(retryTimeout?: number){
        /*
        * Retries click only enabled element retries if click fails
        * */
        const preservedStack = getCleanStack(new Error().stack);
        let currentException;
        const retryTimeoutCondition = timeoutCondition(retryTimeout);
        while (retryTimeoutCondition()){
            try {
                const webElement = await this.getElement();
                if (await webElement.isEnabled()){
                    await webElement.click();
                    return ;
                }
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async clickTillAttributeEqual(name: string, value: string){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                const webElement = await this.getElement();
                await webElement.click();
                if((await webElement.getAttribute(name)).includes(value)) return ;
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async clickTillElementPresent(element: Element){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                const webElement = await this.getElement();
                await webElement.click();
                if(await element.isPresent()) return ;
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }

    async clickSendKeys(...var_args: Array<string | number | Promise<string | number>>) {
        /*
        * Clicks on an element before text typing due to fix bug:
        * https://bugs.chromium.org/p/chromedriver/issues/detail?id=1771
        * https://github.com/angular/angular/issues/6977
        * */
        const preservedStack = getCleanStack(new Error().stack);
        let currentException: any;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()) {
            try {
                const webElement = await this.getElement();
                if (await webElement.isEnabled()) {
                    await webElement.click();
                    await webElement.sendKeys(...var_args);
                    return;
                }
            } catch (e) {
                if (e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async sendKeys(...var_args: Array<string|number|Promise<string|number>>): Promise<void>{
        return (await this.retryGetElement()).sendKeys(...var_args);
    }
    async clear(): Promise<void>{
        return (await this.retryGetElement()).clear();
    };
    async getText(): Promise<string>{
        return (await this.retryGetElement()).getText();
    }
    async getAttribute(attributeName: string): Promise<string>{
        return (await this.retryGetElement()).getAttribute(attributeName);
    }
    async getSize(): Promise<ISize>{
        return (await this.retryGetElement()).getSize();
    };
    async getRect(): Promise<IRectangle>{
        return (await this.retryGetElement()).getRect();
    };
    async getLocation(): Promise<ILocation>{
        return (await this.retryGetElement()).getLocation();
    };
    async takeScreenshot(opt_scroll?: boolean): Promise<string>{
        return (await this.retryGetElement()).takeScreenshot(opt_scroll);
    };
    async submit(): Promise<void>{
        return (await this.retryGetElement()).submit();
    };
    async isSelected(){
        return (await this.retryGetElement()).isSelected();
    }
    async retryIsDisplayed(){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException: any;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await (await this.getElement()).isDisplayed();
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async retryGetText(){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException: any;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await (await this.getElement()).getText();
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    private async isPresent(): Promise<boolean>{
        try {
            await this.getElement();
            return true;
        } catch (e) {
            if ((e instanceof NoSuchElementError) ||
                (e instanceof StaleElementReferenceError)) {
                return false;
            }
            throw e;
        }
    }
    async waitForVisible(): Promise<void>{
        const preservedStack = getCleanStack(new Error().stack);
        let currentException;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                const webElement = await this.getElement();
                if (await webElement.isDisplayed()){
                    return;
                }
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if (!e.getElementError) e.message += `\nLocators chain: ${this.chainedLocators}`;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async waitForNotPresent(): Promise<void>{
        const preservedStack = getCleanStack(new Error().stack);
        let currentException;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                await this.getElement();
            } catch (e) {
                if(e instanceof InvalidSelectorError) throw e;
                if ((e instanceof NoSuchElementError) ||
                    (e instanceof StaleElementReferenceError)) {
                    return ;
                }
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async expectToBeSelected(failMessage?: string){
        return retryExpect(async ()=>(await this.retryGetElement()).isSelected(), true, {
            message: `${failMessage}\n Expected element to be selected ${this.chainedLocators}`
        })
    }
    async expectToBeUnSelected(failMessage?: string){
        return retryExpect(async ()=>(await this.retryGetElement()).isSelected(), false, {
            message: `${failMessage}\n Expected element to be unselected ${this.chainedLocators}`
        })
    }
    async expectToBePresent(failMessage?: string, timeout?: TimeConstants){
        return retryExpect(async ()=>this.isPresent(), true, {
            message: `${failMessage}\n Expected element to be present ${this.chainedLocators}`, timeout: timeout
        })
    }
    async expectToBeNotPresent(failMessage?: string, timeout?: TimeConstants){
        return retryExpect(async ()=>this.isPresent(), false, {
            message: `${failMessage}\n Expected element not to be present ${this.chainedLocators}`, timeout: timeout
        })
    }
    async expectToBeNotDisplayed(failMessage?: string){
        return retryExpect(async ()=>this.retryIsDisplayed(), false, {
            message: `${failMessage}\n Expected element not to be displayed ${this.chainedLocators}`
        })
    }
    async expectTextToBe(expectedText: string, failMessage?: string){
        return retryExpect(async ()=>this.retryGetText(), expectedText, {
            message: failMessage,
            concatenateMessages: true
        })
    }
    async expectInputValueToBe(expectedText: string, failMessage?: string){
        return retryExpect(async ()=>(await this.retryGetElement()).getAttribute('value'), expectedText, {
            message: failMessage,
            concatenateMessages: true
        })
    }
    $(cssSelector: string): Element{
        return new Element([...this.chainedLocators, By.css(cssSelector)]);
    }
    $$(cssSelector: string){
        return new ChainedElementAll(this, By.css(cssSelector))
    }
    xpathAll(xpath: string){
        return new ChainedElementAll(this, By.xpath(xpath))
    }
    xpath(xpath: string): Element{
        return new Element([...this.chainedLocators, By.xpath(xpath)]);
    }
    element(locator: Locator | Element){
        if (locator instanceof  Element){
            return new Element([...this.chainedLocators, locator.currentLocator]);
        }
        return new Element([...this.chainedLocators, locator]);
    }
    async all(element: Locator | Element): Promise<WebElement[]>{
        if (element instanceof  Element){
            return (await this.retryGetElement()).findElements(element.currentLocator);
        } else {
            return (await this.retryGetElement()).findElements(element);
        }
    }
    async retryFindElements(locator: Locator){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException ;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await (await this.getElement()).findElements(locator);
            } catch (e){
                if(e instanceof InvalidSelectorError) throw e;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
}

class ChainedElementAll {
    private internalElement : Element;
    private locator: Locator;
    constructor(element: Element, locator: Locator) {
        this.internalElement = element;
        this.locator = locator;
    }
    async findElements(){
        return this.internalElement.retryFindElements(this.locator);
    }
    async getSortedElementsTexts(){
        const elementTextList = [];
        for (let webElement of (await this.internalElement.findElements(this.locator))){
            elementTextList.push(await webElement.getText());
        }
        return elementTextList.sort();
    }
    async retryGetSortedElementsTexts(){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException ;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await this.getSortedElementsTexts();
            } catch (e){
                if(e instanceof InvalidSelectorError) throw e;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async expectSortedListToEqual(list: string[], failMessage?: string){
        return retryExpect(async ()=>this.retryGetSortedElementsTexts(), list.sort(), {message: failMessage, concatenateMessages: true})
    }
    async expectElementsCountToBe(expectedCount: number, failMessage?: string){
        return retryExpect(async ()=>(await this.findElements()).length, expectedCount, {message: failMessage, concatenateMessages: true})
    }
}

class ElementAll {
    private ownLocator : Locator;
    constructor(locator: Locator) {
        this.ownLocator = locator;
    }
    async findElements(){
        return driver.driver.findElements(this.ownLocator);
    }
    async getSortedElementsTexts(){
        const elementTextList = [];
        for (let webElement of (await driver.driver.findElements(this.ownLocator))){
            elementTextList.push(await webElement.getText());
        }
        return elementTextList.sort();
    }
    async retryGetSortedElementsTexts(){
        const preservedStack = getCleanStack(new Error().stack);
        let currentException ;
        const retryTimeoutCondition = timeoutCondition();
        while (retryTimeoutCondition()){
            try {
                return await this.getSortedElementsTexts();
            } catch (e){
                if(e instanceof InvalidSelectorError) throw e;
                e.stack = preservedStack;
                currentException = e;
            }
        }
        throw currentException;
    }
    async expectSortedListToBe(list: string[], failMessage?: string){
        return retryExpect(async ()=>this.retryGetSortedElementsTexts(), list.sort(), {message: failMessage, concatenateMessages: true})
    }
}

function $(cssSelector: string){
    return new Element(By.css(cssSelector))
}
function xpath(xpath: string){
    return new Element(By.xpath(xpath))
}
function element(locator: Locator){
    return  new Element(locator);
}
function $$(cssSelector: string){
    return new ElementAll(By.css(cssSelector));
}
function xx(xpath: string){
    return new ElementAll(By.css(xpath));
}

const driver = new Driver();
export {
    driver,
    $,
    $$,
    xpath,
    xx,
    element,
    Element,
    ChainedElementAll,
    ElementAll
}