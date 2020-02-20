enum BrowsersAliases {
    chrome = "chrome",
    firefox = "firefox",
    edge = "edge",
    ie = "ie",
    safari = "safari"
}

type capabilities = {
    readonly [key in BrowsersAliases]: {
            browserName: string;
            [key: string]: any;
    }
}

const capabilities: capabilities = {
    chrome: {
        browserName: "chrome",
        acceptInsecureCerts: true
    },
    firefox: {
        browserName: "firefox",
        acceptInsecureCerts: true
    },
    edge: {
        browserName: "MicrosoftEdge"
    },
    ie: {
        browserName: "internet explorer"
    },
    safari: {
        browserName: "safari"
    }
};

export {
    capabilities,
    BrowsersAliases
}


