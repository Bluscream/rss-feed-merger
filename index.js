const cacheTTL = 10 * 60 * 1000; // 10 minutes
const cachePath = '.cache';

const express = require('express');
const axios = require('axios');
const { parseStringPromise, Builder } = require('xml2js');
// const debug = require('debug')('atom-combiner');
const crypto = require('crypto');
// const util = require('util')
const cacheManager = require('cache-manager');
const { DiskStore } = require('cache-manager-fs-hash');
const diskCache = cacheManager.createCache(new DiskStore({
    path: cachePath,
    ttl: cacheTTL,
    zip: true,
}));
async function fetchAndCache(url) {
    const key = crypto.createHash('md5').update(url).digest('hex');
    const cachedData = await diskCache.get(key);
    if (!cachedData) {
        const response = await axios.get(url);
        diskCache.set(key, response.data, { ttl: cacheTTL }); // Store in cache with TTL
        return response.data;
    }
    return cachedData;
}
function log(msg) {
    console.log(msg);
    // if (process.env.DEBUG) {
    //     debug(msg);
    // }
}
function strip(value) {
    return value?.toString()?.trim() ?? null;
}
function decode(value) {
    return decodeURI(value);
}
var getText = function (elt) {
    if (typeof (elt) === 'string') return elt;
    if (typeof (elt) === 'object' && elt.hasOwnProperty('_')) return elt._;
    return ''; // or whatever makes sense for your case
}
function isBaseURL(urlString) {
    try {
      const urlObj = new URL(urlString);
      // Check if the URL has a pathname and if it matches '/'
      // Also, ensure there are no query parameters
      return urlObj.pathname === '/' && urlObj.search === '';
    } catch (error) {
      console.error(`Invalid URL: ${urlString}`);
      return false; // Return false if the URL is invalid
    }
}

const app = express();
const port = process.env.PORT || 9988;
app.use(express.urlencoded({ extended: true }));
app.set('views', './views'); // Set the views directory
app.set('view engine', 'pug'); // Set Pug as the view engine

