/* === App-Daten === */
// Dummy-Daten für die Demo (in einer echten App kämen diese von einem Backend-Server)
let places = [
    { id: 1, name: "Metzgerei Müller", category: "Metzgerei", coords: [49.4538, 11.0775], info: "Bester Leberkäse in der Stadt!", dates: [] },
    { id: 2, name: "St. Lorenz Kirchweih", category: "Kirchweih", coords: [49.451, 11.078], info: "Großes Fest.", dates: ["2026-08-15"] },
    { id: 3, name: "Supermarkt", category: "Supermarkt", coords: [49.452, 11.076], info: "Mo-Sa 8-22 Uhr", dates: [] },
    { id: 4, name: "Zigarettenautomat", category: "Zigarettenautomat", coords: [49.4505, 11.075], info: "", dates: [] },
    { id: 5, name: "Pausenplatz", category: "Pausenplatz", coords: [49.453, 11.079], info: "Mit Aussicht.", dates: [] },
    { id: 6, name: "Wirtshaus Goldener Löwe", category: "Wirtshaus", coords: [49.4515, 11.0765], info: "Original Nürnberger Rostbratwurst.", dates: [] },
    { id: 7, name: "Bäckerei Beck", category: "Bäckerei", coords: [49.4525, 11.077], info: "Täglich frische Brötchen.", dates: ["2026-06-12", "2026-07-20"] },
    { id: 8, name: "Öffentliches WC", category: "WC", coords: [49.450, 11.0755], info: "", dates: [] }
];

// Liste der eingereichten Vorschläge (simuliert Admin-Eingang)
let suggestedPlaces = [];

// App-Status
let appState = {
    activeView: 'map-view',
    activeFilters: ['Metzgerei', 'Wirtshaus', 'Supermarkt', 'Bäckerei', 'Pausenplatz', 'Zigarettenautomat', 'Kirchweih', 'WC'],
    userLocation: null,
    selectedCalendarDay: new Date(),
    isAdmin: false
};

/* === Globale Karten-Variablen === */
let map, newPlaceMap; 
let newPlaceMarker = null; 
let markerLayer = L.layerGroup();
let userMarker;
let userAccuracyCircle;

/* === DOM-Elemente === */
const mainContent = document.querySelector('main');
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('main section');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminModal = document.getElementById('admin-modal');
const closeBtn = document.querySelector('.close-btn');
const newPlaceForm = document.getElementById('new-place-form');
const newPlaceCoordsInput = document.getElementById('new-place-coords');

/* === Initialisierung === */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Karte initialisieren
    initMap();

    // 2. Navigation initialisieren
    initNavigation();

    // 3. PWA-Service-Worker registrieren
    registerServiceWorker();

    // 4. Admin-Simulation
    initAdminSimulation();
});


/* === 1. Karten-Logik (Leaflet) === */

// Kategorien-Symbole für die Demo
const createIcon = (char) => {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: var(--primary-color); color: #fff; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.5);">${char}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });
};

const categoryIcons = {
    Metzgerei: createIcon('M'),
    Wirtshaus: createIcon('W'),
    Supermarkt: createIcon('S'),
    Bäckerei: createIcon('B'),
    Pausenplatz: createIcon('P'),
    Zigarettenautomat: createIcon('Z'),
    Kirchweih: createIcon('K'),
    WC: createIcon('WC')
};

function initMap() {
    map = L.map('map', {
        zoomControl: true, 
        attributionControl: true 
    }).setView([49.301, 10.572], 13); 

    L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19
    }).addTo(map);

    L.control.attribution({
        position: 'bottomleft' 
    }).addAttribution('&copy; <a href="https://basemap.de" target="_blank">GeoBasis-DE / BKG</a>').addTo(map);

    markerLayer.addTo(map);
    updateMapMarkers();
    initMapInteractions();
}

function updateMapMarkers() {
    markerLayer.clearLayers();
    
    places.forEach(place => {
        if (appState.activeFilters.includes(place.category)) {
            const icon = categoryIcons[place.category] || createIcon('?');
            
            const popupContent = `
                <div class="popup-content">
                    <h3>${place.name}</h3>
                    <p><strong>Kategorie:</strong> ${place.category}</p>
                    <p>${place.info}</p>
                    ${place.dates.length > 0 ? `<p><strong>Nächste Termine:</strong> ${place.dates.join(', ')}</p>` : ''}
                </div>
            `;
            
            L.marker(place.coords, { icon: icon })
                .bindPopup(popupContent)
                .addTo(markerLayer);
        }
    });
}

