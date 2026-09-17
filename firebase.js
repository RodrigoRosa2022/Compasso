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
let state = { ready: false, user: null, hasCloudCopy: false, syncEnabled: false, status: '' };
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
  const snapshot = await teacherDoc().get();
  state.hasCloudCopy = snapshot.exists();
  state.status = snapshot.exists() ? 'Cópia na nuvem disponível' : 'Nenhuma cópia enviada ainda';
  emit();
}
async function upload(backup, { enableSync = true } = {}) {
  if (!state.user) throw new Error('Entre com sua conta Google primeiro.');
  if (!backup?.data) throw new Error('Os dados locais ainda não estão prontos.');
  state.status = 'Salvando na nuvem…'; emit();
  await teacherDoc().set({ backup, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), appVersion: backup.appVersion || '' });
  state.hasCloudCopy = true;
  state.syncEnabled = enableSync;
  state.status = 'Sincronização automática ativa';
  emit();
}
async function restore() {
  if (!state.user) throw new Error('Entre com sua conta Google primeiro.');
  const snapshot = await teacherDoc().get();
  if (!snapshot.exists() || !snapshot.data().backup) throw new Error('Não há uma cópia do Compasso nesta conta.');
  window.dispatchEvent(new CustomEvent('compasso-cloud-restore', { detail: snapshot.data().backup }));
  state.syncEnabled = true;
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
  async signOut() { await auth.signOut(); },
  async uploadCurrent() { return upload(window.CompassoCloudBackup?.()); },
  restore,
  async sync(backup) {
    pendingBackup = backup;
    if (!state.user || !state.syncEnabled) return;
    try { await upload(pendingBackup); } catch (error) { state.status = 'Alterações salvas só neste aparelho'; emit(); }
  }
};

auth.onAuthStateChanged(async user => {
  state = { ready: true, user: user || null, hasCloudCopy: false, syncEnabled: false, status: user ? 'Verificando a nuvem…' : 'Entre para proteger seus dados na nuvem' };
  emit();
  if (!user) return;
  try { await refreshCloudState(); } catch (error) { state.status = 'Não foi possível acessar a nuvem agora'; emit(); }
});
