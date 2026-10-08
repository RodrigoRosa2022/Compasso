// Public Firebase web configuration. Authentication and Firestore rules protect teacher data.
const firebaseConfig = {
  apiKey: 'AIzaSyC2Vm0QVYnjhdsOqwVZX1DG3cfCV5A-5go',
  authDomain: 'compasso-17b69.firebaseapp.com',
  projectId: 'compasso-17b69',
  storageBucket: 'compasso-17b69.firebasestorage.app',
  messagingSenderId: '32989675218',
  appId: '1:32989675218:web:ae5991b317d4ea93f5b70b'
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();
const authPersistenceReady = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
const ANCHOR_PREFIX = 'compasso-cloud-anchor-v1-';
const LOCAL_OWNER_KEY = 'compasso-cloud-owner-v1';
let state = { ready: false, user: null, hasCloudCopy: null, checkState: 'idle', syncEnabled: false, status: '', accessState: 'idle', complimentaryPro: false, proAccess: false, paidPlanStatus: '', proSource: '' };
let authGeneration = 0, reconciliation = null, writeInProgress = null, syncTimer = null, erasing = false;
let inspectedConflict = null;

function emit() { window.dispatchEvent(new CustomEvent('compasso-cloud-state', { detail: { ...state } })); }
function teacherDoc(uid = state.user?.uid) { return uid ? db.collection('teachers').doc(uid) : null; }
function anchorKey(uid) { return ANCHOR_PREFIX + uid; }
function readAnchor(uid) {
  try { const value = JSON.parse(localStorage.getItem(anchorKey(uid)) || 'null'); return value?.hash && Number.isInteger(value.revision) ? value : null; }
  catch (_) { return null; }
}
function writeAnchor(uid, revision, hash) {
  localStorage.setItem(anchorKey(uid), JSON.stringify({ revision, hash }));
  localStorage.setItem(LOCAL_OWNER_KEY, uid);
}
function localBackup() { return window.CompassoCloudBackup?.() || null; }
function localOperations() { return window.CompassoCloudOperations?.() || { entries: [], issue: '' }; }
function checkOperations(remote, local, operations) {
  if (operations?.issue) throw new Error('local-integrity');
  try{window.CompassoDataV2.validateCanonical(local.data)}
  catch(error){throw new Error('local-integrity')}
  if (!remote) return;
  if (!operations?.entries?.length) throw new Error('missing-operations');
  let expected;
  try{expected=window.CompassoJournal.apply(remote, operations.entries)}
  catch(error){throw new Error('operation-mismatch')}
  if (!window.CompassoJournal.same(expected, window.CompassoJournal.material(local)))
    throw new Error('operation-mismatch');
}
function retainedVersions(documentData, backup, revision) {
  const history = [...(documentData?.previousBackups || [])];
  if (backup?.data) history.push({ revision, backup });
  // Keep the current document safely below Firestore's 1 MiB document limit.
  while (history.length && (history.length > 3 || JSON.stringify({backup,previousBackups:history}).length > 850000)) history.shift();
  return history;
}
async function inspectConflict() {
  if (!state.user) throw new Error('Entre com Google primeiro.');
  const uid = state.user.uid, snapshot = await serverSnapshot(uid), local = localBackup();
  if (!snapshot.exists || !snapshot.data()?.backup?.data || !local?.data)
    throw new Error('Não foi possível comparar as duas cópias.');
  const remote = snapshot.data().backup;
  window.CompassoDataV2.validateCanonical(remote.data);
  window.CompassoDataV2.validateCanonical(local.data);
  const remoteMaterial = window.CompassoJournal.material(remote);
  const localMaterial = window.CompassoJournal.material(local);
  const differences = window.CompassoJournal.changes(remoteMaterial, localMaterial);
  inspectedConflict = { uid, remote, local, remoteHash: await fingerprint(remote),
    localHash: await fingerprint(local), revision: Number.isInteger(snapshot.data().revision) ? snapshot.data().revision : 1,
    differences, remoteMaterial, localMaterial };
  return { remoteBackup: remote, localBackup: local, differences: differences.map((change, index) => ({ index,
    label: window.CompassoJournal.describe(change, remoteMaterial, localMaterial),
    collection: change.collection, id: change.id, before: change.before, after: change.after })) };
}
async function resolveConflict(choices) {
  const review = inspectedConflict;
  if (!review || state.user?.uid !== review.uid || await fingerprint(localBackup()) !== review.localHash)
    throw new Error('Os dados mudaram. Abra a comparação novamente.');
  if (!Array.isArray(choices) || choices.length !== review.differences.length ||
      choices.some(choice => !['local', 'cloud'].includes(choice)))
    throw new Error('Escolha uma versão para cada diferença.');
  const selected = review.differences.filter((_, index) => choices[index] === 'local');
  const merged = window.CompassoJournal.apply(review.remote, [{ changes: selected }]);
  const backup = selected.length ? { ...review.remote, appVersion: localBackup().appVersion,
    exportedAt: new Date().toISOString(), data: { ...merged, meta: review.remote.data.meta || {} } } : review.remote;
  window.CompassoDataV2.validateCanonical(backup.data);
  const hash = selected.length ? await fingerprint(backup) : review.remoteHash;
  let revision = review.revision;
  await db.runTransaction(async transaction => {
    const ref = teacherDoc(review.uid), snapshot = await transaction.get(ref), remote = snapshot.data()?.backup;
    if (!remote || await fingerprint(remote) !== review.remoteHash ||
        (Number.isInteger(snapshot.data().revision) ? snapshot.data().revision : 1) !== review.revision)
      throw new Error('A nuvem mudou. Abra a comparação novamente.');
    if (hash === review.remoteHash) return;
    revision = review.revision + 1;
    transaction.set(ref, { ...snapshot.data(), backup, revision,
      previousBackups: retainedVersions(snapshot.data(), remote, review.revision),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(), appVersion: backup.appVersion || '' });
  });
  await restoreCloud(backup);
  writeAnchor(review.uid, revision, hash);
  state.hasCloudCopy = true; state.hasCloudRecords = meaningful(backup);
  inspectedConflict = null;
  synced();
}
function meaningful(backup) {
  const data = backup?.data || {};
  return ['students', 'classSchedules', 'billingRules', 'books', 'studentBooks', 'repertoire', 'studentRepertoire', 'paymentRecords', 'classOverrides'].some(key => data[key]?.length);
}
function hasProfile(backup) { return !!(backup?.data?.settings?.teacherName || backup?.data?.settings?.schoolName); }
async function fingerprint(backup) {
  if (!backup?.data || !crypto?.subtle) throw new Error('Não foi possível conferir a integridade dos dados.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify(window.CompassoJournal.material(backup))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function legacyFingerprint(backup) {
  if (!backup?.data || !crypto?.subtle) throw new Error('Não foi possível conferir a integridade dos dados.');
  const data = JSON.parse(JSON.stringify(backup.data));
  if (data.settings) { delete data.settings.lastBackupAt; delete data.settings.lastCloudRestoreAt; }
  delete data.meta; // Save and migration timestamps do not change the teacher's records.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function setStatus(checkState, status) { state.checkState = checkState; state.status = status; emit(); }
function conflict() {
  state.syncEnabled = false;
  setStatus('conflict', 'Há alterações diferentes neste aparelho e na nuvem. Nenhuma cópia foi substituída. Exporte um backup antes de resolver.');
}
function pending() { setStatus('pending', navigator.onLine ? 'Alterações neste aparelho aguardando sincronização' : 'Sem internet · alterações salvas neste aparelho'); }
function synced() { state.syncEnabled = true; setStatus('available', 'Sincronizado'); }
async function linkedTo(uid, revision, hash) {
  writeAnchor(uid, revision, hash);
  const current = localBackup();
  if (current?.data && await fingerprint(current) !== hash) { state.syncEnabled = true; pending(); scheduleSync(0); }
  else synced();
}
async function restoreCloud(backup) {
  await new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent('compasso-cloud-restore', { detail: { backup, automatic: true, resolve, reject } })));
}
async function serverSnapshot(uid) { return teacherDoc(uid).get({ source: 'server' }); }

async function refreshAccess() {
  const uid = state.user?.uid;
  if (!uid) return;
  state.accessState = 'checking'; emit();
  try {
    const snapshot = await db.collection('entitlements').doc(uid).get();
    if (state.user?.uid !== uid) return;
    const grant = snapshot.data();
    const complimentary = snapshot.exists && grant?.active === true && grant?.plan === 'pro' && grant?.source === 'complimentary';
    const paid = snapshot.exists && grant?.active === true && grant?.plan === 'pro' && grant?.source === 'google_play';
    state.complimentaryPro = !!complimentary;
    state.proAccess = !!(complimentary || paid);
    state.proSource = snapshot.exists ? grant?.source || '' : '';
    state.paidPlanStatus = grant?.source === 'google_play' ? grant?.status || (paid ? 'active' : 'expired') : '';
    state.accessState = 'ready';
  } catch (_) {
    if (state.user?.uid !== uid) return;
    state.accessState = 'error';
  }
  emit();
}
function friendlyAuthError(error) {
  if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return 'Entrada com Google cancelada.';
  if (error?.code === 'auth/popup-blocked') return 'O Google não conseguiu abrir. Permita janelas do Compasso e tente novamente.';
  if (error?.code === 'auth/unauthorized-domain') return 'Este endereço do Compasso ainda não foi autorizado no Firebase.';
  if (!navigator.onLine) return 'Sem conexão com a internet. Conecte-se e tente novamente.';
  return 'Não foi possível entrar com Google. Tente novamente.';
}

async function reconcile(uid, generation) {
  const valid = () => state.user?.uid === uid && authGeneration === generation;
  setStatus('checking', 'Conferindo seus dados na nuvem…');
  try {
    const snapshot = await serverSnapshot(uid);
    if (!valid()) return;
    const remote = snapshot.data()?.backup;
    if (snapshot.exists && !remote?.data) throw new Error('A cópia na nuvem não pôde ser lida. Nenhum dado foi substituído.');
    state.hasCloudCopy = snapshot.exists;
    state.hasCloudRecords = meaningful(remote);
    const local = localBackup();
    if (!local?.data) {
      state.syncEnabled = false;
      setStatus('idle', 'Demonstração separada · seus dados reais não serão sincronizados agora');
      return;
    }
    const localHash = await fingerprint(local);
    if (!valid()) return;
    const knownOwner = localStorage.getItem(LOCAL_OWNER_KEY) || localStorage.getItem('compasso-cloud-sync-user');
    if ((meaningful(local) || hasProfile(local)) && knownOwner && knownOwner !== uid) {
      conflict();
      state.status = 'Este aparelho contém dados de outra conta Google. Nada foi enviado ou substituído. Exporte um backup antes de trocar de conta.';
      emit();
      return;
    }
    if (!snapshot.exists) {
      if(localOperations().issue){state.syncEnabled=false;state.hasCloudCopy=false;setStatus('conflict','Os dados deste aparelho precisam de revisão. Nada foi enviado à nuvem. Restaure um backup válido em Dados e backup.');return}
      state.syncEnabled = true;
      if (meaningful(local) || hasProfile(local)) { localStorage.setItem(LOCAL_OWNER_KEY, uid); pending(); scheduleSync(0); }
      else { localStorage.setItem(LOCAL_OWNER_KEY, uid); setStatus('available', 'Conectado · aguardando seus primeiros dados'); }
      return;
    }
    const remoteHash = await fingerprint(remote);
    if (!valid()) return;
    const revision = Number.isInteger(snapshot.data().revision) ? snapshot.data().revision : 1;
    let anchor = readAnchor(uid);
    if(anchor && anchor.revision===revision && anchor.hash!==remoteHash &&
       anchor.hash===await legacyFingerprint(remote)){
      writeAnchor(uid,revision,remoteHash);
      anchor=readAnchor(uid);
    }
    if (localHash === remoteHash) {
      const ids=localOperations().entries.map(entry=>entry.id);
      if(ids.length)window.dispatchEvent(new CustomEvent('compasso-cloud-ack',{detail:{ids}}));
      await linkedTo(uid, revision, remoteHash);
    } else if ((!meaningful(local) && (meaningful(remote) || (!hasProfile(local) && hasProfile(remote)))) || (anchor?.hash === localHash && anchor?.revision <= revision)) {
      // A clean profile/dialog is only a view: the restore handler closes it after
      // the cloud copy is safely persisted. Never discard genuinely unsaved edits.
      if (document.querySelector('.modal-back .modal[data-dirty="true"]')) throw new Error('Feche a edição aberta para recuperar os dados da nuvem.');
      if (await fingerprint(localBackup()) !== localHash) throw new Error('Os dados deste aparelho mudaram durante a conferência. Tente novamente.');
      await restoreCloud(remote);
      if (!valid()) return;
      await linkedTo(uid, revision, remoteHash);
    } else if (anchor?.hash === remoteHash && localOperations().entries.length && !localOperations().issue) {
      try{checkOperations(remote,local,localOperations())}catch(error){conflict();return}
      writeAnchor(uid,revision,remoteHash);
      state.syncEnabled = true;
      pending();
      scheduleSync(0);
    } else conflict();
  } catch (error) {
    if (!valid()) return;
    state.syncEnabled = false;
    const safeMessage = /cópia|Feche a edição|mudaram durante/.test(error?.message || '');
    setStatus('error', safeMessage ? error.message : 'Sem acesso à nuvem. Seus dados continuam neste aparelho; tente novamente quando houver internet.');
    throw error;
  }
}
function startReconciliation() {
  const uid = state.user?.uid, generation = authGeneration;
  if (!uid || erasing) return Promise.resolve();
  if (reconciliation?.uid === uid) return reconciliation.promise;
  const promise = reconcile(uid, generation);
  reconciliation = { uid, promise };
  promise.finally(() => { if (reconciliation?.promise === promise) reconciliation = null; }).catch(() => {});
  return promise;
}
function scheduleSync(delay = 900) {
  clearTimeout(syncTimer);
  if (!state.user || !state.syncEnabled || erasing) return;
  syncTimer = setTimeout(() => { flushSync().catch(() => {}); }, delay);
}
async function flushSync() {
  if (writeInProgress || !state.user || !state.syncEnabled || erasing) return writeInProgress;
  const uid = state.user.uid, generation = authGeneration, backup = localBackup();
  if (!backup?.data) return;
  if (localStorage.getItem(LOCAL_OWNER_KEY) !== uid) { conflict(); return; }
  const operations=localOperations();
  if(operations.issue){conflict();return}
  const hash = await fingerprint(backup);
  if (state.user?.uid !== uid || generation !== authGeneration || !state.syncEnabled || erasing) return;
  const anchor = readAnchor(uid);
  if (hash === anchor?.hash) { synced(); return; }
  if (!meaningful(backup)) {
    // Browser storage loss or a reset phone must not delete an existing cloud copy.
    if (state.hasCloudCopy && state.hasCloudRecords !== false) { await startReconciliation(); return; }
    if (!state.hasCloudCopy && !hasProfile(backup)) { setStatus('available', 'Conectado · aguardando seus primeiros dados'); return; }
  }
  pending();
  const job = (async () => {
    try {
      let nextRevision;
      await db.runTransaction(async transaction => {
        const ref = teacherDoc(uid), snapshot = await transaction.get(ref);
        const remote = snapshot.data()?.backup;
        if (snapshot.exists && !remote?.data) throw new Error('invalid-cloud');
        const remoteHash = remote ? await fingerprint(remote) : null;
        const remoteRevision = snapshot.exists ? (Number.isInteger(snapshot.data().revision) ? snapshot.data().revision : 1) : 0;
        if (remote && (!anchor || anchor.hash !== remoteHash || anchor.revision !== remoteRevision)) throw new Error('cloud-changed');
        if (!remote && anchor) throw new Error('cloud-changed');
        checkOperations(remote,backup,operations);
        nextRevision = remoteRevision + 1;
        transaction.set(ref, { backup, revision: nextRevision,
          previousBackups: retainedVersions(snapshot.data(), remote, remoteRevision),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(), appVersion: backup.appVersion || '' });
      });
      if (state.user?.uid !== uid || generation !== authGeneration) return;
      writeAnchor(uid, nextRevision, hash);
      state.hasCloudCopy = true;
      state.hasCloudRecords = meaningful(backup);
      if(operations.entries.length)window.dispatchEvent(new CustomEvent('compasso-cloud-ack',{detail:{ids:operations.entries.map(entry=>entry.id)}}));
      const latest = localBackup();
      if (latest?.data && await fingerprint(latest) !== hash) { pending(); scheduleSync(0); }
      else synced();
    } catch (error) {
      if (state.user?.uid !== uid || generation !== authGeneration) return;
      if (['cloud-changed','invalid-cloud','local-integrity','missing-operations','operation-mismatch'].includes(error?.message)) conflict();
      else if (!navigator.onLine || error?.code === 'unavailable') pending();
      else setStatus('error', 'Não foi possível salvar na nuvem. As alterações permanecem neste aparelho; toque em Verificar novamente.');
    }
  })();
  writeInProgress = job;
  try { await job; } finally { if (writeInProgress === job) writeInProgress = null; }
}
async function eraseCloudData(backup) {
  if (!state.user || !state.syncEnabled || state.checkState === 'conflict') throw new Error('Confira a sincronização antes de apagar os dados.');
  erasing = true; clearTimeout(syncTimer);
  try {
    if (writeInProgress) await writeInProgress;
    const uid = state.user.uid, anchor = readAnchor(uid), hash = await fingerprint(backup);
    let revision;
    await db.runTransaction(async transaction => {
      const ref = teacherDoc(uid), snapshot = await transaction.get(ref), remote = snapshot.data()?.backup;
      const remoteHash = remote ? await fingerprint(remote) : null;
      const currentRevision = snapshot.exists ? (Number.isInteger(snapshot.data().revision) ? snapshot.data().revision : 1) : 0;
      if (snapshot.exists && (!anchor || anchor.hash !== remoteHash || anchor.revision !== currentRevision)) throw new Error('cloud-changed');
      revision = currentRevision + 1;
      transaction.set(ref, { backup, revision,
        previousBackups: [], // Explicit erase must remove retained cloud history too.
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(), appVersion: backup.appVersion || '' });
    });
    writeAnchor(uid, revision, hash); state.hasCloudCopy = true; state.hasCloudRecords = meaningful(backup); synced();
  } catch (error) {
    if (error?.message === 'cloud-changed') conflict();
    throw error;
  } finally { erasing = false; }
}

window.CompassoCloud = {
  get state() { return { ...state }; },
  async signIn() {
    setStatus('checking', 'Abrindo Google…');
    try {
      await authPersistenceReady;
      const result = await auth.signInWithPopup(provider);
      if (!state.user || state.user.uid !== result.user.uid) await handleAuth(result.user);
      if (reconciliation?.uid === result.user.uid) await reconciliation.promise;
      return result;
    } catch (error) {
      if (error?.code?.startsWith('auth/')) { const friendly = new Error(friendlyAuthError(error)); friendly.code = error.code; throw friendly; }
      throw error;
    }
  },
  async signOut() { await auth.signOut(); },
  refreshAccess,
  retry: startReconciliation,
  inspectConflict,
  resolveConflict,
  sync() { if (state.user?.uid && state.syncEnabled) { pending(); scheduleSync(); } },
  eraseCloudData
};
async function handleAuth(user) {
  if (user && state.user?.uid === user.uid) return reconciliation?.promise;
  authGeneration++;
  clearTimeout(syncTimer);
  state = { ready: true, user: user || null, hasCloudCopy: null, checkState: user ? 'checking' : 'idle', syncEnabled: false, status: user ? 'Conferindo seus dados na nuvem…' : 'Entre para proteger seus dados na nuvem', accessState: user ? 'checking' : 'idle', complimentaryPro: false, proAccess: false, paidPlanStatus: '', proSource: '' };
  emit();
  if (!user) return;
  refreshAccess();
  try { await startReconciliation(); } catch (_) { /* Status is displayed in the profile. */ }
}
auth.onAuthStateChanged(handleAuth);
window.addEventListener('online', () => { if (state.user) startReconciliation().catch(() => {}); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) { refreshAccess(); startReconciliation().catch(() => {}); }
});
