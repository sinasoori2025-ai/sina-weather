
/* =========================================================
   SINA WEATHER
   Complete app.js
   Open-Meteo + GPS + Radar + ESP8266 + Advanced Animation
   ========================================================= */

"use strict";

/* =========================================================
   1. CONFIGURATION
   ========================================================= */

const CONFIG = {
    defaultLocation: {
        name: "Tehran",
        latitude: 35.7219,
        longitude: 51.3347
    },

    forecastDays: 14,
    refreshInterval: 10 * 60 * 1000,
    stationRefreshInterval: 5000,

    openMeteo: "https://api.open-meteo.com/v1/forecast",
    geocoding: "https://geocoding-api.open-meteo.com/v1/search",
    rainViewer: "https://api.rainviewer.com/public/weather-maps.json"
};

/* =========================================================
   2. HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
};

const setHTML = (id, value) => {
    const el = $(id);
    if (el) el.innerHTML = value;
};

const formatNumber = (value, digits = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "--";
};

const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================================
   3. APPLICATION STATE
   ========================================================= */

let currentLocation = { ...CONFIG.defaultLocation };
let currentWeatherData = null;
let currentWeatherMode = "clear";

let forecastRefreshTimer = null;
let stationRefreshTimer = null;

let radarMap = null;
let radarLayer = null;
let radarMarker = null;

let stationChartData = [];

let esp8266Address =
    localStorage.getItem("sinaEspAddress") || "";

let stationConnected = false;
let manualWeatherOverride = null;

let alertSettings = {
    rain: true,
    heavyRain: true,
    snow: true,
    hail: true,
    storm: true,
    wind: true,
    rainThreshold: 5,
    windThreshold: 40
};

let previousAlertStates = {};

/* =========================================================
   4. WEATHER CODES
   ========================================================= */

const WEATHER_CODES = {
    0: { description: "Clear sky", icon: "☀️", mode: "clear" },
    1: { description: "Mainly clear", icon: "🌤️", mode: "clear" },
    2: { description: "Partly cloudy", icon: "⛅", mode: "cloudy" },
    3: { description: "Overcast", icon: "☁️", mode: "cloudy" },
    45: { description: "Fog", icon: "🌫️", mode: "fog" },
    48: { description: "Depositing rime fog", icon: "🌫️", mode: "fog" },
    51: { description: "Light drizzle", icon: "🌦️", mode: "rain" },
    53: { description: "Moderate drizzle", icon: "🌦️", mode: "rain" },
    55: { description: "Dense drizzle", icon: "🌧️", mode: "rain" },
    56: { description: "Freezing drizzle", icon: "🌧️", mode: "sleet" },
    57: { description: "Heavy freezing drizzle", icon: "🌧️", mode: "sleet" },
    61: { description: "Slight rain", icon: "🌧️", mode: "rain" },
    63: { description: "Moderate rain", icon: "🌧️", mode: "rain" },
    65: { description: "Heavy rain", icon: "🌧️", mode: "heavy-rain" },
    66: { description: "Freezing rain", icon: "🌧️", mode: "sleet" },
    67: { description: "Heavy freezing rain", icon: "🌧️", mode: "sleet" },
    71: { description: "Slight snowfall", icon: "🌨️", mode: "snow" },
    73: { description: "Moderate snowfall", icon: "🌨️", mode: "snow" },
    75: { description: "Heavy snowfall", icon: "❄️", mode: "snow" },
    77: { description: "Snow grains", icon: "❄️", mode: "snow" },
    80: { description: "Rain showers", icon: "🌦️", mode: "rain" },
    81: { description: "Moderate rain showers", icon: "🌧️", mode: "rain" },
    82: { description: "Violent rain showers", icon: "🌧️", mode: "heavy-rain" },
    85: { description: "Snow showers", icon: "🌨️", mode: "snow" },
    86: { description: "Heavy snow showers", icon: "❄️", mode: "snow" },
    95: { description: "Thunderstorm", icon: "⛈️", mode: "storm" },
    96: { description: "Thunderstorm with hail", icon: "⛈️", mode: "hail" },
    99: { description: "Severe thunderstorm with hail", icon: "⛈️", mode: "hail" }
};

function getWeatherInfo(code) {
    return WEATHER_CODES[code] || {
        description: "Unknown conditions",
        icon: "🌡️",
        mode: "cloudy"
    };
}

/* =========================================================
   5. WEATHER SCENE CONFIGURATION
   ========================================================= */

const WEATHER_SCENES = {
    clear: {
        clouds: 3, rain: 0, snow: 0,
        wind: 0.35, tree: 0.3, lightning: false
    },

    cloudy: {
        clouds: 8, rain: 0, snow: 0,
        wind: 0.7, tree: 0.5, lightning: false
    },

    wind: {
        clouds: 9, rain: 0, snow: 0,
        wind: 2, tree: 2, lightning: false
    },

    rain: {
        clouds: 11, rain: 100, snow: 0,
        wind: 1.1, tree: 1, lightning: false
    },

    "heavy-rain": {
        clouds: 13, rain: 220, snow: 0,
        wind: 2.1, tree: 2, lightning: false
    },

    storm: {
        clouds: 15, rain: 260, snow: 0,
        wind: 3, tree: 3, lightning: true
    },

    hail: {
        clouds: 15, rain: 100, snow: 100,
        wind: 3, tree: 3, lightning: true
    },

    snow: {
        clouds: 10, rain: 0, snow: 130,
        wind: 1, tree: 0.8, lightning: false
    },

    sleet: {
        clouds: 12, rain: 80, snow: 70,
        wind: 1.5, tree: 1.4, lightning: false
    },

    fog: {
        clouds: 7, rain: 0, snow: 0,
        wind: 0.25, tree: 0.2, lightning: false
    }
};

/* =========================================================
   6. WEATHER API
   ========================================================= */

async function getWeather(latitude, longitude) {
    const params = new URLSearchParams({
        latitude,
        longitude,

        current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "is_day",
            "precipitation",
            "rain",
            "showers",
            "snowfall",
            "weather_code",
            "cloud_cover",
            "pressure_msl",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m"
        ].join(","),

        hourly: [
            "temperature_2m",
            "relative_humidity_2m",
            "precipitation_probability",
            "precipitation",
            "rain",
            "snowfall",
            "weather_code",
            "wind_speed_10m",
            "wind_gusts_10m",
            "visibility",
            "uv_index"
        ].join(","),

        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "sunrise",
            "sunset",
            "uv_index_max",
            "precipitation_sum",
            "rain_sum",
            "snowfall_sum",
            "precipitation_probability_max",
            "wind_speed_10m_max",
            "wind_gusts_10m_max"
        ].join(","),

        timezone: "auto",
        forecast_days: CONFIG.forecastDays
    });

    const response = await fetch(
        `${CONFIG.openMeteo}?${params}`
    );

    if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
    }

    return response.json();
}

/* =========================================================
   7. LOAD WEATHER
   ========================================================= */

async function loadWeather() {
    const refreshButton = $("weatherRefresh");

    if (refreshButton) {
        refreshButton.classList.add("loading");
    }

    try {
        const data = await getWeather(
            currentLocation.latitude,
            currentLocation.longitude
        );

        currentWeatherData = data;

        renderCurrentWeather(data);
        renderHourlyForecast(data);
        renderWeeklyForecast(data);
        renderEnvironment(data);
        renderSunInfo(data);

        const info = getWeatherInfo(
            data.current.weather_code
        );

        currentWeatherMode = info.mode;

        if (!manualWeatherOverride) {
            setWeatherTheme(info.mode);
        }

        checkWeatherAlerts(data);

        setText(
            "lastUpdated",
            "Updated " + new Date().toLocaleTimeString()
        );

        setText("weatherStatus", "Weather data updated");

    } catch (error) {
        console.error("Weather error:", error);
        setText("weatherStatus", "Unable to load weather data");

    } finally {
        if (refreshButton) {
            refreshButton.classList.remove("loading");
        }
    }
}

/* =========================================================
   8. CURRENT WEATHER
   ========================================================= */

function renderCurrentWeather(data) {
    const current = data.current;
    const info = getWeatherInfo(current.weather_code);

    sceneWindSpeed = Number(current.wind_speed_10m) || 0;
    sceneTemperature = Number(current.temperature_2m) || 20;

    setText("locationName", currentLocation.name);
    setText("currentTemperature", `${Math.round(current.temperature_2m)}°`);
    setText("currentDescription", info.description);
    setText("currentWeatherIcon", info.icon);
    setText("feelsLike", `${Math.round(current.apparent_temperature)}°`);

    setText("humidity", `${current.relative_humidity_2m}%`);
    setText("windSpeed", `${formatNumber(current.wind_speed_10m)} km/h`);
    setText("windDirection", `${Math.round(current.wind_direction_10m)}°`);
    setText("windGust", `${formatNumber(current.wind_gusts_10m)} km/h`);
    setText("pressure", `${Math.round(current.pressure_msl)} hPa`);
    setText("cloudCover", `${current.cloud_cover}%`);

    setText("rainAmount", `${formatNumber(current.precipitation, 1)} mm`);
    setText("currentRain", `${formatNumber(current.rain, 1)} mm`);
    setText("currentSnow", `${formatNumber(current.snowfall, 1)} cm`);

    const visibility = data.hourly.visibility?.[0];

    setText(
        "visibility",
        visibility != null
            ? `${formatNumber(visibility / 1000, 1)} km`
            : "--"
    );

    setText("uvIndex", formatNumber(data.hourly.uv_index?.[0]));
    setText("dayNight", current.is_day ? "Daytime" : "Nighttime");

    // پشتیبانی از شناسه‌های جزئیات در HTML
    setText("humidityDetail", `${current.relative_humidity_2m}%`);
    setText("windSpeedDetail", `${formatNumber(current.wind_speed_10m)} km/h`);
    setText("pressureDetail", `${Math.round(current.pressure_msl)} hPa`);
    setText("cloudCoverDetail", `${current.cloud_cover}%`);
}

/* =========================================================
   9. HOURLY FORECAST
   ========================================================= */

function renderHourlyForecast(data) {
    const container = $("hourlyForecast");
    if (!container) return;

    const hourly = data.hourly;
    const now = new Date();

    let startIndex = hourly.time.findIndex(
        time => new Date(time) >= now
    );

    if (startIndex < 0) startIndex = 0;

    const items = hourly.time.slice(startIndex, startIndex + 24);

    container.innerHTML = items.map((time, index) => {
        const i = startIndex + index;
        const date = new Date(time);

        const hour = date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });

        const info = getWeatherInfo(hourly.weather_code[i]);
        const temperature = Math.round(hourly.temperature_2m[i]);
        const probability = hourly.precipitation_probability?.[i] ?? 0;

        return `
            <div class="hour-item">
                <span class="hour-time">${hour}</span>
                <span class="hour-icon">${info.icon}</span>
                <strong class="hour-temperature">${temperature}°</strong>
                <span class="hour-rain">💧 ${probability}%</span>
            </div>
        `;
    }).join("");
}

/* =========================================================
   10. 14 DAY FORECAST
   ========================================================= */

