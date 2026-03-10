<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';

    let { 
        onError = (msg) => console.error(msg),
        destination = null,
        isOverview = false,
        duration = $bindable(0),
        distance = $bindable(0),
        userLat = $bindable(null),
        userLon = $bindable(null),
        hazards = $bindable([]),
        route = $bindable(null),
        prohibitedSections = $bindable([]),
        heading = 0,
        isNavigating = false,
        currentSpeed = $bindable(0),
        isDark = false,
        recenterToken = 0
    } = $props();

    // Recenter Effect
    $effect(() => {
        if (recenterToken > 0 && activeMap && userLat !== null && userLon !== null) {
            activeMap.flyTo([userLat, userLon], 16, { animate: true });
        }
    });

    let map;
    let mapElement;
    let userMarker;
    let userCircle;
    let destMarker;
    let hazardMarkers = [];
    let prohibitedLayers = [];
    let routeLayer; // Changed from routeLine to handle GeoJSON
    let tileLayer;
    /** @type {any} */
    let L = $state(null);
    /** @type {any} */
    let activeMap = $state(null);

    async function fetchRoute(start, end) {
        const url = `/api/route?start=${start[1]},${start[0]}&end=${end[1]},${end[0]}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.route) {
                // Handle safetyAlerts from AI
                if (data.safetyAlerts && data.safetyAlerts.length > 0) {
                    console.log('AI Safety Alerts:', data.safetyAlerts);
                }
                return data.route;
            }
        } catch (error) {
            console.error('Route API fetch error:', error);
        }
        return null;
    }

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

    // Helper to find a point 20m before the end of a geometry
    function getPointBefore(geometry, distanceMeters) {
        if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) return null;
        
        const coords = [...geometry.coordinates].reverse();
        let currentDist = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i+1];
            const segmentDist = calculateDistance(p1[1], p1[0], p2[1], p2[0]) * 1000;
            
            if (currentDist + segmentDist >= distanceMeters) {
                const remaining = distanceMeters - currentDist;
                const ratio = remaining / segmentDist;
                return {
                    lat: p1[1] + (p2[1] - p1[1]) * ratio,
                    lon: p1[0] + (p2[0] - p1[0]) * ratio
                };
            }
            currentDist += segmentDist;
        }
        return { lat: coords[coords.length-1][1], lon: coords[coords.length-1][0] };
    }

    function extractHazards(route) {
        const foundHazards = [];
        if (!route.legs) return [];

        route.legs.forEach(leg => {
            leg.steps.forEach((step, index) => {
                // Rule: Right turn from road
                const isRightTurn = step.maneuver.type === 'turn' && step.maneuver.modifier === 'right';
                if (!isRightTurn) return;

                // 1. High Confidence: Explicit lane count (3+)
                const intersection = step.intersections[0];
                const laneCount = intersection.lanes ? intersection.lanes.length : 0;
                
                // 2. Fallback: Major road by type, name, or speed
                const roadName = step.name || "";
                const isMajorRoad = roadName.includes("国道") || 
                                   roadName.includes("バイパス") || 
                                   roadName.includes("県道") || 
                                   roadName.includes("府道") || 
                                   /\d+号/.test(roadName);
                
                // OSRM road class (if available in annotations or metadata)
                const isPrimaryClass = step.road_class === 'motorway' || 
                                      step.road_class === 'trunk' || 
                                      step.road_class === 'primary';
                
                // Speed check: distance(m) / duration(s) > 13.9 m/s (50km/h)
                const avgSpeed = step.distance / (step.duration || 1);
                const isFastRoad = avgSpeed > 13.9;

                let confidence = 'none';
                let reason = "";
                if (laneCount >= 3) {
                    confidence = 'high';
                    reason = "3車線以上の多車線道路です。";
                } else if (isPrimaryClass || isMajorRoad || isFastRoad) {
                    confidence = 'fallback';
                    reason = isMajorRoad ? "主要な幹線道路（国道・バイパス等）です。" : "高規格な大通りの可能性があります。";
                }

                if (confidence !== 'none') {
                    // Marker placement: 20m before intersection (end of previous step)
                    let markerPos = { lat: step.maneuver.location[1], lon: step.maneuver.location[0] };
                    if (index > 0) {
                        const prevStep = leg.steps[index - 1];
                        const offsetPos = getPointBefore(prevStep.geometry, 20);
                        if (offsetPos) markerPos = offsetPos;
                    }

                    foundHazards.push({
                        ...markerPos,
                        confidence,
                        message: confidence === 'high' 
                            ? "二段階右折が必要です" 
                            : "二段階右折の可能性大（標識を確認！）",
                        detail: reason,
                        id: `hazard-${step.maneuver.location[1]}-${step.maneuver.location[0]}`
                    });
                }
            });
        });
        return foundHazards;
    }

    function getL() { return L; } // Helper for linting if needed

    $effect(() => {
        if (!browser || !mapElement) return;

        let watchId;

        async function initMap() {
            const Leaflet = await import('leaflet');
            L = Leaflet;
            
            const mapInstance = L.map(mapElement, {
                zoomControl: false,
                attributionControl: false
            }).setView([35.6812, 139.7671], 15);

            tileLayer = L.tileLayer(isDark 
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
            }).addTo(mapInstance);

            if ("geolocation" in navigator) {
                watchId = navigator.geolocation.watchPosition(
                    (position) => {
                        const { latitude, longitude, accuracy } = position.coords;
                        userLat = latitude;
                        userLon = longitude;
                        currentSpeed = position.coords.speed || 0; // m/s
                        const currentPos = [latitude, longitude];

                        if (!userMarker) {
                            userCircle = L.circle(currentPos, { radius: accuracy / 2 }).addTo(mapInstance);
                            userMarker = L.circleMarker(currentPos, {
                                radius: 8,
                                fillColor: "#3388ff",
                                color: "#fff",
                                weight: 2,
                                opacity: 1,
                                fillOpacity: 1
                            }).addTo(mapInstance);
                        } else {
                            userMarker.setLatLng(currentPos);
                            userCircle.setLatLng(currentPos);
                            userCircle.setRadius(accuracy / 2);
                        }

                        // Navigation Mode auto-centering and zoom
                        if (isNavigating) {
                            mapInstance.setView(currentPos, 18, { animate: true });
                        } else if (!isOverview) {
                            mapInstance.setView(currentPos, mapInstance.getZoom());
                        }
                    },
                    (error) => {
                        let message = "位置情報の取得に失敗しました。";
                        if (error.code === error.PERMISSION_DENIED) {
                            message = "位置情報の取得が許可されていません。設定を確認してください。";
                        }
                        onError(message);
                    },
                    {
                        enableHighAccuracy: true,
                        maximumAge: 0,
                        timeout: 10000
                    }
                );
            } else {
                onError("お使いのブラウザは位置情報をサポートしていません。");
            }
            
            activeMap = mapInstance;
            map = mapInstance;
        }

        initMap();

        return () => {
            if (activeMap) activeMap.remove();
            if (watchId) navigator.geolocation.clearWatch(watchId);
        };
    });

    // React to destination changes independently
    $effect(() => {
        /** @type {any} */
        const Leaflet = L;
        if (activeMap && destination && Leaflet) {
            const destLatLng = [destination.lat, destination.lon];
            
            if (destMarker) destMarker.remove();
            destMarker = Leaflet.marker(destLatLng).addTo(activeMap);
            
            if (userLat !== null && userLon !== null) {
                const startPos = [userLat, userLon];
                fetchRoute(startPos, destLatLng).then(route => {
                    if (routeLayer) routeLayer.remove();
                    hazardMarkers.forEach(m => m.remove());
                    hazardMarkers = [];
                    prohibitedLayers.forEach(l => l.remove());
                    prohibitedLayers = [];
                    
                    if (route) {
                        // Success: Render the road path (Road-Aligned Geometry)
                        routeLayer = Leaflet.geoJSON(route.geometry, {
                            style: {
                                color: '#007aff',
                                weight: 8,
                                opacity: 0.7
                            }
                        }).addTo(activeMap);

                        // Mandatory: Center and fit the route!
                        activeMap.fitBounds(routeLayer.getBounds(), {
                            padding: [50, 50]
                        });

                        // Extract initial hazards
                        hazards = extractHazards(route);
                        
                        // AI Assessment (Asynchronous - Route & Hazards)
                        if (hazards.length > 0 || route.legs) {
                            fetch('/api/ai/assess-route', {
                                method: 'POST',
                                body: JSON.stringify({ 
                                    hazards, 
                                    routeSteps: route.legs[0].steps,
                                    fullRoute: route.geometry
                                })
                            })
                            .then(res => {
                                if (!res.ok) throw new Error(`AI API failed: ${res.status}`);
                                return res.json();
                            })
                            .then(aiResult => {
                                if (aiResult) {
                                    // 1. Prohibited Sections (⛔ Strict Highlight)
                                    prohibitedSections = aiResult.prohibitedSections || [];
                                    if (prohibitedSections.length > 0) {
                                        prohibitedSections.forEach(section => {
                                            const glowLayer = Leaflet.polyline(section.geometry || [section.start, section.end], {
                                                color: '#ff3b30', weight: 18, opacity: 0.9
                                            }).addTo(activeMap);
                                            const mainLayer = Leaflet.polyline(section.geometry || [section.start, section.end], {
                                                color: '#1c1c1e', weight: 10, opacity: 1.0
                                            }).addTo(activeMap);
                                            const prohibitedMarker = Leaflet.marker(section.start, {
                                                icon: Leaflet.divIcon({
                                                    html: '<div class="prohibited-icon is-strict">⛔</div>',
                                                    className: 'custom-prohibited-marker',
                                                    iconSize: [45, 45], iconAnchor: [22, 22]
                                                })
                                            }).addTo(activeMap);
                                            const popupText = `<div class="prohibited-popup"><strong>絶対進入禁止: ${section.name}</strong><br>${section.reason}</div>`;
                                            mainLayer.bindPopup(popupText); prohibitedMarker.bindPopup(popupText);
                                            prohibitedLayers.push(glowLayer, mainLayer, prohibitedMarker);
                                        });
                                    }

                                    // 2. Map AI results back to hazards
                                    if (aiResult.hazards) {
                                        hazards = hazards.map(h => {
                                            const ai = aiResult.hazards.find(r => r.id === h.id);
                                            return ai ? { ...h, ...ai } : h;
                                        });

                                        // Re-render markers with AI information
                                        hazardMarkers.forEach(m => m.remove());
                                        hazardMarkers = [];
                                         hazards.forEach(h => {
                                             const isAiHigh = h.type === 'TWO_STEP_REQUIRED' || h.type === 'TWO_STEP_RECOMMENDED' || h.score >= 80;
                                             
                                             const marker = Leaflet.marker([h.lat, h.lon], {
                                                 icon: Leaflet.divIcon({
                                                     html: `<div class="hazard-icon ${isAiHigh ? 'is-ai-high' : ''}">${isAiHigh ? '⚠️' : '↩️'}</div>`,
                                                     className: 'custom-hazard-marker',
                                                     iconSize: [isAiHigh ? 45 : 30, isAiHigh ? 45 : 30],
                                                     iconAnchor: [isAiHigh ? 22 : 15, isAiHigh ? 22 : 15]
                                                 })
                                             }).addTo(activeMap);

                                             const title = h.type === 'TWO_STEP_REQUIRED' ? '二段階右折必須' : 
                                                           h.type === 'TWO_STEP_RECOMMENDED' ? '二段階右折推奨 (AI判断)' : '⚠️ 要警戒';

                                             const popupContent = `
                                                 <div class="hazard-popup">
                                                     <strong style="color: ${isAiHigh ? '#ff9500' : '#ff3b30'}">${title}</strong><br>
                                                     <small>${h.reason || h.detail}</small><br>
                                                     <hr style="margin: 5px 0; border: none; border-top: 1px solid #eee;">
                                                     <p style="margin: 1px 0; color: #1c1c1e; font-size: 11px; font-weight: 500;">
                                                         ${h.voiceText || '標識を必ず確認してください。'}
                                                     </p>
                                                     <div style="font-size: 10px; color: #8e8e93; margin-top: 4px;">AI確信度: ${h.score || 50}%</div>
                                                 </div>
                                             `;
                                             marker.bindPopup(popupContent);
                                             hazardMarkers.push(marker);
                                         });
                                    }
                                }
                            })
                            .catch(err => {
                                console.error('AI Assessment Fetch Error:', err);
                                // Fallback is already rendered, so we don't need to do much
                            });
                        }

                        // Render initial markers (fallback if AI is slow or fails)
                        hazards.forEach(h => {
                            const marker = Leaflet.marker([h.lat, h.lon], {
                                icon: Leaflet.divIcon({
                                    html: '<div class="hazard-icon">↩️</div>',
                                    className: 'custom-hazard-marker',
                                    iconSize: [30, 30],
                                    iconAnchor: [15, 15]
                                })
                            }).addTo(activeMap);

                            const popupContent = `
                                <div class="hazard-popup">
                                    <strong>${h.message}</strong><br>
                                    <small>${h.detail}</small><br>
                                    <p style="margin-top: 5px; color: #8e8e93; font-size: 11px;">
                                        ※3車線以上の可能性があるため、標識を必ず確認してください。
                                    </p>
                                </div>
                            `;
                            marker.bindPopup(popupContent);
                            hazardMarkers.push(marker);
                        });

                        // Distance from OSRM (meters to km)
                        distance = parseFloat((route.distance / 1000).toFixed(1));
                        // Duration: Distance / 30km/h
                        duration = Math.round((distance / 30) * 60);

                        if (isOverview) {
                            activeMap.fitBounds(routeLayer.getBounds(), {
                                padding: [50, 50]
                            });
                        }
            route = route; // Ensure binding updates
                    } else {
                        // Fallback to straight line
                        route = null;
                        const startPos = [userLat, userLon];
                        routeLayer = Leaflet.polyline([startPos, destLatLng], {
                            color: '#007aff',
                            weight: 6,
                            opacity: 0.6,
                            dashArray: '10, 10'
                        }).addTo(activeMap);
                        hazards = [];

                        if (isOverview) {
                            activeMap.fitBounds(Leaflet.latLngBounds([startPos, destLatLng]), {
                                padding: [50, 50]
                            });
                        }
                    }
                });
            }
        } else if (activeMap && !destination) {
            if (destMarker) destMarker.remove();
            if (routeLayer) routeLayer.remove();
            hazardMarkers.forEach(m => m.remove());
            hazardMarkers = [];
            prohibitedLayers.forEach(l => l.remove());
            prohibitedLayers = [];
            destMarker = null;
            routeLayer = null;
            distance = 0;
            duration = 0;
            hazards = [];
            prohibitedSections = [];
            route = null;
        }
    });

    // Heading-up Rotation Effect
    $effect(() => {
        if (activeMap && browser) {
            const container = activeMap.getContainer();
            if (isNavigating) {
                container.style.transform = `rotate(${-heading}deg)`;
                container.style.transition = 'transform 0.1s ease-out';
            } else {
                container.style.transform = 'rotate(0deg)';
            }
        }
    });

    // Theme Switching Effect
    $effect(() => {
        const Leaflet = L;
        if (activeMap && tileLayer && Leaflet) {
            const newUrl = isDark 
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            
            if (tileLayer._url !== newUrl) {
                activeMap.removeLayer(tileLayer);
                tileLayer = Leaflet.tileLayer(newUrl, { maxZoom: 19 }).addTo(activeMap);
            }
        }
    });
</script>

<div bind:this={mapElement} class="map-container"></div>

<style>
    .map-container {
        width: 100%;
        height: 100%;
        z-index: 1;
    }

    :global(.hazard-icon) {
        background: white;
        border: 2px solid #ff3b30;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }

    :global(.hazard-icon.is-ai-high) {
        background: #ffcc00;
        border-color: #ff9500;
        width: 45px;
        height: 45px;
        font-size: 28px;
        z-index: 1000;
        box-shadow: 0 4px 15px rgba(255, 149, 0, 0.4);
    }

    :global(.prohibited-icon) {
        background: #ff3b30;
        border: 2px solid white;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: white;
        box-shadow: 0 4px 15px rgba(255, 59, 48, 0.4);
        z-index: 1001;
        transition: transform 0.3s;
    }

    :global(.prohibited-icon.is-strict) {
        background: #1c1c1e;
        border-color: #ff3b30;
        box-shadow: 0 0 20px rgba(255, 59, 48, 0.6);
        animation: prohibitive-pulse 2s infinite;
    }

    @keyframes prohibitive-pulse {
        0% { transform: scale(1); box-shadow: 0 0 10px rgba(255, 59, 48, 0.6); }
        50% { transform: scale(1.1); box-shadow: 0 0 25px rgba(255, 59, 48, 0.8); }
        100% { transform: scale(1); box-shadow: 0 0 10px rgba(255, 59, 48, 0.6); }
    }
</style>
