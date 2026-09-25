(function(){
  var cfg={};try{cfg=JSON.parse(document.getElementById('ahakudos-config').textContent||'{}');}catch(e){}
  var base=cfg.basePath||'';
  var form=document.getElementById('login'),err=document.getElementById('error'),btn=document.getElementById('submit');
  form.addEventListener('submit',function(e){
    e.preventDefault();btn.disabled=true;err.textContent='';
    var key=document.getElementById('key').value.trim(),email=document.getElementById('email').value.trim();
    document.getElementById('key').value='';
    fetch(base+'/api/dev-login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',key:key,email:email})})
      .then(function(r){return r.json().catch(function(){return {ok:false,error:'Phản hồi không hợp lệ.'};}).then(function(d){if(!r.ok||!d.ok)throw new Error(d.error||'Chưa đăng nhập được.');location.reload();});})
      .catch(function(e){err.textContent=e.message;btn.disabled=false;});
  });
})();
