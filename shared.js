// ============================================================
// shared.js — Promoción 2004
// Lógica común de Firebase + jugadores, usada por index.html
// (vista pública: asistencia y posición) y entrenador.html
// (vista privada: arma la alineación).
//
// Cambia esto cada semana: identifica el partido (nadie
// confirmado al inicio). Debe ser IGUAL en ambas páginas,
// por eso vive acá, en un solo lugar.
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC14Y-YWRQ8smHMQydtIGUL0Dc2XrwN8pI",
  authDomain: "promo2004-futbol.firebaseapp.com",
  projectId: "promo2004-futbol",
  storageBucket: "promo2004-futbol.firebasestorage.app",
  messagingSenderId: "882535263793",
  appId: "1:882535263793:web:e8b77bc14e4d3a478def10"
};

const MATCH_ID = "2026-10-10";
// El sáb 03/10 no hubo fecha por las elecciones municipales y regionales;
// la 8va fecha pasó al sáb 10/10. Las posiciones del 03/10 se arrastran
// solas (ver lastConfirmedPositions).
const MATCH_LABEL = "Sáb 10/10 · 7:40 pm · 8va fecha · vs Promoción 2001";

// Identifica la temporada para la tabla oficial / estadísticas
// (colección seasons/{SEASON_ID}/matches). Cambia esto solo cuando
// arranque una temporada nueva. Usado por index.html y entrenador.html.
const SEASON_ID = "2026";

// Roster base: id, nombre, posición de referencia (tag).
// La posición de cada jugador no cambia de fecha a fecha: el tag de acá
// es la última posición confirmada en la historia (5ta y 6ta fecha).
// Cada partido nuevo arranca con la última posición confirmada de cada
// uno (ver lastConfirmedPositions); si alguien la cambia, desde ahí
// se arrastra a las fechas siguientes. "confirmed" es solo del partido.
const BASE_ROSTER = {
  p1:{name:"Víctor Espinoza", tag:"DEF"},
  p2:{name:"Walter Fernández", tag:"DEL"},
  p3:{name:"Erick Talavera", tag:"VOL"},
  p4:{name:"Faviani Solís", tag:"VOL"},
  p5:{name:"Derrick Miranda", tag:"VOL"},
  p6:{name:"Renzo Chumpitaz", tag:"DEF"},
  p7:{name:"Renzo Yaya", tag:"DEF"},
  p8:{name:"Ernesto Vásquez", tag:"DEL"},
  p9:{name:"Eberth Morillo", tag:"DEF"},
  p10:{name:"Oscar Bustamante", tag:"VOL"},
  p11:{name:"Fernando Ramírez", tag:"DEL"},
  p12:{name:"Gilberto Vásquez", tag:"DEL"},
  p13:{name:"Ademir Paucar", tag:"ARQ"},
  p14:{name:"Willy García", tag:"ARQ"},
  p15:{name:"Brayan García", tag:"VOL"},
  p16:{name:"Luigi Chumbes", tag:"DEF"},
  p17:{name:"Miguel Chumpitaz", tag:"VOL"},
  p18:{name:"Daniel Torres", tag:"DEF"},
  p19:{name:"José Camacho", tag:"VOL"},
  p20:{name:"Jorge Purizaca", tag:"DEF"},
  p21:{name:"Jorge Bautista", tag:"VOL"},
  p22:{name:"Andrés Talavera", tag:"ARQ"}
};

// ============================================================
// Firestore: asistencia + posición compartidas en tiempo real
// ============================================================
let remoteConfirmed = {};    // { playerId: true/false }
let remoteExtraPlayers = {}; // { playerId: {name, tag} } -- jugadores agregados en vivo
let remotePositions = {};    // { playerId: "ARQ"|"DEF"|"VOL"|"DEL"|"" } -- posición elegida en vivo
let remoteConfirmedBy = {};  // { playerId: actorId } -- quién tocó el punto verde por última vez
let matchRef = null;
let activePosPlayerId = null;
let onMatchUpdate = null; // callback que define cada página (qué re-renderizar)

