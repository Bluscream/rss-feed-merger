const PORT = process.env.PORT || 80;
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
    // console.log(msg);
    // if (process.env.DEBUG) {
    //     debug(msg);
    // }
}
function strip(value) {
    return value?.toString()?.trim()?? null;
}

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req, res) => {
    function get(key, defaultValue = null) {
        return req.query[key]!== undefined? req.query[key] : defaultValue;
    }
    let combinedFeed = {
        // $: { xmlns: 'http://www.w3.org/2005/Atom' },
        // xml: {encoding: "UTF-8"}
        entry: []
    };
    const param_noformat = get('format', false);
    const builder = new Builder({explicitRoot: true, rootName: "feed", renderOpts: { pretty: !param_noformat, indent: ' ', newline: '\n' }});
    try {
        log('Combining Atom feeds...');
        res.setHeader('Content-Type', 'application/xml');
        const reqUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
        log(`Request Url is ${reqUrl}`);
        const param_urls = req.query.urls.split(',');
        log(`Got ${param_urls.length} urls: ${param_urls.join()}`)
        const param_mode = req.query.mode || 'single'; // Default to 'single' if not specified
        log(`Mode: ${param_mode} | Format: ${param_noformat}`);
        const param_title = req.query.title || `${param_urls.length} Atom Feeds`;
        const param_subtitle = req.query.subtitle || `A combination of ${param_urls.length} Atom feeds`;
        log(`Title: ${param_title} | Subtitle: ${param_subtitle}`);

        if (param_mode === 'single') {
            combinedFeed.title = [param_title]; // Flattening the title array to a string
            combinedFeed.subtitle = [param_subtitle]; // Flattening the subtitle array to a string
            combinedFeed.link = [{
                $: {
                    href: reqUrl,
                    rel: ["self"],
                    type: "application/atom+xml"
                }
            }];
            combinedFeed.updated = [new Date().toISOString()]; // Flattening the updated array to a string
        }

        log(combinedFeed);

        for (const url of param_urls) {
            log(`Fetching ${url}...`);
            const cachedData = await fetchAndCache(url);
            const parsedResponse = await parseStringPromise(cachedData, {explicitRoot: true/*=feed*/, valueProcessors: [strip]});
            const feed = parsedResponse.feed; // err
            if (feed) {
                const feedEntries = feed.entry;
                if (param_mode === 'single') {
                    if (feedEntries && feedEntries.length > 0) {
                        combinedFeed.link.push({
                            $: {
                                href: url,
                                rel: ["source"],
                                type: "application/atom+xml"
                            }
                        });
                        for (const entry of feedEntries) {
                            if (entry.title) entry.title = entry.title.toString().trim();
                            log(entry);
                            if (entry.summary) {
                                log(entry.summary)
                            } // entry.summary[0]._ = entry.summary[0]._.toString().trim();
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
            summary: error.stack
        });
        const xmlString = builder.buildObject(combinedFeed);
        res.status(500).send(xmlString);
        // throw (error);
    }
});

app.listen(PORT, () => {
    log(`Atom Combiner listening at http://*:${PORT}`);
});
