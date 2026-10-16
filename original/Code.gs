// ===== Iglesia Filadelfia I · Acceso con registro y aprobación =====
// CONFIGURACIÓN (una sola vez): Configuración del proyecto ⚙ > Propiedades de la secuencia de comandos
//   Agrega: ADMIN_KEY = (tu clave maestra, solo tú la sabes)
const P = PropertiesService.getScriptProperties();
const DIAS = 30 * 864e5;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Login').setTitle('Iglesia Filadelfia I')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- utilidades ----------
const jget_ = (k, d) => { const v = P.getProperty(k); return v ? JSON.parse(v) : d; };
const jset_ = (k, v) => P.setProperty(k, JSON.stringify(v));
const hash_ = (s, salt) => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + s));
const norm_ = u => String(u || '').trim().toLowerCase();
function locked_(fn) { const l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }
function throttle_(id) { // máx. 5 intentos fallidos / 10 min
  const c = CacheService.getScriptCache(), k = 'f' + hash_(id, 't').replace(/\W/g, '').slice(0, 24), n = +c.get(k) || 0;
  if (n >= 5) throw new Error('Demasiados intentos. Espera 10 minutos.');
  return () => c.put(k, String(n + 1), 600);
}
function mk_(u, role, perm, name) {
  return locked_(() => {
    const S = jget_('SESS', {}), now = Date.now(), t = Utilities.getUuid() + Utilities.getUuid();
    Object.keys(S).forEach(k => { if (S[k].exp < now) delete S[k]; });
    S[t] = { u, role, exp: now + DIAS }; jset_('SESS', S);
    return { token: t, role, perm, name };
  });
}
function auth_(t, admin) {
  const s = jget_('SESS', {})[t];
  if (!s || s.exp < Date.now()) throw new Error('Sesión vencida. Vuelve a entrar.');
  if (s.role === 'admin') return { u: 'admin', role: 'admin', perm: 'editar', name: 'Administrador' };
  if (admin) throw new Error('No autorizado.');
  const u = jget_('USERS', {})[s.u];
  if (!u || u.status !== 'aprobado') throw new Error('Tu acceso no está activo.');
  return { u: s.u, role: 'user', perm: u.perm || 'ver', name: u.name };
}

// ---------- entrada ----------
function register(name, user, pass) {
  user = norm_(user); name = String(name || '').trim();
  if (name.length < 3 || !/^[a-z0-9._-]{3,20}$/.test(user) || String(pass).length < 6)
    throw new Error('Revisa los datos: nombre (3+), usuario (3-20, sin espacios) y clave (6+).');
  return locked_(() => {
    const U = jget_('USERS', {});
    if (U[user]) throw new Error('Ese usuario ya existe.');
    const salt = Utilities.getUuid();
    U[user] = { name, salt, h: hash_(pass, salt), status: 'pendiente', perm: 'ver', created: Date.now() };
    jset_('USERS', U); return 'ok';
  });
}
function login(user, pass) {
  user = norm_(user); const fail = throttle_('u' + user), u = jget_('USERS', {})[user];
  if (!u || hash_(pass, u.salt) !== u.h) { fail(); throw new Error('Usuario o clave incorrectos.'); }
  if (u.status === 'pendiente') throw new Error('Tu cuenta está pendiente de aprobación del administrador.');
  if (u.status !== 'aprobado') throw new Error('Tu acceso fue revocado.');
  return mk_(user, 'user', u.perm || 'ver', u.name);
}
function adminLogin(key) {
  const fail = throttle_('admin'), real = P.getProperty('ADMIN_KEY');
  if (!real || String(key) !== real) { fail(); throw new Error('Clave maestra incorrecta.'); }
  return mk_('admin', 'admin', 'editar', 'Administrador');
}
function check(t) { const a = auth_(t); return { token: t, role: a.role, perm: a.perm, name: a.name }; }
function logout(t) { locked_(() => { const S = jget_('SESS', {}); delete S[t]; jset_('SESS', S); }); }

// ---------- contenido protegido ----------
function getReport(t) { auth_(t); return HtmlService.createHtmlOutputFromFile('informe').getContent(); }
function file_() {
  const it = DriveApp.getFilesByName('Informe_Filadelfia_datos.json');
  return it.hasNext() ? it.next() : DriveApp.createFile('Informe_Filadelfia_datos.json', '{}');
}
function getData(t) { auth_(t); return file_().getBlob().getDataAsString(); }
function saveData(t, json) {
  if (auth_(t).perm !== 'editar') throw new Error('Solo lectura.');
  JSON.parse(json); locked_(() => file_().setContent(json)); return 'ok';
}

// ---------- administración (solo clave maestra) ----------
function listUsers(t) {
  auth_(t, true); const U = jget_('USERS', {});
  return Object.keys(U).map(k => ({ user: k, name: U[k].name, status: U[k].status, perm: U[k].perm, created: U[k].created }))
    .sort((a, b) => (a.status === 'pendiente' ? 0 : 1) - (b.status === 'pendiente' ? 0 : 1) || b.created - a.created);
}
function setUser(t, user, status, perm) { // status: aprobado | revocado | eliminar
  auth_(t, true);
  return locked_(() => {
    const U = jget_('USERS', {}); if (!U[user]) throw new Error('No existe.');
    if (status === 'eliminar') delete U[user]; else { U[user].status = status; U[user].perm = perm === 'editar' ? 'editar' : 'ver'; }
    jset_('USERS', U); return 'ok';
  });
}

// ---------- perfil de usuario ----------
function getProfile(t) {
  const a = auth_(t), u = jget_('USERS', {})[a.u] || {};
  return { name: a.name, user: a.u, role: a.role, perm: a.perm, created: u.created || null, status: a.role === 'admin' ? 'administrador' : u.status };
}
function setName(t, name) {
  const a = auth_(t); name = String(name || '').trim();
  if (a.role === 'admin') throw new Error('El administrador no tiene nombre editable.');
  if (name.length < 3 || name.length > 60) throw new Error('El nombre debe tener entre 3 y 60 caracteres.');
  locked_(() => { const U = jget_('USERS', {}); U[a.u].name = name; jset_('USERS', U); });
  return name;
}
function changePassword(t, oldPass, newPass) {
  const a = auth_(t);
  if (a.role === 'admin') throw new Error('La clave maestra se cambia en Propiedades de la secuencia de comandos (ADMIN_KEY).');
  if (String(newPass).length < 6) throw new Error('La clave nueva debe tener al menos 6 caracteres.');
  const fail = throttle_('c' + a.u);
  return locked_(() => {
    const U = jget_('USERS', {}), u = U[a.u];
    if (hash_(oldPass, u.salt) !== u.h) { fail(); throw new Error('La clave actual no es correcta.'); }
    u.salt = Utilities.getUuid(); u.h = hash_(newPass, u.salt); jset_('USERS', U);
    const S = jget_('SESS', {}); Object.keys(S).forEach(k => { if (S[k].u === a.u && k !== t) delete S[k]; }); jset_('SESS', S); // cierra sus otras sesiones
    return 'ok';
  });
}