// ============================================================
// Identidad del dispositivo: quién soy yo en este celular.
// Se guarda una sola vez en localStorage (no es login real,
// pero deja rastro de quién tocó cada cosa).
// ============================================================
const WHOAMI_KEY = "promo2004_who_am_i";

function getDeviceId(){
  return localStorage.getItem(WHOAMI_KEY);
}

function setDeviceId(id){
  localStorage.setItem(WHOAMI_KEY, id);
}

function openWhoOverlay(){
  const list = document.getElementById("whoList");
  if(!list) return;
  const ids = [...allRosterIds()].sort((a, b) =>
    getPlayer(a).name.localeCompare(getPlayer(b).name, "es")
  );
  list.innerHTML = ids.map(id =>
    `<button class="pick" data-id="${id}">${getPlayer(id).name}</button>`
  ).join("");
  list.querySelectorAll(".pick").forEach(btn => {
    btn.addEventListener("click", () => chooseIdentity(btn.dataset.id));
  });
  document.getElementById("whoOverlay").classList.add("open");
}

function chooseIdentity(id){
  setDeviceId(id);
  document.getElementById("whoOverlay").classList.remove("open");
  renderWhoamiLine();
  if(onMatchUpdate) onMatchUpdate();
}

function chooseAnonymous(){
  setDeviceId("anon");
  document.getElementById("whoOverlay").classList.remove("open");
  renderWhoamiLine();
  if(onMatchUpdate) onMatchUpdate();
}

function renderWhoamiLine(){
  const el = document.getElementById("whoamiLine");
  if(!el) return;
  const me = getDeviceId();
  if(!me){
    el.innerHTML = "";
    return;
  }
  const label = me === "anon" ? "Sin identificar" : (getPlayer(me) ? getPlayer(me).name : "Sin identificar");
  el.innerHTML = `Estás anotando como <strong>${label}</strong> · <button class="who-change" id="whoChangeBtn" type="button">cambiar</button>`;
  document.getElementById("whoChangeBtn").addEventListener("click", openWhoOverlay);
}

function initWhoAmI(){
  renderWhoamiLine();
  if(!getDeviceId()){
    openWhoOverlay();
  }
}

// Antes de tocar la asistencia/posición de OTRO jugador, confirma.
// Si actúas sobre ti mismo (o no hay identidad aún), no molesta.
function confirmActingForOther(targetId){
  const me = getDeviceId();
  if(!me || me === targetId) return true;
  const meName = me === "anon" ? "sin identificar" : (getPlayer(me) ? getPlayer(me).name : "sin identificar");
  const targetName = getPlayer(targetId).name;
  return confirm(`Te anotaste como ${meName}. Estás por cambiar a ${targetName}, no a ti. ¿Seguro que quieres continuar?`);
}

// Junta las posiciones confirmadas en los partidos anteriores a
// MATCH_ID, en orden: la más reciente de cada jugador gana. Así la
// posición queda registrada y pasa sola de una fecha a la siguiente.
// Si no se puede leer la historia, arranca vacío y se usa el tag del
// roster base.
function lastConfirmedPositions(db){
  return db.collection("matches").get().then(qs => {
    const docs = qs.docs.filter(d => d.id < MATCH_ID).sort((a, b) => a.id.localeCompare(b.id));
    const merged = {};
    docs.forEach(d => {
      const pos = (d.data() || {}).positions || {};
      Object.keys(pos).forEach(id => {
        if(BASE_ROSTER[id] && pos[id]) merged[id] = pos[id];
      });
    });
    return merged;
  }).catch(() => ({}));
}

