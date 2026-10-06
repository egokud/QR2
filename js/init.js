// ============ FIREBASE INIT ============
firebase.initializeApp({
  apiKey: "AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss",
  authDomain: "parcel-scanner-90427.firebaseapp.com",
  projectId: "parcel-scanner-90427",
  storageBucket: "parcel-scanner-90427.firebasestorage.app",
  messagingSenderId: "490608225628",
  appId: "1:490608225628:web:1087fa2403c7f089d2e599"
});
const auth = firebase.auth();
auth.languageCode = 'ru';
// Явно сохраняем сессию входа в браузере (чтобы не выкидывало после обновления)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
const db = firebase.firestore();
// db.enablePersistence отключён — ломал загрузку данных после смены ключа
// (при необходимости офлайн-кэш можно вернуть через FirestoreSettings.cache)
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
function fsVal(v){if(v==null)return null;if('stringValue'in v)return v.stringValue;if('integerValue'in v)return parseInt(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;if('timestampValue'in v)return new Date(v.timestampValue);if('mapValue'in v){const o={};for(const k in(v.mapValue.fields||{}))o[k]=fsVal(v.mapValue.fields[k]);return o;}if('arrayValue'in v)return(v.arrayValue.values||[]).map(fsVal);if('nullValue'in v)return null;return null;}
function fsDocToObj(doc){const o={};for(const k in(doc.fields||{}))o[k]=fsVal(doc.fields[k]);return o;}
async function fsGet(path){const token=savedToken||(auth.currentUser&&await auth.currentUser.getIdToken());const r=await fetch(FS_BASE+'/'+path,{headers:{'Authorization':'Bearer '+token}});if(r.status===404)return{exists:false};if(!r.ok)throw new Error('fsGet '+r.status);const doc=await r.json();return{exists:true,data:()=>fsDocToObj(doc),id:(doc.name||'').split('/').pop()};}
async function fsList(path){const token=savedToken||(auth.currentUser&&await auth.currentUser.getIdToken());const r=await fetch(FS_BASE+'/'+path+'?pageSize=300',{headers:{'Authorization':'Bearer '+token}});if(!r.ok)throw new Error('fsList '+r.status);const j=await r.json();return(j.documents||[]).map(doc=>({id:(doc.name||'').split('/').pop(),data:()=>fsDocToObj(doc)}));}
const ADMIN_EMAIL = 'egokud@gmail.com';

// ============ STATE ============
let currentUser = null;
let savedUid = null;
let savedToken = null;
let userProfile = null;
let TABLE = [];
let scanned = {};
let scanHistory = [];
let activeShipmentId = null;
let editingShipmentId = null;  // приход который редактируем через действия/шестерёнку (независим от активного для сканирования)
// Курсы текущего прихода (раздел Клиенты). Дефолты если приходов ещё не было.
const DEFAULT_RATES = { clientRate: 0.60, buyRate: 0.46, shipClient: 20, shipCargo: 15 };
let currentRates = { ...DEFAULT_RATES };
let currentWeights = {};      // { "Егор": 3.2, "Вероника": 1.8, ... } вес по клиентам
let currentOwners = {};       // { "Я": true } клиенты помеченные "это владелец" (затраты, не доход)
let currentPriceInclWeight = {};  // { "Карина": true } клиенты у кого вес ВКЛЮЧЁН в цену (доставку не берём с клиента, но карго-себест вычитаем из прибыли)
let currentCostGoods = {};  // { "Егор": true } клиенты у кого ТОВАРЫ по себестоимости (без наценки)
let currentCostShip = {};   // { "Егор": true } клиенты у кого ДОСТАВКА по себестоимости (без наценки)
let currentTare = 0;          // вес тары (коробки)
let currentCargoWeight = 0;   // вес от карго (Этап 5)
let shipmentDeparted = false; // галочка "выехала" (Этап 5)
let scanner = null;
let scanning = false;
let allCameras = [];
let activeCameraId = null;

