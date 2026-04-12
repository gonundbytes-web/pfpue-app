/* === App-Daten (Jetzt aus Firebase) === */
let places = [];
let suggestedPlaces = [];
let eventsData = []; // Hier landen alle Veranstaltungen aus der Datenbank

// App-Status
let appState = {
    activeView: 'map-view',
    activeFilters: ['Bäckerei', 'Metzgerei','Supermarkt','Pausenplatz','Wirtshaus','WC'],
    userLocation: null,
    selectedCalendarDay: new Date(),
    isAdmin: false
};

/* === Globale Karten-Variablen === */
// Ganz oben in der app.js
let map; // Sicherstellen, dass diese Variable nicht innerhalb einer Funktion mit 'const' neu definiert wird
let newPlaceMap; 
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
const submittedPlacesList = document.getElementById('submitted-places-list');

/* === INITIALISIERUNG === */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Karte initialisieren
    initMap();
    // 2. Navigation initialisieren
    initNavigation();
    // 3. PWA-Service-Worker registrieren
    registerServiceWorker();
    // 4. Admin-Simulation initialisieren
    initAdminSimulation();
    
    // 5. START: Firebase Daten laden
    loadDataFromFirebase();
});

// Echte Daten aus Firebase Firestore laden
function loadDataFromFirebase() {
    if (!window.firebaseFirestore) return;

    const { onSnapshot, collection } = window.firebaseFirestore;
    const loadingScreen = document.getElementById('loading-screen');
    
    // Wir zählen, wie viele Collections wir laden (Places + Events)
    let collectionsLoaded = 0;
    const totalToLoad = 2;

    const checkLoadingStatus = () => {
        collectionsLoaded++;
        // Wenn beide (Places & Events) zum ersten Mal da sind, Spinner ausblenden
        if (collectionsLoaded >= totalToLoad) {
            setTimeout(() => {
                loadingScreen.classList.add('hidden-loader');
            }, 500); // Eine halbe Sekunde Puffer für ein ruhigeres Bild
        }
    };

    // A. Orte laden
    onSnapshot(collection(window.db, "places"), (snapshot) => {
        places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateMapMarkers();
        if (appState.activeView === 'list-view') renderList();
        
        // Status-Check nur beim allerersten Laden
        if (collectionsLoaded < 1) checkLoadingStatus();
    });

    // B. NEU: Veranstaltungen laden
    onSnapshot(collection(window.db, "events"), (snapshot) => {
        eventsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateMapMarkers();
        if (appState.activeView === 'calendar-view') renderCalendar();
        
        // Status-Check nur beim allerersten Laden
        if (collectionsLoaded < 2) checkLoadingStatus();
    });

    // C. Vorschläge für Admin (muss nicht auf den Spinner warten)
    onSnapshot(collection(window.db, "suggestions"), (snapshot) => {
        suggestedPlaces = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (appState.isAdmin) renderAdminPlaceList();
    });
}
/* === 1. KARTEN LOGIK === */
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
    Metzgerei: createIcon('M'), Wirtshaus: createIcon('W'), Supermarkt: createIcon('S'),
    Bäckerei: createIcon('B'), Pausenplatz: createIcon('P'), Zigarettenautomat: createIcon('Z'),
    Kirchweih: createIcon('K'), WC: createIcon('WC')
};

function initMap() {
    // 1. Die verschiedenen Karten-Hintergründe (TileLayers) definieren

    // A: Deine bisherige Straßenkarte (Füge hier deine aktuelle basemap.de URL ein!)
    const standardMap = L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19
    });

    // B: Das neue Luftbild (Satellit von Esri)
    const satelliteMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    });

    // 2. Karte initialisieren
    // WICHTIG: Wir übergeben hier 'layers: [standardMap]', damit die Karte weiß, womit sie starten soll.
    map = L.map('map', {
        zoomControl: false,        // Standard-Zoom aus
        attributionControl: false, // Standard-Leaflet-Text aus
        layers: [standardMap]      // Startet mit der Straßenkarte
    }).setView([49.301, 10.572], 13);

    // 3. Deine Quellenangabe (erweitert um Esri für das Luftbild)
    L.control.attribution({ 
        position: 'bottomleft' 
    }).addAttribution('&copy; <a href="https://basemap.de" target="_blank">GeoBasis-DE / BKG</a> | Luftbild: &copy; Esri')
      .addTo(map);

    // 4. Den Umschalt-Button (Layer Control) erstellen
    const baseMaps = {
        "Straßenkarte": standardMap,
        "Luftbild": satelliteMap
    };
