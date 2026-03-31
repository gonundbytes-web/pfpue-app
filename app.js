/* === App-Daten (Jetzt aus Firebase) === */
let places = [];
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
    // Sicherheitscheck: Wurde Firebase in der index.html richtig geladen?
    if (!window.firebaseFirestore) {
        console.error("Firebase Firestore wurde nicht gefunden. Bitte überprüfe die index.html.");
        return;
    }

    const { onSnapshot, collection } = window.firebaseFirestore;
    
    // A. Haupt-Orte laden (Echtzeit-Update)
    onSnapshot(collection(window.db, "places"), (snapshot) => {
        places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateMapMarkers();
        if (appState.activeView === 'list-view') renderList();
        if (appState.activeView === 'calendar-view') renderCalendar();
    });

    // B. Vorschläge für Admin laden
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
    // Karte initialisieren OHNE automatische Zoom-Buttons
    map = L.map('map', {
        zoomControl: false // Wir schalten die Standard-Buttons links oben aus
        //attributionControl: true 
    }).setView([49.301, 10.572], 13);

    // Jetzt fügen wir die Zoom-Buttons manuell unten rechts hinzu
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

    L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19
    }).addTo(map);

    L.control.attribution({ position: 'bottomleft' })
     .addAttribution('&copy; <a href="https://basemap.de" target="_blank">GeoBasis-DE / BKG</a>').addTo(map);

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
            const dates = place.dates || []; // Fallback, falls Termine leer sind
            
            const popupContent = `
                <div class="popup-content">
                    <h3>${place.name}</h3>
                    <p><strong>Kategorie:</strong> ${place.category}</p>
                    <p>${place.info}</p>
                    ${dates.length > 0 ? `<p><strong>Nächste Termine:</strong> ${dates.join(', ')}</p>` : ''}
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
            filterActiveCountSpan.textContent = `${appState.activeFilters.length}/8 aktiv`;
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
                
                const hasEvent = places.some(p => (p.dates || []).includes(fullDateStr));
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
    const events = places.filter(p => (p.dates || []).includes(dateStr));
    
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

        const coordsRaw = newPlaceCoordsInput.value;
        if (!coordsRaw) return alert("Bitte markiere zuerst den Ort auf der Karte!");

        const newSuggestion = {
            name: document.getElementById('new-place-name').value,
            category: document.getElementById('new-place-category').value,
            info: document.getElementById('new-place-info').value,
            coords: coordsRaw.split(',').map(c => parseFloat(c.trim())),
            dates: [],
            submittedAt: new Date()
        };
        // Innerhalb de's Submit-Listeners von new-place-form:
        const suggestionData = {
            name: document.getElementById('new-place-name').value,
            category: document.getElementById('new-place-category').value,
            info: document.getElementById('new-place-info').value,
            coords: JSON.parse(document.getElementById('new-place-coords').value),
            // NEU: Event-Daten
            eventTitle: document.getElementById('event-title').value || null,
            eventDate: document.getElementById('event-date').value || null,
            submittedAt: new Date()
        };
        // ... dann per addDoc an "suggestions" senden
        try {
            const { collection, addDoc } = window.firebaseFirestore;
            await addDoc(collection(window.db, "suggestions"), newSuggestion);
            alert("Vielen Dank! Der Ort wurde zur Überprüfung eingesendet.");
            
            this.reset();
            newPlaceCoordsInput.value = '';
            if (newPlaceMarker && newPlaceMap) {
                newPlaceMap.removeLayer(newPlaceMarker);
                newPlaceMarker = null;
            }
            document.querySelector('.nav-item[data-view="map-view"]').click();
        } catch (error) {
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
    renderAdminPlaceList();
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

// AKTUALISIERT: Freigabe-Funktion mit Bearbeitungs-Check
window.approvePlace = async function(id) {
    // 1. Die bearbeiteten Werte aus den Eingabefeldern holen
    const updatedName = document.getElementById(`edit-name-${id}`).value;
    const updatedInfo = document.getElementById(`edit-info-${id}`).value;
    
    // NEU: Event-Daten auslesen
    const updatedEventTitle = document.getElementById(`edit-event-title-${id}`).value;
    const updatedEventDate = document.getElementById(`edit-event-date-${id}`).value;

    if (!confirm("Änderungen speichern und Ort (sowie optionales Event) veröffentlichen?")) return;

    try {
        const suggestionRef = window.firebaseFirestore.doc(window.db, "suggestions", id);
        
        // Wir holen uns einmal das Original-Dokument, um Coords und Kategorie zu bewahren
        const allDocs = await window.firebaseFirestore.getDocs(window.firebaseFirestore.collection(window.db, "suggestions"));
        const originalDoc = allDocs.docs.find(d => d.id === id);

        if (originalDoc) {
            const data = originalDoc.data();
            
            // --- SCHRITT A: Den Ort in "places" speichern ---
            const placeData = {
                name: updatedName,
                info: updatedInfo,
                category: data.category,
                coords: data.coords,
                approvedAt: new Date()
            };

            const newPlaceDoc = await window.firebaseFirestore.addDoc(
                window.firebaseFirestore.collection(window.db, "places"), 
                placeData
            );

            // --- SCHRITT B: Das Event speichern (nur wenn Titel UND Datum da sind) ---
            if (updatedEventTitle.trim() !== "" && updatedEventDate !== "") {
                await window.firebaseFirestore.addDoc(
                    window.firebaseFirestore.collection(window.db, "events"), 
                    {
                        title: updatedEventTitle,
                        date: updatedEventDate,
                        placeName: updatedName,
                        placeId: newPlaceDoc.id, // Verknüpfung zum neuen Ort-Eintrag
                        createdAt: new Date()
                    }
                );
                console.log("Event erfolgreich angelegt.");
            }

            // --- SCHRITT C: Den alten Vorschlag löschen ---
            await window.firebaseFirestore.deleteDoc(suggestionRef);

            alert("Erfolgreich! Der Ort (und ggf. das Event) sind nun live.");
            renderAdminPlaceList(); // Admin-Liste aktualisieren
            
            // Falls du schon eine Funktion hast, die die Karte neu lädt:
            if (typeof loadPlacesFromFirebase === "function") loadPlacesFromFirebase();
        }
    } catch (error) {
        console.error("Fehler bei der Freigabe:", error);
        alert("Fehler: " + error.message);
    }
};

// Funktion: Einen Ort freigeben (Verschieben von suggestions -> places)
window.approvePlace = async function(id) {
    if (!confirm("Möchtest du diesen Ort wirklich auf der Karte veröffentlichen?")) return;

    try {
        // 1. Das Original-Dokument finden
        const suggestionRef = window.firebaseFirestore.doc(window.db, "suggestions", id);
        const allSuggestions = await window.firebaseFirestore.getDocs(window.firebaseFirestore.collection(window.db, "suggestions"));
        const targetDoc = allSuggestions.docs.find(d => d.id === id);

        if (targetDoc) {
            const data = targetDoc.data();
            
            // 2. In die Haupt-Collection "places" schreiben
            await window.firebaseFirestore.addDoc(
                window.firebaseFirestore.collection(window.db, "places"), 
                data
            );

            // 3. Aus den Vorschlägen löschen
            await window.firebaseFirestore.deleteDoc(suggestionRef);

            alert("Erfolgreich freigegeben!");
            renderAdminPlaceList(); // Liste aktualisieren
        }
    } catch (error) {
        console.error("Fehler beim Freigeben:", error);
        alert("Fehler: " + error.message);
    }
};

// Funktion: Einen Vorschlag einfach löschen (Ablehnen)
window.deleteSuggestion = async function(id) {
    if (!confirm("Vorschlag wirklich unwiderruflich löschen?")) return;

    try {
        const suggestionRef = window.firebaseFirestore.doc(window.db, "suggestions", id);
        await window.firebaseFirestore.deleteDoc(suggestionRef);
        renderAdminPlaceList();
    } catch (error) {
        console.error("Fehler beim Löschen:", error);
    }
};

async function approveSuggestion(id) {
    const suggestion = suggestedPlaces.find(s => s.id === id);
    if (!suggestion) return;

    const { collection, addDoc, deleteDoc, doc } = window.firebaseFirestore;

    try {
        await addDoc(collection(window.db, "places"), {
            name: suggestion.name,
            category: suggestion.category,
            info: suggestion.info,
            coords: suggestion.coords,
            dates: []
        });
        
        await deleteDoc(doc(window.db, "suggestions", id));
        alert(`Ort "${suggestion.name}" freigeschaltet!`);
    } catch (e) { 
        alert("Fehler: " + e.message); 
    }
}

async function rejectSuggestion(id) {
    if (!confirm("Diesen Vorschlag wirklich löschen?")) return;
    
    const { deleteDoc, doc } = window.firebaseFirestore;
    try {
        await deleteDoc(doc(window.db, "suggestions", id));
        alert("Vorschlag abgelehnt und gelöscht.");
    } catch (e) { 
        alert("Fehler: " + e.message); 
    }
}

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