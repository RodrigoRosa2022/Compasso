(function(global){
  'use strict';
  const method='https://play.google.com/billing';
  let service, catalog, restoring=null;
  async function prepare(){
    if(!global.CompassoCloud?.state.user)throw new Error('Entre com Google para vincular o Pro à sua conta.');
    if(!global.getDigitalGoodsService)throw new Error('Para assinar, abra o Compasso instalado pela Google Play.');
    try{service=await global.getDigitalGoodsService(method)}catch(_){throw new Error('Abra o aplicativo instalado pela Google Play para assinar.');}
    catalog=await global.CompassoCloud.api('catalog');
    const items=await service.getDetails(catalog.products);
    return items.filter(item=>catalog.products.includes(item.itemId)&&item.itemType!=='product');
  }
  async function verify(token){
    if(!token)throw new Error('A Play não retornou o comprovante. Use Restaurar compras para verificar.');
    await global.CompassoCloud.api('verify',{purchaseToken:token});
    await global.CompassoCloud.refreshAccess();
    return global.CompassoCloud.state.proAccess;
  }
  async function buy(item){
    // Call show() directly from the tap, before any network operation consumes user activation.
    if(!service||!catalog||!global.CompassoCloud?.state.user)throw new Error('Abra os planos novamente.');
    const uid=global.CompassoCloud.state.user.uid;
    const request=new PaymentRequest([{supportedMethods:method,data:{sku:item.itemId,obfuscatedAccountId:catalog.accountId}}],
      {total:{label:item.title,amount:item.price}});
    const response=await request.show();
    try{
      if(global.CompassoCloud.state.user?.uid!==uid)throw new Error('Sua conta mudou. Use Restaurar compras na conta utilizada ao assinar.');
      const active=await verify(response.details.purchaseToken||response.details.token);
      await response.complete('success');
      return active;
    }catch(error){await response.complete('unknown').catch(()=>{});throw error;}
  }
  async function restore(){
    if(restoring)return restoring;
    restoring=(async()=>{
      if(!global.CompassoCloud?.state.user)throw new Error('Entre com Google para restaurar suas compras.');
      if(global.getDigitalGoodsService){
        try{service=await global.getDigitalGoodsService(method)}catch(_){}
        if(service){for(const purchase of await service.listPurchases())await verify(purchase.purchaseToken);}
      }
      await global.CompassoCloud.api('refresh');
      await global.CompassoCloud.refreshAccess();
      return global.CompassoCloud.state.proAccess;
    })().finally(()=>{restoring=null});
    return restoring;
  }
  let lastUid=null;
  global.addEventListener('compasso-cloud-state',()=>{
    const uid=global.CompassoCloud?.state.user?.uid;
    if(!uid){lastUid=null;catalog=null;service=null;return}
    if(lastUid!==uid){lastUid=uid;restore().catch(()=>{});}
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&global.CompassoCloud?.state.user)restore().catch(()=>{});});
  global.CompassoBilling={prepare,buy,restore,manage:()=>`https://play.google.com/store/account/subscriptions${catalog?'?package='+encodeURIComponent(catalog.packageName):''}`};
})(window);