function initMapInteractions() {
    const filterBtn = document.getElementById('filter-dropdown-btn');
    const filterContent = document.getElementById('filter-dropdown-content');
    const filterCheckboxes = filterContent.querySelectorAll('input[type="checkbox"]');
    const filterActiveCountSpan = document.getElementById('filter-active-count');
    const myLocationBtn = document.getElementById('show-my-location-btn');

    // Filter-Dropdown
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterContent.classList.toggle('hidden');
    });
    
    map.on('click', () => {
        filterContent.classList.add('hidden');
    });

    // Checkbox-Klicks
    filterCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const category = checkbox.dataset.category;
            if (checkbox.checked) {
                if (!appState.activeFilters.includes(category)) {
                    appState.activeFilters.push(category);
                }
            } else {
                appState.activeFilters = appState.activeFilters.filter(f => f !== category);
            }
            filterActiveCountSpan.textContent = `${appState.activeFilters.length}/8 aktiv`;
            updateMapMarkers();
        });
    });

    // Standort-Button
    myLocationBtn.addEventListener('click', showMyLocation);
}

function showMyLocation() {
    if (!navigator.geolocation) {
        alert("Geolokalisierung wird von deinem Browser nicht unterstützt.");
        return;
    }

    navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude, accuracy } = position.coords;
        appState.userLocation = [latitude, longitude];

        map.flyTo(appState.userLocation, 17, { duration: 1 });

        if (!userMarker) {
            userMarker = L.circleMarker(appState.userLocation, {
                radius: 8,
                fillColor: "#007bff",
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(map);

            userAccuracyCircle = L.circle(appState.userLocation, {
                radius: accuracy,
                color: "#007bff",
                fillColor: "#007bff",
                fillOpacity: 0.1,
                weight: 1
            }).addTo(map);
        } else {
            userMarker.setLatLng(appState.userLocation);
            userAccuracyCircle.setLatLng(appState.userLocation);
            userAccuracyCircle.setRadius(accuracy);
        }
    }, error => {
        alert("Konnte deinen Standort nicht ermitteln: " + error.message);
    }, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    });
}


/* === 2. Navigations-Logik === */
function initNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            if (viewId === appState.activeView) return; 

            document.querySelector('.nav-item.active').classList.remove('active');
            item.classList.add('active');
            
            document.querySelector('.active-view').classList.remove('active-view');
            document.getElementById(viewId).classList.add('active-view');
            
            appState.activeView = viewId;

            if (viewId === 'map-view') {
                map.invalidateSize(); 
                updateMapMarkers();
            } else if (viewId === 'list-view') {
                renderList();
            } else if (viewId === 'calendar-view') {
                renderCalendar();
            } else if (viewId === 'new-place-view') {
                initNewPlaceMap();
            }
        });
    });
}


/* === 3. Listenansicht-Logik === */
const placeListContainer = document.getElementById('place-list-container');
const listSearchInput = document.getElementById('list-search-input');
const listCategoryFilter = document.getElementById('list-category-filter');

function renderList() {
    placeListContainer.innerHTML = '';
    const searchTerm = listSearchInput.value.toLowerCase();
    const selectedCategory = listCategoryFilter.value;

    places.forEach(place => {
        const matchesSearch = place.name.toLowerCase().includes(searchTerm) || place.category.toLowerCase().includes(searchTerm);
        const matchesCategory = selectedCategory === 'all' || place.category === selectedCategory;

        if (matchesSearch && matchesCategory) {
            const placeItem = document.createElement('div');
            placeItem.className = 'place-item';
            placeItem.innerHTML = `
                <h3>${place.name}</h3>
                <p><strong>Kategorie:</strong> ${place.category}</p>
                <p>${place.info.substring(0, 50)}...</p>
            `;
            placeItem.addEventListener('click', () => {
                const navMapItem = document.querySelector('.nav-item[data-view="map-view"]');
                navMapItem.click(); 
                map.flyTo(place.coords, 18);
                markerLayer.eachLayer(layer => {
                    if (layer.getLatLng().lat === place.coords[0] && layer.getLatLng().lng === place.coords[1]) {
                        layer.openPopup();
                    }
                });
            });
            placeListContainer.appendChild(placeItem);
        }
    });
}