// Fügt das Auswahlmenü oben rechts (topright) zur Karte hinzu
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

    markerLayer.addTo(map);
    updateMapMarkers();
    initMapInteractions();
    window.map = map;
}

function updateMapMarkers() {
    markerLayer.clearLayers();
    
    places.forEach(place => {
        if (appState.activeFilters.includes(place.category)) {
            const icon = categoryIcons[place.category] || createIcon('?');
            // 1. Alle Events finden, die zu diesem speziellen Ort gehören
            const placeEvents = eventsData.filter(e => e.placeId === place.id);

            // 2. Event-Texte generieren (falls vorhanden)
            let eventHtml = "";
            if (placeEvents.length > 0) {
                eventHtml = `<div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 5px;">
                                <strong style="font-size: 0.8rem; color: #d32f2f;">📅 Aktuelle Termine:</strong><br>`;
                placeEvents.forEach(e => {
                    const dateParts = e.date.split('-'); // Format YYYY-MM-DD
                    const dateString = `${dateParts[2]}.${dateParts[1]}.`; // Wird zu DD.MM.
                    eventHtml += `<small>• ${dateString}: <strong>${e.title}</strong></small><br>`;
                });
                eventHtml += `</div>`;
            }

            const popupContent = `
                <div class="popup-content">
                    <h3 style="margin: 0 0 5px 0;">${place.name}</h3>
                    <p style="margin: 0; font-size: 0.9rem;"><strong>Kategorie:</strong> ${place.category}</p>
                    <p style="margin: 5px 0; font-size: 0.85rem; color: #666;">${place.info}</p>
                    ${eventHtml}
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

    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterContent.classList.toggle('hidden');
    });
    
    map.on('click', () => { filterContent.classList.add('hidden'); });

    filterCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const category = checkbox.dataset.category;
            if (checkbox.checked) {
                if (!appState.activeFilters.includes(category)) appState.activeFilters.push(category);
            } else {
                appState.activeFilters = appState.activeFilters.filter(f => f !== category);
            }
            filterActiveCountSpan.textContent = `${appState.activeFilters.length}/6 aktiv`;
            updateMapMarkers();
        });
    });

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
                radius: 8, fillColor: "#007bff", color: "#fff", weight: 2, opacity: 1, fillOpacity: 1
            }).addTo(map);

            userAccuracyCircle = L.circle(appState.userLocation, {
                radius: accuracy, color: "#007bff", fillColor: "#007bff", fillOpacity: 0.1, weight: 1
            }).addTo(map);
        } else {
            userMarker.setLatLng(appState.userLocation);
            userAccuracyCircle.setLatLng(appState.userLocation);
            userAccuracyCircle.setRadius(accuracy);
        }
    }, error => {
        alert("Konnte deinen Standort nicht ermitteln: " + error.message);
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
}

/* === 2. NAVIGATIONS-LOGIK === */
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

/* === 3. LISTENANSICHT-LOGIK === */
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


/* === 4. KALENDERANSICHT-LOGIK === */
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
                <tr><th>Mo</th><th>Di</th><th>Mi</th><th>Do</th><th>Fr</th><th>Sa</th><th>So</th></tr>
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
                
                const hasEvent = eventsData.some(e => e.date === fullDateStr);
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
    
    // Wir filtern jetzt in der neuen eventsData Liste
    const eventsAtDay = eventsData.filter(e => e.date === dateStr);
    
    if (eventsAtDay.length === 0) {
        eventListContainer.innerHTML += '<p>Keine Termine gefunden.</p>';
    } else {
        eventsAtDay.forEach(e => {
            eventListContainer.innerHTML += `
                <div class="event-item" style="background: #fff; padding: 10px; margin-bottom: 5px; border-left: 4px solid var(--primary-color); border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <strong style="color: var(--primary-color);">${e.title}</strong><br>
                    <small>Ort: ${e.placeName}</small>
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


/* === 5. "NEU"-ANSICHT (Vorschläge an Firebase senden) === */
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

    newPlaceMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        newPlaceCoordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        
        if (!newPlaceMarker) {
            newPlaceMarker = L.marker([lat, lng]).addTo(newPlaceMap);
        } else {
            newPlaceMarker.setLatLng([lat, lng]);
        }
    });

    const newLocationBtn = document.getElementById('new-place-location-btn');
    if(newLocationBtn) {
        newLocationBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                alert("Geolokalisierung wird von deinem Browser nicht unterstützt.");
                return;
            }
            navigator.geolocation.getCurrentPosition(position => {
                newPlaceMap.flyTo([position.coords.latitude, position.coords.longitude], 17, { duration: 1.5 });
            }, () => alert("Standort konnte nicht ermittelt werden."), { enableHighAccuracy: true });
        });
    }
}

