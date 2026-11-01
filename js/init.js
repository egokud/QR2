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


// ============ ДОСТУП: подписка / тест / 5 дней льготы / только чтение ============
// Должно совпадать с правилами Firestore (canWrite): тест 30 дн. с регистрации (участникам пилота — 90 дн.,
// галочка «Пилот» в админке) — только пока подписки не было;
// как только подписка выдана, действует только её срок (остаток теста сгорает). После окончания —
// ещё 5 календарных дней всё работает, затем только просмотр. Заблокирован — сразу только просмотр.
const PK_TRIAL_DAYS = 30, PK_PILOT_TRIAL_DAYS = 90, PK_GRACE_DAYS = 5;
function pkToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000);
  const d = new Date(v); return isNaN(d) ? null : d;
}
function pkAccess(p) {
  p = p || userProfile || {};
  const now = new Date(), DAY = 864e5;
  if (p.role === 'admin') return { kind: 'admin' };
  if (p.blocked) return { kind: 'blocked' };
  const trialEnd = new Date((pkToDate(p.created) || now).getTime() + (p.founder ? PK_PILOT_TRIAL_DAYS : PK_TRIAL_DAYS) * DAY);
  const subEnd = p.subscription ? pkToDate(p.subscription.endDate) : null;
  const from = subEnd ? 'sub' : 'trial';
  const end = from === 'sub' ? subEnd : trialEnd;
  const until = new Date(end.getTime() + PK_GRACE_DAYS * DAY);
  if (now < end) return { kind: from, from, end, left: Math.ceil((end - now) / DAY) };
  if (now < until) return { kind: 'grace', from, end, until, left: Math.ceil((until - now) / DAY) };
  return { kind: 'readonly', from, end };
}
// Режим «только просмотр»: запись в свои закупки/отметки/историю не уходит, вместо ошибки — понятная подсказка.
// Сервер (правила Firestore) запрещает то же самое независимо от этого кода.
(function () {
  const F = firebase.firestore; let lastMsg = 0;
  const ro = path => !!(userProfile && userProfile._readonly && currentUser && String(path || '').startsWith('users/' + currentUser.uid + '/'));
  const deny = () => {
    if (Date.now() - lastMsg > 4000) {
      lastMsg = Date.now();
      const m = userProfile && userProfile.blocked ? 'Доступ ограничен: только просмотр. Обратитесь в техподдержку.'
        : 'Подписка истекла — сейчас только просмотр. Продлите подписку, и всё снова заработает.';
      if (typeof showToast === 'function') showToast(m); else alert(m);
    }
    const e = new Error('Только просмотр: подписка истекла'); e.code = 'permission-denied'; return e;
  };
  const D = F.DocumentReference && F.DocumentReference.prototype;
  if (D) ['set', 'update', 'delete'].forEach(m => { const o = D[m]; D[m] = function () { return ro(this.path) ? Promise.reject(deny()) : o.apply(this, arguments); }; });
  const C = F.CollectionReference && F.CollectionReference.prototype;
  if (C) { const o = C.add; C.add = function () { return ro(this.path + '/_') ? Promise.reject(deny()) : o.apply(this, arguments); }; }
  [F.WriteBatch, F.Transaction].forEach(K => {
    const P = K && K.prototype; if (!P) return;
    ['set', 'update', 'delete'].forEach(m => { const o = P[m]; P[m] = function (ref) { if (ref && ro(ref.path)) throw deny(); return o.apply(this, arguments); }; });
  });
})();