listSearchInput.addEventListener('input', renderList);
listCategoryFilter.addEventListener('change', renderList);


/* === 4. Kalenderansicht-Logik === */
const calendarContainer = document.getElementById('calendar-container');
const eventListContainer = document.getElementById('event-list-container');
const monthDisplay = document.getElementById('current-month-display');

let displayedDate = new Date(); 

function renderCalendar() {
    const year = displayedDate.getFullYear();
    const month = displayedDate.getMonth();
    
    const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    monthDisplay.textContent = `${monthNames[month]} ${year}`;

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const startingDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    calendarContainer.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Mo</th><th>Di</th><th>Mi</th><th>Do</th><th>Fr</th><th>Sa</th><th>So</th>
                </tr>
            </thead>
            <tbody id="calendar-body"></tbody>
        </table>
    `;
    
    const calendarBody = document.getElementById('calendar-body');
    let date = 1;
    
    for (let i = 0; i < 6; i++) {
        let row = document.createElement('tr');
        
        for (let j = 0; j < 7; j++) {
            let cell = document.createElement('td');
            
            if (i === 0 && j < startingDay) {
                cell.classList.add('empty');
            } else if (date > daysInMonth) {
                break;
            } else {
                cell.textContent = date;
                const fullDateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${date.toString().padStart(2, '0')}`;
                
                const hasEvent = places.some(p => p.dates.includes(fullDateStr));
                if (hasEvent) cell.classList.add('has-event');

                if (date === appState.selectedCalendarDay.getDate() && 
                    month === appState.selectedCalendarDay.getMonth() && 
                    year === appState.selectedCalendarDay.getFullYear()) {
                    cell.classList.add('selected-day');
                }

                const currentDay = date; 
                cell.addEventListener('click', () => {
                    appState.selectedCalendarDay = new Date(year, month, currentDay);
                    renderCalendar();
                    renderEventsForDay(fullDateStr);
                });
                date++;
            }
            row.appendChild(cell);
        }
        calendarBody.appendChild(row);
        if (date > daysInMonth) break;
    }
}

document.getElementById('prev-month').addEventListener('click', () => {
    displayedDate.setMonth(displayedDate.getMonth() - 1);
    renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
    displayedDate.setMonth(displayedDate.getMonth() + 1);
    renderCalendar();
});

function renderEventsForDay(dateStr) {
    eventListContainer.innerHTML = `<h3>Termine am ${appState.selectedCalendarDay.toLocaleDateString('de-DE')}</h3>`;
    const events = places.filter(p => p.dates.includes(dateStr));
    
    if (events.length === 0) {
        eventListContainer.innerHTML += '<p>Keine Termine gefunden.</p>';
    } else {
        events.forEach(p => {
            eventListContainer.innerHTML += `
                <div class="event-item">
                    <strong>${p.name}</strong><br>
                    <small>${p.category}</small>
                </div>`;
        });
    }
}

document.getElementById('go-to-today').addEventListener('click', () => {
    const today = new Date();
    displayedDate = new Date(today.getFullYear(), today.getMonth(), 1);
    appState.selectedCalendarDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    renderCalendar();
    
    const fullDateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    renderEventsForDay(fullDateStr);
});


/* === 5. "Neu"-Ansicht Logik (Einsenden) === */
function initNewPlaceMap() {
    if (newPlaceMap) return; 
    
    newPlaceMap = L.map('new-place-map', {
        zoomControl: false, 
        attributionControl: false 
    }).setView([49.301, 10.572], 13); 

    L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19,
        attribution: '&copy; GeoBasis-DE / BKG'
    }).addTo(newPlaceMap);

    // Klick auf Karte setzt Pin
    newPlaceMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        newPlaceCoordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        
        if (!newPlaceMarker) {
            newPlaceMarker = L.marker([lat, lng]).addTo(newPlaceMap);
        } else {
            newPlaceMarker.setLatLng([lat, lng]);
        }
    });

    // GPS-Button Logik (Zentrieren)
    const newLocationBtn = document.getElementById('new-place-location-btn');
    if(newLocationBtn) {
        newLocationBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                alert("Geolokalisierung wird von deinem Browser nicht unterstützt.");
                return;
            }

            navigator.geolocation.getCurrentPosition(position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                newPlaceMap.flyTo([lat, lng], 17, { duration: 1.5 });
                
            }, error => {
                alert("Standort konnte nicht ermittelt werden.");
            }, {
                enableHighAccuracy: true
            });
        });
    }
}