function renderWeeklyForecast(data) {
    const container = $("weeklyForecast");
    if (!container) return;

    const daily = data.daily;

    container.innerHTML = daily.time.map((time, i) => {
        const date = new Date(`${time}T12:00:00`);

        const day = date.toLocaleDateString("en", {
            weekday: "short"
        });

        const dateLabel = date.toLocaleDateString("en", {
            day: "numeric",
            month: "short"
        });

        const info = getWeatherInfo(daily.weather_code[i]);
        const max = Math.round(daily.temperature_2m_max[i]);
        const min = Math.round(daily.temperature_2m_min[i]);

        const rain = daily.precipitation_probability_max?.[i] ?? 0;
        const wind = daily.wind_speed_10m_max?.[i] ?? 0;

        return `
            <div class="week-item">
                <div class="week-date">
                    <strong>${day}</strong>
                    <small>${dateLabel}</small>
                </div>

                <span class="week-icon">${info.icon}</span>
                <span class="week-description">${info.description}</span>
                <span class="week-rain">💧 ${rain}%</span>
                <span class="week-wind">${Math.round(wind)} km/h</span>

                <div class="week-temperatures">
                    <strong>${max}°</strong>
                    <span>${min}°</span>
                </div>
            </div>
        `;
    }).join("");
}

/* =========================================================
   11. ENVIRONMENT
   ========================================================= */

function renderEnvironment(data) {
    const current = data.current;
    const daily = data.daily;

    setText("environmentRain", `${formatNumber(daily.rain_sum?.[0], 1)} mm`);
    setText("environmentSnow", `${formatNumber(daily.snowfall_sum?.[0], 1)} cm`);
    setText("environmentWind", `${formatNumber(daily.wind_speed_10m_max?.[0])} km/h`);
    setText("environmentGust", `${formatNumber(daily.wind_gusts_10m_max?.[0])} km/h`);
    setText("environmentHumidity", `${current.relative_humidity_2m}%`);
    setText("environmentPressure", `${Math.round(current.pressure_msl)} hPa`);
}

/* =========================================================
   12. SUNRISE / SUNSET
   ========================================================= */

function renderSunInfo(data) {
    const daily = data.daily;
    if (!daily.sunrise?.length) return;

    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);

    setText("sunrise", sunrise.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    }));

    setText("sunset", sunset.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    }));
}

/* =========================================================
   13. LOCATION SEARCH
   ========================================================= */

async function searchLocation(query) {
    if (!query || query.trim().length < 2) return;

    try {
        const params = new URLSearchParams({
            name: query.trim(),
            count: 8,
            language: "en",
            format: "json"
        });

        const response = await fetch(
            `${CONFIG.geocoding}?${params}`
        );

        if (!response.ok) {
            throw new Error("Location search failed");
        }

        const result = await response.json();
        renderLocationResults(result.results || []);

    } catch (error) {
        console.error(error);
        setText("locationSearchStatus", "Location search failed");
    }
}

function renderLocationResults(results) {
    const container = $("locationResults");
    if (!container) return;

    if (!results.length) {
        container.innerHTML =
            `<div class="search-empty">No locations found</div>`;
        return;
    }

    container.innerHTML = results.map((place, index) => {
        const region = [
            place.admin1,
            place.country
        ].filter(Boolean).join(", ");

        return `
            <button
                class="location-result"
                data-location-index="${index}"
                type="button">
                <strong>${escapeHTML(place.name)}</strong>
                <small>${escapeHTML(region)}</small>
            </button>
        `;
    }).join("");

    container.querySelectorAll("[data-location-index]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const place =
                    results[Number(button.dataset.locationIndex)];

                selectLocation({
                    name: place.name,
                    latitude: place.latitude,
                    longitude: place.longitude
                });

                container.innerHTML = "";

                const input = $("locationSearch");
                if (input) input.value = "";
            });
        });
}

function selectLocation(location) {
    currentLocation = location;

    localStorage.setItem(
        "sinaWeatherLocation",
        JSON.stringify(location)
    );

    setText("locationName", location.name);

    loadWeather();
    updateRadarLocation();
}

/* =========================================================
   14. GPS
   ========================================================= */

function useGPSLocation() {
    if (!navigator.geolocation) {
        setText("locationSearchStatus", "GPS is not supported");
        return;
    }

    setText("locationSearchStatus", "Getting your location...");

    navigator.geolocation.getCurrentPosition(
        async position => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            let name = "My Location";

            try {
                const params = new URLSearchParams({
                    latitude,
                    longitude,
                    count: 1,
                    language: "en",
                    format: "json"
                });

                const response = await fetch(
                    `https://geocoding-api.open-meteo.com/v1/reverse?${params}`
                );

                const result = await response.json();

                if (result.results?.length) {
                    name = result.results[0].name;
                }
            } catch (error) {
                console.warn("Reverse geocoding unavailable");
            }

            selectLocation({
                name,
                latitude,
                longitude
            });

            setText("locationSearchStatus", "GPS location updated");
        },

        error => {
            console.error(error);
            setText(
                "locationSearchStatus",
                "Unable to access GPS. Check browser permission."
            );
        },

        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}

/* =========================================================
   15. MOUNTAIN WEATHER
   ========================================================= */

async function loadMountainWeather(
    latitude,
    longitude,
    mountainName = "Mountain"
) {
    try {
        const data = await getWeather(latitude, longitude);
        const current = data.current;
        const info = getWeatherInfo(current.weather_code);

        const result = {
            name: mountainName,
            temperature: current.temperature_2m,
            feelsLike: current.apparent_temperature,
            wind: current.wind_speed_10m,
            gusts: current.wind_gusts_10m,
            humidity: current.relative_humidity_2m,
            precipitation: current.precipitation,
            snowfall: current.snowfall,
            pressure: current.pressure_msl,
            description: info.description,
            icon: info.icon,
            mode: info.mode,
            daily: data.daily
        };

        renderMountainWeather(result);
        return result;

    } catch (error) {
        console.error("Mountain weather error:", error);
        setText("mountainStatus", "Unable to load mountain weather");
        return null;
    }
}

function renderMountainWeather(weather) {
    setText("mountainName", weather.name);
    setText("mountainTemperature", `${Math.round(weather.temperature)}°`);
    setText("mountainDescription", weather.description);
    setText("mountainIcon", weather.icon);
    setText("mountainWind", `${Math.round(weather.wind)} km/h`);
    setText("mountainGust", `${Math.round(weather.gusts)} km/h`);
    setText("mountainHumidity", `${weather.humidity}%`);
    setText("mountainPrecipitation", `${weather.precipitation} mm`);
    setText("mountainSnow", `${weather.snowfall} cm`);
    setText("mountainPressure", `${Math.round(weather.pressure)} hPa`);
    setText("mountainStatus", "Mountain forecast updated");
}

/* =========================================================
   16. WEATHER ALERTS
   ========================================================= */

function checkWeatherAlerts(data) {
    const current = data.current;
    const code = current.weather_code;

    const rain = current.precipitation || 0;
    const wind = current.wind_speed_10m || 0;
    const gust = current.wind_gusts_10m || 0;

    const alerts = [];

    if (alertSettings.rain && rain >= alertSettings.rainThreshold) {
        alerts.push({
            id: "rain",
            title: "Rain alert",
            description: `Current precipitation: ${rain} mm`,
            severity: "medium"
        });
    }

    if (
        alertSettings.heavyRain &&
        ([65, 82].includes(code) || rain >= 10)
    ) {
        alerts.push({
            id: "heavy-rain",
            title: "Heavy rain warning",
            description: "Heavy rainfall conditions detected",
            severity: "high"
        });
    }

    if (alertSettings.snow && code >= 71 && code <= 86) {
        alerts.push({
            id: "snow",
            title: "Snow warning",
            description: "Snowfall is currently reported",
            severity: "medium"
        });
    }

    if (alertSettings.storm && [95, 96, 99].includes(code)) {
        alerts.push({
            id: "storm",
            title: "Thunderstorm warning",
            description: "Thunderstorm conditions reported",
            severity: "high"
        });
    }

    if (alertSettings.hail && [96, 99].includes(code)) {
        alerts.push({
            id: "hail",
            title: "Hail warning",
            description: "Hail is reported in the forecast",
            severity: "high"
        });
    }

    if (
        alertSettings.wind &&
        (
            wind >= alertSettings.windThreshold ||
            gust >= alertSettings.windThreshold
        )
    ) {
        alerts.push({
            id: "wind",
            title: "Strong wind warning",
            description: `Wind: ${wind} km/h, gusts: ${gust} km/h`,
            severity: "high"
        });
    }

    renderWeatherAlerts(alerts);

    alerts.forEach(alert => {
        if (!previousAlertStates[alert.id]) {
            notifyWeatherAlert(alert);
        }

        previousAlertStates[alert.id] = true;
    });

    Object.keys(previousAlertStates).forEach(id => {
        if (!alerts.some(alert => alert.id === id)) {
            previousAlertStates[id] = false;
        }
    });
}

function renderWeatherAlerts(alerts) {
    const container = $("weatherAlerts");
    if (!container) return;

    if (!alerts.length) {
        container.innerHTML = `
            <div class="alert-empty">
                <span>✓</span>
                <p>No active weather alerts</p>
            </div>
        `;
        return;
    }

    container.innerHTML = alerts.map(alert => `
        <div class="weather-alert ${alert.severity}">
            <div class="alert-symbol">⚠</div>
            <div class="alert-content">
                <strong>${escapeHTML(alert.title)}</strong>
                <p>${escapeHTML(alert.description)}</p>
            </div>
        </div>
    `).join("");
}

function notifyWeatherAlert(alert) {
    if (
        !("Notification" in window) ||
        Notification.permission !== "granted"
    ) return;

    new Notification(alert.title, {
        body: alert.description,
        icon: "icon.png"
    });
}

async function enableWeatherNotifications() {
    if (!("Notification" in window)) {
        setText("notificationStatus", "Notifications are not supported");
        return;
    }

    const permission = await Notification.requestPermission();

    setText(
        "notificationStatus",
        permission === "granted"
            ? "Notifications enabled"
            : "Notifications not enabled"
    );
}

/* =========================================================
   17. ALERT SETTINGS
   ========================================================= */

function updateAlertSettings() {
    const fields = {
        rain: "alertRain",
        heavyRain: "alertHeavyRain",
        snow: "alertSnow",
        hail: "alertHail",
        storm: "alertStorm",
        wind: "alertWind"
    };

    Object.entries(fields).forEach(([key, id]) => {
        const element = $(id);
        if (element) alertSettings[key] = element.checked;
    });

    const rainThreshold = $("alertRainThreshold");
    const windThreshold = $("alertWindThreshold");

    if (rainThreshold) {
        alertSettings.rainThreshold = Number(rainThreshold.value);
    }

    if (windThreshold) {
        alertSettings.windThreshold = Number(windThreshold.value);
    }

    localStorage.setItem(
        "sinaWeatherAlerts",
        JSON.stringify(alertSettings)
    );
}

/* =========================================================
   18. RADAR MAP
   ========================================================= */

