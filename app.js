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
let userMarker, userAccuracyCircle;

/* === DOM-Elemente === */
const navItems = document.querySelectorAll('.nav-item');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminModal = document.getElementById('admin-modal');
const closeBtn = document.querySelector('.close-btn');
const newPlaceForm = document.getElementById('new-place-form');
const newPlaceCoordsInput = document.getElementById('new-place-coords');

/* === INITIALISIERUNG === */
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initNavigation();
    initAdminSimulation();
    
    // START: Firebase Daten laden
    loadDataFromFirebase();
});

// 1. Echte Daten aus Firebase Firestore laden
function loadDataFromFirebase() {
    // A. Haupt-Orte laden (Echtzeit-Update)
    const { onSnapshot, collection } = window.firebaseFirestore;
    
    onSnapshot(collection(window.db, "places"), (snapshot) => {
        places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateMapMarkers();
        if (appState.activeView === 'list-view') renderList();
    });

    // B. Vorschläge für Admin laden
    onSnapshot(collection(window.db, "suggestions"), (snapshot) => {
        suggestedPlaces = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (appState.isAdmin) renderAdminPlaceList();
    });
}

/* === KARTEN LOGIK === */
const createIcon = (char) => L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: var(--primary-color); color: #fff; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.5);">${char}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
});

const categoryIcons = {
    Metzgerei: createIcon('M'), Wirtshaus: createIcon('W'), Supermarkt: createIcon('S'),
    Bäckerei: createIcon('B'), Pausenplatz: createIcon('P'), Zigarettenautomat: createIcon('Z'),
    Kirchweih: createIcon('K'), WC: createIcon('WC')
};

function initMap() {
    map = L.map('map').setView([49.45, 11.08], 13); 
    L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
        maxZoom: 19
    }).addTo(map);
    markerLayer.addTo(map);
    initMapInteractions();
}

function updateMapMarkers() {
    markerLayer.clearLayers();
    places.forEach(place => {
        if (appState.activeFilters.includes(place.category)) {
            const icon = categoryIcons[place.category] || createIcon('?');
            const popupContent = `<h3>${place.name}</h3><p>${place.info}</p>`;
            L.marker(place.coords, { icon }).bindPopup(popupContent).addTo(markerLayer);
        }
    });
}

/* === ADMIN LOGIN & LOGIK === */
function initAdminSimulation() {
    adminLoginBtn.addEventListener('click', async () => {
        if (appState.isAdmin) {
            openAdminModal();
            return;
        }

        // Einfacher Login-Dialog
        const email = prompt("Admin E-Mail:");
        const password = prompt("Passwort:");

        if (email && password) {
            const { signInWithEmailAndPassword } = window.firebaseAuth;
            try {
                await signInWithEmailAndPassword(window.auth, email, password);
                appState.isAdmin = true;
                alert("Erfolgreich als Admin angemeldet!");
                openAdminModal();
            } catch (error) {
                alert("Fehler: " + error.message);
            }
        }
    });
    
    closeBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
}

function openAdminModal() {
    adminModal.classList.remove('hidden');
    renderAdminPlaceList();
}

/* === VORSCHLÄGE EINREICHEN (USER) === */
if (newPlaceForm) {
    newPlaceForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const coordsRaw = newPlaceCoordsInput.value;
        if (!coordsRaw) return alert("Bitte Ort auf Karte wählen!");

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
            alert("Vielen Dank! Eingesendet.");
            this.reset();
            if (newPlaceMarker) newPlaceMap.removeLayer(newPlaceMarker);
            document.querySelector('.nav-item[data-view="map-view"]').click();
        } catch (e) {
            alert("Fehler beim Senden: " + e.message);
        }
    });
}

/* === ADMIN AKTIONEN (FREIGEBEN / ABLEHNEN) === */
async function approveSuggestion(id, index) {
    const suggestion = suggestedPlaces.find(s => s.id === id);
    const { collection, addDoc, deleteDoc, doc } = window.firebaseFirestore;

    try {
        // 1. In Hauptliste 'places' verschieben
        await addDoc(collection(window.db, "places"), {
            name: suggestion.name,
            category: suggestion.category,
            info: suggestion.info,
            coords: suggestion.coords,
            dates: []
        });
        // 2. Aus 'suggestions' löschen
        await deleteDoc(doc(window.db, "suggestions", id));
        alert("Ort freigeschaltet!");
    } catch (e) { alert("Fehler: " + e.message); }
}

async function rejectSuggestion(id) {
    const { deleteDoc, doc } = window.firebaseFirestore;
    try {
        await deleteDoc(doc(window.db, "suggestions", id));
        alert("Vorschlag gelöscht.");
    } catch (e) { alert("Fehler: " + e.message); }
}

// ... Restliche Funktionen (initNavigation, renderList, renderCalendar, initNewPlaceMap) bleiben wie gehabt ...
// (Hier der Vollständigkeit halber weggelassen, du hast sie ja bereits lokal)