if (newPlaceForm) {
    newPlaceForm.addEventListener('submit', async function(e) {
        e.preventDefault(); 
        
        if (!window.firebaseFirestore) {
            return alert("Verbindung zur Datenbank fehlt gerade.");
        }

        const coordsRaw = newPlaceCoordsInput.value; // Format: "lat, lng"
        if (!coordsRaw) return alert("Bitte markiere zuerst den Ort auf der Karte!");

        try {
            // Koordinaten sicher umwandeln
            const coordsArray = coordsRaw.split(',').map(c => parseFloat(c.trim()));

            // Alle Daten in EINEM Objekt sammeln
            const suggestionData = {
                name: document.getElementById('new-place-name').value,
                category: document.getElementById('new-place-category').value,
                info: document.getElementById('new-place-info').value,
                coords: coordsArray,
                // Event-Daten (falls vorhanden)
                eventTitle: document.getElementById('event-title')?.value || null,
                eventDate: document.getElementById('event-date')?.value || null,
                submittedAt: new Date()
            };

            const { collection, addDoc } = window.firebaseFirestore;
            await addDoc(collection(window.db, "suggestions"), suggestionData);
            
            alert("Vielen Dank! Der Ort wurde zur Überprüfung eingesendet.");
            
            // Formular zurücksetzen
            this.reset();
            newPlaceCoordsInput.value = '';
            if (newPlaceMarker && newPlaceMap) {
                newPlaceMap.removeLayer(newPlaceMarker);
                newPlaceMarker = null;
            }
            // Zurück zur Karte springen
            document.querySelector('.nav-item[data-view="map-view"]').click();

        } catch (error) {
            console.error("Fehler beim Senden:", error);
            alert("Fehler beim Senden: " + error.message);
        }
    });
}


/* === 6. ADMIN-LOGIK & FIREBASE === */
function initAdminSimulation() {
    adminLoginBtn.addEventListener('click', async () => {
        if (appState.isAdmin) {
            openAdminModal();
            return;
        }

        if (!window.firebaseAuth) {
            alert("Firebase Auth ist nicht geladen.");
            return;
        }

        const email = prompt("Admin E-Mail:");
        if (!email) return; // Abbruch
        const password = prompt("Passwort:");
        if (!password) return;

        const { signInWithEmailAndPassword } = window.firebaseAuth;
        try {
            await signInWithEmailAndPassword(window.auth, email, password);
            appState.isAdmin = true;
            alert("Erfolgreich als Admin angemeldet!");
            openAdminModal();
        } catch (error) {
            alert("Login fehlgeschlagen: " + error.message);
        }
    });
    
    closeBtn.addEventListener('click', closeAdminModal);
    
    adminModal.addEventListener('click', (e) => {
        if (e.target === adminModal) closeAdminModal();
    });
}

function openAdminModal() {
    adminModal.classList.remove('hidden');
    
    // 1. Zeige die neuen Vorschläge
    renderAdminPlaceList(); 
    
    // 2. Zeige die bereits existierenden Daten zum Verwalten (NEU!)
    renderAdminManagementList(); 
}