function initFirebase(callback){
  onMatchUpdate = callback;
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();
    db.enablePersistence().catch(() => {});
    matchRef = db.collection("matches").doc(MATCH_ID);

    matchRef.get().then(snap => {
      if(!snap.exists){
        const initialConfirmed = {};
        Object.keys(BASE_ROSTER).forEach(id => { initialConfirmed[id] = false; });
        lastConfirmedPositions(db).then(positions => {
          matchRef.set({ label: MATCH_LABEL, confirmed: initialConfirmed, extraPlayers: {}, positions, confirmedBy: {} });
        });
      }
    });

    matchRef.onSnapshot(snap => {
      const data = snap.data() || {};
      remoteConfirmed = data.confirmed || {};
      remoteExtraPlayers = data.extraPlayers || {};
      remotePositions = data.positions || {};
      remoteConfirmedBy = data.confirmedBy || {};
      setConnStatus(true);
      if(onMatchUpdate) onMatchUpdate();
    }, err => {
      console.error(err);
      setConnStatus(false, "Error de conexión");
    });
  }catch(err){
    console.error(err);
    setConnStatus(false, "Firebase sin configurar");
  }
}

function setConnStatus(ok, customText){
  const el = document.getElementById("connStatus");
  if(!el) return;
  if(ok){
    el.textContent = "🟢 Asistencia sincronizada en vivo";
    el.classList.add("live");
  } else {
    el.textContent = customText || "Sin conexión — revisa FIREBASE_CONFIG";
    el.classList.remove("live");
  }
}

function getPlayer(id){
  if(remoteExtraPlayers[id]){
    const base = remoteExtraPlayers[id];
    const tag = remotePositions.hasOwnProperty(id) ? remotePositions[id] : (base.tag || "");
    return { ...base, tag, confirmed: !!remoteConfirmed[id], confirmedByLabel: getConfirmedByLabel(id) };
  }
  const base = BASE_ROSTER[id];
  if(!base) return null;
  const tag = remotePositions.hasOwnProperty(id) ? remotePositions[id] : base.tag;
  return { ...base, tag, confirmed: !!remoteConfirmed[id], confirmedByLabel: getConfirmedByLabel(id) };
}

function getConfirmedByLabel(id){
  const actorId = remoteConfirmedBy[id];
  if(!actorId || actorId === id) return null; // se marcó a sí mismo, no hace falta aclarar
  if(actorId === "anon") return "alguien sin identificar";
  const actor = BASE_ROSTER[actorId] || remoteExtraPlayers[actorId];
  return actor ? actor.name : null;
}

function allRosterIds(){
  return [...Object.keys(BASE_ROSTER), ...Object.keys(remoteExtraPlayers)];
}

// Orden: primero los confirmados (🔥), luego por posición en cancha
// (Arquero → Defensa → Volante → Delantero → sin definir), y por
// último alfabético dentro de cada grupo.
const POSITION_ORDER = { ARQ:0, DEF:1, VOL:2, DEL:3, "":4 };

function sortRoster(ids){
  return [...ids].sort((a, b) => {
    const pa = getPlayer(a), pb = getPlayer(b);
    const confA = pa.confirmed ? 0 : 1;
    const confB = pb.confirmed ? 0 : 1;
    if(confA !== confB) return confA - confB;

    const posA = POSITION_ORDER.hasOwnProperty(pa.tag) ? POSITION_ORDER[pa.tag] : 4;
    const posB = POSITION_ORDER.hasOwnProperty(pb.tag) ? POSITION_ORDER[pb.tag] : 4;
    if(posA !== posB) return posA - posB;

    return pa.name.localeCompare(pb.name, "es");
  });
}

function toggleConfirmed(id){
  if(!matchRef){ alert("Firebase no está configurado todavía."); return; }
  if(!confirmActingForOther(id)) return;
  const current = !!remoteConfirmed[id];
  const me = getDeviceId() || "anon";
  matchRef.update({
    [`confirmed.${id}`]: !current,
    [`confirmedBy.${id}`]: me
  }).catch(err => {
    alert("No se pudo guardar: " + err.message);
  });
}

function openPositionPicker(id){
  if(!matchRef){ alert("Firebase no está configurado todavía."); return; }
  activePosPlayerId = id;
  const p = getPlayer(id);
  document.getElementById("posSheetTitle").textContent = `Confirmar posición de ${p.name}`;
  document.getElementById("posOverlay").classList.add("open");
}

