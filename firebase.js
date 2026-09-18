// This is public web-app configuration. Firestore rules, not this value, protect teacher data.
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
const SYNC_USER_KEY = 'compasso-cloud-sync-user';
let state = { ready: false, user: null, hasCloudCopy: null, checkState: 'idle', syncEnabled: false, status: '' };
let pendingBackup = null;

function emit() {
  window.dispatchEvent(new CustomEvent('compasso-cloud-state', { detail: { ...state } }));
}
function teacherDoc() {
  return state.user ? db.collection('teachers').doc(state.user.uid) : null;
}
function mobileOrInstalled() {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(pointer: coarse)').matches;
}
async function refreshCloudState() {
  if (!state.user) return;
  state.hasCloudCopy = null;
  state.checkState = 'checking';
  state.status = 'Verificando a nuvem…';
  emit();
  const snapshot = await teacherDoc().get();
  state.hasCloudCopy = snapshot.exists;
  state.checkState = snapshot.exists ? 'available' : 'missing';
  state.cloudExportedAt = snapshot.data()?.backup?.exportedAt || '';
  state.syncEnabled = snapshot.exists && localStorage.getItem(SYNC_USER_KEY) === state.user.uid;
  state.status = state.syncEnabled ? 'Sincronização automática ativa' : snapshot.exists ? 'Cópia na nuvem disponível' : 'Nenhuma cópia enviada ainda';
  if (!snapshot.exists && localStorage.getItem(SYNC_USER_KEY) === state.user.uid) localStorage.removeItem(SYNC_USER_KEY);
  emit();
}
async function upload(backup, { enableSync = true } = {}) {
  if (!state.user) throw new Error('Entre com sua conta Google primeiro.');
  if (!backup?.data) throw new Error('Os dados locais ainda não estão prontos.');
  state.status = 'Salvando na nuvem…'; emit();
  await teacherDoc().set({ backup, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), appVersion: backup.appVersion || '' });
  state.hasCloudCopy = true;
  state.checkState = 'available';
  state.cloudExportedAt = backup.exportedAt || '';
  state.syncEnabled = enableSync;
  if (enableSync) localStorage.setItem(SYNC_USER_KEY, state.user.uid);
  state.status = 'Sincronização automática ativa';
  emit();
}
async function restore() {
  if (!state.user) throw new Error('Entre com sua conta Google primeiro.');
  const snapshot = await teacherDoc().get();
  if (!snapshot.exists || !snapshot.data().backup) throw new Error('Não há uma cópia do Compasso nesta conta.');
  await new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent('compasso-cloud-restore', { detail: { backup: snapshot.data().backup, resolve, reject } })));
  state.syncEnabled = true;
  state.checkState = 'available';
  localStorage.setItem(SYNC_USER_KEY, state.user.uid);
  state.status = 'Sincronização automática ativa';
  emit();
}

window.CompassoCloud = {
  get state() { return { ...state }; },
  async signIn() {
    state.status = 'Abrindo Google…'; emit();
    try {
      if (mobileOrInstalled()) await auth.signInWithRedirect(provider);
      else await auth.signInWithPopup(provider);
    } catch (error) {
      state.status = error.code === 'auth/popup-closed-by-user' ? 'Entrada cancelada' : 'Não foi possível entrar com Google';
      emit(); throw error;
    }
  },
  async signOut() { localStorage.removeItem(SYNC_USER_KEY); await auth.signOut(); },
  async uploadCurrent() { return upload(window.CompassoCloudBackup?.()); },
  async retry() {
    try { await refreshCloudState(); }
    catch (error) { state.hasCloudCopy = null; state.checkState = 'error'; state.status = 'Não foi possível verificar a nuvem. Confira sua conexão e tente novamente.'; emit(); throw error; }
  },
  restore,
  async sync(backup) {
    pendingBackup = backup;
    if (!state.user || !state.syncEnabled) return;
    try { await upload(pendingBackup); } catch (error) { state.status = 'Alterações salvas só neste aparelho'; emit(); }
  }
};

auth.onAuthStateChanged(async user => {
  state = { ready: true, user: user || null, hasCloudCopy: null, checkState: user ? 'checking' : 'idle', syncEnabled: false, status: user ? 'Verificando a nuvem…' : 'Entre para proteger seus dados na nuvem' };
  emit();
  if (!user) return;
  try { await refreshCloudState(); }
  catch (error) { state.hasCloudCopy = null; state.checkState = 'error'; state.status = 'Não foi possível verificar a nuvem. Confira sua conexão e tente novamente.'; emit(); }
});