function initializeRadar() {
    const mapElement = $("radarMap");
    if (!mapElement) return;

    if (typeof L === "undefined") {
        setText("radarStatus", "Leaflet library was not loaded");
        return;
    }

    if (radarMap) {
        setTimeout(() => radarMap.invalidateSize(), 200);
        return;
    }

    radarMap = L.map("radarMap", {
        zoomControl: true,
        attributionControl: true
    }).setView([
        currentLocation.latitude,
        currentLocation.longitude
    ], 7);

    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
            attribution: "&copy; OpenStreetMap &copy; CARTO",
            maxZoom: 19
        }
    ).addTo(radarMap);

    radarMarker = L.marker([
        currentLocation.latitude,
        currentLocation.longitude
    ]).addTo(radarMap).bindPopup(currentLocation.name);

    setTimeout(() => radarMap.invalidateSize(), 300);

    loadRadar();
}

async function loadRadar() {
    if (!radarMap) return;

    try {
        setText("radarStatus", "Loading radar...");

        const response = await fetch(CONFIG.rainViewer);

        if (!response.ok) {
            throw new Error("Radar service unavailable");
        }

        const data = await response.json();

        const frames = [
            ...(data.radar?.past || []),
            ...(data.radar?.nowcast || [])
        ];

        if (!frames.length) {
            throw new Error("No radar frames available");
        }

        const latest = frames[frames.length - 1];

        const tileUrl =
            `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

        if (radarLayer) {
            radarMap.removeLayer(radarLayer);
        }

        radarLayer = L.tileLayer(tileUrl, {
            opacity: 0.7,
            zIndex: 10,
            maxNativeZoom: 7
        });

        radarLayer.addTo(radarMap);

        setText("radarStatus", "Radar updated");

    } catch (error) {
        console.error("Radar error:", error);
        setText("radarStatus", "Radar is temporarily unavailable");
    }
}

function updateRadarLocation() {
    if (!radarMap) return;

    radarMap.setView([
        currentLocation.latitude,
        currentLocation.longitude
    ], 7);

    if (radarMarker) {
        radarMarker.setLatLng([
            currentLocation.latitude,
            currentLocation.longitude
        ]);

        radarMarker.setPopupContent(currentLocation.name);
    }
}

/* =========================================================
   19. ESP8266 CONNECTION
   ========================================================= */

function normalizeESPAddress(address) {
    let result = String(address || "").trim();

    if (!result) return "";

    if (
        !result.startsWith("http://") &&
        !result.startsWith("https://")
    ) {
        result = "http://" + result;
    }

    return result.replace(/\/+$/, "");
}

async function connectESP8266() {
    const input = $("espAddress");

    const address = normalizeESPAddress(
        input?.value || esp8266Address
    );

    if (!address) {
        setText("stationStatus", "Enter your ESP8266 IP address");
        return;
    }

    esp8266Address = address;

    localStorage.setItem("sinaEspAddress", address);

    await fetchStationData();
}

async function fetchStationData() {
    if (!esp8266Address) {
        setText("stationStatus", "ESP8266 address not configured");
        return;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);

        const response = await fetch(
            `${esp8266Address}/api/data`,
            {
                cache: "no-store",
                signal: controller.signal
            }
        );

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`ESP8266 HTTP ${response.status}`);
        }

        const data = await response.json();

        stationConnected = true;

        renderStationData(data);

        const status = $("stationStatus");

        if (status) {
            status.classList.add("connected");
            status.textContent = "Connected to ESP8266";
        }

    } catch (error) {
        stationConnected = false;

        const status = $("stationStatus");

        if (status) {
            status.classList.remove("connected");
            status.textContent = "ESP8266 offline or unreachable";
        }

        setText("balconyTemp", "--");
        setText("balconyHumidity", "--");
        setText("balconyWind", "--");
        setText("balconyRain", "--");

        console.warn("ESP8266 connection:", error);
    }
}

/* =========================================================
   20. BALCONY STATION DATA
   ========================================================= */

function renderStationData(data) {
    const temperature =
        data.temperature ??
        data.temp ??
        data.temperature_c ??
        data.tempC;

    const humidity =
        data.humidity ??
        data.relative_humidity;

    const wind =
        data.wind ??
        data.windSpeed ??
        data.wind_speed;

    const rain =
        data.rain ??
        data.rainfall ??
        data.precipitation;

    const validTemperature =
        temperature !== null &&
        temperature !== undefined &&
        Number.isFinite(Number(temperature));

    const validHumidity =
        humidity !== null &&
        humidity !== undefined &&
        Number.isFinite(Number(humidity));

    setText(
        "balconyTemp",
        validTemperature
            ? `${Number(temperature).toFixed(1)}°C`
            : "--"
    );

    setText(
        "balconyHumidity",
        validHumidity
            ? `${Number(humidity).toFixed(0)}%`
            : "--"
    );

    setText(
        "balconyWind",
        wind != null && Number.isFinite(Number(wind))
            ? `${Number(wind).toFixed(1)} km/h`
            : "--"
    );

    setText(
        "balconyRain",
        rain != null && Number.isFinite(Number(rain))
            ? `${Number(rain).toFixed(1)} mm`
            : "--"
    );

    if (validTemperature) {
        stationChartData.push({
            time: new Date(),
            temperature: Number(temperature)
        });

        if (stationChartData.length > 30) {
            stationChartData.shift();
        }

        drawStationChart();
    }
}

/* =========================================================
   21. STATION CHART
   ========================================================= */

function drawStationChart() {
    const canvas = $("stationChart");

    if (!canvas || !stationChartData.length) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 200;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const values = stationChartData.map(
        item => item.temperature
    );

    let min = Math.min(...values) - 2;
    let max = Math.max(...values) + 2;

    if (max <= min) max = min + 1;

    const padding = 25;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;

    for (let i = 0; i < 4; i++) {
        const y = padding + (graphHeight / 3) * i;

        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    const points = values.map((value, index) => ({
        x: padding +
            (index / Math.max(values.length - 1, 1)) * graphWidth,

        y: padding +
            (1 - (value - min) / (max - min)) * graphHeight
    }));

    if (!points.length) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    points.forEach(point => {
        ctx.lineTo(point.x, point.y);
    });

    ctx.strokeStyle = "#56d9e8";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    if (points.length > 1) {
        const gradient = ctx.createLinearGradient(
            0, padding, 0, height
        );

        gradient.addColorStop(0, "rgba(86,217,232,.25)");
        gradient.addColorStop(1, "rgba(86,217,232,0)");

        ctx.lineTo(points[points.length - 1].x, height - padding);
        ctx.lineTo(points[0].x, height - padding);
        ctx.closePath();

        ctx.fillStyle = gradient;
        ctx.fill();
    }
}

/* =========================================================
   22. ATMOSPHERIC ANIMATION ENGINE
   ========================================================= */

const weatherCanvas = $("weatherEffects");
const weatherCtx = weatherCanvas
    ? weatherCanvas.getContext("2d")
    : null;

let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;

let atmosphereMode = "clear";
let sceneWindSpeed = 0;
let sceneTemperature = 20;

let clouds = [];
let particles = [];
let birds = [];

let lightningTimer = 0;
let lightningFlash = 0;
let lightningBolts = [];

let lastFrameTime = 0;
let animationFrame = null;

/* =========================================================
   23. CANVAS SIZE AND SCENE
   ========================================================= */

function resizeCanvas() {
    if (!weatherCanvas || !weatherCtx) return;

    const ratio = Math.min(
        window.devicePixelRatio || 1,
        2
    );

    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;

    weatherCanvas.width = canvasWidth * ratio;
    weatherCanvas.height = canvasHeight * ratio;

    weatherCanvas.style.width = `${canvasWidth}px`;
    weatherCanvas.style.height = `${canvasHeight}px`;

    weatherCtx.setTransform(ratio, 0, 0, ratio, 0, 0);

    createWeatherScene();
}

function createWeatherScene() {
    const config =
        WEATHER_SCENES[atmosphereMode] ||
        WEATHER_SCENES.clear;

    createClouds(config.clouds);
    createParticles(config);
    createBirds();
}

function createClouds(amount) {
    clouds = [];

    for (let i = 0; i < amount; i++) {
        clouds.push({
            x: Math.random() * canvasWidth,
            y: Math.random() * canvasHeight * 0.38,
            width: 120 + Math.random() * 180,
            height: 35 + Math.random() * 40,
            speed: 0.025 + Math.random() * 0.055,
            opacity: 0.12 + Math.random() * 0.15
        });
    }
}

function createParticles(config) {
    particles = [];

    const amount = config.rain + config.snow;

    for (let i = 0; i < amount; i++) {
        const isSnow = i >= config.rain;

        particles.push({
            x: Math.random() * canvasWidth,
            y: Math.random() * canvasHeight,

            speed: isSnow
                ? 0.4 + Math.random() * 1.2
                : 5 + Math.random() * 7,

            length: isSnow
                ? 2 + Math.random() * 4
                : 7 + Math.random() * 15,

            size: isSnow
                ? 1 + Math.random() * 2.5
                : 1,

            isSnow,
            sway: Math.random() * 5
        });
    }
}

/* =========================================================
   24. BIRDS
   ========================================================= */

function createBirds() {
    birds = [];

    for (let i = 0; i < 6; i++) {
        birds.push({
            x: Math.random() * canvasWidth,
            y: 50 + Math.random() * canvasHeight * 0.28,
            speed: 0.15 + Math.random() * 0.25,
            size: 5 + Math.random() * 5,
            phase: Math.random() * Math.PI * 2
        });
    }
}

function drawBird(bird, time) {
    const ctx = weatherCtx;
    const wing = Math.sin(time * 0.006 + bird.phase) * 4;

    ctx.save();
    ctx.translate(bird.x, bird.y);

    ctx.strokeStyle = "rgba(25,35,48,.72)";
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(-bird.size, 0);

    ctx.quadraticCurveTo(
        -bird.size / 2,
        -wing,
        0,
        0
    );

    ctx.quadraticCurveTo(
        bird.size / 2,
        -wing,
        bird.size,
        0
    );

    ctx.stroke();
    ctx.restore();
}

function updateBirds(delta, time) {
    if (["storm", "hail", "heavy-rain"].includes(atmosphereMode)) {
        return;
    }

    birds.forEach(bird => {
        bird.x += bird.speed * delta;

        bird.y += Math.sin(
            time * 0.0008 + bird.phase
        ) * 0.08 * delta;

        if (bird.x > canvasWidth + 30) {
            bird.x = -30;
            bird.y = 40 + Math.random() * canvasHeight * 0.3;
        }

        drawBird(bird, time);
    });
}

/* =========================================================
   25. MOUNTAINS
   ========================================================= */

function drawMountains() {
    const ctx = weatherCtx;
    if (!ctx) return;

    const base = canvasHeight * 0.72;

    ctx.beginPath();
    ctx.moveTo(0, base);

    ctx.lineTo(canvasWidth * 0.13, base - 130);
    ctx.lineTo(canvasWidth * 0.25, base - 40);
    ctx.lineTo(canvasWidth * 0.42, base - 180);
    ctx.lineTo(canvasWidth * 0.58, base - 55);
    ctx.lineTo(canvasWidth * 0.75, base - 150);
    ctx.lineTo(canvasWidth * 0.92, base - 60);
    ctx.lineTo(canvasWidth, base - 100);

    ctx.lineTo(canvasWidth, canvasHeight);
    ctx.lineTo(0, canvasHeight);
    ctx.closePath();

    const mountainGradient = ctx.createLinearGradient(
        0, base - 200, 0, canvasHeight
    );

    mountainGradient.addColorStop(
        0,
        atmosphereMode === "storm"
            ? "rgba(44,57,72,.75)"
            : "rgba(93,119,139,.42)"
    );

    mountainGradient.addColorStop(1, "rgba(27,49,64,.72)");

    ctx.fillStyle = mountainGradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, canvasHeight * 0.84);
    ctx.lineTo(canvasWidth * 0.2, canvasHeight * 0.65);
    ctx.lineTo(canvasWidth * 0.38, canvasHeight * 0.82);
    ctx.lineTo(canvasWidth * 0.62, canvasHeight * 0.63);
    ctx.lineTo(canvasWidth * 0.8, canvasHeight * 0.81);
    ctx.lineTo(canvasWidth, canvasHeight * 0.68);
    ctx.lineTo(canvasWidth, canvasHeight);
    ctx.lineTo(0, canvasHeight);
    ctx.closePath();

    ctx.fillStyle = "rgba(26,51,59,.42)";
    ctx.fill();

    if (
        atmosphereMode === "snow" ||
        atmosphereMode === "sleet" ||
        sceneTemperature <= 0
    ) {
        ctx.fillStyle = "rgba(245,250,255,.8)";

        const peaks = [
            [canvasWidth * 0.13, base - 130],
            [canvasWidth * 0.42, base - 180],
            [canvasWidth * 0.75, base - 150]
        ];

        peaks.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.moveTo(x - 27, y + 34);
            ctx.lineTo(x, y);
            ctx.lineTo(x + 28, y + 35);
            ctx.lineTo(x + 12, y + 27);
            ctx.lineTo(x, y + 13);
            ctx.lineTo(x - 12, y + 29);
            ctx.closePath();
            ctx.fill();
        });
    }
}

/* =========================================================
   26. CLOUDS
   ========================================================= */

function drawCloud(cloud) {
    const ctx = weatherCtx;

    const stormy = [
        "storm",
        "hail",
        "heavy-rain"
    ].includes(atmosphereMode);

    const gradient = ctx.createLinearGradient(
        cloud.x,
        cloud.y,
        cloud.x,
        cloud.y + cloud.height
    );

    if (stormy) {
        gradient.addColorStop(0, "rgba(65,76,98,.72)");
        gradient.addColorStop(1, "rgba(17,27,44,.88)");
    } else {
        gradient.addColorStop(0, "rgba(220,232,245,.38)");
        gradient.addColorStop(1, "rgba(115,145,175,.16)");
    }

    ctx.save();
    ctx.globalAlpha = cloud.opacity;
    ctx.fillStyle = gradient;

    ctx.beginPath();

    ctx.ellipse(
        cloud.x,
        cloud.y + cloud.height * 0.55,
        cloud.width * 0.42,
        cloud.height * 0.45,
        0, 0, Math.PI * 2
    );

    ctx.ellipse(
        cloud.x - cloud.width * 0.22,
        cloud.y + cloud.height * 0.5,
        cloud.width * 0.25,
        cloud.height * 0.55,
        0, 0, Math.PI * 2
    );

    ctx.ellipse(
        cloud.x + cloud.width * 0.2,
        cloud.y + cloud.height * 0.4,
        cloud.width * 0.28,
        cloud.height * 0.62,
        0, 0, Math.PI * 2
    );

    ctx.fill();
    ctx.restore();
}

function drawAllClouds(delta) {
    const config = WEATHER_SCENES[atmosphereMode];

    const windFactor = clamp(
        0.55 + sceneWindSpeed / 45,
        0.4,
        2.2
    );

    clouds.forEach(cloud => {
        cloud.x +=
            cloud.speed *
            config.wind *
            windFactor *
            delta;

        if (cloud.x > canvasWidth + cloud.width) {
            cloud.x = -cloud.width;
            cloud.y = Math.random() * canvasHeight * 0.38;
        }

        drawCloud(cloud);
    });
}

/* =========================================================
   27. RAIN / SNOW
   ========================================================= */

function drawWeatherParticles(delta) {
    const ctx = weatherCtx;
    const config = WEATHER_SCENES[atmosphereMode];

    particles.forEach(particle => {
        const wind = config.wind + sceneWindSpeed / 25;

        particle.x += wind * delta * 0.025;

        particle.y +=
            particle.speed *
            delta *
            (particle.isSnow ? 0.025 : 0.06);

        if (particle.isSnow) {
            particle.x += Math.sin(
                performance.now() / 1000 + particle.sway
            ) * 0.3;

            ctx.beginPath();
            ctx.arc(
                particle.x,
                particle.y,
                particle.size,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = "rgba(255,255,255,.82)";
            ctx.fill();

        } else {
            ctx.beginPath();

            ctx.moveTo(particle.x, particle.y);

            ctx.lineTo(
                particle.x - wind * 0.8,
                particle.y + particle.length
            );

            ctx.strokeStyle =
                atmosphereMode === "hail"
                    ? "rgba(220,240,255,.9)"
                    : "rgba(155,210,255,.55)";

            ctx.lineWidth =
                atmosphereMode === "hail" ? 2 : 1;

            ctx.stroke();
        }

        if (particle.y > canvasHeight) {
            particle.y = -20;
            particle.x = Math.random() * canvasWidth;
        }

        if (particle.x > canvasWidth + 20) {
            particle.x = -20;
        }
    });
}

/* =========================================================
   28. FOUR DIFFERENT TREES
   ========================================================= */

function drawPineTree(x, ground, height, sway) {
    const ctx = weatherCtx;

    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(sway * 0.025);

    ctx.fillStyle = "#493c32";
    ctx.fillRect(-4, -height * 0.25, 8, height * 0.25);

    for (let i = 0; i < 4; i++) {
        const y = -height + i * height * 0.2;
        const width = height * (0.24 - i * 0.035);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(-width, y + height * 0.28);
        ctx.lineTo(width, y + height * 0.28);
        ctx.closePath();

        ctx.fillStyle = [
            "#214d42",
            "#285a48",
            "#32634c",
            "#3b6c50"
        ][i];

        ctx.fill();
    }

    ctx.restore();
}

function drawCypressTree(x, ground, height, sway) {
    const ctx = weatherCtx;

    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(sway * 0.02);

    ctx.fillStyle = "#285a4c";
    ctx.beginPath();

    ctx.moveTo(0, -height);

    ctx.bezierCurveTo(
        -height * 0.32,
        -height * 0.65,
        -height * 0.18,
        -height * 0.15,
        0,
        0
    );

    ctx.bezierCurveTo(
        height * 0.18,
        -height * 0.15,
        height * 0.32,
        -height * 0.65,
        0,
        -height
    );

    ctx.fill();

    ctx.fillStyle = "#594438";
    ctx.fillRect(-3, -12, 6, 12);

    ctx.restore();
}

function drawRoundTree(x, ground, height, sway) {
    const ctx = weatherCtx;

    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(sway * 0.035);

    ctx.fillStyle = "#604637";
    ctx.fillRect(-5, -height * 0.42, 10, height * 0.42);

    const crownY = -height * 0.55;

    [
        [-height * 0.16, 0],
        [height * 0.15, 0],
        [0, -height * 0.16],
        [0, height * 0.12]
    ].forEach(([dx, dy]) => {
        ctx.beginPath();

        ctx.arc(
            dx,
            crownY + dy,
            height * 0.22,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "#477b56";
        ctx.fill();
    });

    ctx.restore();
}

function drawAutumnTree(x, ground, height, sway) {
    const ctx = weatherCtx;

    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(sway * 0.035);

    ctx.strokeStyle = "#594537";
    ctx.lineWidth = 7;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -height * 0.65);
    ctx.moveTo(0, -height * 0.4);
    ctx.lineTo(-height * 0.25, -height * 0.75);
    ctx.moveTo(0, -height * 0.5);
    ctx.lineTo(height * 0.25, -height * 0.8);
    ctx.stroke();

    const leaves = [
        [-height * 0.25, -height * 0.72],
        [height * 0.25, -height * 0.78],
        [0, -height * 0.88],
        [-height * 0.08, -height * 0.55],
        [height * 0.12, -height * 0.58]
    ];

    leaves.forEach(([lx, ly], i) => {
        ctx.beginPath();

        ctx.arc(
            lx,
            ly,
            height * 0.13,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = [
            "#bd7138",
            "#d18b3d",
            "#a84d32",
            "#c28a3e",
            "#b65c35"
        ][i];

        ctx.fill();
    });

    ctx.restore();
}

function drawFourTrees(time) {
    const ground = canvasHeight + 4;

    const baseHeight = Math.min(
        canvasHeight * 0.31,
        230
    );

    const wind =
        WEATHER_SCENES[atmosphereMode].tree +
        sceneWindSpeed / 25;

    const sway = Math.sin(time / 650) * wind;

    const positions = [
        canvasWidth * 0.07,
        canvasWidth * 0.24,
        canvasWidth * 0.78,
        canvasWidth * 0.94
    ];

    drawPineTree(
        positions[0],
        ground,
        baseHeight * 0.9,
        sway
    );

    drawCypressTree(
        positions[1],
        ground,
        baseHeight * 1.15,
        sway
    );

    drawRoundTree(
        positions[2],
        ground,
        baseHeight,
        sway
    );

    drawAutumnTree(
        positions[3],
        ground,
        baseHeight * 0.95,
        sway
    );
}

/* =========================================================
   29. SQUIRREL
   ========================================================= */

function drawSquirrel(time) {
    if (sceneTemperature > 8) return;

    if (["heavy-rain", "storm", "hail"].includes(atmosphereMode)) {
        return;
    }

    const ctx = weatherCtx;
    const x = canvasWidth * 0.70;
    const y = canvasHeight * 0.91;
    const bob = Math.sin(time / 450) * 2;

    ctx.save();
    ctx.translate(x, y + bob);

    // Tail
    ctx.strokeStyle = "#a66a3d";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(-4, -8);

    ctx.bezierCurveTo(
        -35, -35,
        -32, -65,
        -10, -55
    );

    ctx.stroke();

    // Body
    ctx.fillStyle = "#a96e42";
    ctx.beginPath();
    ctx.ellipse(0, -12, 13, 19, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(8, -35, 12, 0, Math.PI * 2);
    ctx.fill();

    // Ear
    ctx.beginPath();
    ctx.moveTo(1, -44);
    ctx.lineTo(3, -56);
    ctx.lineTo(10, -45);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#171717";
    ctx.beginPath();
    ctx.arc(13, -37, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = "#e6c29b";
    ctx.beginPath();
    ctx.ellipse(5, -10, 6, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

/* =========================================================
   30. HUMAN CHARACTER
   ========================================================= */

function drawHuman(time) {
    const ctx = weatherCtx;

    const x = canvasWidth * 0.52;
    const ground = canvasHeight * 0.96;

    const walking = Math.sin(time / 230) * 2;

    const cold = sceneTemperature <= 8;
    const veryCold = sceneTemperature <= 0;

    const rainy = [
        "rain",
        "heavy-rain",
        "storm",
        "hail",
        "sleet"
    ].includes(atmosphereMode);

    const snowy = [
        "snow",
        "sleet"
    ].includes(atmosphereMode);

    ctx.save();
    ctx.translate(x, ground);

    // Legs
    ctx.strokeStyle = "#26313b";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(-5, -28);
    ctx.lineTo(-7 + walking, -5);
    ctx.moveTo(5, -28);
    ctx.lineTo(8 - walking, -5);
    ctx.stroke();

    // Shoes
    ctx.fillStyle = "#222a31";

    ctx.beginPath();
    ctx.ellipse(-9 + walking, -4, 8, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(10 - walking, -4, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Coat / shirt
    ctx.fillStyle = veryCold
        ? "#354b67"
        : cold
            ? "#536d7c"
            : rainy
                ? "#456b79"
                : "#6b9272";

    ctx.beginPath();

    if (ctx.roundRect) {
        ctx.roundRect(-12, -65, 24, 38, 7);
    } else {
        ctx.rect(-12, -65, 24, 38);
    }

    ctx.fill();

    // Arms
    ctx.strokeStyle = cold ? "#354b67" : "#c28b69";
    ctx.lineWidth = 5;

    ctx.beginPath();
    ctx.moveTo(-10, -58);
    ctx.lineTo(-17, -37 + walking);
    ctx.moveTo(10, -58);
    ctx.lineTo(17, -37 - walking);
    ctx.stroke();

    // Head
    ctx.fillStyle = "#d4a17d";
    ctx.beginPath();
    ctx.arc(0, -78, 11, 0, Math.PI * 2);
    ctx.fill();

    // Hat
    if (cold || snowy || rainy) {
        ctx.fillStyle = veryCold ? "#293d55" : "#4a5e69";

        ctx.beginPath();
        ctx.arc(0, -82, 12, Math.PI, Math.PI * 2);
        ctx.fill();

        if (veryCold) {
            ctx.fillRect(-12, -83, 24, 5);

            // Scarf
            ctx.fillStyle = "#c48a55";
            ctx.fillRect(-11, -67, 22, 5);
        }
    } else {
        ctx.fillStyle = "#493b32";
        ctx.beginPath();
        ctx.arc(0, -83, 10, Math.PI, Math.PI * 2);
        ctx.fill();
    }

    // Umbrella
    if (rainy) {
        ctx.strokeStyle = "#343f52";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(0, -91);
        ctx.lineTo(0, -120);
        ctx.stroke();

        ctx.fillStyle = "rgba(80,145,190,.9)";
        ctx.beginPath();
        ctx.arc(0, -120, 24, Math.PI, Math.PI * 2);
        ctx.lineTo(24, -120);
        ctx.quadraticCurveTo(18, -111, 12, -120);
        ctx.quadraticCurveTo(6, -111, 0, -120);
        ctx.quadraticCurveTo(-6, -111, -12, -120);
        ctx.quadraticCurveTo(-18, -111, -24, -120);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

/* =========================================================
   31. FOG
   ========================================================= */

function drawFog(time) {
    if (atmosphereMode !== "fog") return;

    const ctx = weatherCtx;

    for (let i = 0; i < 4; i++) {
        const y = canvasHeight * (0.38 + i * 0.13);
        const offset = Math.sin(time / 5000 + i) * 70;

        const gradient = ctx.createLinearGradient(
            0, y, canvasWidth, y
        );

        gradient.addColorStop(0, "rgba(220,230,238,0)");
        gradient.addColorStop(0.5, "rgba(220,230,238,.13)");
        gradient.addColorStop(1, "rgba(220,230,238,0)");

        ctx.fillStyle = gradient;

        ctx.fillRect(
            offset - 100,
            y,
            canvasWidth + 200,
            65
        );
    }
}

/* =========================================================
   32. FOUR LIGHTNING TYPES
   ========================================================= */

function createLightningBolt(type) {
    const xStart =
        Math.random() * canvasWidth * 0.8 +
        canvasWidth * 0.1;

    const points = [];
    let x = xStart;
    let y = 0;

    points.push({ x, y });

    const segments = type === 3 ? 15 : 10;

    for (let i = 0; i < segments; i++) {
        x += Math.random() * 45 - 22;
        y += canvasHeight * 0.045;

        points.push({ x, y });
    }

    lightningBolts.push({
        points,
        life: 1,
        type
    });

    if (type === 1 || type === 3) {
        const middle = points[
            Math.floor(points.length / 2)
        ];

        lightningBolts.push({
            points: [
                { x: middle.x, y: middle.y },
                {
                    x: middle.x + 35,
                    y: middle.y + 35
                },
                {
                    x: middle.x + 70,
                    y: middle.y + 65
                }
            ],
            life: 0.8,
            type
        });
    }
}

function drawLightning() {
    const ctx = weatherCtx;

    lightningBolts.forEach(bolt => {
        const points = bolt.points;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        points.slice(1).forEach(point => {
            ctx.lineTo(point.x, point.y);
        });

        ctx.strokeStyle =
            bolt.type === 2
                ? `rgba(150,205,255,${bolt.life})`
                : `rgba(235,245,255,${bolt.life})`;

        ctx.lineWidth = bolt.type === 3 ? 4 : 2.5;
        ctx.shadowColor = "#a9d8ff";
        ctx.shadowBlur = bolt.type === 3 ? 35 : 20;

        ctx.stroke();
        ctx.restore();

        bolt.life -= 0.09;
    });

    lightningBolts =
        lightningBolts.filter(bolt => bolt.life > 0);
}

function updateLightning(delta) {
    const config = WEATHER_SCENES[atmosphereMode];

    if (!config?.lightning) {
        lightningBolts = [];
        lightningFlash = 0;
        return;
    }

    lightningTimer += delta;

    if (lightningTimer > 1700 + Math.random() * 3200) {
        lightningTimer = 0;

        const type = Math.floor(Math.random() * 4);

        createLightningBolt(type);
        lightningFlash = 0.8;
    }

    if (lightningFlash > 0) {
        lightningFlash = Math.max(
            0,
            lightningFlash - delta * 0.002
        );

        weatherCtx.fillStyle =
            `rgba(225,238,255,${lightningFlash * 0.12})`;

        weatherCtx.fillRect(
            0, 0, canvasWidth, canvasHeight
        );
    }

    drawLightning();
}

/* =========================================================
   33. WEATHER THEME
   ========================================================= */

function setWeatherTheme(mode) {
    if (!WEATHER_SCENES[mode]) {
        mode = "clear";
    }

    atmosphereMode = mode;

    document.body.classList.forEach(className => {
        if (className.startsWith("weather-")) {
            document.body.classList.remove(className);
        }
    });

    document.body.classList.add(`weather-${mode}`);

    createWeatherScene();
}

/* =========================================================
   34. MAIN ANIMATION LOOP
   ========================================================= */

function animateAtmosphere(timestamp = 0) {
    if (!weatherCtx) return;

    const delta = Math.min(
        timestamp - (lastFrameTime || timestamp),
        40
    );

    lastFrameTime = timestamp;

    weatherCtx.clearRect(
        0, 0, canvasWidth, canvasHeight
    );

    drawMountains();
    drawAllClouds(delta);
    drawWeatherParticles(delta);
    drawFog(timestamp);
    drawFourTrees(timestamp);
    updateBirds(delta, timestamp);
    drawSquirrel(timestamp);
    drawHuman(timestamp);
    updateLightning(delta);

    animationFrame =
        requestAnimationFrame(animateAtmosphere);
}

/* =========================================================
   35. BALCONY WEATHER SIMULATOR
   ========================================================= */

function applyBalconyWeather() {
    const selector = $("balconyWeatherMode");
    if (!selector) return;

    const mode = selector.value;

    if (mode === "auto") {
        resetBalconyWeather();
        return;
    }

    manualWeatherOverride = mode;
    setWeatherTheme(mode);

    const messages = {
        clear: "Clear sky simulation activated",
        cloudy: "Cloudy weather simulation activated",
        wind: "Wind simulation activated",
        rain: "Rain simulation activated",
        "heavy-rain": "Heavy rain simulation activated",
        storm: "Thunderstorm simulation activated",
        hail: "Hailstorm simulation activated",
        snow: "Snow simulation activated",
        sleet: "Rain and snow simulation activated",
        fog: "Fog simulation activated"
    };

    setText(
        "balconyWeatherStatus",
        messages[mode] || "Weather simulation activated"
    );
}

function resetBalconyWeather() {
    manualWeatherOverride = null;

    if (currentWeatherData) {
        const info = getWeatherInfo(
            currentWeatherData.current.weather_code
        );

        setWeatherTheme(info.mode);
    } else {
        setWeatherTheme("clear");
    }

    const selector = $("balconyWeatherMode");
    if (selector) selector.value = "auto";

    setText(
        "balconyWeatherStatus",
        "Automatic weather mode is active."
    );
}

/* =========================================================
   36. NAVIGATION
   ========================================================= */

function initializeNavigation() {
    const navButtons =
        document.querySelectorAll("[data-page]");

    navButtons.forEach(button => {
        button.addEventListener("click", () => {
            const pageName = button.dataset.page;

            document.querySelectorAll(".page")
                .forEach(page => page.classList.remove("active"));

            document.querySelectorAll("[data-page]")
                .forEach(item => item.classList.remove("active"));

            const target = $(`${pageName}Page`);

            if (target) {
                target.classList.add("active");
            }

            button.classList.add("active");

            if (pageName === "radar") {
                initializeRadar();

                setTimeout(() => {
                    radarMap?.invalidateSize();
                }, 250);
            }

            if (pageName === "station") {
                drawStationChart();
                fetchStationData();
            }
        });
    });
}

/* =========================================================
   37. SEARCH EVENTS
   ========================================================= */

function initializeSearch() {
    const input = $("locationSearch");
    const button = $("locationSearchButton");
    const gpsButton = $("gpsButton");

    if (button) {
        button.addEventListener("click", () => {
            searchLocation(input?.value || "");
        });
    }

    if (input) {
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                searchLocation(input.value);
            }
        });
    }

    if (gpsButton) {
        gpsButton.addEventListener("click", useGPSLocation);
    }
}

/* =========================================================
   38. STATION EVENTS
   ========================================================= */

function initializeStation() {
    const connectButton = $("connectESP");

    if (connectButton) {
        connectButton.addEventListener(
            "click",
            connectESP8266
        );
    }

    const addressInput = $("espAddress");

    if (addressInput && esp8266Address) {
        addressInput.value = esp8266Address;
    }

    const applyButton = $("applyBalconyWeather");

    if (applyButton) {
        applyButton.addEventListener(
            "click",
            applyBalconyWeather
        );
    }

    const resetButton = $("resetBalconyWeather");

    if (resetButton) {
        resetButton.addEventListener(
            "click",
            resetBalconyWeather
        );
    }
}

/* =========================================================
   39. RADAR EVENTS
   ========================================================= */

function initializeRadarEvents() {
    const refreshButton = $("radarRefresh");

    if (refreshButton) {
        refreshButton.addEventListener("click", loadRadar);
    }
}

/* =========================================================
   40. ALERT EVENTS
   ========================================================= */

function initializeAlertEvents() {
    const notificationButton = $("enableNotifications");

    if (notificationButton) {
        notificationButton.addEventListener(
            "click",
            enableWeatherNotifications
        );
    }

    const alertInputs = [
        "alertRain",
        "alertHeavyRain",
        "alertSnow",
        "alertHail",
        "alertStorm",
        "alertWind",
        "alertRainThreshold",
        "alertWindThreshold"
    ];

    alertInputs.forEach(id => {
        const element = $(id);

        if (element) {
            element.addEventListener(
                "change",
                updateAlertSettings
            );
        }
    });

    const saved = localStorage.getItem("sinaWeatherAlerts");

    if (saved) {
        try {
            alertSettings = {
                ...alertSettings,
                ...JSON.parse(saved)
            };
        } catch (error) {
            console.warn("Alert settings could not be restored");
        }
    }

    const fields = {
        rain: "alertRain",
        heavyRain: "alertHeavyRain",
        snow: "alertSnow",
        hail: "alertHail",
        storm: "alertStorm",
        wind: "alertWind"
    };

    Object.entries(fields).forEach(([key, id]) => {
        const element = $(id);

        if (element) {
            element.checked = Boolean(alertSettings[key]);
        }
    });

    if ($("alertRainThreshold")) {
        $("alertRainThreshold").value =
            alertSettings.rainThreshold;
    }

    if ($("alertWindThreshold")) {
        $("alertWindThreshold").value =
            alertSettings.windThreshold;
    }
}

/* =========================================================
   41. MOUNTAIN SEARCH
   ========================================================= */

function initializeMountainSearch() {
    const button = $("mountainSearchButton");
    const input = $("mountainSearch");

    if (!button || !input) return;

    button.addEventListener("click", async () => {
        const query = input.value.trim();
        if (!query) return;

        try {
            const params = new URLSearchParams({
                name: query,
                count: 1,
                language: "en",
                format: "json"
            });

            const response = await fetch(
                `${CONFIG.geocoding}?${params}`
            );

            const result = await response.json();

            if (!result.results?.length) {
                setText("mountainStatus", "Mountain location not found");
                return;
            }

            const place = result.results[0];

            loadMountainWeather(
                place.latitude,
                place.longitude,
                place.name
            );

        } catch (error) {
            console.error(error);
            setText("mountainStatus", "Mountain search failed");
        }
    });

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            button.click();
        }
    });
}

/* =========================================================
   42. RESTORE LOCATION
   ========================================================= */

function restoreLocation() {
    const saved = localStorage.getItem("sinaWeatherLocation");
    if (!saved) return;

    try {
        const location = JSON.parse(saved);

        if (
            location.name &&
            Number.isFinite(Number(location.latitude)) &&
            Number.isFinite(Number(location.longitude))
        ) {
            currentLocation = {
                name: location.name,
                latitude: Number(location.latitude),
                longitude: Number(location.longitude)
            };
        }
    } catch (error) {
        console.warn("Saved location could not be restored");
    }
}

/* =========================================================
   43. REFRESH TIMERS
   ========================================================= */

function startRefreshTimers() {
    if (forecastRefreshTimer) {
        clearInterval(forecastRefreshTimer);
    }

    if (stationRefreshTimer) {
        clearInterval(stationRefreshTimer);
    }

    forecastRefreshTimer = setInterval(
        loadWeather,
        CONFIG.refreshInterval
    );

    stationRefreshTimer = setInterval(
        fetchStationData,
        CONFIG.stationRefreshInterval
    );
}

/* =========================================================
   44. GENERAL BUTTONS
   ========================================================= */

function initializeGeneralButtons() {
    const refresh = $("weatherRefresh");

    if (refresh) {
        refresh.addEventListener("click", loadWeather);
    }
}

/* =========================================================
   45. APPLICATION START
   ========================================================= */

async function startApp() {
    console.log("SINA WEATHER starting...");

    restoreLocation();

    initializeNavigation();
    initializeSearch();
    initializeStation();
    initializeRadarEvents();
    initializeAlertEvents();
    initializeMountainSearch();
    initializeGeneralButtons();

    window.addEventListener("resize", resizeCanvas);

    resizeCanvas();

    if (!animationFrame) {
        animateAtmosphere();
    }

    await loadWeather();

    if (esp8266Address) {
        fetchStationData();
    } else {
        setText(
            "stationStatus",
            "Enter your ESP8266 IP address"
        );
    }

    startRefreshTimers();

    console.log("SINA WEATHER ready.");
}

/* =========================================================
   46. START APPLICATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    startApp();
});

/* =========================================================
   SINA WEATHER - FOREST, WILDLIFE & OUTDOOR SAFETY EXPANSION
   Add this section at the VERY END of app.js
   ========================================================= */

"use strict";

/* =========================================================
   47. NEW CONFIGURATION
   ========================================================= */

CONFIG.airQuality =
    "https://air-quality-api.open-meteo.com/v1/air-quality";

CONFIG.mountainElevation =
    "https://api.open-meteo.com/v1/forecast";

let currentAirQuality = null;
let currentMountainData = null;

let forestSnow = 0;
let forestAnimals = [];
let forestLeaves = [];
let forestPerson = {
    x: -100,
    direction: 1,
    wave: 0,
    walking: true,
    pause: 0
};

let forestCabin = {
    snow: 0,
    smoke: 0
};

let forestLastTime = 0;

/* =========================================================
   48. DIRECTION-AWARE WIND
   ========================================================= */

// Meteorological direction means where wind comes FROM.
// A wind from west (270°) pushes trees toward east (90°).

function getDownwindDirection(degrees) {
    const direction = Number(degrees);

    if (!Number.isFinite(direction)) return 0;

    const radians = (direction + 180) * Math.PI / 180;

    return {
        x: Math.cos(radians),
        y: Math.sin(radians)
    };
}

function getWindBend(time, heightFactor = 1) {
    const speed = Math.max(0, sceneWindSpeed);
    const direction = currentWeatherData?.current?.wind_direction_10m ?? 270;

    const vector = getDownwindDirection(direction);

    const strength = clamp(speed / 65, 0, 1.5);
    const gust = currentWeatherData?.current?.wind_gusts_10m ?? speed;

    const gustFactor = clamp(gust / 50, 0.3, 2);

    const wave = Math.sin(time / 550) * 0.35;

    return {
        x: vector.x * strength * gustFactor * heightFactor + wave * strength,
        y: vector.y * strength * gustFactor * heightFactor
    };
}

/* =========================================================
   49. REAL WIND TREE DRAWING
   ========================================================= */

function drawWindPine(x, ground, height, time, variant = 0) {
    const ctx = weatherCtx;
    if (!ctx) return;

    const bend = getWindBend(time, height / 180);
    const angle = clamp(bend.x * 0.17, -0.38, 0.38);

    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(angle);

    ctx.fillStyle = "#514237";
    ctx.fillRect(-4, -height * 0.12, 8, height * 0.12);

    const layers = 5;

    for (let i = 0; i < layers; i++) {
        const y = -height + i * height * 0.17;
        const width = height * (0.27 - i * 0.035);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(-width, y + height * 0.28);
        ctx.lineTo(width, y + height * 0.28);
        ctx.closePath();

        const colors = [
            "#153d35",
            "#1d4b3d",
            "#245b45",
            "#2b654a",
            "#34734e"
        ];

        ctx.fillStyle = colors[(i + variant) % colors.length];
        ctx.fill();
    }

    if (forestSnow > 0) {
        ctx.fillStyle = `rgba(245,250,255,${forestSnow})`;

        for (let i = 0; i < 4; i++) {
            const y = -height + i * height * 0.2;

            ctx.beginPath();
            ctx.moveTo(0, y + 5);
            ctx.lineTo(-height * 0.12, y + height * 0.22);
            ctx.lineTo(height * 0.12, y + height * 0.22);
            ctx.closePath();
            ctx.fill();
        }
    }

    ctx.restore();
}

function drawForestTrees(time) {
    if (!weatherCtx) return;

    const ground = canvasHeight + 4;

    const height = Math.min(canvasHeight * 0.34, 260);

    const positions = [
        [canvasWidth * 0.02, height * 0.9],
        [canvasWidth * 0.14, height * 1.2],
        [canvasWidth * 0.31, height * 0.85],
        [canvasWidth * 0.70, height * 0.95],
        [canvasWidth * 0.84, height * 1.2],
        [canvasWidth * 0.97, height * 0.9]
    ];

    positions.forEach(([x, h], i) => {
        drawWindPine(x, ground, h, time, i);
    });
}

/* =========================================================
   50. FOREST CABIN
   ========================================================= */

function drawForestCabin(time) {
    const ctx = weatherCtx;
    if (!ctx) return;

    const x = canvasWidth * 0.42;
    const y = canvasHeight * 0.73;
    const scale = clamp(canvasWidth / 1200, 0.55, 1.2);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Cabin body
    ctx.fillStyle = "#604b3c";
    ctx.fillRect(-58, -65, 116, 68);

    // Wooden wall details
    ctx.strokeStyle = "rgba(35,24,18,.4)";
    ctx.lineWidth = 2;

    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(-55, -55 + i * 12);
        ctx.lineTo(55, -55 + i * 12);
        ctx.stroke();
    }

    // Roof
    ctx.beginPath();
    ctx.moveTo(-72, -63);
    ctx.lineTo(0, -118);
    ctx.lineTo(72, -63);
    ctx.closePath();

    ctx.fillStyle = "#392f2b";
    ctx.fill();

    // Snow on roof
    if (forestSnow > 0) {
        ctx.beginPath();
        ctx.moveTo(-75, -65);
        ctx.lineTo(0, -122);
        ctx.lineTo(75, -65);
        ctx.lineTo(63, -68);
        ctx.lineTo(0, -110);
        ctx.lineTo(-63, -68);
        ctx.closePath();

        ctx.fillStyle = `rgba(245,250,255,${forestSnow})`;
        ctx.fill();
    }

    // Door
    ctx.fillStyle = "#30251e";
    ctx.fillRect(-12, -43, 25, 46);

    // Windows
    ctx.fillStyle = "rgba(255,190,90,.9)";
    ctx.fillRect(-45, -48, 22, 20);
    ctx.fillRect(24, -48, 22, 20);

    // Window frames
    ctx.strokeStyle = "#2b211c";
    ctx.lineWidth = 3;

    ctx.strokeRect(-45, -48, 22, 20);
    ctx.strokeRect(24, -48, 22, 20);

    ctx.beginPath();
    ctx.moveTo(-34, -48);
    ctx.lineTo(-34, -28);
    ctx.moveTo(35, -48);
    ctx.lineTo(35, -28);
    ctx.stroke();

    // Chimney
    ctx.fillStyle = "#49362e";
    ctx.fillRect(30, -115, 14, 38);

    // Smoke
    forestCabin.smoke += 0.015;

    for (let i = 0; i < 4; i++) {
        const smokeY = -120 - ((time / 80 + i * 17) % 65);
        const smokeX = 37 + Math.sin(time / 700 + i) * 8;

        ctx.beginPath();
        ctx.arc(smokeX, smokeY, 5 + i * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210,220,225,${0.16 - i * 0.025})`;
        ctx.fill();
    }

    ctx.restore();
}

