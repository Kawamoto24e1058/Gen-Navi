<script>
    import Map from "$lib/components/Map.svelte";
    import SearchBar from "$lib/components/SearchBar.svelte";
    import AlertBanner from "$lib/components/AlertBanner.svelte";
    import { Volume2, Navigation, LocateFixed, Sun, Moon, Compass, X } from "lucide-svelte";
    import { onMount } from "svelte";
    import { browser } from "$app/environment";
    import { playZundamon, prefetchVoice, stopZundamon } from "$lib/utils/voice";

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
    let currentRoute = $state(null);
    let hazards = $state([]);
    let announcedHazards = new Set();
    let spokenGuidance = new Set(); // To track {stepIndex}-{stage}
    let activeHazard = $state(null);
    let prohibitedSections = $state([]);
    let announcedProhibitions = new Set();
    let activeProhibitedSection = $state(null);
    let userHeading = $state(0);
    let currentSpeed = $state(0);
    let currentStepIndex = $state(1);
    let hasSpokenAdvance = $state(false);
    let hasSpokenSoon = $state(false);
    let hasSpokenStraight = $state(false);
    let nextInstructionText = $state('');
    let distanceToNext = $state(0); // in meters
    let isSpeeding = $state(false);
    let lastSpeedAlertTime = 0;
    
    // Theme Management: User preference (Manual)
    let isDark = $state(false);
    let recenterToken = $state(0);
    let isHeadingUp = $state(false); // Map rotation state
    
    // Sync HTML class for Tailwind dark mode
    $effect(() => {
        if (browser) {
            if (isDark) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        }
    });

    function toggleDarkMode() {
        isDark = !isDark;
        playZundamon(isDark ? "ダークモードに切り替えたのだ。目に優しいのだ！" : "ライトモードに切り替えたのだ。明るくて見やすいのだ！");
    }

    // Derived values for Nav UI
    let routeSteps = $derived(currentRoute?.legs?.[0]?.steps || []);
    $effect(() => {
        if (routeSteps.length > 0) {
            console.log("OSRMステップデータ:", routeSteps);
        }
    });

    let currentStep = $derived(routeSteps[currentStepIndex] || null);
    let etaTime = $derived.by(() => {
        if (!routeDuration) return "";
        const now = new Date();
        const eta = new Date(now.getTime() + routeDuration * 60000);
        return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    function formatDistance(meters) {
        if (meters >= 1000) {
            return (meters / 1000).toFixed(1) + 'km';
        }
        return Math.round(meters) + 'm';
    }

    // Google Maps style translation for OSRM maneuvers
    function translateManeuver(step) {
        if (!step || !step.maneuver) return { text: "道なり", symbol: "↑" };
        const modifier = step.maneuver.modifier;
        const type = step.maneuver.type;

        let text = "道なり";
        let symbol = "↑";

        // Google Maps style mapping
        if (type === 'depart') {
            text = "案内を開始"; symbol = "↑";
        } else if (type === 'turn') {
            if (modifier === 'left') { text = "左折"; symbol = "↖︎"; }
            else if (modifier === 'right') { text = "右折"; symbol = "↗︎"; }
            else if (modifier === 'slight left') { text = "斜め左"; symbol = "↖︎"; }
            else if (modifier === 'slight right') { text = "斜め右"; symbol = "↗︎"; }
            else if (modifier === 'sharp left') { text = "左に鋭角"; symbol = "↖︎"; }
            else if (modifier === 'sharp right') { text = "右に鋭角"; symbol = "↗︎"; }
            else if (modifier === 'uturn') { text = "Uターン"; symbol = "↶"; }
        } else if (type === 'continue') {
            text = "直進"; symbol = "↑";
        } else if (type === 'arrive') {
            text = "目的地に到着"; symbol = "🏁";
        } else if (modifier === 'straight') {
            text = "直進"; symbol = "↑";
        } else if (modifier) {
            // Handle other modifiers
            if (modifier.includes('left')) { text = "左方向"; symbol = "↖︎"; }
            else if (modifier.includes('right')) { text = "右方向"; symbol = "↗︎"; }
        }

        return { text, symbol };
    }

    // Context-aware instruction generator (Optimized for Zundamon)
    function formatInstruction(step, dist, hazard) {
        const { text: direction } = translateManeuver(step);
        const roadName = step.name ? `${step.name}へ、` : "";
        
        // Hazard special handling
        if (hazard) {
            if (hazard.voiceText && dist <= 50) return hazard.voiceText;
            const hazardWarning = `ここは車線が多いのだ！二段階右折をするのだ！`;
            if (dist > 50) {
                const spokenDistance = Math.round(dist / 10) * 10;
                return `およそ${spokenDistance}メートル先、${roadName}${direction}なのだ。${hazardWarning}`;
            }
            return `まもなく、${roadName}${direction}なのだ！二段階右折なのだ！`;
        }

        if (dist > 50) {
            const spokenDistance = Math.round(dist / 10) * 10;
            return `およそ${spokenDistance}メートル先、${roadName}${direction}なのだ`;
        }
        
        return `まもなく、${roadName}${direction}なのだ`;
    }

    // Initial Navigation Setup (Before first GPS fix)
    $effect(() => {
        if (appState === 'NAVIGATING' && currentRoute && routeSteps.length > 0) {
            console.log("初期ナビゲーション計算を開始...");
            const step = routeSteps[currentStepIndex];
            if (step && step.maneuver) {
                const { text, symbol } = translateManeuver(step);
                nextInstructionText = `${text} ${symbol}${step.name ? `（${step.name}）` : ""}`;
                
                if (userLat !== null && userLon !== null && step.maneuver.location) {
                    const distKm = calculateDistance(userLat, userLon, step.maneuver.location[1], step.maneuver.location[0]);
                    distanceToNext = Math.round(distKm * 1000);
                } else {
                    distanceToNext = 0;
                }
            }
        }
    });

    $effect(() => {
        if (userLat !== null && userLon !== null && appState === 'NAVIGATING' && currentRoute) {
            isLoadingLocation = false;
            
            // 1. Hazard Alerts (Manual detection/Proximity)
            hazards.forEach(hazard => {
                if (announcedHazards.has(hazard.id)) return;
                const dist = calculateDistance(userLat, userLon, hazard.lat, hazard.lon);
                if (dist < 0.2) {
                    activeHazard = hazard;
                    
                    // Prioritize AI Voice or construct with reasoning
                    if (hazard.voiceText) {
                        playZundamon(hazard.voiceText);
                    } else {
                        playZundamon(`ここは車線が多いのだ！二段階右折をするのだ！左端の車線に、寄るのだ！`);
                    }
                    
                    announcedHazards.add(hazard.id);
                    setTimeout(() => { if (activeHazard?.id === hazard.id) activeHazard = null; }, 10000);
                }
            });

            // 2. Prohibited Road Alerts (AI-detected bypasses etc.)
            prohibitedSections.forEach((section, idx) => {
                if (announcedProhibitions.has(section.name)) return;
                const dist = calculateDistance(userLat, userLon, section.start[0], section.start[1]);
                if (dist < 0.3) {
                    activeProhibitedSection = section;
                    playZundamon(`大変なのだ！この先の${section.name}は、原付は通れないのだ！別の道を探すのだ！`);
                    announcedProhibitions.add(section.name);
                    setTimeout(() => { if (activeProhibitedSection === section) activeProhibitedSection = null; }, 15000);
                }
            });

            // 3. Navigation Tracking Logic
            if (routeSteps && routeSteps.length > 0) {
                // Bounds check: Arrival handled below in global arrival or here if out of steps
                if (currentStepIndex >= routeSteps.length) {
                    endNavigation(true);
                    return;
                }

                const step = routeSteps[currentStepIndex];
                if (step && step.maneuver && step.maneuver.location) {
                    // RESOLVE OSRM [lon, lat] TRAP (Absolute Rule)
                    const targetLon = step.maneuver.location[0];
                    const targetLat = step.maneuver.location[1];
                    
                    if (userLat !== undefined && userLon !== undefined && targetLat !== undefined && targetLon !== undefined) {
                        // 1. Calculate meter distance (Haversine)
                        const distKm = calculateDistance(userLat, userLon, targetLat, targetLon);
                        if (!isNaN(distKm)) {
                            distanceToNext = Math.round(distKm * 1000);
                        }

                        const hazard = hazards.find(h => h.id && h.id.includes(`${targetLat}-${targetLon}`));
                        const translation = translateManeuver(step);
                        const direction = translation.text;
                        const isStraight = direction === '直進' || direction === '道なり';

                        // 3. Translation & UI Text
                        const intersectionName = step.name ? `（${step.name}）` : "";
                        if (isStraight) {
                            nextInstructionText = `直進 ${translation.symbol}${intersectionName}`;
                        } else {
                            nextInstructionText = `${translation.text} ${translation.symbol}${intersectionName}`;
                        }

                        // --- Robust prioritized if-else for GPS skip protection ---
                        if (distanceToNext <= 25) {
                            // 【交差点通過】
                            console.log(`Zundamon: Stepping to index ${currentStepIndex + 1}`);
                            currentStepIndex = currentStepIndex + 1;
                            hasSpokenAdvance = false;
                            hasSpokenSoon = false;
                            hasSpokenStraight = false;
                        } 
                        else if (distanceToNext <= 50 && !hasSpokenSoon) {
                            // 【直前案内】
                            if (isStraight) {
                                playZundamon("そのまま直進なのだ");
                            } else {
                                const roadName = step.name ? `${step.name}へ、` : "";
                                playZundamon(`まもなく、${roadName}${direction}なのだ`);
                            }
                            hasSpokenSoon = true;
                            hasSpokenAdvance = true; // Prevent double trigger
                        } 
                        else if (distanceToNext <= 300 && !hasSpokenAdvance) {
                            // 【事前案内】
                            const spokenDistance = Math.round(distanceToNext / 10) * 10;
                            if (isStraight) {
                                playZundamon(`およそ${spokenDistance}メートル、直進なのだ`);
                            } else {
                                const roadName = step.name ? `${step.name}へ、` : "";
                                playZundamon(`およそ${spokenDistance}メートル先、${roadName}${direction}なのだ`);
                            }
                            hasSpokenAdvance = true;
                        }

                        // 4. "Continue Straight" Logic (Google Maps style)
                        if (distanceToNext >= 800 && !hasSpokenStraight && !hasSpokenSoon && !hasSpokenAdvance) {
                            playZundamon("この先、しばらく道なりなのだ");
                            hasSpokenStraight = true;
                        }
                    }
                }
            } else if (appState === 'NAVIGATING') {
                nextInstructionText = "案内ポイント計算中...";
            }

            // 4. Speed Limit Monitoring (30km/h for 50cc)
            const speedKmH = currentSpeed * 3.6;
            if (speedKmH > 30) {
                isSpeeding = true;
                const now = Date.now();
                if (now - lastSpeedAlertTime > 10000) { // Alert every 10s
                    playZundamon("スピード出しすぎなのだ！落とすのだ！");
                    lastSpeedAlertTime = now;
                }
            } else {
                isSpeeding = false;
            }

            // 5. Auto-Reroute Detection (50m deviation)
            if (currentRoute?.geometry?.coordinates) {
                const coords = currentRoute.geometry.coordinates;
                // Find distance to nearest point on route
                let minDistance = Infinity;
                for (let i = 0; i < coords.length; i++) {
                    const d = calculateDistance(userLat, userLon, coords[i][1], coords[i][0]);
                    if (d < minDistance) minDistance = d;
                }
                
                if (minDistance > 0.05) { // 50m
                    console.log('Zundamon: Off-route detected! Rerouting...');
                    const destLatLng = [destination.lat, destination.lon];
                    const startPos = [userLat, userLon];
                    const originalDest = { ...destination };
                    destination = null;
                    setTimeout(() => { 
                        destination = originalDest;
                        playZundamon("ルートを外れたのだ。再検索したのだ！");
                    }, 100);
                }
            }

            // 6. Global Arrival Detection (Overall destination < 30m)
            if (destination) {
                const distToDest = calculateDistance(userLat, userLon, destination.lat, destination.lon);
                // Trigger arrival at 30m
                if (distToDest < 0.03) { 
                    endNavigation(true);
                }
            }
        } else if (userLat !== null && userLon !== null) {
            isLoadingLocation = false;
        }
    });

    // Orientation Tracking
    $effect(() => {
        if (!browser) return;
        
        const handleOrientation = (e) => {
            // Priority: webkitCompassHeading (iOS/Safari) -> alpha (Android/Chrome)
            if (e.webkitCompassHeading !== undefined) {
                userHeading = e.webkitCompassHeading;
            } else if (e.alpha !== null) {
                userHeading = 360 - e.alpha;
            }
        };

        window.addEventListener('deviceorientation', handleOrientation, true);
        return () => window.removeEventListener('deviceorientation', handleOrientation);
    });


    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function triggerTestVoice() {
        playZundamon("目的地を、設定するのだ！原付一種専用の、安全なルートを案内するのだ！");
    }

    function handleMapError(message) {
        alertMessage = message;
        alertVisible = true;
    }

    function handleSelectDestination(item) {
        console.log('Destination selected:', item);
        destination = {
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            name: item.display_name
        };
        appState = 'ROUTE_OVERVIEW';
    }

    function startNavigation() {
        if (prohibitedSections.some(s => s.strictness === 'STRICT')) {
            alertMessage = "ルート上に原付通行禁止区間が含まれています。安全のため、別のルートを検討してください。";
            alertVisible = true;
            playZundamon("警告なのだ！ルート上に原付一種が通行できない区間が含まれているのだ。案内を制限するのだ。");
            return;
        }
        
        appState = 'NAVIGATING';
        currentStepIndex = 1; // Start from first maneuver
        hasSpokenAdvance = false;
        hasSpokenSoon = false;
        hasSpokenStraight = false;
        recenterToken += 1; // Trigger map focus
        playZundamon("安全運転で、案内を開始するのだ！実際の交通規制に、従うのだ！");
    }

    function endNavigation(arrived = false) {
        if (arrived) {
            playZundamon("目的地周辺に到着したのだ！案内を終了するのだ！お疲れ様なのだ！");
        } else {
            stopZundamon();
        }

        appState = 'IDLE';
        destination = null;
        currentStepIndex = 1; // Reset progression
        hasSpokenAdvance = false;
        hasSpokenSoon = false;
        hasSpokenStraight = false;
        isHeadingUp = false; // Reset rotation to North-up
        activeHazard = null;
        activeProhibitedSection = null;
        announcedHazards.clear();
        announcedProhibitions.clear();
        spokenGuidance.clear();
    }

    function cancelRoute() {
        endNavigation(false);
    }

    function changeDestination() {
        // Keep destination set but go back to searching state
        appState = 'SEARCHING';
    }

    function recenterMap() {
        recenterToken += 1;
    }


    function toggleHeadingUp() {
        isHeadingUp = !isHeadingUp;
        if (isHeadingUp) {
            playZundamon("ヘディングアップに切り替えたのだ。進行方向が上になるのだ。");
        } else {
            playZundamon("ノースアップに戻したのだ。北が上になるのだ。");
        }
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
            bind:hazards
            bind:route={currentRoute}
            bind:prohibitedSections
            heading={userHeading}
            isNavigating={appState === 'NAVIGATING'}
            {isHeadingUp}
            bind:currentSpeed
            {isDark}
            {recenterToken}
        />
    </div>

    <!-- Navigation Overlay -->
    {#if appState === 'NAVIGATING'}
        <div class="nav-mode-overlay">
            <!-- Top Guidance Bar -->
            <div class="nav-guidance-bar">
                <div class="guidance-icon">
                    {#if currentStep?.maneuver?.modifier === 'right' || currentStep?.maneuver?.modifier === 'slight right' || currentStep?.maneuver?.modifier === 'sharp right'}
                        <Navigation size={48} style="transform: rotate(90deg)" />
                    {:else if currentStep?.maneuver?.modifier === 'left' || currentStep?.maneuver?.modifier === 'slight left' || currentStep?.maneuver?.modifier === 'sharp left'}
                        <Navigation size={48} style="transform: rotate(-90deg)" />
                    {:else if currentStep?.maneuver?.modifier === 'uturn'}
                        <Navigation size={48} style="transform: rotate(180deg)" />
                    {:else}
                        <Navigation size={48} />
                    {/if}
                </div>
                <div class="guidance-text">
                    <span class="guidance-main">
                        {#if nextInstructionText.includes('直進')}
                            {Math.round(distanceToNext)}m {nextInstructionText}
                        {:else}
                            {formatDistance(distanceToNext)}先、{nextInstructionText || '道なり'}
                        {/if}
                    </span>
                    {#if routeSteps[currentStepIndex]?.name}
                        <span class="guidance-subtext">{routeSteps[currentStepIndex].name}</span>
                    {/if}
                </div>
            </div>

            <!-- Bottom Stats Bar -->
            <div class="nav-stats-bar">
                <div class="nav-stat-group">
                    <div class="nav-stat">
                        <span class="nav-stat-val">{etaTime}</span>
                        <span class="nav-stat-lbl">到着</span>
                    </div>
                    <div class="nav-stat main">
                        <span class="nav-stat-val highlight">{routeDuration}<small>分</small></span>
                        <span class="nav-stat-lbl">残り</span>
                    </div>
                    <div class="nav-stat">
                        <span class="nav-stat-val">{routeDistance}<small>km</small></span>
                        <span class="nav-stat-lbl">距離</span>
                    </div>
                </div>

                <!-- Live Speedometer -->
                <div class="nav-speed-container">
                    <div class="nav-debug-info">
                        [ 距離: {Math.round(distanceToNext)}m | 300m前: {hasSpokenAdvance ? '済' : '未'} | 50m前: {hasSpokenSoon ? '済' : '未'} ]
                    </div>
                    <div class="nav-speedometer" class:is-speeding={isSpeeding}>
                        <span class="speed-val">{Math.round(currentSpeed * 3.6)}</span>
                        <span class="speed-unit">km/h</span>
                    </div>
                </div>

                <button class="nav-exit-btn" onclick={cancelRoute}>終了</button>
            </div>
        </div>

        <!-- Pop-over Alerts during Navigation -->
        {#if activeHazard}
            <div class="hazard-alert-overlay">
                <div class="hazard-alert-box" class:is-fallback={activeHazard.confidence === 'fallback'}>
                    <div class="hazard-alert-icon">↩️</div>
                    <div class="hazard-alert-text">
                        <span class="hazard-title">{activeHazard.confidence === 'high' ? '二段階右折が必要' : '二段階右折の可能性大'}</span>
                        <span class="hazard-desc">{activeHazard.confidence === 'high' ? '左端の車線に寄ってください' : '標識を必ず確認してください'}</span>
                    </div>
                    <button class="hazard-close" onclick={() => activeHazard = null}>✕</button>
                </div>
            </div>
        {/if}

        {#if activeProhibitedSection}
            <div class="prohibited-alert-overlay">
                <div class="prohibited-alert-box">
                    <div class="prohibited-alert-icon">🚫</div>
                    <div class="prohibited-alert-text">
                        <span class="prohibited-title">通行禁止区域 接近</span>
                        <span class="prohibited-name">{activeProhibitedSection.name}</span>
                        <span class="prohibited-desc">{activeProhibitedSection.reason}</span>
                    </div>
                    <button class="prohibited-close" onclick={() => activeProhibitedSection = null}>✕</button>
                </div>
            </div>
        {/if}
    {/if}

    <!-- Searching or Route Selection UI -->
    <div class="top-ui-container" class:hide={appState === 'NAVIGATING'}>
        {#if !destination || appState === 'SEARCHING'}
            <SearchBar 
                onSelect={handleSelectDestination} 
                onFocus={() => { if(appState === 'IDLE') appState = 'SEARCHING'; }}
                onBlur={() => { if(appState === 'SEARCHING' && !destination) appState = 'IDLE'; }}
                lat={userLat}
                lon={userLon}
                {isLoadingLocation}
            />
        {:else}
            <!-- Destination Info Card (Top) -->
            <div class="destination-card">
                <div class="dest-icon">
                    <Navigation size={20} />
                </div>
                <div class="dest-info">
                    <span class="dest-label">目的地</span>
                    <h3 class="dest-name">{destination.name.split(',')[0]}</h3>
                </div>
                <div class="dest-actions">
                    <button class="action-btn change" onclick={changeDestination}>変更</button>
                    <button class="action-btn cancel" onclick={cancelRoute}>中止</button>
                </div>
            </div>
        {/if}
    </div>

    <!-- Navigation-specific FABs (Compass/Rotation/Theme) -->
    {#if appState === 'NAVIGATING'}
        <div class="nav-fab-container">
            <button class="fab-btn theme-toggle" onclick={toggleDarkMode} title="テーマ切り替え">
                {#if isDark}
                    <Sun size={24} />
                {:else}
                    <Moon size={24} />
                {/if}
            </button>
            <button 
                class="fab-btn compass-toggle" 
                class:active={isHeadingUp}
                onclick={toggleHeadingUp} 
                title="地図回転切り替え"
            >
                <Compass size={24} style={isHeadingUp ? `transform: rotate(${-userHeading}deg)` : ''} />
            </button>
            <button class="fab-btn exit-nav" onclick={() => endNavigation(false)} title="ナビ終了">
                <X size={24} />
            </button>
        </div>
    {/if}

    <!-- Floating Action Buttons (FAB) for Idle/Overview -->
    {#if appState !== 'NAVIGATING'}
        <div class="fab-container">
            <button class="fab-btn theme-toggle" onclick={toggleDarkMode} title="テーマ切り替え">
                {#if isDark}
                    <Sun size={24} />
                {:else}
                    <Moon size={24} />
                {/if}
            </button>
            <button class="fab-btn recenter" onclick={recenterMap} title="現在地に戻る">
                <LocateFixed size={24} />
            </button>
        </div>
    {/if}

    <!-- Route Overview Panel -->
    {#if appState === 'ROUTE_OVERVIEW'}
        <div class="route-panel-container">
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

    <AlertBanner bind:visible={alertVisible} message={alertMessage} />

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


    /* Professional Navigation Mode Styles */
    .nav-mode-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 16px;
        padding-right: 45px;
        box-sizing: border-box;
        z-index: 4000;
    }

    .nav-guidance-bar {
        position: relative;
        background: #1c1c1e;
        color: white;
        border-radius: 20px;
        padding: 24px;
        display: flex;
        align-items: center;
        gap: 20px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        pointer-events: auto;
        animation: slide-down 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    @keyframes slide-down {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }

    .guidance-icon {
        width: 64px;
        height: 64px;
        background: #34c759;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
    }

    .guidance-text {
        display: flex;
        flex-direction: column;
    }

    .guidance-main {
        font-size: 20px;
        font-weight: 800;
        color: #34c759;
        line-height: 1.2;
    }

    .guidance-subtext {
        font-size: 16px;
        font-weight: 600;
        color: white;
        opacity: 0.8;
        margin-top: 2px;
    }

    .nav-stats-bar {
        background: white;
        border-radius: 24px;
        padding: 16px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 -10px 40px rgba(0,0,0,0.1);
        pointer-events: auto;
        animation: slide-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .nav-stat-group {
        display: flex;
        gap: 24px;
        align-items: center;
    }

    .nav-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .nav-stat-val {
        font-size: 17px;
        font-weight: 700;
        color: #1c1c1e;
    }

    .nav-stat-val.highlight {
        font-size: 24px;
        color: #34c759;
    }

    .nav-stat-val small {
        font-size: 12px;
        margin-left: 1px;
    }

    .nav-stat-lbl {
        font-size: 11px;
        font-weight: 700;
        color: #8e8e93;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .nav-exit-btn {
        background: #f2f2f7;
        color: #ff3b30;
        border: none;
        border-radius: 14px;
        padding: 12px 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
    }

    .nav-speed-container {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
    }

    .nav-debug-info {
        font-size: 10px;
        color: #8e8e93;
        font-family: monospace;
        white-space: nowrap;
    }

    .nav-speedometer {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: #f2f2f7;
        padding: 8px 16px;
        border-radius: 16px;
        min-width: 70px;
    }

    .nav-speedometer.is-speeding {
        background: #ff3b30;
        color: white;
        animation: flash-red 0.5s infinite alternate;
    }

    .nav-speedometer .speed-val {
        font-size: 24px;
        font-weight: 900;
        line-height: 1;
    }

    .nav-speedometer .speed-unit {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }

    @keyframes flash-red {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0.8; transform: scale(1.05); }
    }

    /* Hide utilities */
    .top-ui-container.hide {
        pointer-events: none;
        opacity: 0;
        transform: translateY(-20px);
        transition: all 0.3s;
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

    .top-ui-container {
        position: absolute;
        top: 20px;
        left: 0;
        width: 100%;
        padding: 0 20px;
        padding-right: 45px;
        box-sizing: border-box;
        z-index: 3000;
        pointer-events: none;
    }

    .top-ui-container > :global(*) {
        pointer-events: auto;
    }

    .destination-card {
        background: white;
        border-radius: 16px;
        padding: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        animation: fade-in 0.3s ease-out;
    }

    @keyframes fade-in {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .dest-icon {
        width: 40px;
        height: 40px;
        background: #f2f2f7;
        color: #007aff;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .dest-info {
        flex: 1;
        min-width: 0;
    }

    .dest-label {
        font-size: 11px;
        font-weight: 700;
        color: #8e8e93;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: block;
    }

    .dest-name {
        margin: 0;
        font-size: 16px;
        color: #1c1c1e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dest-actions {
        display: flex;
        gap: 8px;
    }

    .action-btn {
        padding: 8px 16px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: background 0.2s;
    }

    .action-btn.change {
        background: #f2f2f7;
        color: #007aff;
    }

    .action-btn.cancel {
        background: #fff1f0;
        color: #ff3b30;
    }

    .action-btn.change:hover { background: #e5e5ea; }
    .action-btn.cancel:hover { background: #fee2e2; }

    .hazard-alert-overlay {
        position: absolute;
        top: 100px;
        left: 0;
        width: 100%;
        display: flex;
        justify-content: center;
        padding: 0 20px;
        box-sizing: border-box;
        z-index: 4000;
        pointer-events: none;
    }

    .hazard-alert-box {
        background: #ff3b30;
        color: white;
        border-radius: 16px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 15px;
        box-shadow: 0 10px 40px rgba(255, 59, 48, 0.4);
        pointer-events: auto;
        animation: pulse-alert 1.5s infinite alternate ease-in-out;
        max-width: 400px;
        width: 100%;
    }

    @keyframes pulse-alert {
        from { transform: scale(1); box-shadow: 0 10px 40px rgba(255, 59, 48, 0.4); }
        to { transform: scale(1.03); box-shadow: 0 10px 50px rgba(255, 59, 48, 0.6); }
    }

    .hazard-alert-box.is-fallback {
        background: #ff9500; /* Orange for warning/fallback */
        box-shadow: 0 10px 40px rgba(255, 149, 0, 0.4);
    }

    .hazard-alert-icon {
        font-size: 32px;
        background: white;
        width: 50px;
        height: 50px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .hazard-alert-text {
        display: flex;
        flex-direction: column;
        flex: 1;
    }

    .hazard-title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: -0.5px;
    }

    .hazard-desc {
        font-size: 13px;
        font-weight: 500;
        opacity: 0.9;
    }

    .hazard-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        font-size: 16px;
        cursor: pointer;
    }

    .prohibited-alert-overlay {
        position: absolute;
        top: 180px;
        left: 0;
        width: 100%;
        display: flex;
        justify-content: center;
        padding: 0 20px;
        box-sizing: border-box;
        z-index: 4500;
        pointer-events: none;
    }

    .prohibited-alert-box {
        background: #1c1c1e;
        color: #ff3b30;
        border: 2px solid #ff3b30;
        border-radius: 16px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 15px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        animation: shake 0.5s ease-in-out infinite;
        max-width: 400px;
        width: 100%;
    }

    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
    }

    .prohibited-alert-icon {
        font-size: 32px;
        background: #ff3b30;
        color: white;
        width: 50px;
        height: 50px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .prohibited-alert-text {
        display: flex;
        flex-direction: column;
        flex: 1;
    }

    .prohibited-title {
        font-size: 14px;
        font-weight: 700;
        color: #ff3b30;
        text-transform: uppercase;
    }

    .prohibited-name {
        font-size: 18px;
        font-weight: 800;
        color: white;
    }

    .prohibited-desc {
        font-size: 13px;
        font-weight: 500;
        color: #8e8e93;
    }

    .prohibited-close {
        background: rgba(255,255,255,0.1);
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        font-size: 16px;
        cursor: pointer;
    }

    @media (max-width: 600px) {
        /* Mobile specific tweaks can go here */
    }

    /* FAB Styles */
    .fab-container {
        position: absolute;
        bottom: 32px;
        right: 45px; /* Adjusting for right margin safe area + padding */
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 1000;
    }

    .fab-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        background: white;
        color: #1c1c1e;
    }

    :global(.dark) .fab-btn {
        background: #1f2937; /* bg-gray-800 */
        color: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .fab-btn:active {
        transform: scale(0.9);
    }

    .fab-btn.recenter {
        color: #007aff;
    }

    :global(.dark) .fab-btn.recenter {
        color: #0a84ff;
    }

    /* Navigation FABs */
    .nav-fab-container {
        position: absolute;
        bottom: 120px; /* Above stats bar */
        right: 45px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 5000;
    }

    .fab-btn.compass-toggle.active {
        background: #007aff;
        color: white;
    }

    .fab-btn.exit-nav {
        color: #ff3b30;
    }

    .fab-btn.compass-toggle {
        transition: transform 0.1s ease-out;
    }
</style>
