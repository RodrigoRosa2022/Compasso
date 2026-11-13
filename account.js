(function(){
  window.openAccountDeletion=function(){
    if(!window.CompassoCloud?.state.user){toast('Entre com Google para excluir sua conta.');return}
    const begin=()=>{
      modalShell('Excluir conta do Compasso',`<p>Seus alunos, aulas, acervo, pagamentos, perfil e cópias na nuvem serão apagados permanentemente.</p><p>A assinatura da Play não é cancelada por esta exclusão. <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener">Gerenciar assinatura</a></p><label>Para confirmar, digite <b>excluir minha conta</b><input id="delete-account-confirm" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label><p role="status" data-delete-status></p>`);
      const form=document.querySelector('.modal'),button=form.querySelector('.save');button.textContent='Excluir conta permanentemente';
      form.onsubmit=async event=>{
        event.preventDefault();const status=form.querySelector('[data-delete-status]');
        if(form.querySelector('input').value!=='excluir minha conta'){status.textContent='Digite a frase indicada para confirmar.';return}
        button.disabled=true;status.textContent='Confirme sua conta Google para concluir…';
        const uid=window.CompassoCloud.state.user.uid;
        try{await window.CompassoCloud.deleteAccount();if((localStorage.getItem('compasso-cloud-owner-v1')||localStorage.getItem('compasso-cloud-sync-user'))===uid){for(const key of Object.keys(localStorage))if(key.startsWith('compasso-'))localStorage.removeItem(key)}location.reload();}
        catch(error){status.textContent=error.message||'Não foi possível excluir a conta agora.';button.disabled=false}
      };
    };
    if(closeModal(false,begin))begin();
  };
  window.appendAccountControls=function(){
    const modal=document.querySelector('.modal');if(!modal)return;
    const section=document.createElement('section');section.className='account-legal';
    section.innerHTML='<a href="privacy.html" target="_blank" rel="noopener">Privacidade</a> · <a href="delete-account.html" target="_blank" rel="noopener">Exclusão de conta</a>';
    if(window.CompassoCloud?.state.user&&!demoMode){const button=document.createElement('button');button.type='button';button.className='cloud-link';button.textContent='Excluir minha conta';button.onclick=window.openAccountDeletion;section.append(button)}
    modal.append(section);
  };
})();
