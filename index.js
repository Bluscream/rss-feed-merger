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
var getText = function (elt) {
    if (typeof (elt) === 'string') return elt;
    if (typeof (elt) === 'object' && elt.hasOwnProperty('_')) return elt._;
    return ''; // or whatever makes sense for your case
}

const app = express();
const port = process.env.PORT || 9988;
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req, res) => {
    function get_key(key, defaultValue = null) {
        return req.query[key] !== undefined ? req.query[key] : defaultValue;
    }
    const reqUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    if (reqUrl === "http://rssmerge.onrender.com/") return;
    log(`Request Url is ${reqUrl}`);
    // const reqUrlHash = crypto.createHash('md5').update(reqUrl).digest('hex');
    const selfLink = [{
        $: {
            href: reqUrl,
            rel: ["self"],
            type: "application/atom+xml"
        }
    }];
    let param_urls = get_key("urls");
    if (param_urls) param_urls = param_urls.split(',');
    else return;
    log(`Got ${param_urls.length} urls: ${param_urls.join()}`)
    const param_title = get_key("title", `${param_urls.length} Atom Feeds`);
    const param_subtitle = get_key("subtitle", `A combination of ${param_urls.length} Atom feeds`);
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
                                if (entry.title) entry.title = entry.title.toString().trim();
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