// Formular-Einreichung verarbeiten
if (newPlaceForm) {
    newPlaceForm.addEventListener('submit', function(e) {
        e.preventDefault(); 

        const name = document.getElementById('new-place-name').value;
        const category = document.getElementById('new-place-category').value;
        const info = document.getElementById('new-place-info').value;
        const coordsRaw = newPlaceCoordsInput.value;

        if (!coordsRaw) {
            alert("Bitte markiere zuerst den Ort auf der Karte, indem du darauf klickst!");
            return;
        }

        const coordsArray = coordsRaw.split(',').map(c => parseFloat(c.trim()));
        
        const newSuggestion = {
            name: name,
            category: category,
            info: info,
            coords: coordsArray,
            dates: [] 
        };

        suggestedPlaces.push(newSuggestion);
        
        alert(`Vielen Dank! Der Ort "${name}" wurde zur Überprüfung eingesendet.`);

        this.reset();
        newPlaceCoordsInput.value = ''; // Verstecktes Feld leeren
        
        if (newPlaceMarker && newPlaceMap) {
            newPlaceMap.removeLayer(newPlaceMarker);
            newPlaceMarker = null;
        }

        const mapNavBtn = document.querySelector('.nav-item[data-view="map-view"]');
        if (mapNavBtn) mapNavBtn.click();
    });
}


/* === 6. Admin-Simulation === */
const submittedPlacesList = document.getElementById('submitted-places-list');

function initAdminSimulation() {
    adminLoginBtn.addEventListener('click', () => {
        openAdminModal();
    });
    
    closeBtn.addEventListener('click', closeAdminModal);
    
    adminModal.addEventListener('click', (e) => {
        if (e.target === adminModal) closeAdminModal();
    });
}

function openAdminModal() {
    adminModal.classList.remove('hidden');
    appState.isAdmin = true;
    renderAdminPlaceList();
}

function closeAdminModal() {
    adminModal.classList.add('hidden');
    appState.isAdmin = false;
}

function renderAdminPlaceList() {
    submittedPlacesList.innerHTML = '';
    
    if (suggestedPlaces.length === 0) {
        submittedPlacesList.innerHTML = '<p>Keine neuen Einsendungen.</p>';
        return;
    }
    
    suggestedPlaces.forEach((suggestion, index) => {
        const adminItem = document.createElement('div');
        adminItem.className = 'admin-place-item';
        adminItem.innerHTML = `
            <div class="suggestion-info">
                <h3>${suggestion.name}</h3>
                <p><strong>Kategorie:</strong> ${suggestion.category}</p>
                <p>${suggestion.info}</p>
            </div>
            <div class="admin-action-btns">
                <button class="admin-approve-btn" data-index="${index}">Freischalten</button>
                <button class="admin-reject-btn" data-index="${index}">Ablehnen</button>
            </div>
        `;
        
        const approveBtn = adminItem.querySelector('.admin-approve-btn');
        const rejectBtn = adminItem.querySelector('.admin-reject-btn');
        
        approveBtn.addEventListener('click', () => approveSuggestion(index));
        rejectBtn.addEventListener('click', () => rejectSuggestion(index));
        
        submittedPlacesList.appendChild(adminItem);
    });
}

function approveSuggestion(index) {
    const suggestion = suggestedPlaces[index];
    
    const newId = places.length > 0 ? Math.max(...places.map(p => p.id)) + 1 : 1;
    const newPlace = { ...suggestion, id: newId, dates: [] }; 
    places.push(newPlace);
    
    suggestedPlaces.splice(index, 1);
    
    renderAdminPlaceList();
    alert(`Der Ort "${suggestion.name}" wurde freigeschaltet und ist nun für alle sichtbar.`);
    
    if (appState.activeView === 'map-view') {
        updateMapMarkers();
    }
}

function rejectSuggestion(index) {
    const suggestion = suggestedPlaces[index];
    suggestedPlaces.splice(index, 1);
    renderAdminPlaceList();
    alert(`Der Vorschlag "${suggestion.name}" wurde abgelehnt.`);
}


/* === 7. PWA-Service-Worker registrieren === */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    console.log('ServiceWorker registriert:', registration);
                })
                .catch(error => {
                    console.error('ServiceWorker Registrierung fehlgeschlagen:', error);
                });
        });
    }
}