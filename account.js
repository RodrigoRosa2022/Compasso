(function(){
  window.openAccountDeletion=function(){
    showActionDialog({
      title:'Excluir sua conta?',
      message:'A exclusão apaga permanentemente seu perfil, alunos, aulas, pagamentos e cópias na nuvem. Na próxima tela, você precisará entrar com Google e confirmar. Deseja continuar?',
      actions:[
        {label:'Cancelar',tone:'neutral'},
        {label:'Continuar para exclusão',tone:'danger',run:()=>{
          const navigate=()=>location.assign('delete-account.html');
          if(closeModal(false,navigate))navigate();
        }}
      ]
    });
  };
  window.appendAccountControls=function(){
    const modal=document.querySelector('.modal');if(!modal)return;
    const section=document.createElement('section');section.className='account-legal';section.setAttribute('aria-label','Privacidade e conta');
    section.innerHTML='<a class="account-control" href="privacy.html" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg><span>Privacidade</span></a>';
    if(!demoMode){const button=document.createElement('button');button.type='button';button.className='account-control account-control-danger';button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>Excluir conta</span>';button.onclick=window.openAccountDeletion;section.append(button)}
    const version=modal.querySelector('.app-version');if(version)version.before(section);else modal.append(section);
  };
})();