/* =========================================================
   51. SNOW ACCUMULATION
   ========================================================= */

function updateForestSnow(delta) {
    const isSnowing =
        atmosphereMode === "snow" ||
        atmosphereMode === "sleet";

    if (isSnowing) {
        forestSnow = clamp(
            forestSnow + delta * 0.000018,
            0,
            1
        );
    } else if (
        sceneTemperature > 2 &&
        atmosphereMode !== "snow"
    ) {
        forestSnow = Math.max(
            0,
            forestSnow - delta * 0.000004
        );
    }

    if (forestSnow > 0.08) {
        document.body.classList.add("forest-snow");
    } else {
        document.body.classList.remove("forest-snow");
    }
}

/* =========================================================
   52. WILDLIFE
   ========================================================= */

function createForestAnimals() {
    forestAnimals = [
        {
            type: "deer",
            x: canvasWidth * 0.15,
            y: canvasHeight * 0.91,
            speed: 0.025,
            direction: 1,
            phase: 0
        },
        {
            type: "fox",
            x: canvasWidth * 0.85,
            y: canvasHeight * 0.94,
            speed: 0.04,
            direction: -1,
            phase: 2
        },
        {
            type: "rabbit",
            x: canvasWidth * 0.58,
            y: canvasHeight * 0.95,
            speed: 0.035,
            direction: 1,
            phase: 4
        }
    ];
}

