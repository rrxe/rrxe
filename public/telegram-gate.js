(() => {
  const el = document.getElementById('stormBoot');
  if (!el) return;
  const startedAt = Date.now(), MIN_SPLASH_MS = 4000;
  const $ = id => document.getElementById(id);
  let value = 4, completionStarted = false;
  const fill=$('stormBootFill'), percent=$('stormBootPercent'), bar=$('stormBootProgress');
  const label=$('stormBootLabel'), status=$('stormBootStatus'), stage=$('stormBootStage');
  const meta=$('stormBootMeta'), panel=$('stormBootError'), title=$('stormBootErrorTitle');
  const message=$('stormBootErrorMessage'), retry=$('stormBootRetry'), foot=$('stormBootFoot');
  function progress(n,text){
    value=Math.max(value,Math.min(99,Math.round(Number(n)||0)));
    fill.style.width=value+'%'; percent.textContent=value+'%'; bar.setAttribute('aria-valuenow',value);
    stage.textContent=value<35?'01':value<70?'02':value<96?'03':'04';
    if(text)status.textContent=text;
    label.textContent=value<35?'VERIFYING SESSION':value<70?'LOADING STORE DATA':value<96?'PREPARING WORKSPACE':'ALMOST READY';
  }
  function lock(t,m,canRetry){title.textContent=t;message.textContent=m;panel.hidden=false;retry.hidden=!canRetry;bar.hidden=true;meta.hidden=true;status.textContent='SESSION CHECK REQUIRED';stage.textContent='—';foot.textContent='STORM STUDIO / ACCESS CONTROL';}
  retry.addEventListener('click',()=>location.reload());
  function complete(){
    if(completionStarted)return; completionStarted=true;
    const remaining=Math.max(0,MIN_SPLASH_MS-(Date.now()-startedAt));
    setTimeout(()=>{progress(100,'تم تجهيز التطبيق');label.textContent='STUDIO READY';foot.textContent='WELCOME TO STORM STUDIO';document.body.classList.add('storm-boot-ready');
      setTimeout(()=>{el.classList.add('is-hiding');setTimeout(()=>el.remove(),650);},220);
    },remaining);
  }
  window.StormBoot={progress,deny:(t,m)=>lock(t,m,false),fail:(t,m)=>lock(t,m,true),complete};
})();