function setPosition(tag){
  if(!matchRef || !activePosPlayerId) { closePosPicker(); return; }
  if(!confirmActingForOther(activePosPlayerId)){ closePosPicker(); return; }
  matchRef.update({ [`positions.${activePosPlayerId}`]: tag }).catch(err => {
    alert("No se pudo guardar: " + err.message);
  });
  closePosPicker();
}

function closePosPicker(){
  document.getElementById("posOverlay").classList.remove("open");
  activePosPlayerId = null;
}

function addNewPlayer(){
  if(!matchRef){ alert("Firebase no está configurado todavía."); return; }
  const name = prompt("Nombre del jugador que se anota:");
  if(!name || !name.trim()) return;
  const id = `x${Date.now()}`;
  matchRef.update({
    [`extraPlayers.${id}`]: { name: name.trim(), tag:"" },
    [`confirmed.${id}`]: true
  }).catch(err => alert("No se pudo guardar: " + err.message));
}

// Solo se puede quitar a un jugador agregado en vivo (extraPlayers),
// no a los 22 del roster fijo.
function removeExtraPlayer(id){
  if(!matchRef || !remoteExtraPlayers[id]) return;
  const name = remoteExtraPlayers[id].name;
  if(!confirm(`¿Quitar a ${name} de la lista? No se puede deshacer.`)) return;
  matchRef.update({
    [`extraPlayers.${id}`]: firebase.firestore.FieldValue.delete(),
    [`confirmed.${id}`]: firebase.firestore.FieldValue.delete(),
    [`positions.${id}`]: firebase.firestore.FieldValue.delete(),
    [`confirmedBy.${id}`]: firebase.firestore.FieldValue.delete()
  }).catch(err => alert("No se pudo quitar: " + err.message));
}

function timeNow(){
  return new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
}

// ============================================================
// Chip reutilizable: nombre (toca=asistencia) + posición (toca=elegir)
// Usado tanto en la lista de Asistencia como en la Banca del entrenador.
// ============================================================
function renderRosterChips(containerId, ids){
  const container = document.getElementById(containerId);
  if(!container) return;
  if(ids.length === 0){
    container.innerHTML = `<span class="log-empty">Sin jugadores</span>`;
    return;
  }
  container.innerHTML = ids.map(id => {
    const p = getPlayer(id);
    const dot = p.confirmed ? '<span class="dot-confirmed">🔥</span>' : '';
    const posLabel = p.tag ? p.tag : "＋ pos";
    const posClass = p.tag ? "chip-pos set" : "chip-pos";
    const byNote = p.confirmed && p.confirmedByLabel
      ? `<span class="by-note"> · marcó ${p.confirmedByLabel}</span>`
      : "";
    const removeBtn = remoteExtraPlayers[id]
      ? `<button class="chip-remove" data-id="${id}" type="button" aria-label="Quitar ${p.name}">✕</button>`
      : "";
    return `<span class="chip-group">
      <button class="chip-name" data-id="${id}" type="button">${dot}${p.name}${byNote}</button>
      <button class="${posClass}" data-id="${id}" type="button">${posLabel}</button>
      ${removeBtn}
    </span>`;
  }).join("");
  container.querySelectorAll(".chip-name").forEach(btn => {
    btn.addEventListener("click", () => toggleConfirmed(btn.dataset.id));
  });
  container.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", () => removeExtraPlayer(btn.dataset.id));
  });
  container.querySelectorAll(".chip-pos").forEach(btn => {
    btn.addEventListener("click", () => openPositionPicker(btn.dataset.id));
  });
}

// Conecta los botones del selector de posición (mismo markup en ambas páginas)
function initPositionPickerUI(){
  document.getElementById("posSheetClose").addEventListener("click", closePosPicker);
  document.getElementById("posOverlay").querySelectorAll(".pick").forEach(btn => {
    btn.addEventListener("click", () => setPosition(btn.dataset.tag));
  });
  document.getElementById("posOverlay").addEventListener("click", (e) => {
    if(e.target.id === "posOverlay") closePosPicker();
  });
}
