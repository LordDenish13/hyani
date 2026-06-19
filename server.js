const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

// ── AnimeSaturn streaming provider (consumet) ──
let saturn = null;
try {
    const consumet = require('@consumet/extensions');
    saturn = new consumet.ANIME.AnimeSaturn();
    console.log('AnimeSaturn streaming provider loaded');
} catch (e) {
    console.log('AnimeSaturn provider unavailable:', e.message);
}

// ── AniList GraphQL helper ──
const ANILIST_URL = 'https://graphql.anilist.co';

async function anilistQuery(query, variables = {}) {
    const res = await fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables }),
        timeout: 12000
    });
    if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data;
}

const MEDIA_FIELDS = `
    id
    title { romaji english native userPreferred }
    coverImage { extraLarge large medium }
    bannerImage
    description(asHtml: false)
    status
    episodes
    nextAiringEpisode { episode }
    seasonYear
    averageScore
    genres
    type
    format
    season
`;

function formatAnime(media) {
    let epCount = media.episodes;
    if (!epCount && media.nextAiringEpisode?.episode) {
        epCount = media.nextAiringEpisode.episode - 1;
    }
    return {
        id: String(media.id),
        title: media.title,
        image: media.coverImage?.extraLarge || media.coverImage?.large || '',
        cover: media.bannerImage || media.coverImage?.extraLarge || '',
        description: media.description || '',
        status: media.status || 'Unknown',
        rating: media.averageScore || null,
        releaseDate: media.seasonYear ? String(media.seasonYear) : '',
        type: media.format || media.type || 'TV',
        genres: media.genres || [],
        totalEpisodes: epCount || null
    };
}

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// Cache: AniList ID -> AnimeSaturn episodes mapping
const saturnCache = new Map();

// Search AnimeSaturn by title, return episodes array
async function getSaturnEpisodes(anilistTitle, anilistId) {
    if (saturnCache.has(anilistId)) return saturnCache.get(anilistId);
    if (!saturn) return null;

    const titles = [anilistTitle.english, anilistTitle.romaji, anilistTitle.userPreferred, anilistTitle.native].filter(Boolean);
    
    for (const title of titles) {
        try {
            const searchResult = await withTimeout(saturn.search(title), 10000);
            const results = searchResult.results || searchResult || [];
            if (results.length === 0) continue;

            // Try to find best match
            const normalise = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const normTitle = normalise(title);
            let best = results.find(r => normalise(r.title) === normTitle) || results[0];

            const info = await withTimeout(saturn.fetchAnimeInfo(best.id), 12000);
            if (info && info.episodes && info.episodes.length > 0) {
                saturnCache.set(anilistId, info.episodes);
                console.log(`Mapped "${title}" -> AnimeSaturn "${best.title}" (${info.episodes.length} eps)`);
                return info.episodes;
            }
        } catch (e) {
            console.log(`Saturn search failed for "${title}":`, e.message);
        }
    }
    saturnCache.set(anilistId, null);
    return null;
}

// ── Local library logic removed as requested ──

// ── API Routes ──

app.get('/api/trending', async (req, res) => {
    try {
        const data = await anilistQuery(`{
            Page(page:1, perPage:20) {
                media(type:ANIME, sort:TRENDING_DESC, isAdult:false) { ${MEDIA_FIELDS} }
            }
        }`);
        res.json((data.Page.media || []).map(formatAnime));
    } catch (e) {
        console.error('Trending error:', e.message);
        res.json([]);
    }
});

app.get('/api/popular', async (req, res) => {
    try {
        const data = await anilistQuery(`{
            Page(page:1, perPage:20) {
                media(type:ANIME, sort:POPULARITY_DESC, isAdult:false) { ${MEDIA_FIELDS} }
            }
        }`);
        res.json((data.Page.media || []).map(formatAnime));
    } catch (e) {
        console.error('Popular error:', e.message);
        res.json([]);
    }
});