function closeAdminModal() {
    adminModal.classList.add('hidden');
}

// Hilfsfunktion: Lädt die Vorschläge aus Firebase und zeigt sie im Modal an
async function renderAdminPlaceList() {
    const container = document.getElementById('submitted-places-list');
    container.innerHTML = '<p style="padding: 10px;">Lade Vorschläge...</p>';

    try {
        const querySnapshot = await window.firebaseFirestore.getDocs(
            window.firebaseFirestore.collection(window.db, "suggestions")
        );
        
        container.innerHTML = '';

        if (querySnapshot.empty) {
            container.innerHTML = '<p style="padding: 10px;">Keine neuen Vorschläge. ✅</p>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;

            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.style = "border-bottom: 2px solid #eee; padding: 15px 10px; background: #f9f9f9; margin-bottom: 10px; border-radius: 8px;";
            
            item.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 0.7rem; color: #777;">Name:</label>
                    <input type="text" id="edit-name-${id}" value="${data.name}" style="width: 100%; padding: 5px; margin-bottom: 5px;">
                    
                    <label style="font-size: 0.7rem; color: #777;">Infos / Zeiten:</label>
                    <textarea id="edit-info-${id}" style="width: 100%; height: 60px; padding: 5px;">${data.info || ''}</textarea>
                    
                    <div style="font-size: 0.8rem; color: #666; margin-top: 5px;">
                        Kategorie: <strong>${data.category}</strong> | 
                        <a href="#" onclick="showOnMap(${data.coords[0]}, ${data.coords[1]}); return false;" style="color: #2196F3; font-weight: bold;">📍 Auf Karte zeigen</a>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="approvePlace('${id}')" style="background-color: #4CAF50; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; flex: 2; font-weight: bold;">✔ Speichern & Freigeben</button>
                    <button onclick="deleteSuggestion('${id}')" style="background-color: #f44336; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; flex: 1;">✖ Löschen</button>
                </div>
                // Im HTML-String innerhalb von renderAdminPlaceList hinzufügen:
                <div style="background: #e3f2fd; padding: 8px; margin-top: 10px; border-radius: 4px;">
                    <strong>Event-Vorschlag:</strong><br>
                    <input type="text" id="edit-event-title-${id}" value="${data.eventTitle || ''}" placeholder="Kein Event" style="width: 70%;">
                    <input type="date" id="edit-event-date-${id}" value="${data.eventDate || ''}">
                </div>

            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error("Fehler:", error);
        container.innerHTML = '<p style="color: red;">Fehler beim Laden.</p>';
    }
}

// Diese Funktion zeigt alle AKTIVEN Orte und Events im Admin-Bereich an
function renderAdminManagementList() {
    const container = document.getElementById('admin-live-management');
    if (!container) return;
    
    // Wir fügen hier einen leeren Container "admin-edit-form" für das Bearbeitungsfenster hinzu
    container.innerHTML = `
        <div style="background: #fff3e0; padding: 15px; border-radius: 8px; border: 1px solid #ffe0b2;">
            <p style="font-weight: bold; margin-bottom: 10px; color: #e65100;">Aktive Orte & Events verwalten</p>
            <div id="admin-edit-form" style="display: none; background: #fff; padding: 15px; border-radius: 5px; margin-bottom: 15px; border: 1px solid #ccc; box-shadow: 0 2px 5px rgba(0,0,0,0.1);"></div>
            <div id="live-items-list"></div>
        </div>
    `;
    
    const list = document.getElementById('live-items-list');

    // 1. Alle echten Orte (places) auflisten
    places.forEach(place => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid #ccc; padding: 10px;";
        div.innerHTML = `
            <span style="font-size: 0.9rem;">📍 <strong>${place.name}</strong></span>
            <div>
                <button onclick="editLivePlace('${place.id}')" style="background: #2196F3; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; margin-right: 5px;">✏️ Bearbeiten</button>
                <button onclick="deleteLivePlace('${place.id}')" style="background: #f44336; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Löschen</button>
            </div>
        `;
        list.appendChild(div);
    });

    // 2. Alle echten Events (eventsData) auflisten
    eventsData.forEach(event => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid #ccc; padding: 10px; background: #fffde7;";
        div.innerHTML = `
            <span style="font-size: 0.85rem;">📅 ${event.title} (${event.date})</span>
            <div>
                <button onclick="editLiveEvent('${event.id}')" style="background: #2196F3; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; margin-right: 5px;">✏️ Bearbeiten</button>
                <button onclick="deleteLiveEvent('${event.id}')" style="background: #ff9800; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Entfernen</button>
            </div>
        `;
        list.appendChild(div);
    });
}
// NEU: Funktion um die Karte im Hintergrund zu bewegen
window.showOnMap = function(lat, lng) {
    // 1. Prüfen, ob die Karte existiert
    const currentMap = window.map || map; 

    if (!currentMap) {
        console.error("Karte wurde noch nicht initialisiert!");
        alert("Fehler: Die Karte ist noch nicht bereit.");
        return;
    }

    // 2. Sicherstellen, dass lat/lng Zahlen sind (Firebase speichert sie manchmal als Strings)
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
        console.error("Ungültige Koordinaten:", lat, lng);
        return;
    }

    // 3. Zum Punkt springen
    currentMap.setView([latitude, longitude], 18);

    // 4. Einen temporären auffälligen Kreis zeichnen, der nach 3 Sekunden wieder verschwindet
    const highlight = L.circle([latitude, longitude], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.5,
        radius: 20
    }).addTo(currentMap);

    setTimeout(() => {
        currentMap.removeLayer(highlight);
    }, 3000);

    // 5. Optional: Modal verkleinern oder nach hinten schieben, 
    // damit man die Karte sehen kann (falls das Modal alles verdeckt)
    // document.getElementById('admin-modal').style.opacity = "0.5";
    // setTimeout(() => { document.getElementById('admin-modal').style.opacity = "1"; }, 2000);
    // Ergänzung für showOnMap:
    const adminModal = document.getElementById('admin-modal'); // ID eventuell anpassen
    adminModal.classList.add('hidden');
    setTimeout(() => {
        adminModal.classList.remove('hidden');
    }, 2500); // Zeigt die Karte für 2,5 Sekunden
};

