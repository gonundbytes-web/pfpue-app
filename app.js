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
    map = L.map('map', {
        zoomControl: true, 
        attributionControl: true 
    }).setView([49.301, 10.572], 13); 

    L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19
    }).addTo(map);

    L.control.attribution({ position: 'bottomleft' })
     .addAttribution('&copy; <a href="https://basemap.de" target="_blank">GeoBasis-DE / BKG</a>').addTo(map);

    markerLayer.addTo(map);
    updateMapMarkers();
    initMapInteractions();
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
    container.innerHTML = '<p style="padding: 10px;">Lade Vorschläge aus der Datenbank...</p>';

    try {
        // Wir holen alle Dokumente aus der Collection "suggestions"
        const querySnapshot = await window.firebaseFirestore.getDocs(
            window.firebaseFirestore.collection(window.db, "suggestions")
        );
        
        container.innerHTML = ''; // Lade-Text entfernen

        if (querySnapshot.empty) {
            container.innerHTML = '<p style="padding: 10px;">Keine neuen Vorschläge vorhanden. Alles erledigt! ✅</p>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;

            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.style = "border-bottom: 1px solid #ddd; padding: 15px 10px; display: flex; flex-direction: column; gap: 5px;";
            
            item.innerHTML = `
                <div style="display:flex; justify-content:between; align-items:start;">
                    <div style="flex-grow:1;">
                        <strong style="font-size: 1.1rem; color: #2e7d32;">${data.name}</strong> 
                        <span style="background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">${data.category}</span>
                        <p style="margin: 5px 0; font-size: 0.9rem; color: #555;">${data.info || '<em>Keine Zusatzinfos</em>'}</p>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button onclick="approvePlace('${id}')" style="background-color: #4CAF50; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; flex: 1;">✔ Freigeben</button>
                    <button onclick="deleteSuggestion('${id}')" style="background-color: #f44336; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; flex: 1;">✖ Löschen</button>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error("Fehler beim Laden der Admin-Liste:", error);
        container.innerHTML = '<p style="color: red; padding: 10px;">Fehler: Du hast eventuell keine Berechtigung (Sicherheitsregeln!).</p>';
    }
}

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