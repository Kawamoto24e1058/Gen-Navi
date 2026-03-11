<script>
    import { Search, Mic, MapPin, Loader2 } from 'lucide-svelte';
    import { onMount } from 'svelte';

    let { onSelect, onFocus, onBlur } = $props();

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

        isSearching = true;
        try {
            // Fetch from internal SvelteKit API proxy for Yahoo! API
            const url = `/api/search?q=${encodeURIComponent(q)}`;
            console.log('Fetching Yahoo Search:', url);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Proxy error: ${response.status}`);
            }
            const data = await response.json();
            // Yahoo API returns features in Feature array
            results = data.Feature || [];
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
            // 500ms debounce as requested
            debounceTimer = setTimeout(() => {
                searchPlaces(query);
            }, 500);
        } else {
            showDropdown = false;
            results = [];
        }
    }

    async function selectResult(item) {
        query = item.Name;
        showDropdown = false;
        
        try {
            // Yahoo API returns coordinates as "lon,lat" string
            const coordString = item.Geometry?.Coordinates;
            if (coordString) {
                const [lonStr, latStr] = coordString.split(',');
                const latVal = parseFloat(latStr);
                const lonVal = parseFloat(lonStr);

                // Transition to overview via parent handler with correctly mapped coordinates
                onSelect({
                    lat: latVal,
                    lon: lonVal,
                    display_name: `${item.Name} (${item.Property?.Address || ''})`
                });
            } else {
                throw new Error('Could not retrieve coordinates from Yahoo API');
            }
        } catch (error) {
            console.error('Selection error:', error);
            alert('場所の情報を取得できませんでした。');
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
            placeholder="目的地を検索（例: コンビニ）" 
            bind:value={query}
            oninput={handleInput}
            onfocus={onFocus}
            onblur={() => setTimeout(() => { showDropdown = false; onBlur(); }, 200)} 
        />
        
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
                        <span class="result-name">{item.Name}</span>
                        <span class="result-sub">
                            {item.Property?.Address || ''}
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
</style>