/* === 6. ADMIN-LOGIK (Die finale Version) === */

// Funktion: Vorschlag bearbeiten, freigeben und optionales Event speichern
window.approvePlace = async function(id) {
    const updatedName = document.getElementById(`edit-name-${id}`).value;
    const updatedInfo = document.getElementById(`edit-info-${id}`).value;
    const updatedEventTitle = document.getElementById(`edit-event-title-${id}`)?.value || "";
    const updatedEventDate = document.getElementById(`edit-event-date-${id}`)?.value || "";

    if (!confirm("Änderungen speichern und Ort veröffentlichen?")) return;

    try {
        const { doc, collection, addDoc, deleteDoc, getDocs } = window.firebaseFirestore;
        const suggestionRef = doc(window.db, "suggestions", id);
        
        // Originaldaten holen (wegen Coords/Kategorie)
        const allDocs = await getDocs(collection(window.db, "suggestions"));
        const originalDoc = allDocs.docs.find(d => d.id === id);

        if (originalDoc) {
            const data = originalDoc.data();
            
            // 1. Ort in "places" speichern
            const newPlaceDoc = await addDoc(collection(window.db, "places"), {
                name: updatedName,
                info: updatedInfo,
                category: data.category,
                coords: data.coords,
                approvedAt: new Date()
            });

            // 2. Event in "events" speichern (falls ausgefüllt)
            if (updatedEventTitle.trim() !== "" && updatedEventDate !== "") {
                await addDoc(collection(window.db, "events"), {
                    title: updatedEventTitle,
                    date: updatedEventDate,
                    placeName: updatedName,
                    placeId: newPlaceDoc.id,
                    createdAt: new Date()
                });
            }

            // 3. Vorschlag löschen
            await deleteDoc(suggestionRef);

            alert("Erfolgreich freigegeben!");
            renderAdminPlaceList();
        }
    } catch (error) {
        console.error("Fehler bei Freigabe:", error);
        alert("Fehler: " + error.message);
    }
};

