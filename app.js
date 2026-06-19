document.addEventListener('DOMContentLoaded', () => {
    // Configurable API base for Option B (set window.API_BASE in index.html or leave empty for same-origin)
    const API_BASE = window.API_BASE || '';
    function api(path) { return API_BASE ? (API_BASE.replace(/\/$/, '') + path) : path; }

    const homeView = document.getElementById('home-view');
    const playerView = document.getElementById('player-view');
    const loadingOverlay = document.getElementById('loading-overlay');
    const nowPlayingText = document.getElementById('now-playing');

    let localLibrary = [];
    let allEpisodes = [];

    init();

    async function init() {
        showLoading();
        await fetchLocalLibrary();
        await Promise.all([
            fetchAndRender('/api/trending', 'trending-grid', true),
            fetchAndRender('/api/popular', 'popular-grid', false)
        ]);
        hideLoading();
    }

    // ── Navigation ──
    document.getElementById('home-btn').addEventListener('click', (e) => {
        e.preventDefault();
        location.reload();
    });

    document.getElementById('search-btn').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
    });

    async function doSearch() {
        const q = document.getElementById('search-input').value.trim();
        if (!q) return;
        showLoading();
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            renderGrid(data, 'trending-grid');
            document.querySelector('.section-title').textContent = `Search Results: "${q}"`;
            document.getElementById('popular-grid').parentElement.style.display = 'none';
            document.getElementById('hero-section').style.display = 'none';
        } catch (e) {
            console.error('Search error:', e);
        }
        hideLoading();
    }

    // ── Data fetching ──
    async function fetchAndRender(url, gridId, isHero) {
        try {
            const res = await fetch(api(url));
            if (!res.ok) throw new Error('Fetch failed');
            const data = await res.json();
            if (data && data.length > 0) {
                if (isHero) renderHero(data[0]);
                renderGrid(isHero ? data.slice(1) : data, gridId);
            }
        } catch (e) {
            console.error(e);
            document.getElementById(gridId).innerHTML = '<p style="color:#a1a2a8;padding:1rem">Failed to load.</p>';
        }
    }

    async function fetchLocalLibrary() {
        try {
            const res = await fetch(api('/api/library'));
            if (res.ok) localLibrary = await res.json();
        } catch (e) { localLibrary = []; }
    }

    // ── Rendering ──
    function getTitle(anime) {
        if (!anime.title) return 'Unknown';
        if (typeof anime.title === 'string') return anime.title;
        return anime.title.english || anime.title.romaji || anime.title.userPreferred || anime.title.native || 'Unknown';
    }

    function renderHero(anime) {
        const bgUrl = anime.cover || anime.image || '';
        document.getElementById('hero-bg').style.backgroundImage = `url('${bgUrl}')`;
        const title = getTitle(anime);
        document.getElementById('hero-title').textContent = title;

        let metaHtml = '';
        if (anime.rating) metaHtml += `<span class="rating">★ ${(anime.rating / 10).toFixed(1)}</span>`;
        if (anime.releaseDate) metaHtml += `<span>${anime.releaseDate}</span>`;
        if (anime.type) metaHtml += `<span>${anime.type}</span>`;
        if (anime.genres && anime.genres.length > 0) metaHtml += `<span>${anime.genres.slice(0, 3).join(' · ')}</span>`;
        document.getElementById('hero-meta').innerHTML = metaHtml;

        const desc = anime.description ? anime.description.replace(/<[^>]*>?/gm, '').substring(0, 250) : '';
        document.getElementById('hero-synopsis').textContent = desc ? desc + '...' : '';

        document.getElementById('hero-watch-btn').onclick = () => openPlayer(anime.id);
        document.getElementById('hero-details-btn').onclick = () => openPlayer(anime.id);
    }

    function renderGrid(animeList, gridId) {
        const grid = document.getElementById(gridId);
        grid.innerHTML = '';
        if (!animeList || animeList.length === 0) {
            grid.innerHTML = '<p style="color:#a1a2a8;padding:1rem">No results found.</p>';
            return;
        }

        animeList.forEach(anime => {
            const card = document.createElement('div');
            card.className = 'anime-card';
            const title = getTitle(anime);
            const type = anime.type || 'TV';
            const year = anime.releaseDate || '';

            card.innerHTML = `
                <div class="img-wrapper">
                    <img src="${anime.image || ''}" alt="${title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22300%22><rect fill=%22%23141519%22 width=%22200%22 height=%22300%22/><text fill=%22%23555%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22>No Image</text></svg>'">
                    <div class="card-overlay">
                        <div class="card-play-btn">▶</div>
                    </div>
                </div>
                <div class="card-info">
                    <h3>${title}</h3>
                    <div class="meta"><span>${type}</span><span>${year}</span></div>
                </div>
            `;
            card.onclick = () => openPlayer(anime.id);
            grid.appendChild(card);
        });
    }

    // ── Player ──
    async function openPlayer(id) {
        showLoading();
        try {
            const res = await fetch(api(`/api/info/${encodeURIComponent(id)}`));
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            currentAnimeId = data.id;

            homeView.classList.replace('view-active', 'view-hidden');
            playerView.classList.replace('view-hidden', 'view-active');
            window.scrollTo({ top: 0, behavior: 'smooth' });

            const title = getTitle(data);
            document.getElementById('details-title').textContent = title;
            document.getElementById('details-poster').src = data.image || '';
            document.getElementById('details-status').textContent = data.status || 'Unknown';
            document.getElementById('details-rating').textContent = data.rating ? `★ ${(data.rating / 10).toFixed(1)}` : 'N/A';
            document.getElementById('details-desc').textContent = data.description ? data.description.replace(/<[^>]*>?/gm, '') : 'No description available.';

            allEpisodes = data.episodes || [];
            renderEpisodes(allEpisodes, title);

            nowPlayingText.textContent = allEpisodes.length > 0 ? 'Select an episode to start watching.' : 'No episodes available.';
            
            const iframePlayer = document.getElementById('iframe-player');
            if (iframePlayer) {
                iframePlayer.src = '';
                iframePlayer.classList.add('hidden');
            }
        } catch (e) {
            console.error('openPlayer error:', e);
            alert('Error loading anime details: ' + e.message);
        }
        hideLoading();
    }

    function renderEpisodes(episodes, animeTitle) {
        const list = document.getElementById('episodes-list');
        list.innerHTML = '';

        if (!episodes || episodes.length === 0) {
            list.innerHTML = '<li style="padding:1rem;color:#a1a2a8">No episodes found.</li>';
            return;
        }

        episodes.forEach(ep => {
            const li = document.createElement('li');
            li.className = 'ep-item';
            li.innerHTML = `
                <span>EP ${ep.number} — ${ep.title || 'Episode ' + ep.number}</span>
            `;
            li.onclick = () => {
                document.querySelectorAll('.ep-item').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
                playEpisode(ep.number, animeTitle, currentAnimeId);
            };
            list.appendChild(li);
        });
    }

    document.getElementById('episode-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = allEpisodes.filter(ep =>
            ep.number.toString().includes(q) ||
            (ep.title && ep.title.toLowerCase().includes(q))
        );
        renderEpisodes(filtered, document.getElementById('details-title').textContent);
    });

    // Track current state to handle server switching
    let currentAnimeId = null;
    let currentEpNumber = null;
    let currentAnimeTitle = null;

    // Handle Server Button Clicks
    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active state in the same group
            e.target.parentElement.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
            // Also remove active from the other group to keep only 1 active globally
            document.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // If an episode is already playing, switch the server immediately
            if (currentEpNumber !== null && currentAnimeId !== null) {
                playEpisode(currentEpNumber, currentAnimeTitle, currentAnimeId);
            }
        });
    });

    function getSelectedServer() {
        const activeBtn = document.querySelector('.server-btn.active');
        return activeBtn ? activeBtn.dataset.server : 'sub1';
    }

    async function playEpisode(epNumber, animeTitle, animeId) {
        currentEpNumber = epNumber;
        currentAnimeTitle = animeTitle;
        currentAnimeId = animeId;

        const serverId = getSelectedServer();
        nowPlayingText.textContent = `Loading Episode ${epNumber}...`;
        window.scrollTo({ top: 0, behavior: 'smooth' });

        showLoading();
        let tmdb_id = null;
        let imdb_id = null;
        try {
            const mapRes = await fetch(api(`/api/mapping/${animeId}`));
            const mapData = await mapRes.json();
            tmdb_id = mapData.tmdb_id;
            imdb_id = mapData.imdb_id;
        } catch(e) { console.error('Mapping fetch failed'); }
        hideLoading();

        let iframeUrl = '';
        const slug = animeTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Route mapping for 6 servers using TMDB ID when available
        switch(serverId) {
            case 'sub1':
                // VidSrc.cc (Uses AniList natively - Excellent for Subs)
                iframeUrl = `https://megaplay.buzz/stream/ani/${animeId}/${epNumber}/sub`;
                break;
            case 'sub2':
                // VidSrc.me (Requires TMDB)
                iframeUrl = `https://vidnest.fun/anime/${animeId}/${epNumber}/sub`;
                break;
            case 'sub3':
                // VidSrc.to (Requires AniList)
                iframeUrl = `https://tryembed.us.cc/embed/anime/${animeId}/${epNumber}/sub`;
                break;
            case 'dub1':
                // VidLink (Requires TMDB)
                iframeUrl = tmdb_id ? `https://vidlink.pro/tv/${tmdb_id}/1/${epNumber}` : `https://vidlink.pro/anime/${animeId}/${epNumber}`;
                break;
            case 'dub2':
                // VidSrc.me (Dub version)
                iframeUrl = tmdb_id ? `https://vidsrc.me/embed/tv?tmdb=${tmdb_id}&season=1&episode=${epNumber}` : `https://vidsrc.to/embed/anime/${animeId}/${epNumber}`;
                break;
            case 'dub3':
                // 2Embed (Requires TMDB)
                iframeUrl =  `https://megaplay.buzz/stream/ani/${animeId}/${epNumber}/dub`;
                break;
            default:
                iframeUrl = `https://vidsrc.cc/v2/embed/anime/${animeId}/${epNumber}`;
        }

        const activeBtnName = document.querySelector('.server-btn.active').textContent;
        loadIframe(iframeUrl, `Episode ${epNumber} (${activeBtnName})`);
    }

    function loadIframe(url, displayText) {
        nowPlayingText.textContent = `Playing: ${displayText}`;
        const iframePlayer = document.getElementById('iframe-player');
        iframePlayer.src = url;
        iframePlayer.classList.remove('hidden');
    }

    function showLoading() { loadingOverlay.classList.remove('hidden'); }
    function hideLoading() { loadingOverlay.classList.add('hidden'); }
});
