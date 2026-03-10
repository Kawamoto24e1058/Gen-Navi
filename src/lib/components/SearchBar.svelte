<script>
    import { Search, Mic, MapPin, Loader2 } from 'lucide-svelte';
    import { onMount } from 'svelte';

    let { onSelect, onFocus, onBlur, lat = null, lon = null, isLoadingLocation = true } = $props();

    let query = $state('');
    let results = $state([]);
    let isSearching = $state(false);
    let showDropdown = $state(false);
    let debounceTimer;

    async function searchPlaces(q) {
        if (!q || q.length < 2) {
            results = [];
            return;
        }

        // Debug: Check if coordinates are arriving correctly
        console.log('Current Search Location:', lat, lon);

        if (isLoadingLocation || lat === null || lon === null) {
            console.warn('Search blocked: User location not available.');
            return;
        }

        isSearching = true;
        try {
            // Fetch from internal SvelteKit API proxy to avoid CORS
            const url = `/api/places/autocomplete?input=${encodeURIComponent(q)}&lat=${lat}&lon=${lon}`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Proxy error: ${response.status}`);
            }
            const data = await response.json();
            results = data.predictions || [];
        } catch (error) {
            console.error('Search error:', error);
            results = [];
        } finally {
            isSearching = false;
        }
    }

    function handleInput(e) {
        query = e.target.value;
        clearTimeout(debounceTimer);
        
        if (query) {
            showDropdown = true;
            if (isLoadingLocation) {
                // If location is missing, we don't even trigger the debounce search
                results = [];
                return;
            }
            debounceTimer = setTimeout(() => {
                searchPlaces(query);
            }, 300);
        } else {
            showDropdown = false;
            results = [];
        }
    }

    async function selectResult(item) {
        query = item.structured_formatting.main_text;
        showDropdown = false;
        
        isSearching = true;
        try {
            // Get coordinates from internal Details proxy
            const detailsUrl = `/api/places/details?place_id=${item.place_id}`;
            const response = await fetch(detailsUrl);
            const data = await response.json();
            
            if (data.status === 'OK' && data.result.geometry) {
                const location = data.result.geometry.location;
                // Transition to overview via parent handler
                onSelect({
                    lat: location.lat,
                    lon: location.lng,
                    display_name: item.description
                });
            } else {
                throw new Error('Could not retrieve place details');
            }
        } catch (error) {
            console.error('Details error:', error);
            alert('場所の詳細を取得できませんでした。');
        } finally {
            isSearching = false;
        }
    }
</script>

<div class="search-container">
    <div class="search-bar">
        {#if isSearching}
            <Loader2 size={20} class="icon animate-spin" />
        {:else}
            <Search size={20} class="icon" />
        {/if}
        
        <input 
            type="text" 
            placeholder={!isLoadingLocation ? "目的地を検索（例: コンビニ）" : "現在地を取得中..."} 
            bind:value={query}
            oninput={handleInput}
            onfocus={onFocus}
            onblur={() => setTimeout(() => { showDropdown = false; onBlur(); }, 200)} 
            disabled={isLoadingLocation}
        />
        
        {#if isLoadingLocation}
            <div class="location-status">
                <Loader2 size={14} class="animate-spin" />
                <span>現在地を取得中...</span>
            </div>
        {/if}
        
        <button class="mic-btn">
            <Mic size={20} />
        </button>
    </div>

    {#if showDropdown && (results.length > 0 || isSearching)}
        <div class="results-dropdown">
            {#each results as item}
                <div 
                    role="button"
                    tabindex="0"
                    class="result-item" 
                    onpointerdown={(e) => {
                        e.preventDefault(); // Prevent blur
                        selectResult(item);
                    }}
                >
                    <MapPin size={18} class="result-icon" />
                    <div class="result-text">
                        <span class="result-name">{item.structured_formatting.main_text}</span>
                        <span class="result-sub">
                            {item.structured_formatting.secondary_text}
                        </span>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .result-sub {
        font-size: 13px;
        color: #8e8e93;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .search-container {
        position: absolute;
        top: 20px;
        left: 20px;
        right: 40px; /* Leave space for right margin */
        z-index: 9999; /* Boosted to ensure it's above Leaflet */
        pointer-events: none;
    }

    .search-bar {
        background: white;
        height: 54px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        padding: 0 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        pointer-events: auto;
    }

    .results-dropdown {
        background: white;
        margin-top: 10px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        overflow: hidden;
        pointer-events: auto;
        display: flex;
        flex-direction: column; /* Ensure vertical list */
        z-index: 9999;
    }

    .result-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px; /* Increased for mobile touchability */
        background: none;
        border: none;
        border-bottom: 1px solid #f2f2f7;
        text-align: left;
        cursor: pointer;
        transition: background 0.2s;
        box-sizing: border-box;
    }

    .result-item:last-child {
        border-bottom: none;
    }

    .result-item:active {
        background: #f2f2f7;
    }

    .result-text {
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .result-name {
        font-size: 16px;
        font-weight: 600;
        color: #1c1c1e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 16px;
        color: #333;
    }

    .mic-btn {
        background: none;
        border: none;
        color: #007aff;
        padding: 8px;
        cursor: pointer;
    }

    .location-status {
        position: absolute;
        top: 60px;
        left: 0;
        background: rgba(0, 122, 255, 0.9);
        color: white;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
        pointer-events: auto;
    }
</style>