window.deleteSuggestion = async function(id) {
    if (!confirm("Vorschlag wirklich löschen?")) return;
    try {
        await window.firebaseFirestore.deleteDoc(window.firebaseFirestore.doc(window.db, "suggestions", id));
        renderAdminPlaceList();
    } catch (error) {
        alert("Fehler beim Löschen: " + error.message);
    }
};

/* === 7. PWA-SERVICE-WORKER === */
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
// Hilfsfunktion: Löscht einen Ort permanent aus der Datenbank
window.deleteLivePlace = async function(id) {
    if (!confirm("Diesen Ort wirklich von der Karte löschen? Das kann nicht rückgängig gemacht werden!")) return;
    try {
        await window.firebaseFirestore.deleteDoc(window.firebaseFirestore.doc(window.db, "places", id));
        alert("Ort gelöscht.");
        // Die Liste aktualisiert sich durch den onSnapshot automatisch!
    } catch (error) {
        alert("Fehler beim Löschen: " + error.message);
    }
};

// Hilfsfunktion: Löscht ein Event permanent
window.deleteLiveEvent = async function(id) {
    if (!confirm("Diese Veranstaltung wirklich löschen?")) return;
    try {
        await window.firebaseFirestore.deleteDoc(window.firebaseFirestore.doc(window.db, "events", id));
        alert("Event gelöscht.");
    } catch (error) {
        alert("Fehler: " + error.message);
    }
};

// --- BEARBEITEN VON ORTEN ---
window.editLivePlace = function(id) {
    const place = places.find(p => p.id === id);
    if (!place) return;

    const editForm = document.getElementById('admin-edit-form');
    const list = document.getElementById('live-items-list');

    // Liste ausblenden, Formular einblenden
    list.style.display = 'none';
    editForm.style.display = 'block';

    // Formular mit den aktuellen Daten befüllen
    editForm.innerHTML = `
        <h4 style="margin-top: 0; color: var(--primary-color);">Ort bearbeiten</h4>
        <label style="font-size: 0.8rem;">Name:</label><br>
        <input type="text" id="edit-place-name" value="${place.name}" style="width: 100%; margin-bottom: 10px; padding: 8px; box-sizing: border-box;"><br>
        
        <label style="font-size: 0.8rem;">Kategorie:</label><br>
        <input type="text" id="edit-place-category" value="${place.category}" style="width: 100%; margin-bottom: 10px; padding: 8px; box-sizing: border-box;"><br>
        
        <label style="font-size: 0.8rem;">Beschreibung:</label><br>
        <textarea id="edit-place-info" style="width: 100%; margin-bottom: 10px; padding: 8px; height: 80px; box-sizing: border-box;">${place.info}</textarea><br>
        
        <button onclick="savePlaceEdit('${id}')" style="background: #4CAF50; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">Speichern</button>
        <button onclick="cancelEdit()" style="background: #9e9e9e; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; margin-left: 10px;">Abbrechen</button>
    `;
};

window.savePlaceEdit = async function(id) {
    const newName = document.getElementById('edit-place-name').value;
    const newCategory = document.getElementById('edit-place-category').value;
    const newInfo = document.getElementById('edit-place-info').value;

    try {
        // Firebase Befehl zum Aktualisieren (updateDoc statt setDoc)
        await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(window.db, "places", id), {
            name: newName,
            category: newCategory,
            info: newInfo
        });
        alert("Ort erfolgreich aktualisiert!");
        cancelEdit(); // Schließt das Formular
    } catch (error) {
        alert("Fehler beim Speichern: " + error.message);
    }
};