app.get('/', async (req, res) => {
    function get_key(key, defaultValue = null) {
        return req.query[key] !== undefined ? req.query[key] : defaultValue;
    }
    const reqUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    log(`Request Url is ${reqUrl}`);
    if (isBaseURL(reqUrl)) {
        log("Requested generatorPage")
        res.render('generatorPage');
        return;
    }
    // const reqUrlHash = crypto.createHash('md5').update(reqUrl).digest('hex');
    const selfLink = [{
        $: {
            href: reqUrl,
            rel: ["self"],
            type: "application/atom+xml"
        }
    }];
    let param_urls = get_key("urls");
    if (param_urls) {
        // Split the string into an array of URLs
        param_urls = param_urls.split(',');
    
        // Decode each URL in the array and create a new array with the decoded URLs
        param_urls = param_urls.map(url => {
            try {
                // Attempt to decode the URL
                const decodedUrl = decode(url);
                console.log(`Decoding URL: ${url} -> Decoded URL: ${decodedUrl}`);
                return decodedUrl; // Return the decoded URL
            } catch (error) {
                // Log any errors that occur during decoding
                console.error(`Error decoding URL: ${url}`, error);
                return url; // Return the original URL if decoding fails
            }
        });
    
        // Update the original param_urls variable with the decoded URLs
        // param_urls = param_urls.join(','); // Join the array back into a comma-separated string
    } else {
        return;
    }
    
    log(`Got ${param_urls.length} urls: ${param_urls}`);
    const param_title = get_key("title", `${param_urls.length} RSS Feeds`);
    const param_subtitle = get_key("subtitle", `A combination of ${param_urls.length} feeds`);
    log(`Title: ${param_title} | Subtitle: ${param_subtitle}`);
    let combinedFeed = {
        $: { xmlns: 'http://www.w3.org/2005/Atom', "xmlns:media": "http://search.yahoo.com/mrss/", "xml:lang": "en-US" },
        // xml: {encoding: "UTF-8"},
        link: selfLink,
        // "atom:link": selfLink,
        updated: new Date().toISOString(),
        title: param_title,
        subtitle: param_subtitle,
        id: reqUrl,
        entry: []
    };
    const param_noformat = get_key('format', false);
    const param_fixtitles = get_key('fixtitles', false);
    const builder = new Builder({ explicitRoot: true, rootName: "feed", renderOpts: { pretty: !param_noformat, indent: ' ', newline: '\n' } });
    let lastUrl = "";
    try {
        log('Combining Atom feeds...');
        res.setHeader('Content-Type', 'application/xml');
        const param_mode = get_key('mode', 'single');
        log(`Mode: ${param_mode} | Format: ${!param_noformat}`);

        if (param_mode === 'single') {
        }

        // log(combinedFeed);
        for (const url of param_urls) {
            try {
                log(`Fetching ${url}...`);
                lastUrl = url;
                const cachedData = await fetchAndCache(url);
                const parsedResponse = await parseStringPromise(cachedData, { explicitRoot: true/*=feed*/, valueProcessors: [strip] });
                const feed = parsedResponse.feed; // err
                if (feed) {
                    // if (feed.hasOwnProperty("id")) combinedFeed.id = feed.id;
                    let feedUrl, feedBaseUrl;
                    if (feed.link && feed.link.length > 0) {
                        feedUrl = new URL(feed.link[0].$.href);
                        feedBaseUrl = `${feedUrl.protocol}//${feedUrl.hostname}`;
                    }
                    const feedEntries = feed.entry;
                    if (param_mode === 'single') {
                        if (feedEntries && feedEntries.length > 0) {
                            combinedFeed.link.push({
                                $: {
                                    href: url,
                                    rel: ["related"],
                                    type: "application/atom+xml"
                                }
                            });
                            for (const entry of feedEntries) {
                                if (entry.title && param_fixtitles) {
                                    let title = entry.title;
                                    if (Array.isArray(title) && title.length > 0) {
                                        log(`entry.title ${title} is array!`);
                                        // title = title.join(', ');
                                    }
                                    title = entry.title.toString().trim();
                                    log(`entry.title ${title}`);
                                    entry.title = title;
                                }
                                if (entry.hasOwnProperty("author")) {
                                    if (entry.author.hasOwnProperty("name")) {
                                        const txt = getText(entry.author.name);
                                        if (txt && txt == "") entry.author.name = "Unknown";
                                    }
                                }
                                if (entry.hasOwnProperty("summary")) {
                                    const txt = getText(entry.summary);
                                    if (txt && txt.strip() == "") entry.summary = "empty";
                                }
                                if (feed.title) entry["feed:title"] = feed.title;
                                if (feed.link) {
                                    entry["feed:site"] = feedUrl.hostname;
                                    entry["feed:base"] = feedBaseUrl;
                                    entry["feed:icon"] = `https://www.google.com/s2/favicons?domain=${feedBaseUrl}&sz=256`;
                                }
                                combinedFeed.entry.push(entry);
                            }
                        } else {
                            log(`No <entry> elements in ${feed.title}`);
                        }
                    } else {
                        throw ("mode not supported!");
                    }
                } else {
                    log(`No <feed> elements in ${url}`);
                }
            } catch (error) {
                const err = error.toString();
                log(error);
                combinedFeed.error = [err];
                combinedFeed.entry.push({
                    title: err,
                    summary: error.stack,
                    url: lastUrl
                });
            }
        }

        const xmlString = builder.buildObject(combinedFeed);
        log('Combined Atom feed ready to serve...');
        res.send(xmlString);
    } catch (error) {
        const err = error.toString();
        log(error);
        combinedFeed.error = [err];
        combinedFeed.entry.push({
            title: err,
            summary: error.stack,
            url: lastUrl
        });
        const xmlString = builder.buildObject(combinedFeed);
        res.status(500).send(xmlString);
        // throw (error);
    }
});

app.listen(port, () => {
    log(`Atom Combiner listening at http://*:${port}`);
});
