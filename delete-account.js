firebase.initializeApp({apiKey:'AIzaSyC2Vm0QVYnjhdsOqwVZX1DG3cfCV5A-5go',authDomain:'compasso-17b69.firebaseapp.com',projectId:'compasso-17b69'});
const accountAuth=firebase.auth(),statusText=document.getElementById('status'),loginButton=document.getElementById('login'),deleteForm=document.getElementById('delete');
const confirmation=document.getElementById('confirmation'),deleteButton=deleteForm.querySelector('button');
confirmation.addEventListener('input',()=>{deleteButton.disabled=confirmation.value!=='excluir minha conta'});
loginButton.onclick=async()=>{loginButton.disabled=true;try{const {user}=await accountAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());document.getElementById('account').textContent=user.email;confirmation.value='';deleteButton.disabled=true;deleteForm.hidden=false;loginButton.hidden=true;statusText.textContent='';confirmation.focus();}catch(_){statusText.textContent='Não foi possível entrar. Tente novamente.'}finally{loginButton.disabled=false}};
deleteForm.onsubmit=async event=>{
  event.preventDefault();if(document.getElementById('confirmation').value!=='excluir minha conta'){statusText.textContent='Digite a frase indicada para confirmar.';return}
  const button=deleteForm.querySelector('button');button.disabled=true;
  try{
    await accountAuth.currentUser.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    const token=await accountAuth.currentUser.getIdToken(true);
    const result=await fetch('https://southamerica-east1-compasso-17b69.cloudfunctions.net/billingApi',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'deleteAccount'})});
    const body=await result.json().catch(()=>({}));if(!result.ok)throw new Error(body.error||'Não foi possível concluir a exclusão. Tente novamente mais tarde.');
    const uid=accountAuth.currentUser.uid;
    await accountAuth.signOut();if((localStorage.getItem('compasso-cloud-owner-v1')||localStorage.getItem('compasso-cloud-sync-user'))===uid){for(const key of Object.keys(localStorage))if(key.startsWith('compasso-'))localStorage.removeItem(key)}
    deleteForm.hidden=true;statusText.textContent='Sua conta e seus dados na nuvem foram excluídos.';
  }catch(error){statusText.textContent=error.message||'Não foi possível excluir a conta. Tente novamente.';button.disabled=false}
};
