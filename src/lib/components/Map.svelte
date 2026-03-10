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
        userLon = $bindable(null)
    } = $props();

    let map;
    let mapElement;
    let userMarker;
    let userCircle;
    let destMarker;
    let routeLayer; // Changed from routeLine to handle GeoJSON
    /** @type {any} */
    let L = $state(null);
    /** @type {any} */
    let activeMap = $state(null);

    async function fetchRoute(start, end) {
        const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.code === 'Ok' && data.routes.length > 0) {
                return data.routes[0];
            }
        } catch (error) {
            console.error('OSRM fetch error:', error);
        }
        return null;
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

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
            }).addTo(mapInstance);

            if ("geolocation" in navigator) {
                watchId = navigator.geolocation.watchPosition(
                    (position) => {
                        const { latitude, longitude, accuracy } = position.coords;
                        userLat = latitude;
                        userLon = longitude;
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

                        // Only auto-center if not in overview mode
                        if (!isOverview) {
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
                    
                    if (route) {
                        // Success: Render the road path
                        routeLayer = Leaflet.geoJSON(route.geometry, {
                            style: {
                                color: '#007aff',
                                weight: 8,
                                opacity: 0.7
                            }
                        }).addTo(activeMap);

                        // Distance from OSRM (meters to km)
                        distance = parseFloat((route.distance / 1000).toFixed(1));
                        // Duration: Distance / 30km/h
                        duration = Math.round((distance / 30) * 60);

                        if (isOverview) {
                            activeMap.fitBounds(routeLayer.getBounds(), {
                                padding: [50, 50]
                            });
                        }
                    } else {
                        // Fallback to straight line if API fails
                        const startPos = [userLat, userLon];
                        routeLayer = Leaflet.polyline([startPos, destLatLng], {
                            color: '#007aff',
                            weight: 6,
                            opacity: 0.6,
                            dashArray: '10, 10'
                        }).addTo(activeMap);

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
            destMarker = null;
            routeLayer = null;
            distance = 0;
            duration = 0;
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
</style>