// --- BEARBEITEN VON EVENTS ---
window.editLiveEvent = function(id) {
    const event = eventsData.find(e => e.id === id);
    if (!event) return;

    const editForm = document.getElementById('admin-edit-form');
    const list = document.getElementById('live-items-list');

    list.style.display = 'none';
    editForm.style.display = 'block';

    editForm.innerHTML = `
        <h4 style="margin-top: 0; color: var(--primary-color);">Event bearbeiten</h4>
        <label style="font-size: 0.8rem;">Titel:</label><br>
        <input type="text" id="edit-event-title" value="${event.title}" style="width: 100%; margin-bottom: 10px; padding: 8px; box-sizing: border-box;"><br>
        
        <label style="font-size: 0.8rem;">Datum:</label><br>
        <input type="date" id="edit-event-date" value="${event.date}" style="width: 100%; margin-bottom: 10px; padding: 8px; box-sizing: border-box;"><br>
        
        <button onclick="saveEventEdit('${id}')" style="background: #4CAF50; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">Speichern</button>
        <button onclick="cancelEdit()" style="background: #9e9e9e; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; margin-left: 10px;">Abbrechen</button>
    `;
};

window.saveEventEdit = async function(id) {
    const newTitle = document.getElementById('edit-event-title').value;
    const newDate = document.getElementById('edit-event-date').value;

    try {
        await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(window.db, "events", id), {
            title: newTitle,
            date: newDate
        });
        alert("Event erfolgreich aktualisiert!");
        cancelEdit();
    } catch (error) {
        alert("Fehler beim Speichern: " + error.message);
    }
};

// --- HILFSFUNKTION ---
window.cancelEdit = function() {
    document.getElementById('admin-edit-form').style.display = 'none';
    document.getElementById('live-items-list').style.display = 'block';
};

/* =========================================
   NEU: TERMINE IM ADMIN-BEREICH VERWALTEN
   ========================================= */

// 1. Dropdown mit Orten füllen, wenn der Admin-Button geklickt wird
document.getElementById('admin-login-btn').addEventListener('click', () => {
    const dropdown = document.getElementById('new-event-place-id');
    if (!dropdown) return;
    
    // Altes leeren und Standard-Option setzen
    dropdown.innerHTML = '<option value="">-- Bitte Ort wählen --</option>';
    
    // Alle freigegebenen Orte alphabetisch sortieren (optional, aber übersichtlicher)
    const sortedPlaces = [...places].sort((a, b) => a.name.localeCompare(b.name));

    // Für jeden Ort eine Auswahlmöglichkeit erstellen
    sortedPlaces.forEach(place => {
        const option = document.createElement('option');
        option.value = place.id; // Die Firebase-ID wird versteckt gespeichert
        option.textContent = place.name; // Der Name wird angezeigt
        dropdown.appendChild(option);
    });
});

// 2. Klick auf "Termin speichern" abfangen und an Firebase senden
document.addEventListener('DOMContentLoaded', () => {
    const saveEventBtn = document.getElementById('btn-save-new-event');
    
    if (saveEventBtn) {
        saveEventBtn.addEventListener('click', async () => {
            const placeId = document.getElementById('new-event-place-id').value;
            const title = document.getElementById('new-event-title').value;
            const date = document.getElementById('new-event-date').value;

            // Prüfen, ob der Admin alles ausgefüllt hat
            if (!placeId || !title || !date) {
                alert("Bitte wähle einen Ort aus und fülle Titel sowie Datum aus!");
                return;
            }

            // Den Namen des Ortes für den Kalender heraussuchen
            const selectedPlace = places.find(p => p.id === placeId);
            const placeName = selectedPlace ? selectedPlace.name : "Unbekannter Ort";

            try {
                // In Firebase speichern
                await window.firebaseFirestore.addDoc(window.firebaseFirestore.collection(window.db, "events"), {
                    placeId: placeId,
                    placeName: placeName, // Wichtig für die Anzeige in der Kalender-Liste
                    title: title,
                    date: date
                });
                
                alert("Termin erfolgreich gespeichert!");
                
                // Formular wieder leeren, falls man direkt noch einen Termin eintragen will
                document.getElementById('new-event-title').value = '';
                document.getElementById('new-event-date').value = '';
                
            } catch (error) {
                alert("Fehler beim Speichern: " + error.message);
                console.error(error);
            }
        });
    }
});