function drawDeer(x, y, phase) {
    const ctx = weatherCtx;
    const bob = Math.sin(phase) * 2;

    ctx.save();
    ctx.translate(x, y + bob);

    ctx.fillStyle = "#9a6745";
    ctx.beginPath();
    ctx.ellipse(0, -14, 17, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(13, -27, 7, 9, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#5c3b2c";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-9, -10);
    ctx.lineTo(-11, 0);
    ctx.moveTo(8, -10);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // Antlers
    ctx.strokeStyle = "#4b3629";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(14, -34);
    ctx.lineTo(10, -45);
    ctx.lineTo(6, -49);
    ctx.moveTo(10, -45);
    ctx.lineTo(15, -49);
    ctx.moveTo(17, -34);
    ctx.lineTo(21, -45);
    ctx.stroke();

    ctx.restore();
}

function drawFox(x, y, phase) {
    const ctx = weatherCtx;
    const bob = Math.sin(phase) * 2;

    ctx.save();
    ctx.translate(x, y + bob);

    ctx.fillStyle = "#c66b32";
    ctx.beginPath();
    ctx.ellipse(0, -12, 18, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-12, -13);
    ctx.quadraticCurveTo(-35, -34, -39, -12);
    ctx.quadraticCurveTo(-25, -4, -12, -8);
    ctx.fill();

    ctx.fillStyle = "#f2e7d8";
    ctx.beginPath();
    ctx.arc(-37, -13, 4, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = "#d87535";
    ctx.beginPath();
    ctx.arc(14, -23, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(8, -29);
    ctx.lineTo(7, -41);
    ctx.lineTo(16, -32);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(17, -31);
    ctx.lineTo(25, -41);
    ctx.lineTo(24, -27);
    ctx.fill();

    ctx.restore();
}

function drawRabbit(x, y, phase) {
    const ctx = weatherCtx;
    const hop = Math.abs(Math.sin(phase)) * 4;

    ctx.save();
    ctx.translate(x, y - hop);

    ctx.fillStyle = "#d9d3c8";

    ctx.beginPath();
    ctx.ellipse(0, -9, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(8, -18, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(5, -30, 3, 10, -0.2, 0, Math.PI * 2);
    ctx.ellipse(12, -30, 3, 10, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(11, -19, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function updateForestAnimals(delta, time) {
    if (!forestAnimals.length) {
        createForestAnimals();
    }

    const badWeather = [
        "storm",
        "hail",
        "heavy-rain"
    ].includes(atmosphereMode);

    forestAnimals.forEach(animal => {
        if (badWeather) return;

        animal.phase += delta * 0.004;

        animal.x +=
            animal.speed *
            animal.direction *
            delta;

        if (
            animal.x > canvasWidth + 80 ||
            animal.x < -80
        ) {
            animal.direction *= -1;
        }

        if (animal.type === "deer") {
            drawDeer(animal.x, animal.y, animal.phase);
        } else if (animal.type === "fox") {
            drawFox(animal.x, animal.y, animal.phase);
        } else {
            drawRabbit(animal.x, animal.y, animal.phase);
        }
    });
}

/* =========================================================
   53. WALKING PERSON AND WAVE
   ========================================================= */

function updateForestPerson(delta, time) {
    if (!weatherCtx) return;

    if (forestPerson.pause > 0) {
        forestPerson.pause -= delta;
    } else {
        forestPerson.x +=
            forestPerson.direction * delta * 0.035;

        if (forestPerson.x > canvasWidth * 0.62) {
            forestPerson.direction = -1;
            forestPerson.pause = 3500;
            forestPerson.wave = 1;
        }

        if (forestPerson.x < canvasWidth * 0.38) {
            forestPerson.direction = 1;
            forestPerson.pause = 1800;
            forestPerson.wave = 0;
        }
    }

    const ctx = weatherCtx;
    const x = forestPerson.x;
    const y = canvasHeight * 0.96;

    if (x < -100 || x > canvasWidth + 100) return;

    const step = Math.sin(time / 130) * 3;

    ctx.save();
    ctx.translate(x, y);

    // Legs
    ctx.strokeStyle = "#273746";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(-4, -26);
    ctx.lineTo(-7 + step, 0);
    ctx.moveTo(4, -26);
    ctx.lineTo(7 - step, 0);
    ctx.stroke();

    // Body
    ctx.fillStyle = sceneTemperature < 5 ? "#526a85" : "#497b62";
    ctx.beginPath();
    ctx.roundRect(-10, -62, 20, 36, 6);
    ctx.fill();

    // Head
    ctx.fillStyle = "#d5a17d";
    ctx.beginPath();
    ctx.arc(0, -72, 9, 0, Math.PI * 2);
    ctx.fill();

    // Walking arm
    ctx.strokeStyle = "#d5a17d";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(-9, -54);
    ctx.lineTo(-15, -35 + step);
    ctx.stroke();

    // Waving arm
    const waveAngle = forestPerson.wave
        ? Math.sin(time / 180) * 0.45
        : 0;

    ctx.save();
    ctx.translate(9, -54);
    ctx.rotate(forestPerson.wave ? -1.6 + waveAngle : 0.2);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -24);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
}

/* =========================================================
   54. AIR QUALITY API
   ========================================================= */

async function getAirQuality(latitude, longitude) {
    const params = new URLSearchParams({
        latitude,
        longitude,

        current: [
            "european_aqi",
            "us_aqi",
            "pm10",
            "pm2_5",
            "carbon_monoxide",
            "nitrogen_dioxide",
            "sulphur_dioxide",
            "ozone"
        ].join(","),

        hourly: [
            "european_aqi",
            "us_aqi",
            "pm10",
            "pm2_5",
            "ozone"
        ].join(","),

        timezone: "auto",
        forecast_days: 2
    });

    const response = await fetch(
        `${CONFIG.airQuality}?${params}`
    );

    if (!response.ok) {
        throw new Error(`Air quality API error: ${response.status}`);
    }

    return response.json();
}

function getAQILevel(aqi) {
    const value = Number(aqi);

    if (!Number.isFinite(value)) {
        return {
            label: "Unknown",
            advice: "Air quality data is unavailable.",
            level: "unknown"
        };
    }

    if (value <= 20) {
        return {
            label: "Good",
            advice: "Air quality is generally suitable for outdoor activities.",
            level: "good"
        };
    }

    if (value <= 40) {
        return {
            label: "Fair",
            advice: "Most people can enjoy outdoor activities.",
            level: "fair"
        };
    }

    if (value <= 60) {
        return {
            label: "Moderate",
            advice: "Sensitive people should consider reducing prolonged outdoor exertion.",
            level: "moderate"
        };
    }

    if (value <= 80) {
        return {
            label: "Poor",
            advice: "Reduce prolonged outdoor exercise, especially if sensitive to air pollution.",
            level: "poor"
        };
    }

    if (value <= 100) {
        return {
            label: "Very poor",
            advice: "Avoid strenuous outdoor activity.",
            level: "very-poor"
        };
    }

    return {
        label: "Extremely poor",
        advice: "Avoid outdoor exercise and follow local health guidance.",
        level: "extreme"
    };
}

function getOutdoorWeatherAdvice(weather, aqiInfo) {
    const wind = Number(weather.current.wind_speed_10m) || 0;
    const gust = Number(weather.current.wind_gusts_10m) || 0;
    const code = Number(weather.current.weather_code);
    const rain = Number(weather.current.precipitation) || 0;
    const temperature = Number(weather.current.temperature_2m);

    const warnings = [];

    if ([95, 96, 99].includes(code)) {
        warnings.push("Thunderstorm conditions: postpone outdoor activity.");
    }

    if ([65, 82].includes(code) || rain >= 10) {
        warnings.push("Heavy rain: trails and paths may become slippery.");
    }

    if (wind >= 40 || gust >= 55) {
        warnings.push("Strong wind: exposed routes and wooded areas may be unsafe.");
    }

    if (temperature <= -5) {
        warnings.push("Very cold conditions: use suitable clothing and limit exposure.");
    }

    if (temperature >= 35) {
        warnings.push("High temperature: avoid strenuous activity during the hottest hours.");
    }

    if (aqiInfo.level === "poor" ||
        aqiInfo.level === "very-poor" ||
        aqiInfo.level === "extreme") {
        warnings.push(aqiInfo.advice);
    }

    if (!warnings.length) {
        return "Conditions appear generally suitable for ordinary outdoor activity. Check local conditions before leaving.";
    }

    return warnings.join(" ");
}

function ensureOutdoorPanel() {
    if ($("outdoorSafetyPanel")) return;

    const panel = document.createElement("section");
    panel.id = "outdoorSafetyPanel";
    panel.className = "glass outdoor-safety-panel";

    panel.innerHTML = `
        <h2>Outdoor Activity & Air Quality</h2>
        <div class="outdoor-aqi-grid">
            <div><span>European AQI</span><strong id="outdoorAQI">--</strong></div>
            <div><span>US AQI</span><strong id="outdoorUSAQI">--</strong></div>
            <div><span>PM2.5</span><strong id="outdoorPM25">--</strong></div>
            <div><span>PM10</span><strong id="outdoorPM10">--</strong></div>
            <div><span>Ozone</span><strong id="outdoorOzone">--</strong></div>
            <div><span>NO₂</span><strong id="outdoorNO2">--</strong></div>
        </div>
        <p id="outdoorAQILevel">Loading air quality...</p>
        <p id="outdoorActivityAdvice">Loading outdoor activity advice...</p>
        <p id="outdoorWeatherWarnings"></p>
        <small>Air quality values are modelled estimates from Open-Meteo, not measurements from a local monitoring station.</small>
    `;

    const target =
        $("environmentPage") ||
        $("weatherPage") ||
        document.querySelector(".app-shell") ||
        document.body;

    target.appendChild(panel);
}

async function loadAirQuality() {
    try {
        const data = await getAirQuality(
            currentLocation.latitude,
            currentLocation.longitude
        );

        currentAirQuality = data;

        const current = data.current;

        const europeanAQI = current.european_aqi;
        const usAQI = current.us_aqi;

        const info = getAQILevel(europeanAQI);

        ensureOutdoorPanel();

        setText("outdoorAQI", formatNumber(europeanAQI));
        setText("outdoorUSAQI", formatNumber(usAQI));
        setText("outdoorPM25", formatNumber(current.pm2_5, 1));
        setText("outdoorPM10", formatNumber(current.pm10, 1));
        setText("outdoorOzone", formatNumber(current.ozone, 1));
        setText("outdoorNO2", formatNumber(current.nitrogen_dioxide, 1));

        setText("outdoorAQILevel", `Air quality: ${info.label}`);
        setText("outdoorActivityAdvice", info.advice);

        if (currentWeatherData) {
            setText(
                "outdoorWeatherWarnings",
                getOutdoorWeatherAdvice(currentWeatherData, info)
            );
        }

        const panel = $("outdoorSafetyPanel");

        if (panel) {
            panel.dataset.aqiLevel = info.level;
        }

    } catch (error) {
        console.error("Air quality error:", error);

        ensureOutdoorPanel();

        setText("outdoorAQILevel", "Air quality data unavailable");
        setText("outdoorActivityAdvice", "Do not assume air quality is safe when data is unavailable.");
    }
}

/* =========================================================
   55. MOUNTAIN WEATHER WITH ELEVATION
   ========================================================= */

async function getMountainForecast(latitude, longitude, elevation) {
    const params = new URLSearchParams({
        latitude,
        longitude,
        elevation: String(
            Number.isFinite(Number(elevation))
                ? Number(elevation)
                : 1500
        ),

        current: [
            "temperature_2m",
            "apparent_temperature",
            "relative_humidity_2m",
            "precipitation",
            "rain",
            "snowfall",
            "weather_code",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
            "visibility",
            "pressure_msl",
            "cloud_cover"
        ].join(","),

        hourly: [
            "temperature_2m",
            "precipitation_probability",
            "precipitation",
            "snowfall",
            "weather_code",
            "wind_speed_10m",
            "wind_gusts_10m",
            "visibility",
            "freezing_level_height"
        ].join(","),

        daily: [
            "weather_code",
            "temperature_2m_min",
            "temperature_2m_max",
            "precipitation_sum",
            "snowfall_sum",
            "wind_speed_10m_max",
            "wind_gusts_10m_max"
        ].join(","),

        timezone: "auto",
        forecast_days: 3
    });

    const response = await fetch(
        `${CONFIG.mountainElevation}?${params}`
    );

    if (!response.ok) {
        throw new Error("Mountain forecast unavailable");
    }

    return response.json();
}

function assessMountainRisk(data, elevation) {
    const c = data.current;

    const wind = Number(c.wind_speed_10m) || 0;
    const gust = Number(c.wind_gusts_10m) || 0;
    const code = Number(c.weather_code);
    const visibility = Number(c.visibility);
    const temperature = Number(c.temperature_2m);
    const rain = Number(c.precipitation);
    const snow = Number(c.snowfall);

    const risks = [];

    let level = "low";

    if ([95, 96, 99].includes(code)) {
        risks.push("Thunderstorm forecast: do not start or continue an exposed mountain hike.");
        level = "extreme";
    }

    if (gust >= 60 || wind >= 50) {
        risks.push("Very strong wind: exposed ridges and high terrain can be dangerous.");
        level = "extreme";
    } else if (gust >= 40 || wind >= 35) {
        risks.push("Strong wind: reconsider exposed routes.");
        if (level !== "extreme") level = "high";
    }

    if (visibility > 0 && visibility < 1000) {
        risks.push("Very low visibility: navigation may become difficult.");
        if (level !== "extreme") level = "high";
    } else if (visibility > 0 && visibility < 3000) {
        risks.push("Reduced visibility: use caution and avoid unfamiliar routes.");
        if (level === "low") level = "moderate";
    }

    if (temperature <= 0 && (rain > 0 || snow > 0 || code >= 56)) {
        risks.push("Freezing conditions with precipitation: ice may form on the route.");
        if (level !== "extreme") level = "high";
    }

    if (snow > 0 || (code >= 71 && code <= 86)) {
        risks.push("Snowfall forecast: snow cover and trail conditions may change.");
        if (level === "low") level = "moderate";
    }

    if (rain >= 5) {
        risks.push("Rain may make paths slippery and increase runoff.");
        if (level === "low") level = "moderate";
    }

    if (Number(elevation) >= 3000) {
        risks.push("High elevation: consider altitude, acclimatisation and the possibility of rapidly changing conditions.");
        if (level === "low") level = "moderate";
    }

    if (!risks.length) {
        risks.push("No major hazards detected in the forecast variables. This is not a guarantee of safe trail conditions.");
    }

    return { level, risks };
}

function ensureMountainRiskPanel() {
    if ($("mountainRiskPanel")) return;

    const panel = document.createElement("section");
    panel.id = "mountainRiskPanel";
    panel.className = "glass mountain-risk-panel";

    panel.innerHTML = `
        <h3>Mountain Hiking Safety</h3>
        <p>Elevation: <strong id="mountainElevation">--</strong></p>
        <p>Visibility: <strong id="mountainVisibility">--</strong></p>
        <p>Freezing level: <strong id="mountainFreezingLevel">--</strong></p>
        <p>Risk level: <strong id="mountainRiskLevel">--</strong></p>
        <ul id="mountainRiskList"></ul>
        <small>Forecast-based guidance only. Check official mountain, weather and trail warnings before hiking.</small>
    `;

    const target =
        $("mountainPage") ||
        $("mountainPanel") ||
        document.querySelector(".app-shell") ||
        document.body;

    target.appendChild(panel);
}

function renderMountainRisk(data, elevation) {
    ensureMountainRiskPanel();

    const risk = assessMountainRisk(data, elevation);

    const hourly = data.hourly;

    const freezing = hourly.freezing_level_height?.[0];
    const visibility = data.current.visibility;

    setText(
        "mountainElevation",
        `${Math.round(Number(elevation) || 1500)} m`
    );

    setText(
        "mountainVisibility",
        visibility != null
            ? `${(visibility / 1000).toFixed(1)} km`
            : "--"
    );

    setText(
        "mountainFreezingLevel",
        freezing != null
            ? `${Math.round(freezing)} m`
            : "--"
    );

    setText("mountainRiskLevel", risk.level.toUpperCase());

    const list = $("mountainRiskList");

    if (list) {
        list.innerHTML = risk.risks
            .map(item => `<li>${escapeHTML(item)}</li>`)
            .join("");
    }

    const panel = $("mountainRiskPanel");

    if (panel) {
        panel.dataset.risk = risk.level;
    }
}

/* =========================================================
   56. REPLACE MOUNTAIN SEARCH WITH ELEVATION SUPPORT
   ========================================================= */

initializeMountainSearch = function () {
    const button = $("mountainSearchButton");
    const input = $("mountainSearch");

    if (!button || !input) return;

    async function searchMountain() {
        const query = input.value.trim();

        if (!query) return;

        setText("mountainStatus", "Searching mountain location...");

        try {
            const params = new URLSearchParams({
                name: query,
                count: 5,
                language: "en",
                format: "json"
            });

            const response = await fetch(
                `${CONFIG.geocoding}?${params}`
            );

            if (!response.ok) {
                throw new Error("Mountain search failed");
            }

            const result = await response.json();

            if (!result.results?.length) {
                setText("mountainStatus", "Location not found");
                return;
            }

            const place = result.results[0];

            const elevation =
                Number(place.elevation) > 0
                    ? Number(place.elevation)
                    : 1500;

            const data = await getMountainForecast(
                place.latitude,
                place.longitude,
                elevation
            );

            currentMountainData = data;

            const current = data.current;
            const info = getWeatherInfo(current.weather_code);

            renderMountainWeather({
                name: place.name,
                temperature: current.temperature_2m,
                feelsLike: current.apparent_temperature,
                wind: current.wind_speed_10m,
                gusts: current.wind_gusts_10m,
                humidity: current.relative_humidity_2m,
                precipitation: current.precipitation,
                snowfall: current.snowfall,
                pressure: current.pressure_msl,
                description: info.description,
                icon: info.icon
            });

            renderMountainRisk(data, elevation);

            setText(
                "mountainStatus",
                "Elevation-adjusted mountain forecast updated"
            );

        } catch (error) {
            console.error(error);
            setText("mountainStatus", "Unable to load mountain forecast");
        }
    }

    button.addEventListener("click", searchMountain);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            searchMountain();
        }
    });
};

/* =========================================================
   57. EXTEND CURRENT WEATHER WITH AIR QUALITY
   ========================================================= */

const originalLoadWeather = loadWeather;

loadWeather = async function () {
    await originalLoadWeather();

    if (currentWeatherData) {
        loadAirQuality();
    }
};

/* =========================================================
   58. EXTEND ANIMATION LOOP
   ========================================================= */

const originalAnimateAtmosphere = animateAtmosphere;

animateAtmosphere = function (timestamp = 0) {
    originalAnimateAtmosphere(timestamp);

    if (!weatherCtx) return;

    const delta = Math.min(
        timestamp - (forestLastTime || timestamp),
        40
    );

    forestLastTime = timestamp;

    updateForestSnow(delta);

    drawForestTrees(timestamp);
    drawForestCabin(timestamp);
    updateForestAnimals(delta, timestamp);
    updateForestPerson(delta, timestamp);
};

/* =========================================================
   59. EXTEND RESIZE HANDLER
   ========================================================= */

const originalResizeCanvas = resizeCanvas;

resizeCanvas = function () {
    originalResizeCanvas();

    createForestAnimals();

    forestPerson.x = -100;
};

/* =========================================================
   60. OUTDOOR SAFETY INITIALIZATION
   ========================================================= */

function initializeOutdoorSafety() {
    ensureOutdoorPanel();
    ensureMountainRiskPanel();

    loadAirQuality();
}

/* =========================================================
   61. REFRESH AIR QUALITY
   ========================================================= */

let airQualityRefreshTimer = null;

function startAirQualityRefresh() {
    if (airQualityRefreshTimer) {
        clearInterval(airQualityRefreshTimer);
    }

    airQualityRefreshTimer = setInterval(
        loadAirQuality,
        15 * 60 * 1000
    );
}

/* =========================================================
   62. START NEW FEATURES
   ========================================================= */

const originalStartApp = startApp;

startApp = async function () {
    await originalStartApp();

    createForestAnimals();

    initializeOutdoorSafety();

    startAirQualityRefresh();

    console.log(
        "SINA WEATHER forest and outdoor safety systems ready."
    );
};

/* =========================================================
   63. RESPONSIVE CANVAS SAFETY
   ========================================================= */

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        return;
    }

    if (weatherCanvas && weatherCtx) {
        resizeCanvas();
    }

    if (currentLocation) {
        loadAirQuality();
    }
});

/* =========================================================
   END OF EXPANSION
   ========================================================= */
