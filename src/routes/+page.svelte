<script>
    import Map from "$lib/components/Map.svelte";
    import SearchBar from "$lib/components/SearchBar.svelte";
    import AlertBanner from "$lib/components/AlertBanner.svelte";
    import { speak } from "$lib/utils/voice";
    import { Volume2, Navigation } from "lucide-svelte";

    let alertVisible = $state(false);
    let alertMessage = $state("3車線交差点です。二段階右折禁止の標識に注意してください");
    
    // Application States: 'IDLE', 'SEARCHING', 'ROUTE_OVERVIEW', 'NAVIGATING'
    let appState = $state('IDLE');
    /** @type {any} */
    let destination = $state(null); 
    let userLat = $state(null);
    let userLon = $state(null);
    let isLoadingLocation = $state(true);
    let routeDistance = $state(0);
    let routeDuration = $state(0);

    $effect(() => {
        if (userLat !== null && userLon !== null) {
            isLoadingLocation = false;
        }
    });

    function triggerTestVoice() {
        speak("音声案内のテストです。目的地を設定してください");
    }

    function triggerAlert() {
        alertVisible = true;
    }

    function handleMapError(message) {
        alertMessage = message;
        alertVisible = true;
    }

    function handleSelectDestination(item) {
        destination = {
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            name: item.display_name
        };
        appState = 'ROUTE_OVERVIEW';
    }

    function startNavigation() {
        appState = 'NAVIGATING';
        // In a real app, we might trigger a specific voice guidance here
        speak("案内を開始します。実際の交通規制に従って走行してください。");
    }

    function cancelRoute() {
        appState = 'IDLE';
        destination = null;
    }
</script>

<main class="app-container" class:is-navigating={appState === 'NAVIGATING'}>
    <div class="map-view">
        <Map 
            onError={handleMapError} 
            {destination} 
            isOverview={appState === 'ROUTE_OVERVIEW'}
            bind:distance={routeDistance}
            bind:duration={routeDuration}
            bind:userLat
            bind:userLon
        />
    </div>

    <!-- UI Overlay -->
    {#if appState !== 'NAVIGATING'}
        <SearchBar 
            onSelect={handleSelectDestination} 
            onFocus={() => { if(appState === 'IDLE') appState = 'SEARCHING'; }}
            onBlur={() => { if(appState === 'SEARCHING' && !destination) appState = 'IDLE'; }}
            lat={userLat}
            lon={userLon}
            {isLoadingLocation}
        />
    {/if}

    <AlertBanner bind:visible={alertVisible} message={alertMessage} />

    {#if appState === 'ROUTE_OVERVIEW'}
        <div class="route-panel-container">
            <!-- This will be replaced by RoutePanel component shortly -->
            <div class="route-panel">
                <div class="route-info">
                    <h3>{destination?.name.split(',')[0]}</h3>
                    <p>距離: {routeDistance}km / 所要時間: 約{routeDuration}分 (30km/h)</p>
                </div>
                <div class="route-actions">
                    <button class="cancel-btn" onclick={cancelRoute}>戻る</button>
                    <button class="start-btn" onclick={startNavigation}>案内開始</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Controls Overlay -->
    {#if appState === 'IDLE' || appState === 'NAVIGATING'}
        <div class="controls-overlay">
            <button class="control-btn voice-test" onclick={triggerTestVoice}>
                <Volume2 size={24} />
                <span>テスト音声</span>
            </button>

            <button class="control-btn alert-test" onclick={triggerAlert}>
                <Navigation size={24} />
                <span>アラート検証</span>
            </button>
        </div>
    {/if}

    <!-- Right-side margin for ergonomic swiping -->
    <div class="right-margin-safe-area"></div>
</main>

<style>
    :global(html, body) {
        height: 100%;
        width: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
    }

    .app-container {
        position: relative;
        width: 100vw;
        height: 100vh;
        display: flex;
        overflow: hidden;
    }

    .map-view {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    }

    .controls-overlay {
        position: absolute;
        bottom: 30px;
        left: 20px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .control-btn {
        background: white;
        border: none;
        border-radius: 12px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        font-weight: 600;
        color: #333;
        cursor: pointer;
        transition: transform 0.1s;
    }

    .control-btn:active {
        transform: scale(0.95);
    }

    .voice-test {
        color: #007aff;
    }

    .alert-test {
        color: #ff3b30;
    }

    /* Requirement: Right-side margin for easy scrolling/swiping */
    .right-margin-safe-area {
        position: absolute;
        top: 0;
        right: 0;
        width: 25px; /* Margin for swiping */
        height: 100%;
        background: rgba(
            0,
            0,
            0,
            0.02
        ); /* Very subtle visual hint, can be transparent */
        z-index: 5000;
        pointer-events: none; /* Allow events through? User said "余白を確保". Usually means keep it empty of UI. */
    }

    .app-container.is-navigating .controls-overlay {
        bottom: 20px;
    }

    .route-panel-container {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        padding: 20px;
        padding-right: 45px; /* Account for swipe margin */
        box-sizing: border-box;
        z-index: 2000;
    }

    .route-panel {
        background: white;
        border-radius: 20px;
        padding: 20px;
        box-shadow: 0 -4px 30px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        gap: 15px;
        animation: slide-up 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    @keyframes slide-up {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }

    .route-info h3 {
        margin: 0 0 5px 0;
        font-size: 18px;
        color: #1c1c1e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .route-info p {
        margin: 0;
        color: #8e8e93;
        font-weight: 500;
    }

    .route-actions {
        display: flex;
        gap: 10px;
    }

    .start-btn {
        flex: 2;
        background: #007aff;
        color: white;
        border: none;
        border-radius: 12px;
        padding: 14px;
        font-size: 17px;
        font-weight: 700;
        cursor: pointer;
    }

    .cancel-btn {
        flex: 1;
        background: #f2f2f7;
        color: #1c1c1e;
        border: none;
        border-radius: 12px;
        padding: 14px;
        font-size: 17px;
        font-weight: 600;
        cursor: pointer;
    }

    @media (max-width: 600px) {
        .control-btn span {
            display: none;
        }
        .control-btn {
            padding: 14px;
            border-radius: 50%;
        }
    }
</style>
