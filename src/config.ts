import parse from 'yargs-parser';
import config from 'config';
import {BrowsersAliases} from "./driversCapabilities";

export class Config {
    static get browser():BrowsersAliases {
        const argv = parse(process.argv.slice(2));
        if (!argv.browser && !config.has('browser')){
            console.error(`Browser name dos not set please add: NODE_CONFIG={"browser":[chrome | firefox | ...]} as env param or --browser=[chrome | firefox | ...] for npm -- --browser=`);
            process.exit(1);
        }
        const browser = argv.browser || config.get<string>('browser');
        if (!(browser in BrowsersAliases)){
            console.error(`Browser name is incorrect please use one of these:`, BrowsersAliases);
            process.exit(1);
        }
        return browser as BrowsersAliases;
    }
    static get browsers():BrowsersAliases[]{
        if (!config.has('browsers')){
            console.error(`Browsers dos not set please add: NODE_CONFIG={"browsers":[chrome, firefox, ...]} as env param`);
            process.exit(1);
        }
        const browsers: string[] = config.get<string[]>('browsers');
        browsers.forEach(browser =>{
            if (!(browser in BrowsersAliases)){
                console.error(`Browser name is incorrect please use these values:`, BrowsersAliases);
                process.exit(1);
            }
        });
        return browsers as BrowsersAliases[];
    }
    static get directConnect(): boolean{
        if (!config.has('directConnect')){
            return false;
        }
        return config.get<boolean>('directConnect');
    }
    static get seleniumHubUrl(): string{
        if (Config.directConnect){
            return ''
        }
        return config.get<string>('seleniumHubUrl');
    }
    static get webDriverProxy(){
        if (!config.has('webDriverProxy')){
            return '';
        }
        return config.get<string>('webDriverProxy');
    }
}