app.get('/api/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const data = await anilistQuery(`
            query($search:String) {
                Page(page:1, perPage:30) {
                    media(type:ANIME, search:$search, isAdult:false, sort:SEARCH_MATCH) { ${MEDIA_FIELDS} }
                }
            }
        `, { search: q });
        res.json((data.Page.media || []).map(formatAnime));
    } catch (e) {
        console.error('Search error:', e.message);
        res.json([]);
    }
});

app.get('/api/info/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid anime ID' });
    try {
        const data = await anilistQuery(`
            query($id:Int) {
                Media(id:$id, type:ANIME) { ${MEDIA_FIELDS} }
            }
        `, { id });
        const anime = formatAnime(data.Media);

        // Try to get real episodes from AnimeSaturn
        const saturnEps = await getSaturnEpisodes(data.Media.title, anime.id);
        if (saturnEps && saturnEps.length > 0) {
            anime.episodes = saturnEps.map((ep, i) => ({
                id: ep.id,  // AnimeSaturn episode ID for streaming
                number: ep.number || i + 1,
                title: ep.title || `Episode ${ep.number || i + 1}`
            }));
        } else {
            // Fallback: generate placeholder episodes from AniList count
            const count = anime.totalEpisodes || 0;
            anime.episodes = [];
            for (let i = 1; i <= count; i++) {
                anime.episodes.push({ id: `${anime.id}-ep-${i}`, number: i, title: `Episode ${i}` });
            }
        }
        res.json(anime);
    } catch (e) {
        console.error('Info error:', e.message);
        res.status(500).json({ error: 'Failed to fetch anime info' });
    }
});

let fribbMappingCache = null;

app.get('/api/mapping/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        if (!fribbMappingCache) {
            const resp = await fetch('https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json');
            fribbMappingCache = await resp.json();
        }
        const mapping = fribbMappingCache.find(x => x.anilist_id === id);
        if (mapping) {
            return res.json({
                tmdb_id: mapping.themoviedb_id?.tv || mapping.themoviedb_id?.movie || null,
                imdb_id: mapping.imdb_id ? mapping.imdb_id[0] : null
            });
        }
        res.json({ tmdb_id: null, imdb_id: null });
    } catch (e) {
        console.error('Mapping error:', e.message);
        res.json({ tmdb_id: null, imdb_id: null });
    }
});

app.get('/api/gogo-proxy/:slug/:type/:episode', async (req, res) => {
    try {
        const { slug, type, episode } = req.params;
        const gogoSlug = type === 'dub' ? `${slug}-dub-episode-${episode}` : `${slug}-episode-${episode}`;
        const embedUrl = `https://embtaku.pro/embed/${gogoSlug}`;
        
        let r = await fetch(embedUrl);
        let html = await r.text();
        
        const redirectMatch = html.match(/window\.location\.replace\(['"](.*?)['"]/);
        if (redirectMatch) {
            r = await fetch(redirectMatch[1]);
            html = await r.text();
        }
        
        html = html.replace('<head>', '<head><base href="https://embtaku.pro/">');
        html = html.replace(/window\.top\.location/g, 'window.self.location');
        html = html.replace(/window\.parent/g, 'window.self');
        html = html.replace(/top\.location/g, 'self.location');
        
        res.send(html);
    } catch (e) {
        console.error(e);
        res.status(500).send('Proxy error');
    }
});

app.get('/api/stream/:episodeId', async (req, res) => {
    const episodeId = decodeURIComponent(req.params.episodeId);

    // Local files: format is "animeName::fileName"
    if (episodeId.includes('::')) {
        const [animeEnc, fileEnc] = episodeId.split('::');
        return res.json({ streamUrl: `/videos/${animeEnc}/${fileEnc}` });
    }

    // Placeholder episode IDs (no streaming available)
    if (/^\d+-ep-\d+$/.test(episodeId)) {
        return res.status(404).json({ error: 'No streaming source found for this anime. Try searching for it — some titles map better than others.' });
    }

    // AnimeSaturn streaming
    if (saturn) {
        try {
            const sources = await withTimeout(saturn.fetchEpisodeSources(episodeId), 15000);
            const list = sources?.sources || sources || [];
            // Pick best quality
            const best = list.find(s => s.quality === 'default' || s.quality === 'auto')
                || list.find(s => /1080|720/.test(s.quality))
                || list[0];
            if (best && (best.url || best.file || best.src)) {
                return res.json({
                    streamUrl: best.url || best.file || best.src,
                    headers: sources.headers || null
                });
            }
        } catch (e) {
            console.error('Stream error:', e.message);
        }
    }

    res.status(404).json({ error: 'Stream not found' });
});

// Proxy for streams that require custom headers (e.g. AnimeSaturn Referer)
app.get('/api/proxy', async (req, res) => {
    const url = req.query.url;
    const referer = req.query.referer || '';
    if (!url) return res.status(400).send('Missing url');

    try {
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
        if (referer) headers['Referer'] = referer;
        const upstream = await fetch(url, { headers, timeout: 30000 });
        if (!upstream.ok) return res.status(upstream.status).send('Upstream error');

        const ct = upstream.headers.get('content-type') || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (ct) res.setHeader('Content-Type', ct);

        // If it's an m3u8 playlist, we must rewrite the URIs inside it to also go through the proxy
        if (ct.includes('mpegurl') || url.includes('.m3u8')) {
            const text = await upstream.text();
            const rewritten = text.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return line; // Leave directives alone
                // Resolve relative URLs
                try {
                    const absoluteUrl = new URL(trimmed, url).href;
                    return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
                } catch(e) {
                    return line;
                }
            }).join('\n');
            return res.send(rewritten);
        }

        // Otherwise, pipe the binary stream directly
        upstream.body.pipe(res);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(502).send('Proxy error');
    }
});

// ── Start ──
const server = app.listen(PORT, '0.0.0.0', () => {
    const addr = server.address();
    console.log(`hyani server running at http://localhost:${addr.port}`);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (r) => console.error('Unhandled:', r));
