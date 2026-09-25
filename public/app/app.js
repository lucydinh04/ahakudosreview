(async () => {
'use strict';
/* ============================================================================
   AHAKUDOS web app — V30 (AhaHandbook-ready)
   Sections: 1 Config & assets · 2 API client · 3 Boot & data store · 4 Shared renderers
             5 Employee pages · 6 Admin pages · 7 Router & bindings · 8 Deep link & start
   Identity is resolved on the server from the AhaHandbook session. The UI never chooses
   or switches the user; all permission checks are repeated server-side in Apps Script.
   ========================================================================== */

// ---- 1. Config & assets ----------------------------------------------------
const CONFIG=(()=>{try{return JSON.parse(document.getElementById('ahakudos-config').textContent||'{}');}catch(e){return {};}})();
const BASE=String(CONFIG.basePath||'');
const ART=window.AHAKUDOS_ART;
const A={logoLight:BASE+'/branding/logo-light.png',logoDark:BASE+'/branding/logo-dark.png',logoMark:BASE+'/branding/logo-mark.png',kudosLogo:BASE+'/branding/ahamove-logo-kudos.png',mascotCutout:BASE+'/illustrations/mascot-cutout.png'};
// Base KUDOS backgrounds are static files in /public/backgrounds; event backgrounds come from tab EVENTS.
const BG=(()=>{
 const LIST=[{id:'wish',name:'Tri ân',sticker:'🧧',fallback:'#FFF4D8'},{id:'move',name:'Đồng đội',sticker:'🛵',fallback:'#FFF0DB'},{id:'birthday',name:'Sinh nhật',sticker:'🎂',fallback:'#FFE3EA'},{id:'tech',name:'Cảm hứng',sticker:'🤖',fallback:'#DDEEFF'}];
 const byId={};LIST.forEach(t=>{byId[t.id]=t;});
 return {LIST,get(id){const t=byId[id]||LIST[0];return {id:t.id,name:t.name,sticker:t.sticker,fallback:t.fallback,url:BASE+'/backgrounds/'+t.id+'.png'};}};
})();
function safeGet(key){try{return localStorage.getItem(key);}catch(e){return null;}}
function safeSet(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);return true;}catch(e){return false;}}

// ---- 2. API client ---------------------------------------------------------
class ApiError extends Error{constructor(message,code,status){super(message);this.code=code||'ERROR';this.status=status||0;}}
// ---- REVIEW MODE guard (only on the review deployment). The server refuses mutations too; this just avoids the round trip.
const REVIEW=CONFIG.review||null;
// taoKudos is allowed in review as a SANDBOX send (email goes only to the signed-in reviewer; nothing reaches production).
const REVIEW_READ=['layTrangThai','xemKudos','layDuLieuAdmin','xemTruocEmail','ghiDaMo','docPhanHoi','taoKudos'];
function reviewScenario(){try{return localStorage.getItem('ahakudos-review-scenario')||'default';}catch(e){return 'default';}}
function blockProductionMutation(method){if(REVIEW&&!REVIEW_READ.includes(method))throw new ApiError('Review Mode: thao tác này đã được disable.','REVIEW_DISABLED',403);}
function showActionError(e){if(e&&e.code==='REVIEW_DISABLED'){toast(e.message);return;}window.alert(e&&e.message||'Không thực hiện được thao tác.');}
async function rpc(method,...args){
 blockProductionMutation(method);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),58000);
 try{
  const response=await fetch(BASE+'/api/bridge',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(REVIEW?{method,args,scenario:reviewScenario()}:{method,args}),signal:controller.signal});
  const result=await response.json().catch(()=>null);
  if(response.status===401)throw new ApiError('Phiên đăng nhập AhaHandbook đã hết hạn. Vui lòng tải lại trang.','UNAUTHENTICATED',401);
  if(!result||typeof result.ok!=='boolean')throw new ApiError('Phản hồi máy chủ không hợp lệ.','INVALID_RESPONSE',response.status);
  if(!result.ok)throw new ApiError(result.error||'Không thực hiện được thao tác.',result.code,response.status);
  return result.data;
 }catch(e){
  if(e&&e.name==='AbortError')throw new ApiError('Máy chủ phản hồi quá lâu. Thao tác có thể đã được lưu — tải lại trang để kiểm tra trước khi thử lại.','TIMEOUT',0);
  if(e instanceof ApiError)throw e;
  console.error('[AHAKUDOS] network error',e);
  throw new ApiError('Không thể kết nối AHAKUDOS. Vui lòng kiểm tra mạng và thử lại.','NETWORK',0);
 }finally{clearTimeout(timer);}
}

// ---- 3. Boot & data store --------------------------------------------------
let BOOT;
try{BOOT=await rpc('layTrangThai');if(!BOOT||!BOOT.me)throw new ApiError('Thiếu dữ liệu khởi tạo.','INVALID_RESPONSE');}
catch(e){
 const copy=e.code==='NOT_IN_MASTER_DATA'?{title:'Tài khoản chưa có trong Master Data',message:e.message}
  :e.code==='UNAUTHENTICATED'?{title:'Phiên đăng nhập đã hết hạn',message:'Vui lòng tải lại trang để đăng nhập lại AhaHandbook.'}
  :e.code==='FORBIDDEN'?{title:'Không có quyền truy cập',message:e.message}:null;
 window.AhaKudosBoot.fail(e,copy);return;
}
const legacyLinkId=new URLSearchParams(location.search).get('id')||''; // V28 emails used ?id=<kudosId>

// The web app and Apps Script are deployed separately. If Apps Script is older, new features (e.g. Giá trị cốt lõi) fail with old errors.
const REQUIRED_BACKEND='V30.17';
function backendOutdated(){const v=String((BOOT.config&&BOOT.config.version)||'');const m=v.match(/^V(\d+)\.(\d+)/),r=REQUIRED_BACKEND.match(/^V(\d+)\.(\d+)/);return !m||Number(m[1])<Number(r[1])||(Number(m[1])===Number(r[1])&&Number(m[2])<Number(r[2]));}
if(backendOutdated())console.warn('[AHAKUDOS] Apps Script '+((BOOT.config&&BOOT.config.version)||'?')+' cũ hơn web app ('+REQUIRED_BACKEND+'). Dán Code.gs mới và tạo New version.');
const PEOPLE=BOOT.people||[];
const AVATARS=Object.assign({},BOOT.avatars||{}); // email → version; images are stored on the server (Drive), not in the browser // Master Data directory (email, name, dept, section, birthday MM-DD)
const employees=PEOPLE;
// Giá trị cốt lõi Ahamove. Old ids (fair/share/grow) only appear on KUDOS created before V30.10 and stay readable.
const VALUE_IDS=['speed','together','innovation'];
const CULTURE={speed:'Tốc độ',together:'Đồng hành',innovation:'Đổi mới'};
const CULTURE_ICON={speed:'⚡',together:'🤝',innovation:'💡'};
const CULTURE_IMG=v=>`${BASE}/illustrations/values/${v}.webp`;
const VALUE_HINTS={speed:['nhanh','kịp','gấp','deadline','đúng hạn','sớm','ngay trong','tốc độ','công nghệ','khách hàng','tự động','cập nhật'],together:['hỗ trợ','đồng hành','phối hợp','giúp','cùng nhau','cùng team','kết nối','lắng nghe','chia sẻ','bên cạnh','hướng dẫn','chuyến hàng'],innovation:['đổi mới','cải tiến','sáng tạo','giải pháp','ý tưởng','thử nghiệm','tối ưu','cách làm mới','đề xuất','cải thiện','tốt hơn']};
const q_=a=>a.map(w=>`“${w}”`).join(', ');
const VALUE_WHY={speed:w=>`vì bạn nhắc tới ${q_(w)} — sự nhanh chóng, kịp thời, nắm bắt sớm nhu cầu khách hàng.`,together:w=>`vì bạn nhắc tới ${q_(w)} — tinh thần đi cùng nhau, có mặt khi cần và hỗ trợ đồng đội.`,innovation:w=>`vì bạn nhắc tới ${q_(w)} — không hài lòng với cái đang có, tìm giải pháp tốt hơn.`};
const CULTURE_DEF={
 speed:'Bắt kịp những công nghệ mới. Luôn nắm bắt sớm nhu cầu khách hàng. Đảm bảo nhanh chóng trong tốc độ cung cấp dịch vụ và sản phẩm.',
 together:'Để tiến xa, chúng ta đi cùng nhau. Đồng hành để thấu hiểu và đón đầu những nhu cầu mới, để luôn có mặt khi cần và hỗ trợ trên từng chuyến hàng.',
 innovation:'Tại Ahamove, đổi mới luôn diễn ra từng giờ, từng ngày, trong mọi hoạt động. Chúng ta không hài lòng với thành quả đang có và luôn tìm kiếm những giải pháp tốt hơn.'
};
const LEGACY_CULTURE={fair:'Công bằng & Tôn trọng',share:'Học hỏi & Chia sẻ',grow:'Gắn kết & Cùng phát triển'};
function valueLabel(v){return CULTURE[v]||LEGACY_CULTURE[v]||v;}
function zeroValues(){const o={};VALUE_IDS.forEach(v=>o[v]=0);return o;}
function asciiLabel(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D');}
const store={received:BOOT.received||[],sent:BOOT.sent||[],community:BOOT.community||[],detail:{}};
let QUOTA=BOOT.quota||{used:0,limit:5,remaining:5};
const ADMIN={loaded:false,loading:false,error:'',records:[],blacklist:[],settings:{},master:null,upcoming:{birthdays:[],anniversaries:[]},health:{}};
let employeeStale=false;

function me(){return BOOT.me;}
function personByEmail(e){const k=String(e||'').trim().toLowerCase();return PEOPLE.find(p=>p.email===k)||null;}
// Tenure comes from Master Data: "Tenure (Days)" first, else computed server-side from "Onboard Day"; else null (never a fake number).
function employeeTenureDays(p){return p&&typeof p.tenureDays==='number'&&Number.isFinite(p.tenureDays)&&p.tenureDays>=0?Math.floor(p.tenureDays):null;}
function uid(){const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');}
function replaceIn(list,rec){const i=list.findIndex(k=>k.id===rec.id);if(i>=0){list[i]=rec;return true;}return false;}
function takeRecord(rec){
 if(!rec||!rec.id)return;
 let found=false;
 ['received','sent','community'].forEach(key=>{if(replaceIn(store[key],rec))found=true;});
 if(store.detail[rec.id]){store.detail[rec.id]=rec;found=true;}
 if(!found&&rec.senderEmail&&rec.senderEmail===me().email)store.sent.unshift(rec);
 if(rec.isCommunity===false)store.community=store.community.filter(k=>k.id!==rec.id);
}
function takeAdminRecord(rec){if(!rec||!rec.id)return;if(!replaceIn(ADMIN.records,rec))ADMIN.records.unshift(rec);employeeStale=true;}
function kudosById(id){if(!id)return null;return store.received.concat(store.sent,store.community).find(k=>k.id===id)||store.detail[id]||null;}
function adminRecordById(id){return ADMIN.records.find(k=>k.id===id)||null;}
function receivedFor(){return store.received;}
// ---- Unread + today's community: nav badges and the corner button (priority: KUDOS for me → today's community → send) ----
const COMMUNITY_SEEN_KEY='ahakudos-community-seen:'+me().email;
function unreadReceived(){return store.received.filter(k=>!k.viewedAt&&!k._seenLocal).slice().sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));}
function unreadReplies(){const seen=new Set();return store.received.concat(store.sent).filter(k=>{if(seen.has(k.id))return false;seen.add(k.id);return k.replyUnread&&!k._replySeenLocal;});}
function todayCommunityNew(){const today=vnDay(new Date().toISOString()),seen=safeGet(COMMUNITY_SEEN_KEY)||'';return store.community.filter(k=>vnDay(k.createdAt)===today&&String(k.createdAt)>seen&&k.recipientEmail!==me().email&&k.senderEmail!==me().email);}
function markCommunitySeen(){const last=store.community.reduce((a,k)=>String(k.createdAt)>a?String(k.createdAt):a,'');if(last)safeSet(COMMUNITY_SEEN_KEY,last);}
function fabState(){const u=unreadReceived();if(u.length)return {kind:'unread',n:u.length,label:`Bạn có ${u.length} KUDOS mới chưa đọc`,cta:'Đọc ngay →',id:u[0].id};const rp=unreadReplies();if(rp.length)return {kind:'unread',n:rp.length,label:`${rp.length} lời nhắn mới từ đồng nghiệp`,cta:'Xem lời nhắn →',id:rp[0].id};const c=todayCommunityNew();if(c.length)return {kind:'community',n:c.length,label:`${c.length} KUDOS mới trên Cộng đồng hôm nay`,cta:'Xem ngay →'};return {kind:'send',n:0,label:'Gửi một lời ghi nhận hôm nay?',cta:'Gửi KUDOS →'};}
function fabHtml(){const f=fabState();return `<button class="aha-floating-kudos aha-fab--${f.kind}" data-fab="${f.kind}" ${f.id?`data-fab-id="${escapeHtml(f.id)}"`:''} aria-label="${escapeHtml(f.label+'. '+f.cta)}" title="${escapeHtml(f.label)}"><img src="${BASE}/illustrations/mascot-cutout.png" alt="">${f.n?`<span class="aha-fab-count">${f.n>99?'99+':f.n}</span>`:''}<span class="aha-fab-bubble"><b>${escapeHtml(f.label)}</b><em>${escapeHtml(f.cta)}</em></span></button>`;}
function openFab(btn){const k=btn.dataset.fab;if(k==='unread'&&btn.dataset.fabId){state.mode='employee';state.page='kudos-detail';state.viewKudosId=btn.dataset.fabId;try{history.replaceState(null,'','#/k/'+btn.dataset.fabId);}catch(e){}render();window.scrollTo(0,0);}else goToPage(k==='community'?'public-feed':'send-kudos');}
// Welcome Onboard: the signed-in employee's Onboard Day is today → banner + confetti (once per day).
function isOnboardToday(){const d=me().onboardDate;return !!d&&d===vnDay(new Date().toISOString());}
function welcomeOnboardHtml(){if(!isOnboardToday())return '';const first=String(me().name||'').split(' ').slice(-1)[0];const w=store.received.find(k=>k.welcome);return `<section class="welcome-onboard" aria-label="Chào mừng thành viên mới"><img src="${BASE}/illustrations/welcome-onboard.webp" alt="Welcome Onboard — Chúc bạn có thật nhiều trải nghiệm tuyệt vời cùng đại gia đình Ahamove" width="1600" height="900"><div class="welcome-onboard__copy"><div class="welcome-onboard__text"><b>Hôm nay là ngày đầu tiên của ${escapeHtml(first)} tại Ahamove 🎉</b><span>${w?'Có một lời nhắn dành riêng cho bạn đang chờ được mở.':'Hãy dành chút thời gian làm quen với đồng đội mới nhé.'}</span></div>${w?`<button class="welcome-onboard__cta" data-open-kudos="${escapeHtml(w.id)}">💌 Mở lời nhắn →</button>`:''}</div></section>`;}
let welcomeCelebrated=false;
function celebrateOnboard(){if(welcomeCelebrated||!isOnboardToday()||state.mode!=='employee'||state.page!=='employee-home')return;welcomeCelebrated=true;const key='ahakudos-welcome-onboard:'+me().email+':'+me().onboardDate;if(safeGet(key))return;safeSet(key,'1');setTimeout(launchConfetti,400);}
function sentBy(){return store.sent;}
function publicFeedList(){return store.community;}
async function refreshEmployeeData(){
 const d=await rpc('layTrangThai');
 BOOT=d;Object.keys(AVATARS).forEach(k=>delete AVATARS[k]);Object.assign(AVATARS,d.avatars||{});state.avatarData=avatarUrl(me().email)||state.avatarData;store.received=d.received||[];store.sent=d.sent||[];store.community=d.community||[];QUOTA=d.quota||QUOTA;
 CUSTOM_BGS=d.backgrounds||[];employeeStale=false;
}
async function loadAdminData(force){
 if(ADMIN.loading||(ADMIN.loaded&&!force))return;
 ADMIN.loading=true;ADMIN.error='';
 try{const d=await rpc('layDuLieuAdmin');if(d.backgrounds)CUSTOM_BGS=d.backgrounds;Object.assign(ADMIN,{records:d.records||[],blacklist:d.blacklist||[],settings:d.settings||{},master:d.master||null,upcoming:d.upcoming||{birthdays:[],anniversaries:[]},health:d.health||{},schedules:d.schedules||[],autoSend:!!d.autoSend,loaded:true});}
 catch(e){ADMIN.error=e.message;console.error('[AHAKUDOS] admin data',e);}
 finally{ADMIN.loading=false;}
 if(state.mode==='admin')render();
}
/** Admin pages render this placeholder until layDuLieuAdmin has loaded. */
function adminGate(){
 if(ADMIN.loaded)return '';
 if(!ADMIN.loading&&!ADMIN.error)setTimeout(()=>loadAdminData(false),0);
 if(!ADMIN.error)return `<section class="page active">${loaderHtml('Đang tải dữ liệu quản trị…','aha-loader--page')}</section>`;
 return `<section class="page active"><div class="empty"><div class="icon">!</div><h3>Chưa tải được dữ liệu quản trị</h3><p>${escapeHtml(ADMIN.error)}</p><button class="btn primary" data-admin-reload>Thử lại</button></div></section>`;
}
const BANNERS=BOOT.banners||{};
function banner(id){return BANNERS[id]||null;}
function mailStatusText(k){
 return ({AWAITING_APPROVAL:'Email sẽ gửi sau khi Admin duyệt',PENDING:'Email thông báo đang chờ gửi',SENDING:'Đang gửi email thông báo',SENT:'Đã gửi email thông báo',FAILED:'Email chưa gửi được — Admin đang xử lý',CANCELLED:'Không gửi email thông báo'})[k&&k.emailStatus]||'Email chưa được xác nhận';
}
function modStatusOf(k){return (k&&(k.moderationStatus||(k.moderation&&k.moderation.status)))||'HELD';}

// ---- 4. Shared renderers ---------------------------------------------------
// Thiệp KUDOS ở TRANG CHI TIẾT (đã xác thực): nội dung đầy đủ TRÊN background 3D người gửi chọn.
function buildKudosCard(k,opts){
 opts=opts||{};
 const bg=(typeof bgFor==='function'?bgFor(k.templateId):null)||{};
 const bgUrl=bg.url||'';
 const vals=(k.values||[]).map(valueLabel);
 const chips=vals.map(n=>`<span class="kd-value-chip">${escapeHtml(n)}</span>`).join('');
 const rawMsg=String(k.message||'').trim();
 const msg=escapeHtml(rawMsg).replace(/\r?\n/g,'<br>');
 const msgLen=rawMsg.replace(/\s+/g,' ').length;
 const lineCount=(rawMsg.match(/\r?\n/g)||[]).length+1;
 const msgClass=msgLen>700||lineCount>14?' kd-card-msg--xxxlong':msgLen>520||lineCount>11?' kd-card-msg--xxlong':msgLen>360||lineCount>8?' kd-card-msg--xlong':msgLen>240||lineCount>6?' kd-card-msg--long':msgLen>140||lineCount>4?' kd-card-msg--medium':'';
 const senderName=escapeHtml(k.senderName||'Người gửi');
 const senderDept=escapeHtml(k.senderDept||'');
 const senderSection=escapeHtml(k.senderSection||'');
 const senderOrg=[senderDept,senderSection].filter(Boolean).join(' · ');
 const bgLayer=bgUrl
   ?`<img class="kd-card-bg" src="${escapeHtml(bgUrl)}" alt="Background KUDOS ${escapeHtml(bg.name||'')}" loading="eager">`
   :`<div class="kd-card-bg kd-card-bg-fallback" aria-hidden="true"></div>`;
 const cardLabel=opts.mode==='public'?'NỘI DUNG KUDOS':'LỜI GHI NHẬN DÀNH CHO BẠN';
 return `<div class="kd-card kd-card-fullbg tpl-${escapeHtml(bg.id||k.templateId||'wish')} ${opts.mode==='public'?'kd-card-public':''}">
   ${bgLayer}
   <div class="kd-card-shade" aria-hidden="true"></div>
   <div class="kd-card-content">
     <div class="kd-template-brand"><span class="kd-template-brand-logo">${kudosLogo()}</span><span class="kd-template-brand-name"><b>AHA</b><strong>KUDOS</strong></span></div>
     <div class="kd-card-label">${cardLabel}</div>
     <div class="kd-party-row">
       <div class="kd-sender-stack">
         <span class="kd-sender-caption">TỪ</span>
         <b class="kd-sender-name">${senderName}</b>
         ${senderOrg?`<span class="kd-sender-dept">${senderOrg}</span>`:''}
       </div>
       ${k.recipientName?`<div class="kd-sender-stack kd-recipient-stack">
         <span class="kd-sender-caption">ĐẾN</span>
         <b class="kd-sender-name">${escapeHtml(k.recipientName)}</b>
         ${k.recipientDept?`<span class="kd-sender-dept">${escapeHtml(k.recipientDept)}</span>`:''}
       </div>`:''}
     </div>
     <div class="kd-card-msg${msgClass}">${msg}</div>
     ${vals.length?`<div class="kd-values-block"><div class="kd-value-caption">Giá trị cốt lõi được ghi nhận</div><div class="kd-value-row">${chips}</div></div>`:''}
   </div>
 </div>`;
}
// ---- Banner / notification components (dùng chung web app) --------------------
function bannerHero(id,opts){
 opts=opts||{};const b=banner(id);if(!b)return '';
 const tone=opts.tone||(b.type==='system'?'tone-calm':(b.type==='receive'||b.type==='celebrate'?'':'tone-blue'));
 const img=b.image?`<img class="aha-illu" src="${escapeHtml(BASE+b.image)}" alt="${escapeHtml(b.headline)}" data-hide-on-error>`:'';
 const label=escapeHtml(opts.ctaLabel||b.ctaLabel||'');
 const cta=(b.ctaLabel&&b.ctaRoute)?`<button class="aha-cta" data-cta-route="${b.ctaRoute}"${opts.ctaId?` data-cta-id="${escapeHtml(opts.ctaId)}"`:''}>${label} <span aria-hidden="true">→</span></button>`:'';
 const sub=escapeHtml(opts.subheadline||b.subheadline||'');
 return `<div class="aha-banner ${tone}">${img}<div class="aha-copy"><div class="aha-eyebrow">${escapeHtml(b.headline)}</div><p class="aha-sub">${sub}</p>${cta}</div></div>`;
}
// CTA deep-link routing: dẫn tới đúng màn hình trong AHAKUDOS.
function ctaGo(route,id){
 switch(route){
  case 'compose': goToPage('send-kudos');break;
  case 'home': goToPage(state.mode==='admin'?'admin-home':'employee-home');break;
  case 'inbox': case 'received': goToPage('kudos-profile');break;
  case 'kudos-detail': if(id)openKudos(id);else goToPage('kudos-profile');break;
  case 'leaderboard': goToPage('public-feed');break;
  case 'milestone': goToPage('kudos-profile');break;
  default: goToPage(state.mode==='admin'?'admin-home':'employee-home');
 }
}
function modReasonsTextClient(reasons){
 const map={admin_review:'Chờ Admin duyệt',blacklist:'Chứa từ trong danh sách cấm',placeholder:'Nội dung rỗng nghĩa/placeholder',low_content:'Nội dung quá ngắn/ít thông tin',spammy_repeat:'Lặp ký tự bất thường',duplicate:'Trùng nội dung gửi gần đây'};
 return (reasons||[]).map(r=>{const k=String(r).split(':')[0];const extra=String(r).indexOf(':')>=0?(' ('+String(r).split(':').slice(1).join(':')+')'):'';return (map[k]||k)+extra;});
}

// ---- App state (UI only; never identity) -----------------------------------
// Legacy (≤V30.7) avatars lived only in localStorage and were lost on logout / another device. They are migrated once to the server.
const AVATAR_KEY='ahakudos-avatar:'+me().email, AVATAR_SCALE_KEY='ahakudos-avatar-scale:'+me().email;
function avatarUrl(email){const e=String(email||'').trim().toLowerCase(),v=AVATARS[e];return v?`${BASE}/api/avatar?email=${encodeURIComponent(e)}&v=${encodeURIComponent(v)}`:'';}
// Loading state: AHAKUDOS mascot (original orientation — never mirrored) bobbing above an animated progress bar.
function loaderHtml(label='Đang tải…',cls=''){return `<div class="aha-loader ${cls}" role="status" aria-live="polite"><div class="aha-loader__stage" aria-hidden="true"><img class="aha-loader__mascot" src="${BASE}/illustrations/loading-mascot.webp" alt="" width="560" height="426" data-hide-on-error><span class="aha-loader__shadow"></span></div><div class="aha-loader__bar" aria-hidden="true"><i></i></div><p class="aha-loader__word">Loading...</p><p class="aha-loader__label">${escapeHtml(label)}</p></div>`;}
// Same rule as kudosQuality_() in APPS_SCRIPT/Code.gs (keep in sync): ≥15 words and ≥2 of action / impact / appreciation.
// Same rule as kudosQuality_() in APPS_SCRIPT/Code.gs (keep in sync).
const KUDOS_QUALITY={about:/(cảm ơn|cám ơn|biết ơn|trân trọng|ghi nhận|ngưỡng mộ|tự hào về|nể phục|nhờ (có )?(bạn|anh|chị|em|cậu|team|cả nhóm)|(bạn|anh|chị|em|cậu|team|cả nhóm)\s+(đã|luôn|vẫn|chủ động|nhiệt tình|giúp|hỗ trợ|chia sẻ|hướng dẫn|xử lý|đồng hành|lắng nghe|kiên nhẫn|dẫn dắt))/i,aboutName:/\p{Lu}\p{Ll}+\s+(đã|luôn|vẫn|chủ động|nhiệt tình|giúp|hỗ trợ)/u,moment:/(đã|chủ động|hỗ trợ|giúp|chia sẻ|xử lý|chuẩn bị|phối hợp|hoàn thành|hướng dẫn|giải thích|tổng hợp|kết nối|thực hiện|rà soát|sửa|dẫn dắt|đề xuất|lắng nghe|đứng ra|theo sát|đồng hành|lúc|khi|hôm)/i,energy:/(nhờ|nên|kịp|tiết kiệm|giảm|tăng|cải thiện|tránh|hiệu quả|yên tâm|thuận lợi|nhanh hơn|kết quả|khách hàng|dự án|deadline|tiến độ|chất lượng|cả team|mọi người|động lực|năng lượng|cảm hứng|tự tin|nhẹ nhõm|vui|học được|giúp mình|giúp em|giúp anh|giúp chị|giúp team|giúp cả)/i,minWords:15};
function kudosQuality(text){const t=String(text||''),words=t.trim().split(/\s+/).filter(Boolean).length;const has={about:KUDOS_QUALITY.about.test(t)||KUDOS_QUALITY.aboutName.test(t),moment:KUDOS_QUALITY.moment.test(t),energy:KUDOS_QUALITY.energy.test(t)};return {ok:words>=KUDOS_QUALITY.minWords&&has.about&&has.moment&&has.energy,words,has};}
const QUALITY_MESSAGE='KUDOS này chỉ còn thiếu một chút nữa để thật sự “woah”. Bạn tham khảo lại format chuẩn của một KUDOS và bổ sung thêm vài chi tiết, để khi đồng nghiệp nhận được, họ có thể cảm nhận rõ hơn sự chân thành và điều bạn muốn ghi nhận nhé!';
const QUALITY_RETURN_REASON='Chưa đủ chất lượng — người gửi được mời bổ sung chi tiết';
function qualityFormatHtml(){return `<div class="quality-format"><b>Format tiêu chuẩn cho một KUDOS</b><span><strong>01</strong> Khoảnh khắc khiến bạn muốn ghi nhận</span><span><strong>02</strong> Sự hỗ trợ / Năng lượng mà bạn đã nhận được</span></div>`;}
function qualityNoticeHtml(k){return `<div class="quality-notice" role="note"><img src="${BASE}/illustrations/quality-mascot.webp" alt="" width="560" height="484" data-hide-on-error><div><b>Kể thêm một chút về điều bạn muốn ghi nhận nha</b><p>${escapeHtml(QUALITY_MESSAGE)}</p>${k?`<button class="btn primary" data-rewrite-kudos="${escapeHtml(k.id)}">Viết lại KUDOS này →</button>`:''}</div></div>`;}
// Send-time check (Đồng nghiệp only). Resolves true to send anyway, false to keep editing.
function confirmQuality(){
 return new Promise(resolve=>{
  const root=document.querySelector('#modal-root');
  root.innerHTML=`<div class="modal-backdrop quality-backdrop"><div class="modal quality-modal" role="dialog" aria-modal="true" aria-labelledby="quality-title">
   <button class="modal-close" data-q="edit" aria-label="Đóng">×</button>
   <div class="quality-art" aria-hidden="true"><img src="${BASE}/illustrations/quality-mascot.webp" alt="" width="560" height="484" data-hide-on-error></div>
   <div class="kicker">THƯ KÝ KUDOS</div>
   <h2 id="quality-title">Sắp hoàn hảo rồi nè 🧡</h2>
   <p>${escapeHtml(QUALITY_MESSAGE)}</p>
   ${qualityFormatHtml()}
   <div class="kudos-success-actions"><button class="btn secondary" data-q="send">Vẫn gửi KUDOS</button><button class="btn primary" data-q="edit">Bổ sung nội dung</button></div>
  </div></div>`;
  const done=v=>{root.innerHTML='';document.removeEventListener('keydown',onKey);resolve(v);};
  const onKey=e=>{if(e.key==='Escape')done(false);};document.addEventListener('keydown',onKey);
  root.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>done(b.dataset.q==='send')));
  root.querySelector('.quality-modal .btn.primary').focus();
 });
}
function rewriteKudos(id){
 const k=kudosById(id);if(!k)return;
 const person=!k.recipientManual&&personByEmail(k.recipientEmail);
 state.mode='employee';state.page='send-kudos';state.kudosType='recognition';state.manualRecipient=false;state.prefillRecipient=person?person.email:'';state.selectedRecipient=person||null;state.rewriteMessage=k.message||'';
 try{history.replaceState(null,'',location.pathname);}catch(e){}
 render();window.scrollTo(0,0);
 setTimeout(()=>{const m=document.querySelector('#message');if(m&&state.rewriteMessage){m.value=state.rewriteMessage;m.dispatchEvent(new Event('input',{bubbles:true}));state.rewriteMessage='';m.focus();m.scrollIntoView({block:'center'});}},60);
}
let loaderOverlayTimer=null;
function showLoaderOverlay(label){hideLoaderOverlay();loaderOverlayTimer=setTimeout(()=>{const o=document.createElement('div');o.className='aha-loader-overlay';o.innerHTML=loaderHtml(label);document.body.appendChild(o);},250);}
function hideLoaderOverlay(){clearTimeout(loaderOverlayTimer);document.querySelectorAll('.aha-loader-overlay').forEach(o=>o.remove());}
const ADMIN_AVATAR=`${BASE}/illustrations/ahakudos-admin-avatar-v3.webp`; // avatar of AHAKUDOS / Admin
function miniAvatar(email,name,cls=''){if(!email&&String(name||'').trim()==='AHAKUDOS')return `<div class="mini-avatar ${cls} has-photo is-ahakudos"><img src="${ADMIN_AVATAR}" alt="" loading="lazy" data-hide-on-error><span>AK</span></div>`;const u=avatarUrl(email);return `<div class="mini-avatar ${cls}${u?' has-photo':''}">${u?`<img src="${escapeHtml(u)}" alt="" loading="lazy" data-hide-on-error>`:''}<span>${escapeHtml(initials(name||email||''))}</span></div>`;}
const state={
  mode:me().inMasterData===false&&BOOT.isAdmin?'admin':'employee',
  page:me().inMasterData===false&&BOOT.isAdmin?'admin-home':'employee-home',
  values:new Set(),
  kudosType:'recognition',
  selectedTemplate:(BG.LIST[0]||{id:'wish'}).id,
  sendVisibility:'public', // Nhân viên luôn đề xuất CỘNG ĐỒNG KUDOS; Admin kiểm soát trước khi publish.
  prefillRecipient:'',
  selectedRecipient:null,
  manualRecipient:false,
  viewKudosId:null,
  adminPrefill:null,
  avatarData:avatarUrl(me().email)||safeGet(AVATAR_KEY)||'',
  avatarScale:avatarUrl(me().email)?1:(Number(safeGet(AVATAR_SCALE_KEY)||1)||1)
};

let liveFeedTimer=null;

// Colleagues' birthdays from Master Data: from 2 days ago up to 30 days ahead. Sending opens only within ±2 days.
function birthdaySuggestionsFor(currentEmail){
 const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 return PEOPLE.filter(p=>p.email!==currentEmail&&/^\d{2}-\d{2}$/.test(p.birthday||'')).map(p=>{
   const days=birthdayOffsetDays(p.birthday);if(days===null||days<-2||days>30)return null;
   const [mm,dd]=p.birthday.split('-').map(Number);
   const opens=new Date(today);opens.setDate(today.getDate()+days-2);
   return {initials:initials(p.name),name:p.name,dept:p.dept||'',section:p.section||'',email:p.email,
     date:String(dd).padStart(2,'0')+'/'+String(mm).padStart(2,'0'),
     when:days===0?'Hôm nay':days===1?'Ngày mai':days===-1?'Hôm qua':days<0?(-days)+' ngày trước':'Còn '+days+' ngày',
     days,canSend:Math.abs(days)<=2,opensLabel:String(opens.getDate()).padStart(2,'0')+'/'+String(opens.getMonth()+1).padStart(2,'0')};
 }).filter(Boolean).sort((a,b)=>a.days-b.days).slice(0,5);
}
// Background templates = 4 ảnh 3D thật (backgrounds.js). Fallback nếu module vắng.
const cardTemplates=(BG&&BG.LIST&&BG.LIST.length)
  ? BG.LIST.map(t=>({id:t.id,name:t.name,sticker:t.sticker}))
  : [{id:'warm',name:'Ấm áp',sticker:'🧡'}];
// Background theo sự kiện (Admin quản lý) — chỉ hiện sự kiện đang kích hoạt trong picker.
// Admin-uploaded backgrounds for special occasions (served privately via /api/background). Employees only render them.
let CUSTOM_BGS=BOOT.backgrounds||[];
function customBg(id){return CUSTOM_BGS.find(b=>b.id===id)||null;}
function customBgTemplates(){return CUSTOM_BGS.filter(b=>b.status==='ACTIVE').map(b=>({id:b.id,name:b.name,sticker:'🎁',custom:true}));}
function allTemplates(){return cardTemplates.slice();}
// KUDOS type is an explicit choice; each type shows only its own backgrounds.
const KUDOS_TYPES=[{id:'recognition',label:'Đồng nghiệp',icon:'👥',hint:'Ghi nhận hành động, đóng góp của đồng nghiệp'},{id:'other',label:'Khác',icon:'🎁',hint:'Sinh nhật / Thâm niên / …'}];
// Occasions under "Khác". Each occasion: the Master Data date it uses (or typed when the recipient is not in DATA) and a ±2-day window.
const OCCASIONS=[
 {id:'birthday',label:'Sinh nhật',icon:'🎂',field:'birthday',manualLabel:'Ngày sinh người nhận',payloadKey:'recipientBirthday',dataName:'Date of Birth',
  what:'Sinh nhật',placeholder:'Ví dụ: Chúc mừng sinh nhật bạn! Chúc bạn tuổi mới thật nhiều niềm vui, sức khỏe và những hành trình đáng nhớ cùng Ahamove.'},
 {id:'anniversary',label:'Thâm niên',icon:'✦',field:'anniversary',manualLabel:'Ngày vào Ahamove của người nhận',payloadKey:'recipientOnboard',dataName:'Onboard Day',
  what:'Ngày kỷ niệm vào Ahamove',placeholder:'Ví dụ: Cảm ơn bạn đã đồng hành cùng Ahamove thêm một năm. Chúc bạn tiếp tục có thêm nhiều dấu ấn và hành trình đáng nhớ phía trước.'},
 // Dịp khác: người viết tự đặt tên dịp và nội dung (không có điều kiện ngày).
 {id:'custom',label:'Dịp khác',icon:'✎',custom:true,what:'Dịp',placeholder:'Ví dụ: Chúc mừng bạn đã chính thức trở thành Team Lead! Mình tin bạn sẽ tiếp tục truyền cảm hứng cho cả team trên chặng đường mới.'}
];
const OCCASION_SUGGESTIONS=['Thăng chức','Chào mừng thành viên mới','Hoàn thành dự án','Chúc mừng kết hôn','Chào đón em bé','Chia tay đồng nghiệp'];
function typeGroup(){return state.kudosType==='recognition'?'recognition':'other';}
function isOccasion(){return !!occasionOf(state.kudosType);}
function occasionOf(type){return OCCASIONS.find(o=>o.id===type)||null;}
function kudosTypeLabel(t,k){const o=occasionOf(t);if(o&&o.custom&&k&&k.occasionLabel)return o.icon+' '+k.occasionLabel;return o?o.icon+' '+o.label:'👥 Đồng nghiệp';}
const BIRTHDAY_TEMPLATE_IDS=(BOOT.config&&BOOT.config.birthdayTemplateIds)||['birthday'];
const BIRTHDAY_WINDOW_DAYS=Number(BOOT.config&&BOOT.config.birthdayWindowDays)||2;
function typeTemplates(type){if(type==='other')type='birthday';return type==='birthday'?allTemplates().filter(t=>BIRTHDAY_TEMPLATE_IDS.includes(t.id)):allTemplates().filter(t=>!BIRTHDAY_TEMPLATE_IDS.includes(t.id));}
function templateMeta(id){return allTemplates().concat(customBgTemplates()).find(t=>t.id===id)||cardTemplates[0];}
function bgFor(id){if(/^bg_[a-z0-9]{8,32}$/.test(String(id||''))){const c=customBg(id);return {id,name:c?c.name:'Background dịp đặc biệt',sticker:'🎁',fallback:'#FFF3E6',url:BASE+'/api/background?id='+encodeURIComponent(id)};}return BG?BG.get(id):null;}

const icons={
home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/>',
send:'<path d="m3 11 18-8-7 18-3-7-8-3Z"/><path d="m11 14 4-4"/>',
profile:'<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
shield:'<path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
team:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M15 15a5 5 0 0 1 6 5"/>',
culture:'<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/>',
settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.4v-.1A1.7 1.7 0 0 0 9 19.8a1.7 1.7 0 0 0-1-.4 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.4h.1A1.7 1.7 0 0 0 3.2 9a1.7 1.7 0 0 0 .4-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4.2v.1a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .4 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.1.36.3.7.6 1 .3.27.7.4 1.1.4h.1v4.2h-.1a1.7 1.7 0 0 0-1.1.4c-.3.3-.5.64-.6 1Z"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
feed:'<path d="M5 5h14M5 12h14M5 19h9"/><circle cx="3" cy="5" r=".6"/><circle cx="3" cy="12" r=".6"/><circle cx="3" cy="19" r=".6"/>',
image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m4 18 5-4.5 4 3 3.5-3L20 17"/>',
mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'
};
const svg=(n)=>`<svg viewBox="0 0 24 24">${icons[n]}</svg>`;
const avatarMarkup=(className='')=>{
  if(state.avatarData){
    return `<div class="avatar-media ${className}" data-avatar-edit><img src="${state.avatarData}" alt="Avatar cá nhân" style="transform:scale(${state.avatarScale})"></div>`;
  }
  return `<div class="avatar-fallback ${className}" data-avatar-edit>${initials(me().name)}</div>`;
};
const logo=(light=true)=>`<img src="${light?A.logoLight:A.logoDark}" alt="Ahamove">`;
const kudosLogo=()=>`<img src="${A.kudosLogo||A.logoLight}" alt="Ahamove">`;
const mascotIllustration=()=>`<img src="${A.mascotCutout||A.logoLight}" alt="Mascot Ahamove">`;

// Admin navigation: 5 groups; pages inside a group are reached through sub-tabs.
const ADMIN_NAV=[
 {id:'admin-home',icon:'grid',label:'Tổng quan',tabs:[['admin-home','Tổng quan'],['admin-dept','Phòng ban'],['admin-culture','Giá trị cốt lõi']]},
 {id:'admin-quality',icon:'shield',label:'Duyệt nội dung',tabs:[['admin-quality','Duyệt nội dung']]},
 {id:'admin-people',icon:'team',label:'Nhân viên',tabs:[['admin-people','Nhân viên']]},
 {id:'admin-recognition',icon:'send',label:'Gửi AHAKUDOS',tabs:[['admin-recognition','Gửi AHAKUDOS'],['admin-ops','Sinh nhật & Thâm niên']]},
 {id:'admin-notify',icon:'settings',label:'Cài đặt',tabs:[['admin-notify','Email thông báo'],['admin-words','Từ cấm']]}
];
function adminGroupOf(page){return ADMIN_NAV.find(g=>g.tabs.some(t=>t[0]===page))||ADMIN_NAV[0];}
function adminSubtabs(){
 const g=adminGroupOf(state.page);if(g.tabs.length<2)return '';
 return `<nav class="admin-subtabs" aria-label="${escapeHtml(g.label)}">${g.tabs.map(([id,label])=>`<button type="button" class="admin-subtab ${state.page===id?'active':''}" data-page="${id}" ${state.page===id?'aria-current="page"':''}>${escapeHtml(label)}</button>`).join('')}</nav>`;
}
function sidebar(){
 const emp=[
  ['employee-home','home','Trang chủ'],
  ['send-kudos','send','Gửi KUDOS'],
  ['public-feed','feed','CỘNG ĐỒNG KUDOS'],
  ['kudos-profile','profile','Hồ sơ KUDOS']
 ];
 const adm=ADMIN_NAV.map(g=>[g.id,g.icon,g.label]);
 const items=state.mode==='employee'?emp:adm;
 const active=(id)=>state.mode==='admin'?adminGroupOf(state.page).id===id:(state.page===id||(id==='kudos-profile'&&state.page==='kudos-detail'));
 const badge=(id)=>{
  if(state.mode!=='admin'){const n=id==='kudos-profile'?unreadReceived().length+unreadReplies().length:id==='public-feed'?todayCommunityNew().length:0;return n?`<span class="nav-badge nav-badge--inline" aria-label="${n} ${id==='public-feed'?'KUDOS mới hôm nay':'KUDOS / lời nhắn chưa đọc'}">${n>99?'99+':n}</span>`:'';}
  const n=id==='admin-quality'?ADMIN.records.filter(k=>modStatusOf(k)==='HELD').length:id==='admin-notify'?ADMIN.records.filter(k=>k.email&&k.email.status==='FAILED').length:0;
  return n?`<span class="nav-badge" aria-label="${n} mục cần xử lý">${n>99?'99+':n}</span>`:'';
 };
 return `<nav class="hb-nav" aria-label="${state.mode==='employee'?'Điều hướng AHAKUDOS':'Điều hướng quản trị'}">
  ${items.map(([id,ic,lb])=>`<button class="nav-btn ${active(id)?'active':''}" data-page="${id}" ${active(id)?'aria-current="page"':''}>${svg(ic)}${state.mode==='employee'?`<span class="nav-label">${lb}${badge(id)}</span>`:`<span>${lb}</span>${badge(id)}`}</button>`).join('')}
 </nav>`;
}
function topbar(){
 const u=me();
 return `<header class="hb-header">
  <div class="hb-header-inner">
   <button class="hb-brand" data-page="${state.mode==='employee'?'employee-home':'admin-home'}" aria-label="AHAKUDOS — Trang chủ">
    <span class="hb-brand-logo">${logo(true)}</span><span class="hb-brand-divider"></span><span class="hb-product">AHAKUDOS<span>GHI NHẬN & CẢM ƠN</span></span>
   </button>
   ${sidebar()}
   <div class="hb-header-actions">
    ${BOOT.isAdmin&&me().inMasterData!==false?`<button class="switch-btn" data-switch="${state.mode==='employee'?'admin':'employee'}" title="Chuyển giữa giao diện Nhân viên và Quản trị">${svg(state.mode==='employee'?'shield':'home')}<span>${state.mode==='employee'?'Giao diện Admin':'Giao diện Nhân viên'}</span></button>`:''}
    <button class="hb-account" data-page="${state.mode==='employee'?'kudos-profile':'admin-home'}" aria-label="Hồ sơ ${escapeHtml(u.name)}">${state.mode==='admin'?`<img src="${ADMIN_AVATAR}" alt="Admin AHAKUDOS">`:state.avatarData?`<img src="${state.avatarData}" alt="" style="transform:scale(${state.avatarScale})">`:initials(u.name)}</button>
   </div>
  </div>
 </header>`;
}
function envBadge(){
 // Chỉ hiện ở development/staging để tránh nhầm môi trường. Production không có nhãn này.
 return CONFIG.env&&CONFIG.env!=='production'?`<span class="hb-demo-label" title="Môi trường ${escapeHtml(CONFIG.env)}"><i></i>${escapeHtml(String(CONFIG.env).toUpperCase())}</span>`:'';
}
function contextbar(){
 const u=me();
 const firstName=escapeHtml((u.name||'bạn').split(' ').slice(-1)[0]);
 const tenureDays=employeeTenureDays(u);
 const tenureLine=isOnboardToday()||tenureDays===0
   ?'Cùng khám phá AHAKUDOS — nơi mọi lời cảm ơn được lưu lại ✨'
   :tenureDays!==null
   ?`Cảm ơn bạn đã đồng hành cùng Ahamove <strong class="tenure-days">${tenureDays.toLocaleString('vi-VN')}</strong> ngày.`
   :'Cảm ơn bạn đã đồng hành cùng Ahamove.';
 const employeeGreeting=`<b>Xin chào, ${firstName}! <span class="wave" aria-hidden="true">👋</span></b><span>${tenureLine}</span>`;
 return `<div class="hb-contextbar">
  <div class="hb-context-left"><span class="hb-context-icon">${svg(state.mode==='employee'?'profile':'shield')}</span><div class="greeting">${state.mode==='employee'?employeeGreeting:'<b>Trung tâm quản trị</b><span>Không gian vận hành AHAKUDOS toàn công ty.</span>'}</div></div>
  <div class="hb-context-right">${envBadge()}<div class="search hb-directory"><input id="hb-directory-search" placeholder="Tìm đồng nghiệp, phòng ban..." autocomplete="off" aria-label="Tìm đồng nghiệp trong Master Data" aria-expanded="false" aria-controls="hb-directory-results">${svg('search')}<div class="recipient-suggestions hidden" id="hb-directory-results"></div></div></div>
 </div>`;
}
function shell(content){
 return `<div class="app-shell ${state.mode==='admin'?'admin-shell':''}">
  <a class="hb-skip-link" href="#main-content">Đến nội dung chính</a>
  ${topbar()}
  <main class="main-wrap" id="main-content" tabindex="-1">${contextbar()}${content}</main>
  ${state.mode==='employee'?fabHtml():''}
  <footer class="hb-footer"><b>AHAKUDOS <span>· Ahamove</span></b><span>Always Moving Together</span></footer>
 </div>`;
}

// ---- Home ------------------------------------------------------------------
function receivedFeedItem(k,{big=false}={}){
 const cn=(k.values||[]).map(valueLabel);
 const tags=cn.map(n=>`<span>${escapeHtml(n)}</span>`).join('');
 return `<div class="feed-item kudos-open kudos-soft-bg" style="--soft-bg:url('${escapeHtml(bgFor(k.templateId).url)}')" role="button" tabindex="0" data-open-kudos="${k.id}">
   <div class="feed-head">${miniAvatar(k.senderEmail,k.senderName)}<div class="who"><b>${escapeHtml(k.senderName)}</b><span>${escapeHtml(k.senderDept||'')}</span></div><time>${escapeHtml(k.sentAtLabel||'')}</time></div>
   <p>${escapeHtml(k.message)}</p>
   <div class="value-tags">${tags}</div>
   ${replyChip(k)}
 </div>`;
}
function replyThreadHtml(k,isRecipient){
 const other=isRecipient?k.senderName:k.recipientName;
 const otherFirst=String(other||'').trim();
 const quick=[`Cảm ơn bạn ${otherFirst} rất nhiều 🧡`,'Then kiu dancers 💃'];
 const list=(k.replies||[]).map(r=>`<div class="reply-msg ${r.mine?'is-mine':''}"><b>${escapeHtml(r.mine?'Bạn':r.name||'')}</b><p>${escapeHtml(r.text)}</p><time>${escapeHtml(fmtDateTime(r.at))}</time></div>`).join('');
 return `<div class="kd-panel kd-reply-panel"><h3>💬 ${isRecipient?'Nhắn lại cho '+escapeHtml(other||'người gửi'):'Lời nhắn từ '+escapeHtml(other||'người nhận')}</h3>
  ${list?`<div class="reply-list">${list}</div>`:`<p class="reply-empty">${isRecipient?'Gửi một lời cảm ơn để người gửi biết KUDOS đã chạm tới bạn nhé.':'Chưa có lời nhắn nào.'}</p>`}
  ${isRecipient&&k.canReply?`<div class="reply-quick">${quick.map(q=>`<button type="button" data-reply-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
  <div class="reply-form"><textarea id="reply-text" class="textarea" rows="2" maxlength="500" placeholder="Viết lời nhắn…"></textarea><button class="btn primary" data-reply-send="${escapeHtml(k.id)}">Gửi</button></div>
  <span class="field-hint">Chỉ ${escapeHtml(other||'người gửi')} và bạn thấy lời nhắn này.</span>`:''}
 </div>`;
}
function replyChip(k){const n=(k.replies||[]).length;if(!n&&!(k.canReply&&k.recipientEmail===me().email))return '';const unread=k.replyUnread&&!k._replySeenLocal;return `<span class="reply-chip ${unread?'is-new':''}">💬 ${n?n+' lời nhắn':'Gửi lời nhắn'}${unread?' · Mới':''}</span>`;}
function employeeHome(){
 const u=me();
 const rec=receivedFor(u.email);
 const latest=rec[0];
 const sentCount=sentBy(u.email).length;
 const birthdaySuggestions=birthdaySuggestionsFor(u.email);
 const heroNote=latest?`
   <div class="hb-hero-note">
    <div class="hb-note-label"><span>✦</span> KUDOS gần nhất dành cho bạn</div>
    <div class="kudos-highlight kudos-open" role="button" tabindex="0" data-open-kudos="${latest.id}">
     <span class="hb-note-heart" aria-hidden="true">♥</span>
     <div class="person-row">${miniAvatar(latest.senderEmail,latest.senderName)}<div><b>${escapeHtml(latest.senderName)}</b><span>${escapeHtml(latest.senderDept||'')} · ${escapeHtml(latest.sentAtLabel||'')}</span></div></div>
     <p>${escapeHtml(latest.message)}</p>
     <div class="value-tags">${(latest.values||[]).map(v=>`<span>${escapeHtml(CULTURE[v]||v)}</span>`).join('')}</div>
     <div class="hb-note-signoff">Nhấn để mở lời ghi nhận <span>— và giữ lại cho riêng bạn</span></div>
    </div>
   </div>`:`
   <div class="hb-hero-note">
    <div class="hb-note-label"><span>✦</span> KUDOS gần nhất dành cho bạn</div>
    <div class="kudos-highlight"><p>Bạn chưa nhận KUDOS nào. Khi một đồng nghiệp ghi nhận bạn, lời đó sẽ xuất hiện tại đây và được lưu trong Hồ sơ để bạn xem lại.</p></div>
   </div>`;
 const recentList=rec.slice(0,2).map(k=>receivedFeedItem(k)).join('')||`<div class="empty"><div class="icon">✦</div><h3>Chưa có KUDOS đã nhận</h3><p>Những lời ghi nhận dành cho bạn sẽ xuất hiện và được lưu tại đây.</p></div>`;
 const approvedCommunity=publicFeedList().slice(0,2);
 const pendingOwn=sentBy(u.email).filter(k=>k.visibility==='public'&&k.publicConsent!=='approved'&&modStatusOf(k)!=='HIDDEN').slice(0,2);
 const homeCommunityItems=approvedCommunity.length?approvedCommunity:pendingOwn;
 const homeCommunityMode=approvedCommunity.length?'approved':(pendingOwn.length?'pending':'empty');
 const homeCommunityCards=homeCommunityItems.map(k=>`<article class="home-community-item">
    <div class="home-community-item-head">
      <div><b>${escapeHtml(k.senderName||'')}</b><span>${escapeHtml(k.senderDept||'')}</span></div>
      <span class="home-community-status ${homeCommunityMode}">${homeCommunityMode==='approved'?'Admin đã duyệt':'Chờ Admin duyệt'}</span>
    </div>
    <button class="home-community-visual kudos-open" data-open-kudos="${k.id}" aria-label="Mở KUDOS">${buildKudosCard(k,{mode:'public'})}</button>
   </article>`).join('');
 const homePrimaryCard=sentCount===0?`
   <article class="home-start-card">
    <div class="home-start-head">
     <div>
      <span class="home-start-kicker">BẮT ĐẦU</span>
      <h2 class="home-start-title">Gửi KUDOS đầu tiên</h2>
      <p class="home-start-sub">Chưa gửi KUDOS nào? Bắt đầu lan tỏa một lời ghi nhận thật lòng nhé.</p>
     </div>
    </div>
    <div class="home-start-grid">
     <article class="home-start-step">
      <span class="home-step-badge">1</span>
      <img src="${BASE}/illustrations/home-step-select-person.png" alt="Chọn người bạn muốn ghi nhận">
      <h3>Chọn người bạn muốn ghi nhận</h3>
      <p>Tìm đồng nghiệp mà bạn muốn gửi một lời cảm ơn thật là woah.</p>
     </article>
     <article class="home-start-step">
      <span class="home-step-badge">2</span>
      <img src="${BASE}/illustrations/home-step-write-message.png" alt="Nội dung ghi nhận bạn muốn chia sẻ">
      <h3>Nội dung ghi nhận bạn muốn chia sẻ</h3>
      <p>Kể lại khoảnh khắc khiến bạn muốn ghi nhận và sự hỗ trợ / năng lượng bạn đã nhận được.</p>
     </article>
     <article class="home-start-step">
      <span class="home-step-badge">3</span>
      <img src="${BASE}/illustrations/home-step-send-kudos.png" alt="Chọn giá trị và gửi KUDOS">
      <h3>Chọn giá trị &amp; gửi KUDOS</h3>
      <p>Chọn giá trị cốt lõi phù hợp và gửi lời ghi nhận của bạn đi.</p>
     </article>
    </div>
    <button class="btn primary home-start-cta" data-page="send-kudos">Gửi KUDOS đầu tiên →</button>
   </article>`:`
   <article class="home-community-card">
    <div class="home-community-head">
      <div><div class="kicker">CỘNG ĐỒNG KUDOS</div><h2>${homeCommunityMode==='pending'?'KUDOS của bạn đang chờ được lan tỏa':'Những chuyển động tích cực đang được lan tỏa'}</h2><p>${homeCommunityMode==='approved'?'Những KUDOS đã được Admin duyệt gần đây.':homeCommunityMode==='pending'?'Chưa có KUDOS nào được Admin duyệt. Trong lúc chờ, đây là lời ghi nhận bạn vừa gửi.':'Chưa có KUDOS nào được Admin duyệt để hiển thị.'}</p></div>
      <button class="link-btn" data-page="public-feed">Xem tất cả →</button>
    </div>
    <div class="home-community-list">${homeCommunityCards||`<div class="empty"><div class="icon">✦</div><h3>Cộng đồng đang chờ lời ghi nhận đầu tiên</h3><p>Khi Admin duyệt KUDOS, những lời ghi nhận sẽ xuất hiện tại đây.</p></div>`}</div>
   </article>`
const recvCount=rec.length, noJourneyYet=sentCount===0&&recvCount===0;
 const recvJourneyCard=noJourneyYet
  ? `<div class="hb-journey-stat hb-journey-stat-empty"><strong>✦</strong><div><b>Bắt đầu hành trình KUDOS</b><span>Chưa có KUDOS nào được gửi hoặc nhận. Hãy bắt đầu bằng lời ghi nhận đầu tiên.</span></div></div>`
  : `<div class="hb-journey-stat"><strong>${recvCount}</strong><div><b>${recvCount===0?'Chưa có KUDOS nào nhận được':'KUDOS bạn đã nhận'}</b><span>${recvCount===0?'Khi đồng nghiệp gửi lời ghi nhận, bạn sẽ thấy tại đây.':'Được lưu để xem lại bất cứ lúc nào'}</span></div></div>`;
 const sentJourneyCard=sentCount===0
  ? `<div class="hb-journey-stat hb-journey-stat-warm"><strong>→</strong><div><b>Gửi KUDOS đầu tiên</b><span>Lan tỏa lời ghi nhận đầu tiên của bạn tới đồng nghiệp ngay hôm nay.</span><button class="hb-journey-mini-cta" data-page="send-kudos">Gửi KUDOS ngay →</button></div></div>`
  : sentCount===1
   ? `<div class="hb-journey-stat hb-journey-stat-warm"><strong class="hb-gift-stat" aria-label="Quà KUDOS">🎁</strong><div><b class="hb-first-kudos-title">Chúc mừng bạn đã gửi <span>KUDOS đầu tiên!</span></b><span>Hãy chờ đón một món quà nhỏ đặc biệt dành cho cột mốc này nhé.</span></div></div>`
   : `<div class="hb-journey-stat hb-journey-stat-warm"><strong>${sentCount}</strong><div><b>KUDOS bạn đã gửi</b><span>Lan tỏa điều tích cực đến đồng nghiệp.</span></div></div>`;
 return `<section class="page active hb-home">${welcomeOnboardHtml()}
 <article class="recognition-hero hb-hero">
  <div class="moment-copy">
   <span class="eyebrow">KHOẢNH KHẮC ĐƯỢC GHI NHẬN · AHAMOVE</span>
   <h1>Cùng lan tỏa văn hoá ghi nhận <br>từ một lời cảm ơn.</h1>
   <p>Mỗi AHAKUDOS gửi đi là một dấu ấn được lưu lại, để điều tích cực tiếp tục lan tỏa.</p>
   <div class="hb-hero-actions"><button class="btn primary" data-page="send-kudos">${svg('send')} Gửi KUDOS ngay <span aria-hidden="true">→</span></button><button class="btn hb-btn-light" data-page="kudos-profile">Xem hồ sơ ${svg('profile')}</button></div>
  </div>
 </article>
 <div class="profile-strip hb-journey-strip">
  <div class="profile-intro"><div class="avatar-edit-wrap">${avatarMarkup('home-avatar')}<button class="avatar-edit-btn" data-avatar-edit title="Cập nhật avatar" aria-label="Cập nhật ảnh đại diện">✎</button></div><div><b>${escapeHtml(u.name)} ✨</b><p>${escapeHtml(u.dept||'')}${u.section?` · ${escapeHtml(u.section)}`:''}${u.dateOfBirth?` · Sinh nhật ${escapeHtml(u.dateOfBirth.slice(8,10)+'/'+u.dateOfBirth.slice(5,7))}`:''}</p></div></div>
  ${recvJourneyCard}
  ${sentJourneyCard}
 </div>
 <section class="home-about-kudos home-handbook-layout" aria-label="Thông tin về AHAKUDOS">
  <div class="home-handbook-progress" aria-label="Các phần chính của AHAKUDOS">
   <div class="home-progress-count"><b>1/3</b><span style="--progress:33.333%"></span></div>
   <a href="#home-about" class="active"><strong>01</strong><span>Giới thiệu AHAKUDOS</span></a>
   <i></i>
   <a href="#home-goals"><strong>02</strong><span>Mục tiêu</span></a>
   <i></i>
   <a href="#home-how"><strong>03</strong><span>Gửi KUDOS</span></a>
  </div>

  <div class="home-handbook-grid">
   <article id="home-about" class="home-def-v2" aria-labelledby="home-def-title">
    <span class="home-def-v2__blob home-def-v2__blob--top" aria-hidden="true"></span>
    <span class="home-def-v2__blob home-def-v2__blob--right" aria-hidden="true"></span>
    <span class="home-def-v2__blob home-def-v2__blob--corner" aria-hidden="true"></span>
    <div class="home-def-v2__copy">
     <span class="home-def-v2__badge">GIỚI THIỆU AHAKUDOS</span>
     <h2 id="home-def-title" class="home-def-v2__title">AHAKUDOS <span>là gì?</span></h2>
     <p class="home-def-v2__lead">AHAKUDOS là nền tảng ghi nhận nội bộ của Ahamove, được xây dựng để giúp nhân viên dễ dàng gửi lời cảm ơn, ghi nhận những hành động tích cực và lan tỏa các giá trị cốt lõi trong công việc hằng ngày.</p>
     <blockquote class="home-def-v2__quote"><span class="home-def-v2__quote-mark" aria-hidden="true">“</span><p>Khi một đồng nghiệp làm điều gì đó có ý nghĩa, đóng góp ấy xứng đáng được nhìn thấy và trân trọng.</p></blockquote>
     <p class="home-def-v2__support">Đó có thể là khi một đồng nghiệp chủ động hỗ trợ bạn, giải quyết một vấn đề khó, chia sẻ kiến thức, đồng hành cùng team hoặc tạo ra một tác động tích cực.</p>
     <div class="home-def-v2__note"><span class="home-def-v2__note-icon" aria-hidden="true">i</span><p>AHAKUDOS là chương trình ghi nhận văn hóa và <strong>không thay thế hệ thống đánh giá hiệu suất.</strong></p></div>
    </div>
    <div class="home-def-v2__visual" aria-hidden="true">
     <div class="home-def-v2__slogan">
      <svg class="home-def-v2__spark home-def-v2__spark--left" viewBox="0 0 60 60"><path d="M6 20 L30 30 M8 44 L30 40" /></svg>
      <span>Always<br>Moving<br>Together</span>
      <svg class="home-def-v2__spark home-def-v2__spark--right" viewBox="0 0 60 60"><path d="M14 38 L38 12" /></svg>
      <svg class="home-def-v2__heart" viewBox="0 0 32 30"><path d="M16 28C6 21 1 15.5 1 9.6 1 5 4.6 1.5 9 1.5c2.9 0 5.3 1.5 7 3.9 1.7-2.4 4.1-3.9 7-3.9 4.4 0 8 3.5 8 8.1C31 15.5 26 21 16 28Z"/></svg>
     </div>
     <div class="home-def-v2__mascot-wrap">
      <img src="${BASE}/illustrations/definition-mascot-star.png" alt="" class="home-def-v2__mascot" width="760" height="643" loading="lazy" data-hide-on-error>
      <svg class="home-def-v2__spark home-def-v2__spark--mascot" viewBox="0 0 60 60"><path d="M22 8 L16 26 M40 18 L28 32 M50 34 L32 40" /></svg>
     </div>
    </div>
   </article>

   <div id="home-goals" class="home-handbook-objectives">
    <article class="home-handbook-card home-handbook-goals">
     <div class="home-handbook-card-icon">🎯</div>
     <div class="home-handbook-card-copy">
      <span class="home-handbook-card-kicker">MỤC TIÊU</span>
      <h2>AHAKUDOS được phát triển nhằm</h2>
      <div class="home-handbook-goal-list">
       <span>Khuyến khích thói quen ghi nhận và cảm ơn trong công việc hằng ngày.</span>
       <span>Giúp những đóng góp tích cực được nhìn thấy và ghi nhận đúng lúc.</span>
       <span>Lan tỏa hành vi văn hóa tích cực bằng những câu chuyện thật.</span>
       <span>Tăng sự kết nối giữa các Ahamovers trong quá trình làm việc.</span>
      </div>
     </div>
    </article>

    <article class="home-handbook-card home-handbook-sources">
     <div class="home-handbook-card-icon">🎁</div>
     <div class="home-handbook-card-copy">
      <span class="home-handbook-card-kicker">BẠN CÓ THỂ NHẬN KUDOS TỪ ĐÂU?</span>
      <h2>Những khoảnh khắc có thể nhận KUDOS</h2>
      <div class="home-handbook-source-row">
       <div><i>👥</i><b>Từ đồng nghiệp</b><p>Khi một đồng nghiệp nhìn thấy một hành động hoặc đóng góp tích cực của bạn, họ có thể chủ động gửi KUDOS để ghi nhận điều đó.</p></div>
       <div><i>🎂</i><b>Từ những cột mốc đáng nhớ</b><p>AHAKUDOS cũng sẽ gửi lời chúc và ghi nhận vào một số dịp đặc biệt như <strong>Sinh nhật</strong> hoặc <strong>Kỷ niệm ngày vào công ty / Thâm niên</strong>.</p></div>
      </div>
     </div>
    </article>
   </div>
  </div>

  <article id="home-how" class="home-handbook-journey">
   <div class="home-handbook-journey-head">
    <div class="home-handbook-card-icon">✈️</div>
    <div>
     <span class="home-handbook-card-kicker">GỬI MỘT KUDOS NHƯ THẾ NÀO?</span>
     <h2>Gửi KUDOS trong 3 bước</h2>
     <p>Hãy chia sẻ khoảnh khắc khiến bạn muốn ghi nhận và sự hỗ trợ / năng lượng bạn đã nhận được từ đồng nghiệp. Sau đó, chọn Giá trị cốt lõi phù hợp (Tốc độ · Đồng hành · Đổi mới) — theo gợi ý hoặc theo cách bạn cảm nhận.</p>
    </div>
   </div>
   <div class="home-handbook-steps">
    <div class="home-handbook-step"><b>01</b><div class="home-handbook-step-icon"><img src="${BASE}/illustrations/home-step-select-person.png" alt="Chọn đồng nghiệp"></div><h3>Chọn đồng nghiệp bạn muốn ghi nhận</h3><p>Tìm đồng nghiệp mà bạn muốn gửi một lời cảm ơn thật là woah.</p></div>
    <div class="home-handbook-step"><b>02</b><div class="home-handbook-step-icon"><img src="${BASE}/illustrations/home-step-write-message.png" alt="Viết nội dung"></div><h3>Nội dung ghi nhận bạn muốn chia sẻ</h3><p>Kể lại khoảnh khắc khiến bạn muốn ghi nhận và sự hỗ trợ / năng lượng bạn đã nhận được.</p></div>
    <div class="home-handbook-step"><b>03</b><div class="home-handbook-step-icon"><img src="${BASE}/illustrations/home-step-send-kudos.png" alt="Chọn giá trị và gửi KUDOS"></div><h3>Chọn giá trị &amp; gửi KUDOS</h3><p>Chọn Giá trị cốt lõi phù hợp và gửi lời ghi nhận của bạn đi.</p><button class="home-step-kudos-cta" data-page="send-kudos">Gửi KUDOS ngay →</button></div>
   </div>
  </article>

  <div class="home-handbook-extra">
   <article class="home-handbook-mini home-birthday-master">
    <div class="home-handbook-mini-head">
     <div class="home-handbook-mini-icon">🎂</div>
     <div>
      <span class="home-handbook-mini-kicker">SINH NHẬT</span>
      <h3>Sinh nhật đồng nghiệp sắp tới</h3>
     </div>
    </div>
    <div class="home-master-birthday-list">${birthdaySuggestions.length?birthdaySuggestions.slice(0,3).map(b=>`<div class="home-master-birthday-row">${miniAvatar(b.email,b.name,'birthday-avatar')}<div><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.dept||'')} · ${escapeHtml(b.when)} · ${escapeHtml(b.date)}</span></div>${b.canSend?`<button data-birthday="${escapeHtml(b.email)}">Gửi lời chúc →</button>`:`<span class="home-master-birthday-soon">Gửi lời chúc từ ${escapeHtml(b.opensLabel)}</span>`}</div>`).join(''):`<div class="home-master-empty">Chưa có sinh nhật nào trong 30 ngày tới theo Master Data.</div>`}</div>
   </article>

   <article class="home-handbook-mini">
    <div class="home-handbook-mini-head">
     <div class="home-handbook-mini-icon">📅</div>
     <div>
      <span class="home-handbook-mini-kicker">SỰ KIỆN</span>
      <h3>Thông báo sự kiện sắp diễn ra</h3>
     </div>
    </div>
    <p>Khu vực này sẽ hiển thị các sự kiện nội bộ liên quan đến văn hoá ghi nhận để Ahamovers tiện theo dõi và tham gia.</p>
    <span class="home-handbook-mini-chip">Coming soon</span>
   </article>
  </div>

  <div class="home-handbook-bottom">
   <div class="home-handbook-bottom-icon">💬</div>
   <div><b>Bạn đã sẵn sàng gửi một lời ghi nhận?</b><span>Một lời cảm ơn nhỏ có thể tạo nên động lực lớn cho đồng nghiệp.</span></div>
   <button class="btn primary" data-page="send-kudos">Gửi KUDOS ngay →</button>
  </div>
 </section>
</section>`;
}

// ---- Public feed -----------------------------------------------------------
function publicFeedPage(){
 const reactionMeta={heart:['🧡','Đồng cảm'],clap:['👏','Vỗ tay'],cheer:['🙌','Tuyệt vời'],spark:['✨','Lan tỏa']};
 const list=publicFeedList();
 const cards=list.map(k=>{
   const tags=(k.values||[]).map(v=>`<span>${escapeHtml(CULTURE[v]||v)}</span>`).join('');
   const template=templateMeta(k.templateId);
   return `<article class="card public-kudos-card" data-public-card="${k.id}">
     <div class="public-card-top">
       <div class="public-route">
         ${miniAvatar(k.senderEmail,k.senderName)}
         <div class="public-person"><b>${escapeHtml(k.senderName)}</b><span>${escapeHtml(k.senderDept||'')}</span></div>
         <span class="route-arrow">→</span>
         ${miniAvatar(k.recipientEmail,k.recipientName,'recipient-public-avatar')}
         <div class="public-person"><b>${escapeHtml(k.recipientName)}</b><span>${escapeHtml(k.recipientDept||'')}</span></div>
       </div>
       <div class="public-time"><span class="public-badge">◎ CỘNG ĐỒNG KUDOS</span><time>${escapeHtml(k.sentAtLabel||'Vừa xong')}</time></div>
     </div>
     <div class="public-kudos-visual kudos-open" role="button" tabindex="0" data-open-kudos="${k.id}">
       ${buildKudosCard(k,{mode:'public'})}
     </div>
     <div class="reaction-row">
       <div class="reaction-buttons">
         ${Object.entries(reactionMeta).map(([key,meta])=>`<button class="reaction-btn ${k.myReactions&&k.myReactions[key]?'active':''}" data-reaction="${key}" data-public-id="${k.id}" title="${meta[1]}"><span>${meta[0]}</span><b>${Number((k.reactions&&k.reactions[key])||0)}</b></button>`).join('')}
       </div>
       <span class="reaction-note">Reaction dùng để hưởng ứng lời ghi nhận</span>
     </div>
   </article>`;
 }).join('');
 return `<section class="page active">
   <div class="page-head public-feed-head">
     <div>
       <div class="kicker">CỘNG ĐỒNG KUDOS</div>
       <h1>Những chuyển động tích cực đang được lan toả tại Ahamove</h1>
       <p class="page-sub">Những KUDOS được Admin duyệt cho phạm vi CỘNG ĐỒNG KUDOS sẽ xuất hiện tại đây.</p>
     </div>
     <div class="realtime-status"><i></i><div><b>Realtime</b><span>Đang cập nhật</span></div></div>
   </div>
   <div class="public-feed-layout">
     <div class="public-feed-list" id="public-feed-list">${cards||`<div class="empty"><div class="icon">✦</div><h3>Chưa có CỘNG ĐỒNG KUDOS</h3><p>Những lời ghi nhận được Admin duyệt cho CỘNG ĐỒNG KUDOS sẽ xuất hiện tại đây.</p></div>`}</div>
     <aside class="public-feed-rail">
       <article class="card public-feed-side-card">
         <div class="rail-title"><span>Lan tỏa hôm nay</span></div>
         <div class="public-stat"><strong>${list.length}</strong><span>CỘNG ĐỒNG KUDOS</span></div>
         <div class="public-stat"><strong>${list.reduce((s,k)=>s+Object.values(k.reactions||{}).reduce((a,b)=>a+Number(b||0),0),0)}</strong><span>Reaction</span></div>
       </article>
       <article class="card public-feed-side-card public-feed-mascot-card">
         
         <div class="public-feed-mascot-wrap">${mascotIllustration()}</div>
         <p>Một lời cảm ơn nhỏ có thể bắt đầu từ hôm nay — gửi một KUDOS để ghi nhận điều tốt đẹp bạn vừa nhìn thấy.</p>
       </article>
       <button class="btn primary wide" data-page="send-kudos">+ Gửi một KUDOS</button>
     </aside>
   </div>
 </section>`;
}

// ---- Compose (single column) ----------------------------------------------
function composeRecord(){
 // Build a live record from current compose inputs — the SAME shape the email uses.
 const u=me();
 const manual=!!state.manualRecipient;
 const r=state.selectedRecipient;
 const rawEmail=(document.querySelector('#recipient-email')?document.querySelector('#recipient-email').value.trim():state.prefillRecipient)||'';
 const manualName=(document.querySelector('#recipient-manual-name')?.value||'').trim();
 const manualDept=(document.querySelector('#recipient-manual-dept')?.value||'').trim();
 const manualEmail=(document.querySelector('#recipient-manual-email')?.value||'').trim();
 return {
   senderName:u.name,senderDept:u.dept,senderSection:u.section||'',senderEmail:u.email,
   recipientManual:manual,
   recipientName:manual?manualName:(r?r.name:''),recipientDept:manual?manualDept:(r?r.dept:''),recipientEmail:manual?manualEmail:(r?r.email:rawEmail),
   message:(document.querySelector('#message')?document.querySelector('#message').value:'')||'',
   templateId:state.selectedTemplate,values:[...state.values],
   visibility:'public',publicConsent:'pending',
   ctaUrl:'#'
 };
}
function sendKudos(){
return `<section class="page active kudos-compose-page">
 <div class="compose-hero">
  <div class="ch-copy">
   <div class="ch-eyebrow">AHAKUDOS · GHI NHẬN & CẢM ƠN</div>
   <h1>Ghi nhận điều tuyệt vời mỗi ngày!</h1>
   <p>Một lời ghi nhận xuất phát từ sự chân thành của bạn có thể trở thành động lực rất lớn cho đồng nghiệp trên hành trình Always Moving.</p>
  </div>
  <div class="ch-art">${ART?ART.heroCharacter():''}<span class="ch-glow" aria-hidden="true"></span></div>
 </div>
 <div class="hb-compose-steps" aria-label="Các bước gửi KUDOS"><span class="hb-step-intro">GỬI MỘT LỜI GHI NHẬN</span><ol><li><span>01</span>Người nhận & background</li><li><span>02</span>Nội dung KUDOS</li><li><span>03</span>Xem trước KUDOS</li><li><span>04</span>Gửi & chờ Admin duyệt</li></ol></div>
 <div class="form-layout kudos-compose-layout">
  <article class="card form-card kudos-compose-form">
   <div class="field kudos-type-field">
    <label id="kudos-type-label">KUDOS</label>
    <div class="kudos-type-switch" role="radiogroup" aria-labelledby="kudos-type-label">
     ${KUDOS_TYPES.map(t=>`<button type="button" class="kudos-type-option ${typeGroup()===t.id?'selected':''}" role="radio" aria-checked="${typeGroup()===t.id}" data-kudos-type="${t.id}"><span class="kudos-type-icon" aria-hidden="true">${t.icon}</span><span><b>${t.label}</b><small>${escapeHtml(t.hint)}</small></span></button>`).join('')}
    </div>
    <div id="occasion-row" class="occasion-switch ${typeGroup()==='other'?'':'hidden'}" role="radiogroup" aria-label="Chọn dịp">
     ${OCCASIONS.map(o=>`<button type="button" class="occasion-option ${state.kudosType===o.id?'selected':''}" role="radio" aria-checked="${state.kudosType===o.id}" data-occasion="${o.id}"><span aria-hidden="true">${o.icon}</span>${o.label}</button>`).join('')}
     <span class="occasion-hint" id="occasion-hint">${occasionOf(state.kudosType)&&occasionOf(state.kudosType).custom?'Tự đặt tên dịp và viết lời chúc phù hợp.':'Chỉ gửi được trong vòng 2 ngày trước hoặc sau ngày kỷ niệm.'}</span>
    </div>
    <div id="occasion-custom-wrap" class="occasion-custom ${occasionOf(state.kudosType)&&occasionOf(state.kudosType).custom?'':'hidden'}">
     <label for="occasion-label">Tên dịp</label>
     <input id="occasion-label" class="input" type="text" maxlength="60" placeholder="Ví dụ: Thăng chức, Chào mừng thành viên mới…" value="${escapeHtml(state.occasionLabel||'')}">
     <div class="occasion-suggest" aria-label="Gợi ý tên dịp">${OCCASION_SUGGESTIONS.map(x=>`<button type="button" data-occasion-suggest="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div>
    </div>
   </div>
   <div class="field recipient-search-field">
    <label>Email người bạn muốn ghi nhận</label>
    <label class="recipient-mode-toggle"><input id="recipient-no-company-email" type="checkbox" ${state.manualRecipient?'checked':''}><span>Người nhận không có mail công ty</span></label>
    <div id="recipient-company-mode" class="recipient-company-mode ${state.manualRecipient?'hidden':''}">
      <div class="email-search-wrap">
        <input id="recipient-email" class="input" type="email" autocomplete="off" placeholder="Nhập email Ahamove của đồng nghiệp..." value="${escapeHtml(state.prefillRecipient||'')}">
        <span class="email-search-icon" aria-hidden="true">⌕</span>
        <div id="recipient-suggestions" class="recipient-suggestions hidden"></div>
      </div>
      <div id="selected-recipient" class="selected-recipient hidden"></div>
      <span class="field-hint">Tìm trong Master Data bằng email Ahamove để lấy đúng họ tên và phòng ban.</span>
    </div>
    <div id="recipient-manual-mode" class="recipient-manual-mode ${state.manualRecipient?'':'hidden'}">
      <div class="recipient-manual-grid">
        <div><label for="recipient-manual-name">Họ tên người nhận</label><input id="recipient-manual-name" class="input" type="text" maxlength="120" placeholder="Nhập họ tên"></div>
        <div><label for="recipient-manual-dept">Phòng ban / Bộ phận</label><input id="recipient-manual-dept" class="input" type="text" maxlength="120" placeholder="Nhập phòng ban hoặc bộ phận"></div>
      </div>
      <label for="recipient-manual-email">Email liên hệ</label>
      <input id="recipient-manual-email" class="input" type="email" autocomplete="off" placeholder="name@example.com">
      <div id="recipient-manual-dob-wrap" class="recipient-manual-dob ${isOccasion()?'':'hidden'}"><label for="recipient-manual-dob" id="recipient-manual-dob-label">${escapeHtml((occasionOf(state.kudosType)||OCCASIONS[0]).manualLabel)}</label><input id="recipient-manual-dob" class="input" type="date"><span class="field-hint">Bắt buộc khi người nhận không có trong Master Data.</span></div>
      <span class="field-hint">Có thể nhập email ngoài @ahamove.com. KUDOS sẽ được đưa vào hàng chờ CỘNG ĐỒNG KUDOS; Admin là người duyệt trước khi hiển thị công khai.</span>
    </div>
    <div id="birthday-status" class="birthday-status hidden" role="status" aria-live="polite"></div>
   </div>
   <div class="field template-field">
    <label id="background-picker-label">Chọn background cho KUDOS</label>
    <div class="bg-carousel">
     <button type="button" class="bg-nav prev" data-bg-nav="-1" aria-label="Xem các background trước">‹</button>
     <div class="template-gallery kudos-background-gallery" role="group" aria-labelledby="background-picker-label">
      ${templateGalleryHtml()}
     </div>
     <button type="button" class="bg-nav next" data-bg-nav="1" aria-label="Xem các background tiếp theo">›</button>
    </div>
    <span class="field-hint">Vuốt hoặc dùng mũi tên để xem thêm. Background sẽ được dùng khi người nhận mở lời ghi nhận trong AHAKUDOS.</span>
   </div>

   <div class="compose-writing">
    <div class="field message-field">
     <label for="message">Nội dung KUDOS</label>
     <div class="kudos-content-format ${isOccasion()?'hidden':''}" aria-label="Format nội dung KUDOS">
      <b>Format tiêu chuẩn cho một KUDOS:</b>
      <span><strong>01</strong> Khoảnh khắc khiến bạn muốn ghi nhận</span>
      <span><strong>02</strong> Sự hỗ trợ / Năng lượng mà bạn đã nhận được</span>
     </div>
     <textarea id="message" class="textarea" aria-describedby="count" placeholder="Ví dụ: Cảm ơn bạn đã chủ động hỗ trợ team xử lý gấp đầu việc trước deadline. Nhờ vậy cả team kịp tiến độ và tránh được một lỗi quan trọng. Mình rất trân trọng sự chủ động và tinh thần đồng đội của bạn."></textarea>
     <span class="field-hint" id="count">0 ký tự</span>
    </div>
    <div class="coach coach--featured ${isOccasion()?'hidden':''}" role="region" aria-label="Thư ký hỗ trợ nội dung KUDOS">
     <div class="coach-head">
      <span class="coach-title"><span class="coach-badge" aria-hidden="true">✍</span><span class="coach-title-copy"><b>Thư ký hỗ trợ nội dung KUDOS</b><small>Thư ký nhỏ sẽ là người bạn đồng hành giúp bạn thêm một chút “gia vị”, để lời KUDOS thật là woah và chạm đến trái tim đồng nghiệp 🧡</small></span></span>
      <span class="coach-actions"><span class="coach-live"><i aria-hidden="true"></i>Realtime</span><button type="button" class="coach-toggle" id="coach-toggle" aria-expanded="false" aria-controls="coach-more">Xem thêm</button></span>
     </div>
     <p class="coach-nudge" id="coach-nudge" role="status" aria-live="polite">Bắt đầu viết, mình sẽ kiểm tra xem nội dung đã có Khoảnh khắc → Sự hỗ trợ / Năng lượng bạn nhận được chưa.</p>
     <div class="coach-more hidden" id="coach-more">
      <p>Một nội dung KUDOS đầy đủ thường có:</p>
      <ul>
       <li><b>Khoảnh khắc</b> khiến bạn muốn ghi nhận — chuyện gì đã xảy ra, lúc nào (không chỉ "cảm ơn nhiều nha").</li>
       <li><b>Sự hỗ trợ / năng lượng</b> mà bạn đã nhận được — điều đó giúp bạn, đội nhóm hoặc công việc thế nào.</li>
      </ul>
      <p class="coach-note">Gợi ý dựa trên quy tắc viết — chưa dùng mô hình AI. Bạn luôn là người quyết định câu chữ; thư ký không tự sửa lời của bạn.</p>
     </div>
    </div>
   </div>

   <div class="field culture-field ${isOccasion()?'hidden':''}" id="culture-field">
    <label id="culture-picker-label">Giá trị cốt lõi <span class="optional-label">· chọn từ 1 đến 3</span></label>
    <div class="culture-picker culture-picker--defs" role="group" aria-labelledby="culture-picker-label">
     ${VALUE_IDS.map(v=>`<button type="button" class="culture-chip culture-card ${state.values.has(v)?'selected':''}" data-value="${v}" aria-pressed="${state.values.has(v)}"><span class="culture-card-head"><img class="culture-card-icon" src="${CULTURE_IMG(v)}" alt="" width="44" height="44" data-hide-on-error><b>${CULTURE[v]}</b><em class="culture-card-suggest">Gợi ý</em><span class="culture-card-tick" aria-hidden="true">✓</span></span><span class="culture-card-def">${escapeHtml(CULTURE_DEF[v])}</span></button>`).join('')}
    </div>
    <div class="value-suggest-panel" id="ai-values" aria-live="polite">Viết nội dung KUDOS, Thư ký sẽ gợi ý Giá trị cốt lõi phù hợp kèm lý do. Bạn có thể tham khảo gợi ý, nhưng giá trị được chọn vẫn do bạn quyết định.</div>
   </div>

   <section class="compose-kudos-review" id="kudos-preview" aria-labelledby="kudos-review-title">
    <div class="email-review-heading">
     <div><div class="kicker">KUDOS PREVIEW</div><h2 id="kudos-review-title" tabindex="-1">Xem trước KUDOS mà người ấy sẽ nhận</h2><p>Đây là nội dung đầy đủ người nhận sẽ thấy sau khi bấm “Mở lời ghi nhận này” trong email thông báo.</p></div>
     <span class="email-review-sync"><i aria-hidden="true"></i>Tự động cập nhật</span>
    </div>
    <div class="kudos-review-recipient"><span>Người nhận</span><strong id="kudos-preview-recipient">Chưa chọn người nhận</strong></div>
    <div class="kudos-review-canvas">
      <div id="kudos-preview-card" class="kudos-preview-card" aria-live="polite"></div>
    </div>
    <p class="email-preview-note">Email chỉ thông báo rằng có KUDOS mới và dẫn vào màn này; nội dung lời ghi nhận không hiển thị trực tiếp trong email.</p>
   </section>
   <div class="compose-send-footer">
    <button type="button" class="link-btn" data-modal="rules">Xem quy tắc →</button>
    <div class="form-actions"><button type="button" class="btn secondary" id="preview">Xem lại KUDOS ↑</button><button type="button" class="btn primary" id="send">Gửi KUDOS ${svg('send')}</button></div>
   </div>
  </article>
 </div>
</section>`;
}

// ---- Profile ---------------------------------------------------------------
function profile(){
 const u=me();
 const rec=receivedFor(u.email);
 const sent=sentBy(u.email);
 const receivedHtml=rec.length?`<div class="feed">${rec.map(k=>receivedFeedItem(k)).join('')}</div>`
   :`<div class="received-empty-state">
      <img class="received-empty-mascot" src="${BASE}/illustrations/empty-received-mascot.png" alt="Mascot Ahamove đang chờ KUDOS" data-fallback="${BASE}/illustrations/mascot-cutout.png">
      <div class="received-empty-copy">
        <span class="received-empty-kicker">Đã nhận</span>
        <h3>Chưa có KUDOS nào</h3>
        <p>Khi đồng nghiệp gửi lời ghi nhận, bạn sẽ thấy ở đây.</p>
        <button class="btn primary" data-page="send-kudos">Gửi KUDOS ngay →</button>
      </div>
    </div>`;
 const sentHtml=sent.length?`<div class="feed sent-history">${sent.map(k=>{
     const cn=(k.values||[]).map(valueLabel);
     const ms=modStatusOf(k);
     const statusText=k.needsImprovement?'✎ Cần bổ sung nội dung':ms==='HIDDEN'?'● Không được duyệt hiển thị':ms==='HELD'?'🕓 Chờ Admin duyệt':k.visibility==='public'?'◎ CỘNG ĐỒNG KUDOS · Admin đã duyệt':'● Chỉ người nhận biết · Admin đã duyệt';
     return `<div class="feed-item sent-feed-item kudos-open kudos-soft-bg" style="--soft-bg:url('${escapeHtml(bgFor(k.templateId).url)}')" role="button" tabindex="0" data-open-kudos="${k.id}">
       <div class="feed-head">${miniAvatar(k.recipientEmail,k.recipientName)}<div class="who"><b>${escapeHtml(k.recipientName)}</b><span>${escapeHtml(k.recipientEmail)}</span></div><time>${escapeHtml(k.sentAtLabel||'Đã gửi')}</time></div>
       <p>${escapeHtml(k.message)}</p>
       ${k.needsImprovement?qualityNoticeHtml(k):''}
       ${replyChip(k)}
       <div class="sent-item-footer"><div>${cn.length?`<div class="sent-values-label">Giá trị cốt lõi được ghi nhận</div><div class="value-tags">${cn.map(n=>`<span>${escapeHtml(n)}</span>`).join('')}</div>`:''}<span class="sent-visibility ${k.visibility==='public'?'public':'private'}">${statusText}</span></div><button class="link-btn" data-open-kudos="${k.id}">Xem chi tiết</button></div>
     </div>`;
   }).join('')}</div>`
   :`<div class="received-empty-state sent-empty-state">
      <img class="received-empty-mascot" src="${BASE}/illustrations/empty-sent-mascot.png" alt="Mascot Ahamove với hộp quà" data-fallback="${BASE}/illustrations/mascot-cutout.png">
      <div class="received-empty-copy">
        <h3>Chưa có KUDOS – Gửi lời khen đầu tiên</h3>
        <p>Bắt đầu bằng một lời cảm ơn dành cho đồng nghiệp bạn muốn ghi nhận.</p>
        <button class="btn primary" data-page="send-kudos">Gửi KUDOS đầu tiên →</button>
      </div>
    </div>`;
return `<section class="page active"><div class="page-head"><div><div class="kicker">HÀNH TRÌNH GHI NHẬN</div><h1>Hồ sơ KUDOS</h1><p class="page-sub">Xem lại những KUDOS bạn đã nhận và đã gửi — tất cả được lưu để bạn mở lại bất cứ lúc nào.</p></div></div>
 <div class="profile-grid">
  <article class="card profile-card"><div class="profile-avatar-edit">${avatarMarkup('profile-big-avatar')}<button class="avatar-edit-btn profile-avatar-btn" data-avatar-edit title="Cập nhật avatar">✎</button></div><h2>${escapeHtml(u.name)}</h2><p>${escapeHtml(u.dept)} · Ahamove</p><button class="profile-avatar-link" data-avatar-edit>Cập nhật ảnh đại diện</button><div class="profile-stats profile-stats-two"><div class="pstat"><b>${rec.length}</b><span>Đã nhận</span></div><div class="pstat"><b>${sent.length}</b><span>Đã gửi</span></div></div></article>
  <article class="card card-pad">
   <div class="tabs"><button class="tab active" data-tab="received">Đã nhận</button><button class="tab" data-tab="sent">Đã gửi</button></div>
   <div class="tab-panel active" id="tab-received">${receivedHtml}</div>
   <div class="tab-panel" id="tab-sent">${sentHtml}</div>
  </article>
 </div>
</section>`;
}

// ---- KUDOS detail (deep link #/k/<id>) — server decides who may see what -----
const detailLoad={};
function kudosDetail(){
 const id=state.viewKudosId;
 const k=kudosById(id);
 const u=me();
 const back=`<button class="kd-back" data-page="employee-home">← Về trang chủ</button>`;
 if(!k){
   const d=detailLoad[id];
   if(!d&&id){
     detailLoad[id]={loading:true};
     rpc('xemKudos',id).then(rec=>{store.detail[id]=rec;detailLoad[id]={done:true};})
       .catch(e=>{detailLoad[id]={error:e};if(e.code!=='KUDOS_NOT_AVAILABLE')console.error('[AHAKUDOS] xemKudos',e);})
       .finally(()=>{if(state.page==='kudos-detail'&&state.viewKudosId===id)render();});
   }
   if(id&&(!d||d.loading))return `<section class="page active kudos-detail-page">${back}${loaderHtml('Đang mở lời ghi nhận…','aha-loader--page')}</section>`;
   const msg=d&&d.error&&d.error.code!=='KUDOS_NOT_AVAILABLE'?escapeHtml(d.error.message):'KUDOS không tồn tại, chưa được Admin duyệt, hoặc bạn không có quyền xem lời ghi nhận này.';
   return `<section class="page active kudos-detail-page">${back}<div class="empty"><div class="icon">✦</div><h3>Không mở được lời ghi nhận</h3><p>${msg}</p></div></section>`;
 }
 const isRecipient=!!k.recipientEmail&&k.recipientEmail===u.email;
 const isSender=!!k.senderEmail&&k.senderEmail===u.email;
 if(!isRecipient&&!isSender&&!k.isCommunity){
   return `<section class="page active kudos-detail-page">${back}<div class="empty"><div class="icon">✦</div><h3>Không mở được lời ghi nhận</h3><p>Bạn không có quyền xem lời ghi nhận này.</p></div></section>`;
 }
 // Mark as viewed only when the recipient actually opens the detail.
 if(isRecipient)k._seenLocal=true; // badge/corner button update in this same render
 if((isRecipient||isSender)&&k.replyUnread&&!k._replySeenLocal){k._replySeenLocal=true;rpc('docPhanHoi',k.id).then(takeRecord).catch(e=>console.warn('[AHAKUDOS] docPhanHoi',e));}
 if(isRecipient&&!k.viewedAt&&!k._markingViewed){
  k._markingViewed=true;
  rpc('ghiDaMo',k.id).then(takeRecord).catch(e=>{console.warn('[AHAKUDOS] ghiDaMo',e);}).finally(()=>{k._markingViewed=false;});
 }
 const status=modStatusOf(k);
 const emailStatusPill=isSender&&!isRecipient?`<span class="status-pill status-queued"><i></i>${escapeHtml(mailStatusText(k))}</span>`:'';
 const visPill=k.needsImprovement?`<span class="status-pill status-pending"><i></i>Cần bổ sung nội dung</span>`:status==='HIDDEN'?`<span class="status-pill status-private"><i></i>Không được duyệt hiển thị</span>`
   :k.visibility==='public'
   ?(status==='APPROVED'?`<span class="status-pill status-public"><i></i>CỘNG ĐỒNG KUDOS · Admin đã duyệt</span>`
     :`<span class="status-pill status-pending"><i></i>Chờ Admin duyệt CỘNG ĐỒNG KUDOS</span>`)
   :`<span class="status-pill status-private"><i></i>Chỉ người nhận biết</span>`;
 let senderBlock='';
 if(isSender&&!isRecipient){
   const s=k.needsImprovement?'Admin mời bạn bổ sung thêm chi tiết trước khi gửi tới người nhận. Người nhận chưa nhận được thông báo.':status==='HIDDEN'?'KUDOS này không được Admin duyệt hiển thị. Người nhận sẽ không nhận được thông báo.'
     :status==='HELD'?'KUDOS đang chờ Admin duyệt. Người nhận sẽ nhận email thông báo sau khi Admin duyệt.'
     :k.visibility==='public'?'Admin đã duyệt CỘNG ĐỒNG KUDOS. Lời ghi nhận đang hiển thị công khai với danh tính người gửi.'
     :`Admin đã duyệt. Lời ghi nhận được gửi riêng cho ${escapeHtml(k.recipientName)}.`;
   senderBlock=`<div class="kd-panel"><h3>Trạng thái</h3><p class="kd-sender-status">${s}</p></div>`+(k.needsImprovement?qualityNoticeHtml(k):'');
 }
 const replyBlock=isRecipient?(k.canReply||(k.replies||[]).length?replyThreadHtml(k,true):''):isSender&&(k.replies||[]).length?replyThreadHtml(k,false):'';
 const shareBlock=isRecipient&&k.canShareToCommunity?`<div class="kd-panel kd-share-panel"><h3>${k.sharedByRecipient?'Đang hiển thị trên CỘNG ĐỒNG KUDOS':'Lan tỏa niềm vui này?'}</h3><p>${k.sharedByRecipient?'Mọi người trong Ahamove đang cùng chúc mừng bạn. Bạn có thể chuyển về Riêng tư bất cứ lúc nào.':'AHAKUDOS này đang ở chế độ riêng tư. Bạn có thể chia sẻ lên CỘNG ĐỒNG KUDOS để đồng nghiệp cùng chúc mừng.'}</p><button class="btn ${k.sharedByRecipient?'secondary':'primary'}" data-share-community="${escapeHtml(k.id)}" data-share="${k.sharedByRecipient?'0':'1'}">${k.sharedByRecipient?'Chuyển về Riêng tư':'Chia sẻ đến CỘNG ĐỒNG KUDOS →'}</button></div>`:'';
 const backTarget=isSender&&!isRecipient?'kudos-profile':(k.isCommunity&&!isRecipient?'public-feed':'employee-home');
 const kicker=isRecipient?'KUDOS DÀNH CHO BẠN':isSender?'KUDOS BẠN ĐÃ GỬI':'CỘNG ĐỒNG KUDOS';
 const title=isRecipient&&k.welcome?'Lời nhắn từ AHAKUDOS 💌':isRecipient?'Có một lời ghi nhận dành riêng cho bạn 🧡':isSender?'Lời ghi nhận bạn đã gửi':'Một lời ghi nhận đang được lan tỏa';
 const sub=isRecipient&&k.welcome?'Gửi đến bạn nhân ngày gia nhập Ahamove.':isRecipient&&k.source==='ADMIN'?'AHAKUDOS gửi đến bạn lời ghi nhận nhân dịp đặc biệt này.':isRecipient?'Một đồng đội đã nhìn thấy điều bạn làm và muốn gửi đến bạn lời ghi nhận này.':isSender?'Đây là lời ghi nhận bạn đã gửi (trên background đã chọn).':'Lời ghi nhận đã được Admin duyệt cho CỘNG ĐỒNG KUDOS.';
 return `<section class="page active kudos-detail-page">
   <button class="kd-back" data-page="${backTarget}">← ${backTarget==='kudos-profile'?'Về Hồ sơ':backTarget==='public-feed'?'Về Cộng đồng':'Về trang chủ'}</button>
   <div class="page-head"><div><div class="kicker">${kicker}</div><h1>${title}</h1><p class="page-sub">${sub}</p></div></div>
   ${buildKudosCard(k,{mode:isRecipient?'':'public'})}
   <div class="kd-panel"><div class="kd-row">${emailStatusPill}${visPill}</div>${isRecipient?'<div class="kd-save-note"><span>💾</span><div>Lời ghi nhận này được <b>tự động lưu</b> trong Hồ sơ KUDOS của bạn — không cần bấm "Lưu". Bạn có thể mở lại bất cứ lúc nào.</div></div>':''}</div>
   ${senderBlock}${shareBlock}${replyBlock}
 </section>`;
}

// ---- Admin (giữ nguyên) ----------------------------------------------------
// ---- Dashboard dữ liệu thật + lọc ngày + export CSV (feedback #4) ----
let dashFrom='',dashTo='',dashDept='';
// Dates in reports are Vietnam dates (createdAt is stored in UTC).
function vnDay(v){const d=v instanceof Date?v:new Date(v||0);if(!isFinite(d.getTime()))return '';return new Date(d.getTime()+7*3600000).toISOString().slice(0,10);}
function isApproved(k){return modStatusOf(k)==='APPROVED';}
function dashFiltered(){return (ADMIN.records||[]).filter(r=>{const d=vnDay(r.createdAt);if(dashFrom&&d<dashFrom)return false;if(dashTo&&d>dashTo)return false;return true;});}
function dashScoped(){return dashFiltered().filter(r=>!dashDept||r.recipientDept===dashDept);}
let dashValue='';
function deptOptions(){var set={};PEOPLE.forEach(p=>{if(p.dept)set[p.dept]=1;});(ADMIN.records||[]).forEach(r=>{if(r.recipientDept)set[r.recipientDept]=1;});return Object.keys(set).sort();}
// Thanh lọc dùng chung: ngày (preset + tùy chọn) + phòng ban + xuất CSV. exportKey: 'kudos'|'dept'|'culture'.
function filterBar(exportKey){
 const opts=deptOptions().map(d=>`<option value="${escapeHtml(d)}" ${dashDept===d?'selected':''}>${escapeHtml(d)}</option>`).join('');
 const valueSel=exportKey==='people'?`<select id="dash-value" class="select" aria-label="Lọc theo giá trị cốt lõi"><option value="">Tất cả giá trị cốt lõi</option>${VALUE_IDS.map(v=>`<option value="${v}" ${dashValue===v?'selected':''}>${CULTURE[v]}</option>`).join('')}</select>`:'';
 return `<style>
   .dash-filter{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:6px 0 0}
   .dash-presets{display:flex;gap:6px;flex-wrap:wrap}
   .chip-btn{border:1px solid var(--line);background:#fff;color:var(--navy);border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer}
   .chip-btn:hover{border-color:#BCD3EA}
   .dash-range{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
   .dash-range .input,.dash-range .select{height:40px;width:auto}
   @media(max-width:820px){.dash-filter{flex-direction:column;align-items:stretch}.dash-range{flex-wrap:wrap}}
  </style>
  <div class="dash-filter">
   <div class="dash-presets">
     <button class="chip-btn" data-dash-preset="7">7 ngày</button>
     <button class="chip-btn" data-dash-preset="30">30 ngày</button>
     <button class="chip-btn" data-dash-preset="month">Tháng này</button>
     <button class="chip-btn" data-dash-preset="all">Tất cả</button>
   </div>
   <div class="dash-range">
     <input id="dash-from" class="input" type="date" value="${dashFrom}"><span>→</span><input id="dash-to" class="input" type="date" value="${dashTo}">
     <select id="dash-dept" class="select" aria-label="Lọc theo phòng ban"><option value="">Tất cả phòng ban</option>${opts}</select>${valueSel}
     <button class="btn secondary" id="dash-apply">Lọc</button>
     <button class="btn primary" data-export="${exportKey}">⬇ Xuất CSV</button>
   </div>
  </div>`;
}
function deptAgg(recs){
 const CULT=CULTURE;
 const m={};recs.forEach(r=>{const d=r.recipientDept||'—';if(!m[d])m[d]={dept:d,received:0,senders:{},receivers:{},cult:zeroValues()};const o=m[d];o.received++;if(r.senderEmail)o.senders[r.senderEmail]=1;if(r.recipientEmail)o.receivers[r.recipientEmail]=1;(r.values||[]).forEach(v=>{if(o.cult[v]!=null)o.cult[v]++;});});
 return Object.keys(m).map(k=>{const o=m[k];const top=Object.keys(o.cult).sort((a,b)=>o.cult[b]-o.cult[a])[0];return {dept:o.dept,received:o.received,senders:Object.keys(o.senders).length,receivers:Object.keys(o.receivers).length,topCult:o.received&&o.cult[top]?CULT[top]:'—'};}).sort((a,b)=>b.received-a.received);
}
function csvEsc(v){const s=String(v==null?'':v).replace(/"/g,'""');return /[",\n\r]/.test(s)?`"${s}"`:s;}
function downloadCsv(lines,prefix){try{const csv='﻿'+lines.join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=prefix+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},600);toast('Đã xuất CSV ('+(lines.length-1)+' dòng).');}catch(e){toast('Không xuất được CSV: '+e.message);}}
function deptExportCsv(){const agg=deptAgg(dashScoped().filter(isApproved));const head=['Phong_ban','KUDOS_nhan','Nguoi_gui','Nguoi_nhan','Gia_tri_noi_bat'];const lines=[head.join(',')];agg.forEach(a=>lines.push([a.dept,a.received,a.senders,a.receivers,a.topCult].map(csvEsc).join(',')));downloadCsv(lines,'ahakudos_phongban_');}
function cultureExportCsv(){const recs=dashScoped().filter(isApproved);const deptSet=[];recs.forEach(r=>{if(r.recipientDept&&deptSet.indexOf(r.recipientDept)<0)deptSet.push(r.recipientDept);});const head=['Phong_ban'].concat(VALUE_IDS.map(v=>asciiLabel(CULTURE[v]).replace(/\W+/g,'_')));const lines=[head.join(',')];deptSet.forEach(d=>{const rr=recs.filter(x=>x.recipientDept===d);const c=zeroValues();rr.forEach(x=>(x.values||[]).forEach(v=>{if(c[v]!=null)c[v]++;}));lines.push([d].concat(VALUE_IDS.map(v=>c[v])).map(csvEsc).join(','));});downloadCsv(lines,'ahakudos_giatri_');}
function adminDataDashboard(){
 const recs=dashScoped();
 const uniq=(a)=>Array.from(new Set(a.filter(Boolean))).length;
 const senders=uniq(recs.map(r=>r.senderEmail));
 const receivers=uniq(recs.map(r=>r.recipientEmail));
 const sent=recs.filter(r=>r.email&&r.email.status==='SENT').length;
 const held=recs.filter(r=>modStatusOf(r)==='HELD').length;
 const pub=recs.filter(r=>r.visibility==='public'&&r.publicConsent==='approved').length;
 const CULT=CULTURE;
 const ok=recs.filter(isApproved); // charts count approved KUDOS only
 const cultCount=zeroValues();ok.forEach(r=>(r.values||[]).forEach(v=>{if(cultCount[v]!=null)cultCount[v]++;}));
 const deptCount={};ok.forEach(r=>{const d=r.recipientDept||'—';deptCount[d]=(deptCount[d]||0)+1;});
 const deptTop=Object.entries(deptCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
 const maxDept=Math.max(1,...deptTop.map(d=>d[1]));
 const maxCult=Math.max(1,...VALUE_IDS.map(v=>cultCount[v]));
 const tile=(ic,label,val,sub)=>`<article class="metric"><div class="metric-icon">${ic}</div><span>${label}</span><strong>${val}</strong><em>${sub||''}</em></article>`;
 const rangeLabel=(dashFrom||dashTo)?`${dashFrom||'…'} → ${dashTo||'…'}`:'toàn bộ';
 return `<article class="card admin-card" style="padding:18px;margin-bottom:14px">
   <style>
    .dash-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
    .dash-col h4{margin:0 0 10px;font-size:14px;color:var(--navy)}
    .dash-bar-row{display:grid;grid-template-columns:minmax(120px,1.4fr) 2fr auto;gap:10px;align-items:center;margin-bottom:9px;font-size:13px;color:var(--text)}
    .dash-bar{height:9px;background:#EDF2F7;border-radius:999px;overflow:hidden}
    .dash-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--orange),#FFB55E)}
    .dash-bar-row b{color:var(--navy)}
    @media(max-width:820px){.dash-breakdown{grid-template-columns:1fr}}
   </style>
   <div class="card-head"><div><div class="kicker">DỮ LIỆU THẬT · TỪ GOOGLE SHEET</div><h3>Tổng quan KUDOS</h3><div class="sub">Lọc theo thời gian tạo KUDOS (${rangeLabel})${dashDept?(' · '+escapeHtml(dashDept)):''}. Ô số liệu tính mọi KUDOS; biểu đồ tính KUDOS đã duyệt. Xuất CSV để làm báo cáo.</div></div></div>
   ${filterBar('kudos')}
   <div class="metric-grid" style="margin-top:14px">
     ${tile('⌘','Tổng KUDOS',recs.length,rangeLabel==='toàn bộ'?'toàn bộ':'trong khoảng')}
     ${tile('👥','Người gửi',senders,'khác nhau')}
     ${tile('★','Người nhận',receivers,'khác nhau')}
     ${tile('✉','Đã gửi email',sent,'SENT')}
     ${tile('△','Chờ duyệt',held,'kiểm duyệt')}
     ${tile('◎','Công khai',pub,'đã duyệt')}
   </div>
   <div class="dash-breakdown">
     <div class="dash-col"><h4>Theo giá trị cốt lõi</h4>${VALUE_IDS.map(k=>`<div class="dash-bar-row"><span>${CULT[k]}</span><div class="dash-bar"><i style="width:${Math.round(cultCount[k]/maxCult*100)}%"></i></div><b>${cultCount[k]}</b></div>`).join('')}</div>
     <div class="dash-col"><h4>Theo phòng ban (nhận nhiều nhất)</h4>${deptTop.length?deptTop.map(([d,c])=>`<div class="dash-bar-row"><span>${escapeHtml(d)}</span><div class="dash-bar"><i style="width:${Math.round(c/maxDept*100)}%"></i></div><b>${c}</b></div>`).join(''):'<p class="sub">Chưa có dữ liệu trong khoảng lọc.</p>'}</div>
   </div>
 </article>`;
}
function dashExportCsv(){
 const recs=dashScoped();
 const CULT={};Object.keys(LEGACY_CULTURE).concat(VALUE_IDS).forEach(v=>CULT[v]=asciiLabel(valueLabel(v)));
 const head=['Thoi_gian_tao','Nguoi_gui','Phong_ban_gui','Nguoi_nhan','Phong_ban_nhan','Gia_tri_van_hoa','Pham_vi','Duyet_cong_khai','Kiem_duyet','Email','Noi_dung'];
 const esc=(v)=>{const s=String(v==null?'':v).replace(/"/g,'""');return /[",\n\r]/.test(s)?`"${s}"`:s;};
 const lines=[head.join(',')];
 recs.forEach(r=>{lines.push([r.createdAt||'',r.senderName||'',r.senderDept||'',r.recipientName||'',r.recipientDept||'',(r.values||[]).map(v=>CULT[v]||v).join(' | '),r.visibility||'',r.publicConsent||'',modStatusOf(r),(r.email&&r.email.status)||'AWAITING_APPROVAL',String(r.message||'').replace(/\r?\n/g,' ')].map(esc).join(','));});
 const csv='﻿'+lines.join('\r\n');
 try{
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ahakudos_export_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},600);
  toast('Đã xuất '+recs.length+' KUDOS ra CSV.');
 }catch(e){toast('Không xuất được CSV: '+e.message);}
}
function bindAdminFilters(){
 document.querySelectorAll('[data-dash-preset]').forEach(b=>b.addEventListener('click',()=>{
   const p=b.dataset.dashPreset,today=vnDay(new Date());
   if(p==='all'){dashFrom='';dashTo='';}
   else if(p==='month'){dashFrom=today.slice(0,8)+'01';dashTo=today;}
   else{const days=parseInt(p,10);dashFrom=vnDay(new Date(Date.now()-(days-1)*86400000));dashTo=today;}
   render();
 }));
 const apply=document.querySelector('#dash-apply');if(apply)apply.addEventListener('click',()=>{dashFrom=(document.querySelector('#dash-from').value||'');dashTo=(document.querySelector('#dash-to').value||'');const ds=document.querySelector('#dash-dept');if(ds)dashDept=ds.value;const dv=document.querySelector('#dash-value');if(dv)dashValue=dv.value;render();});
 const dv=document.querySelector('#dash-value');if(dv)dv.addEventListener('change',()=>{dashValue=dv.value;render();});
 const ds=document.querySelector('#dash-dept');if(ds)ds.addEventListener('change',()=>{dashDept=ds.value;render();});
 document.querySelectorAll('[data-export]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.export;if(k==='people'){if(adminPerson)personExportCsv(adminPerson);else peopleExportCsv();}else if(k==='dept')deptExportCsv();else if(k==='culture')cultureExportCsv();else dashExportCsv();}));
}
function adminHome(){
 const gate=adminGate();if(gate)return gate;
 const recs=ADMIN.records;
 const agg=deptAgg(recs.filter(isApproved)).slice(0,6);
 const maxR=Math.max(1,...agg.map(a=>a.received));
 const held=recs.filter(k=>modStatusOf(k)==='HELD');
 const cnt=zeroValues();recs.filter(isApproved).forEach(r=>(r.values||[]).forEach(v=>{if(cnt[v]!=null)cnt[v]++;}));
 const totalV=VALUE_IDS.reduce((a,v)=>a+cnt[v],0)||1;
 const up=ADMIN.upcoming||{birthdays:[],anniversaries:[]};
 const emailFailed=recs.filter(k=>k.email&&k.email.status==='FAILED').length;
 const emailPending=recs.filter(k=>k.email&&k.email.status==='PENDING').length;
 const mi=(ADMIN.master&&ADMIN.master.issues)||{};
 const masterWarn=ADMIN.master&&(mi.missingTab||(mi.missingRequired||[]).length||mi.skippedNoEmail||mi.skippedNoName||mi.invalidEmail||(mi.duplicates||[]).length)
   ?`<div class="ops-note" role="status">⚠ Master Data: ${escapeHtml([mi.missingTab?'thiếu tab DATA':'',(mi.missingRequired||[]).length?'thiếu cột '+mi.missingRequired.join(', '):'',mi.skippedNoEmail?mi.skippedNoEmail+' dòng thiếu Work Email':'',mi.skippedNoName?mi.skippedNoName+' dòng thiếu Full Name':'',mi.invalidEmail?mi.invalidEmail+' email sai định dạng':'',(mi.duplicates||[]).length?(mi.duplicates.length+' email trùng'):''].filter(Boolean).join(' · '))}. Các dòng này được bỏ qua.</div>`:'';
 return `<section class="page active">
 <div class="admin-head"><div class="admin-logo-chip">${logo(true)}</div><div><h1>Trung tâm quản trị</h1><p>Không gian vận hành AHAKUDOS toàn công ty.</p></div></div>
 <div class="page-head"><div><div class="kicker">PROGRAM CONTROL</div><h1>Tổng quan AHAKUDOS</h1><p class="page-sub">Ghi nhận · Chất lượng · AHAKUDOS từ Admin · Sinh nhật & Thâm niên · Giá trị cốt lõi</p></div><button class="btn primary" data-page="admin-recognition">+ Gửi AHAKUDOS</button></div>
 ${masterWarn}
 ${adminDataDashboard()}
 <div class="admin-grid">
  <article class="card admin-card"><div class="card-head"><div><div class="kicker">PHÒNG BAN</div><h3>Mức độ được ghi nhận</h3><div class="sub">Theo số KUDOS đã duyệt mà phòng ban nhận được.</div></div><button class="link-btn" data-page="admin-dept">Chi tiết →</button></div>
   <div class="table-wrap"><table><thead><tr><th>Phòng ban</th><th>KUDOS nhận</th><th>Người gửi</th><th>Người nhận</th></tr></thead><tbody>${agg.length?agg.map(a=>`<tr><td>${escapeHtml(a.dept)}</td><td><span class="bar"><i style="width:${Math.round(a.received/maxR*100)}%"></i></span>${a.received}</td><td>${a.senders}</td><td>${a.receivers}</td></tr>`).join(''):'<tr><td colspan="4" style="color:var(--muted);padding:14px">Chưa có dữ liệu.</td></tr>'}</tbody></table></div>
  </article>
  <article class="card admin-card"><div class="card-head"><div><div class="kicker">HÀNG CHỜ</div><h3>Nội dung cần duyệt (${held.length})</h3></div><button class="link-btn" data-page="admin-quality">Xem tất cả →</button></div>
   <div class="review-list">${held.slice(0,3).map(k=>`<div class="review-row">${miniAvatar(k.senderEmail,k.senderName)}<div><b>${escapeHtml(k.senderName||'')}</b><p>${escapeHtml(String(k.message||'').slice(0,90))}${String(k.message||'').length>90?'…':''}</p></div><span class="flag">${escapeHtml(modReasonsTextClient((k.moderation&&k.moderation.reasons||[]).filter(r=>r!=='admin_review'))[0]||'Chờ duyệt')}</span></div>`).join('')||'<p class="sub">Không có KUDOS nào đang chờ duyệt.</p>'}</div>
  </article>
  <article class="card admin-card"><div class="card-head"><div><div class="kicker">GIÁ TRỊ CỐT LÕI</div><h3>Đang được ghi nhận</h3></div><button class="link-btn" data-page="admin-culture">Chi tiết →</button></div>
   <div class="culture-bars">${VALUE_IDS.map(v=>`<div class="culture-item"><div class="culture-bar-head"><span>${CULTURE[v]}</span><b>${Math.round(cnt[v]/totalV*100)}%</b></div><div class="culture-line"><i style="width:${Math.round(cnt[v]/totalV*100)}%"></i></div></div>`).join('')}</div>
  </article>
  <article class="card admin-card"><div class="card-head"><div><div class="kicker">MASTER DATA · 30 NGÀY TỚI</div><h3>Sinh nhật, Thâm niên & Email</h3></div><button class="link-btn" data-page="admin-ops">Chi tiết →</button></div>
   <div class="ops-row"><b>Sinh nhật</b><strong>${up.birthdays.length}</strong><span>trong ${up.windowDays||30} ngày tới</span></div>
   <div class="ops-row"><b>Thâm niên</b><strong>${up.anniversaries.length}</strong><span>kỷ niệm năm làm việc</span></div>
   <div class="ops-row"><b>Email</b><strong>${emailPending}</strong><span>chờ gửi · ${emailFailed} lỗi cần xử lý</span></div>
  </article>
 </div>
</section>`;
}
function adminDept(){
 const gate=adminGate();if(gate)return gate;
 const recs=dashScoped().filter(isApproved);
 const agg=deptAgg(recs);
 const maxR=Math.max(1,...agg.map(a=>a.received));
 const rows=agg.length?agg.map(a=>`<tr><td>${escapeHtml(a.dept)}</td><td><span class="bar"><i style="width:${Math.round(a.received/maxR*100)}%"></i></span>${a.received}</td><td>${a.senders}</td><td>${a.receivers}</td><td>${escapeHtml(a.topCult)}</td></tr>`).join(''):`<tr><td colspan="5" style="color:var(--muted);padding:14px">Chưa có dữ liệu trong khoảng lọc.</td></tr>`;
 return `<section class="page active">
   <div class="page-head"><div><div class="kicker">THEO PHÒNG BAN</div><h1>Mức độ ghi nhận & tham gia</h1><p class="page-sub">Chỉ tính KUDOS đã được Admin duyệt. Lọc theo thời gian / phòng ban và xuất CSV để báo cáo.</p></div></div>
   ${filterBar('dept')}
   <article class="card admin-card" style="padding:16px 18px;margin-top:14px"><div class="table-wrap"><table>
     <thead><tr><th>Phòng ban</th><th>KUDOS nhận</th><th>Người gửi</th><th>Người nhận</th><th>Giá trị nổi bật</th></tr></thead>
     <tbody>${rows}</tbody></table></div></article>
 </section>`;
}
function adminCulture(){
 const gate=adminGate();if(gate)return gate;
 const recs=dashScoped().filter(isApproved);
 const CULT=CULTURE;
 const cnt=zeroValues();recs.forEach(r=>(r.values||[]).forEach(v=>{if(cnt[v]!=null)cnt[v]++;}));
 const total=VALUE_IDS.reduce((a,v)=>a+cnt[v],0)||1;
 const bars=VALUE_IDS.map(k=>`<div class="culture-item"><div class="culture-bar-head"><b>${CULT[k]}</b><span>${cnt[k]} · ${Math.round(cnt[k]/total*100)}%</span></div><div class="culture-line"><i style="width:${Math.round(cnt[k]/total*100)}%"></i></div></div>`).join('');
 const deptSet=[];recs.forEach(r=>{if(r.recipientDept&&deptSet.indexOf(r.recipientDept)<0)deptSet.push(r.recipientDept);});
 const rows=deptSet.length?deptSet.map(d=>{const rr=recs.filter(x=>x.recipientDept===d);const c=zeroValues();rr.forEach(x=>(x.values||[]).forEach(v=>{if(c[v]!=null)c[v]++;}));return `<tr><td>${escapeHtml(d)}</td>${VALUE_IDS.map(v=>`<td>${c[v]}</td>`).join('')}</tr>`;}).join(''):`<tr><td colspan="4" style="color:var(--muted);padding:14px">Chưa có dữ liệu trong khoảng lọc.</td></tr>`;
 return `<section class="page active">
   <div class="page-head"><div><div class="kicker">DỮ LIỆU GIÁ TRỊ CỐT LÕI</div><h1>Giá trị cốt lõi đang được thể hiện</h1><p class="page-sub">Chỉ tính KUDOS đã được Admin duyệt (theo lượt chọn giá trị). Lọc theo thời gian / phòng ban và xuất CSV.</p></div></div>
   ${filterBar('culture')}
   <article class="card admin-card" style="padding:16px 18px;margin-top:14px"><div class="card-head"><div><div class="kicker">TỶ TRỌNG</div><h3>Toàn công ty</h3></div></div><div class="culture-bars">${bars}</div></article>
   <article class="card admin-card" style="padding:16px 18px;margin-top:14px"><div class="card-head"><div><div class="kicker">THEO PHÒNG BAN</div><h3>Lượt giá trị theo phòng ban</h3></div></div><div class="table-wrap"><table><thead><tr><th>Phòng ban</th>${VALUE_IDS.map(v=>`<th>${CULTURE[v]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></article>
 </section>`;
}

let modFilter='HELD';const modTags=new Set();const modSelected=new Set(); // tag filter (any of) + KUDOS selected for bulk tagging
const MOD_TAGS={ok:{label:'Đạt chất lượng',icon:'✓',tone:'ok',hint:'Nội dung rõ ràng, đủ ý, có thể duyệt.'},needs_content:{label:'Cần bổ sung nội dung',icon:'✎',tone:'violet',hint:'Quá ngắn, vô nghĩa, thiếu chi tiết hoặc chưa đủ chất lượng.'},language:{label:'Ngôn ngữ không phù hợp',icon:'⊘',tone:'red',hint:'Từ ngữ nhạy cảm, thiếu phù hợp hoặc có tính công kích.'},repeat:{label:'Nội dung trùng / gửi lặp',icon:'⟳',tone:'amber',hint:'Trùng nội dung, gửi lặp cho cùng người, gửi liên tục trong thời gian ngắn.'},check_info:{label:'Có thông tin cần kiểm tra',icon:'⌕',tone:'blue',hint:'Chứa SĐT, email, link hoặc nội dung cần xem kỹ trước khi public.'}};
function tagsOf(k){return Array.isArray(k.tags)?k.tags.filter(t=>MOD_TAGS[t]):[];}
function tagChip(t,k){const d=MOD_TAGS[t];const why=k&&k.tagDetails&&k.tagDetails[t]?k.tagDetails[t]:[];return `<span class="mod-tag mod-tag--${d.tone}" title="${escapeHtml(why.length?why.join(' · '):d.hint)}"><i aria-hidden="true">${d.icon}</i>${escapeHtml(d.label)}${why.length&&t!=='ok'?`<small>· ${escapeHtml(why.join(' · '))}</small>`:''}</span>`;}
function adminQuality(){
 const gate=adminGate();if(gate)return gate;
 const held=ADMIN.records.filter(k=>modStatusOf(k)==='HELD');
 const hidden=ADMIN.records.filter(k=>modStatusOf(k)==='HIDDEN');
 const approved=ADMIN.records.filter(k=>modStatusOf(k)==='APPROVED');
 const card=(k)=>{
  const tags=tagsOf(k);
  return `<div class="mod-item" data-mod-row="${escapeHtml(k.id)}">
    <div class="mod-item-head">
      <input type="checkbox" class="mod-select" data-mod-select="${escapeHtml(k.id)}" ${modSelected.has(k.id)?'checked':''} aria-label="Chọn KUDOS này">
      ${miniAvatar(k.senderEmail,k.senderName)}
      <div class="mod-item-who"><b>${escapeHtml(k.senderName||'Đồng nghiệp')}</b><span>${escapeHtml(k.senderDept||'')} → ${escapeHtml(k.recipientName||'')}${k.kudosType&&k.kudosType!=='recognition'?' · '+escapeHtml(kudosTypeLabel(k.kudosType,k)):''}</span></div>
      <span class="mod-flag">${({HELD:'Chờ Admin duyệt',APPROVED:'Đã duyệt',HIDDEN:'Đã ẩn'})[modStatusOf(k)]||''}${k.sentAtLabel?' · '+escapeHtml(k.sentAtLabel):''}</span>
    </div>
    <div class="mod-reasons">${tags.map(t=>tagChip(t,k)).join('')}</div><div class="mod-scope-control"><span>Phạm vi:</span><button class="btn secondary ${k.visibility==='private'?'active':''}" data-mod-scope="private" data-kid="${k.id}">Riêng tư</button><button class="btn secondary ${k.visibility==='public'?'active':''}" data-mod-scope="public" data-kid="${k.id}">CỘNG ĐỒNG KUDOS</button></div>
    <div class="mod-msg">${escapeHtml(k.message||'').replace(/\r?\n/g,'<br>')}</div>
    ${modStatusOf(k)==='HIDDEN'&&k.moderation&&k.moderation.hiddenReason?`<div class="mod-reasons"><span class="mod-reason-chip">Lý do ẩn: ${escapeHtml(k.moderation.hiddenReason)}</span></div>`:''}
    <div class="mod-actions">
      <button class="btn secondary" data-mod-tagedit="${k.id}">🏷 Gắn tag</button><button class="btn secondary" data-mod-detail="${k.id}">Xem chi tiết KUDOS</button><button class="btn secondary" data-mod-preview="${k.id}">Xem email</button>
      ${modStatusOf(k)!=='APPROVED'?`<button class="btn secondary" data-mod-edit="${k.id}">Sửa</button>`:''}
      ${modStatusOf(k)==='HELD'&&k.source!=='ADMIN'&&tags.includes('needs_content')?`<button class="btn secondary" data-mod-return="${k.id}" title="Ẩn và mời người gửi bổ sung chi tiết">Trả lại để bổ sung</button>`:''}
      ${modStatusOf(k)!=='HIDDEN'?`<button class="btn danger" data-mod-hide="${k.id}">Ẩn</button>`:''}
      ${modStatusOf(k)==='HELD'?`<button class="btn primary" data-mod-approve="${k.id}">Duyệt & gửi</button>`:modStatusOf(k)==='HIDDEN'?`<button class="btn primary" data-mod-approve="${k.id}">Duyệt lại</button>`:''}
    </div>
  </div>`;
 };
 const lists={HELD:held,APPROVED:approved,HIDDEN:hidden};
 const base=lists[modFilter]||held;
 const tagCount=t=>base.filter(k=>tagsOf(k).includes(t)).length;
 const shown=!modTags.size?base:base.filter(k=>{const t=tagsOf(k);return [...modTags].some(x=>t.includes(x));});
 [...modSelected].forEach(id=>{if(!shown.some(k=>k.id===id))modSelected.delete(id);});
 const tagBar=`<div class="mod-tagbar" role="group" aria-label="Lọc theo tag tự động"><span class="mod-tagbar-title">✦ Tag duyệt nội dung</span>
  <button type="button" class="mod-tagfilter ${!modTags.size?'active':''}" data-mod-tag="" aria-pressed="${!modTags.size}">Tất cả <b>${base.length}</b></button>
  ${Object.keys(MOD_TAGS).map(t=>{const n=tagCount(t);return `<button type="button" class="mod-tagfilter mod-tag--${MOD_TAGS[t].tone} ${modTags.has(t)?'active':''}" data-mod-tag="${t}" aria-pressed="${modTags.has(t)}" ${n?'':'disabled'}><i aria-hidden="true">${MOD_TAGS[t].icon}</i>${escapeHtml(MOD_TAGS[t].label)} <b>${n}</b></button>`;}).join('')}
  <p class="mod-tagbar-note">Chọn nhiều tag cùng lúc để lọc (hiện KUDOS có bất kỳ tag nào đã chọn). Hệ thống tự gắn tag theo quy tắc ngay trong Google Apps Script (nội dung không gửi ra dịch vụ bên ngoài). Tag chỉ giúp lọc và ưu tiên — Admin vẫn là người quyết định.</p></div>`;
 const emptyText={HELD:'Không có KUDOS nào chờ duyệt. Khi Admin duyệt, email mới được gửi và CỘNG ĐỒNG KUDOS mới được publish.',APPROVED:'Chưa có KUDOS nào được duyệt.',HIDDEN:'Không có KUDOS nào bị ẩn.'}[modFilter];
 const heldHtml=shown.length?shown.slice(0,200).map(card).join(''):`<div class="empty"><div class="icon">✅</div><h3>Không có mục nào</h3><p>${emptyText}</p></div>`;
 return `<section class="page active">
  <style>
   .mod-stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
   .mod-stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;box-shadow:var(--shadow)}
   .mod-stat span{font-size:13px;color:var(--muted)}.mod-stat strong{display:block;font-size:22px;color:var(--navy);margin-top:6px}
   .mod-list{display:grid;gap:12px;margin-top:12px}
   .mod-item{border:1px solid #F0D8C6;background:#FFFCF9;border-radius:16px;padding:14px}
   .mod-item-head{display:flex;align-items:center;gap:10px}
   .mod-item-who{flex:1;min-width:0}.mod-item-who b{font-size:14px;color:var(--navy)}.mod-item-who span{display:block;font-size:12px;color:var(--muted);margin-top:2px}
   .mod-flag{background:var(--amber-soft,#FFF4E3);color:#A5751E;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap}
   .mod-reasons{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
   .mod-reason-chip{background:#FDECEC;color:#C0392B;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:600}
   .mod-msg{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.7;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
   .mod-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:flex-end}
   .mod-actions .btn{padding:9px 14px;font-size:13px}
   .mod-scope-control{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0}.mod-scope-control>span{font-size:12px;font-weight:800;color:var(--muted)}.mod-scope-control .btn{padding:6px 10px;font-size:12px}.mod-scope-control .btn.active{background:#EAF2FB;border-color:#9BC4EA;color:#0E4174}
   @media(max-width:640px){.mod-stat-row{grid-template-columns:1fr 1fr}.mod-actions{justify-content:stretch}.mod-actions .btn{flex:1}.mod-item-head{flex-wrap:wrap}.mod-flag{flex-basis:100%;white-space:normal;text-align:center}}
  
</style>
  ${bannerHero('ai_review')}
  <div class="page-head"><div><div class="kicker">ADMIN CONTROL</div><h1>Admin duyệt toàn bộ KUDOS</h1><p class="page-sub">Mọi KUDOS đều được giữ tại đây trước khi gửi email. Admin có thể xem chi tiết, chỉnh nội dung, chọn Riêng tư hoặc CỘNG ĐỒNG KUDOS, rồi mới Duyệt & gửi.</p></div></div>
  <div class="mod-stat-row" role="tablist" aria-label="Lọc theo trạng thái">
   ${[['HELD','Chờ duyệt',held.length],['APPROVED','Đã duyệt',approved.length],['HIDDEN','Đã ẩn',hidden.length]].map(([id,label,n])=>`<button type="button" role="tab" aria-selected="${modFilter===id}" class="mod-stat mod-stat-tab ${modFilter===id?'active':''}" data-mod-filter="${id}"><span>${label}</span><strong>${n}</strong></button>`).join('')}
  </div>
  <article class="card admin-card" style="padding:16px 18px"><div class="card-head"><div><div class="kicker">${({HELD:'HÀNG CHỜ',APPROVED:'ĐÃ DUYỆT',HIDDEN:'ĐÃ ẨN'})[modFilter]}</div><h3>${({HELD:'Chờ duyệt',APPROVED:'Đã duyệt',HIDDEN:'Đã ẩn'})[modFilter]} (${shown.length})</h3>${shown.length>200?'<div class="sub">Hiển thị 200 KUDOS mới nhất.</div>':''}</div></div>
   ${tagBar}
   <div class="mod-bulkbar ${modSelected.size?'':'is-empty'}"><label><input type="checkbox" data-mod-select-all ${shown.length&&shown.slice(0,200).every(k=>modSelected.has(k.id))?'checked':''}> Chọn tất cả (${Math.min(shown.length,200)})</label><span>${modSelected.size?`Đã chọn <b>${modSelected.size}</b> KUDOS`:'Tick ô ở từng KUDOS để gắn tag hàng loạt'}</span><button type="button" class="btn secondary" data-mod-bulk-tag ${modSelected.size?'':'disabled'}>🏷 Gắn tag cho mục đã chọn</button></div>
   <div class="mod-list">${heldHtml}</div>
  </article>
 </section>`;
}
// Gắn nhiều tag cùng lúc cho 1 hoặc nhiều KUDOS. Tag tự động hiện sẵn (không bỏ được); tag thủ công lưu vào KUDOS.
function openTagEditor(ids){
 const recs=ids.map(adminRecordById).filter(Boolean);if(!recs.length)return;
 const single=recs.length===1,k=recs[0];
 const manual=single?new Set(k.manualTags||[]):new Set();
 const auto=single?new Set(tagsOf(k).filter(t=>t!=='ok'&&!(k.manualTags||[]).includes(t))):new Set();
 const root=document.querySelector('#modal-root');
 root.innerHTML=`<div class="modal-backdrop"><div class="modal tag-editor-modal" role="dialog" aria-modal="true" aria-labelledby="tag-editor-title"><button class="modal-close" data-tag-close aria-label="Đóng">×</button>
  <div class="kicker">GẮN TAG</div><h2 id="tag-editor-title">${single?'Gắn tag cho KUDOS của '+escapeHtml(k.senderName||''):'Gắn tag cho '+recs.length+' KUDOS'}</h2>
  <p class="sub">${single?'Chọn một hoặc nhiều tag. Tag có nhãn “tự động” do hệ thống gắn. Chọn “Đạt chất lượng” để xác nhận KUDOS ổn dù hệ thống có cảnh báo.':'Các tag đã chọn sẽ được <b>thêm</b> vào tất cả KUDOS đã chọn (giữ nguyên tag hiện có).'}</p>
  <div class="tag-editor-list">${Object.keys(MOD_TAGS).map(t=>`<label class="tag-editor-item mod-tag--${MOD_TAGS[t].tone}"><input type="checkbox" value="${t}" ${manual.has(t)||auto.has(t)?'checked':''} ${auto.has(t)?'disabled':''}><i aria-hidden="true">${MOD_TAGS[t].icon}</i><span><b>${escapeHtml(MOD_TAGS[t].label)}</b><small>${escapeHtml(single&&k.tagDetails&&k.tagDetails[t]&&auto.has(t)?k.tagDetails[t].join(' · '):MOD_TAGS[t].hint)}</small></span>${auto.has(t)?'<em>tự động</em>':''}</label>`).join('')}</div>
  <div class="kudos-success-actions"><button class="btn secondary" data-tag-close>Huỷ</button><button class="btn primary" data-tag-save>Lưu tag</button></div></div></div>`;
 const close=()=>root.innerHTML='';
 root.querySelectorAll('[data-tag-close]').forEach(b=>b.addEventListener('click',close));
 root.querySelector('[data-tag-save]').addEventListener('click',async e=>{
  const picked=[...root.querySelectorAll('.tag-editor-list input:checked:not(:disabled)')].map(i=>i.value);
  e.target.disabled=true;e.target.textContent='Đang lưu…';
  try{
   for(const r of recs){const tags=single?picked:[...new Set([...(r.manualTags||[]),...picked])];const res=await rpc('datTagKudos',r.id,tags);takeAdminRecord(res.record);}
   close();if(!single)modSelected.clear();render();toast(single?'Đã cập nhật tag.':'Đã gắn tag cho '+recs.length+' KUDOS.');
  }catch(err){e.target.disabled=false;e.target.textContent='Lưu tag';toast(err.message);}
 });
}
function openModDetail(id){
 const k=adminRecordById(id);if(!k){toast('Không tìm thấy KUDOS.');return;}
 document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal mod-detail-modal"><button class="modal-close mod-detail-close" aria-label="Đóng">×</button><div class="kicker">CHI TIẾT KUDOS CẦN DUYỆT</div><h2>${escapeHtml(k.senderName||'')} → ${escapeHtml(k.recipientName||'')}</h2><p class="page-sub">${escapeHtml(k.senderDept||'')}${k.senderSection?` · ${escapeHtml(k.senderSection)}`:''} → ${escapeHtml(k.recipientDept||'')}${k.recipientSection?` · ${escapeHtml(k.recipientSection)}`:''}</p>${buildKudosCard(k)}<div class="mod-reasons" style="margin-top:16px">${tagsOf(k).map(t=>tagChip(t,k)).join('')}</div><button class="btn primary wide mod-detail-close">Đóng</button></div></div>`;
 document.querySelectorAll('.mod-detail-close').forEach(b=>b.addEventListener('click',()=>document.querySelector('#modal-root').innerHTML=''));
}
async function openModPreview(id){
 const k=adminRecordById(id);if(!k){toast('Không tìm thấy KUDOS.');return;}
 let mail;
 try{mail=await rpc('xemTruocEmail',id);}catch(e){toast(e.message);return;}
 document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal notif-email-modal"><button class="modal-close notif-close" aria-label="Đóng">×</button><div class="kicker">EMAIL NGƯỜI NHẬN SẼ THẤY · ${escapeHtml(mail.mode==='IMAGE_ENHANCED'?'MODE B (CÓ ẢNH)':'MODE A (KHÔNG ẢNH)')}</div><div class="notif-email-envelope"><span><b>Đến:</b> ${escapeHtml(mail.to)}</span><span><b>Tiêu đề:</b> ${escapeHtml(mail.subject)}</span><span class="notif-email-sim">● Bản xem trước được dựng bởi đúng hàm gửi email thật — nội dung KUDOS không có trong email.</span></div><iframe class="notif-email-frame" title="Xem trước email" sandbox="allow-same-origin" style="height:560px"></iframe><button class="btn primary wide notif-close">Đóng</button></div></div>`;
 const fr=document.querySelector('.notif-email-frame');if(fr)fr.srcdoc=mail.html;
 document.querySelectorAll('.notif-close').forEach(b=>b.addEventListener('click',()=>{document.querySelector('#modal-root').innerHTML='';}));
}
function openModEdit(id){
 const k=adminRecordById(id);if(!k)return;
 document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal"><button class="modal-close" aria-label="Đóng">×</button><div class="kicker">SỬA NỘI DUNG</div><h2>Sửa lời ghi nhận</h2><p>Chỉnh nội dung rồi lưu; hệ thống sẽ kiểm duyệt lại tự động.</p><textarea id="mod-edit-msg" class="textarea" style="min-height:160px">${escapeHtml(k.message||'')}</textarea><div class="form-actions" style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end"><button class="btn secondary" data-mod-edit-cancel>Huỷ</button><button class="btn primary" data-mod-edit-save="${escapeHtml(k.id)}">Lưu &amp; kiểm duyệt lại</button></div></div></div>`;
 const close=()=>{document.querySelector('#modal-root').innerHTML='';};
 document.querySelector('.modal-close').addEventListener('click',close);
 document.querySelector('[data-mod-edit-cancel]').addEventListener('click',close);
 document.querySelector('[data-mod-edit-save]').addEventListener('click',async(e)=>{
  const msg=document.querySelector('#mod-edit-msg').value;e.target.disabled=true;
  try{const res=await rpc('suaKudosDuyet',id,msg);takeAdminRecord(res.record);toast(res.notice||'Đã lưu.');close();render();}catch(err){e.target.disabled=false;toast(err.message);}
 });
}
function bindAdminQuality(){
 document.querySelectorAll('[data-mod-detail]').forEach(b=>b.addEventListener('click',()=>openModDetail(b.dataset.modDetail)));
 document.querySelectorAll('[data-mod-preview]').forEach(b=>b.addEventListener('click',()=>openModPreview(b.dataset.modPreview)));
 document.querySelectorAll('[data-mod-edit]').forEach(b=>b.addEventListener('click',()=>openModEdit(b.dataset.modEdit)));
 document.querySelectorAll('[data-mod-scope]').forEach(b=>b.addEventListener('click',async()=>{
  b.disabled=true;try{const res=await rpc('datPhamViKudos',b.dataset.kid,b.dataset.modScope);takeAdminRecord(res.record);toast(res.notice||'Đã cập nhật phạm vi.');render();}catch(e){b.disabled=false;toast(e.message);}
 }));
 document.querySelectorAll('[data-mod-approve]').forEach(b=>b.addEventListener('click',async()=>{
  if(!window.confirm('Duyệt KUDOS này? Nếu email đang bật, hệ thống sẽ gửi thông báo cho người nhận.'))return;
  b.disabled=true;try{const res=await rpc('duyetKudos',b.dataset.modApprove);takeAdminRecord(res.record);toast(res.notice||'Đã duyệt.');render();loadAdminData(true);}catch(e){b.disabled=false;toast(e.message);}
 }));
 document.querySelectorAll('[data-mod-hide]').forEach(b=>b.addEventListener('click',async()=>{
  const reason=window.prompt('Lý do ẩn KUDOS này (không bắt buộc):','');
  if(reason===null)return;
  b.disabled=true;try{const res=await rpc('anKudos',b.dataset.modHide,reason);takeAdminRecord(res.record);toast(res.notice||'Đã ẩn.');render();}catch(e){b.disabled=false;toast(e.message);}
 }));
 document.querySelectorAll('[data-mod-filter]').forEach(b=>b.addEventListener('click',()=>{modFilter=b.dataset.modFilter;render();}));
 document.querySelectorAll('[data-mod-tag]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.modTag;if(!t)modTags.clear();else if(modTags.has(t))modTags.delete(t);else modTags.add(t);render();}));
 document.querySelectorAll('[data-mod-select]').forEach(c=>c.addEventListener('change',()=>{if(c.checked)modSelected.add(c.dataset.modSelect);else modSelected.delete(c.dataset.modSelect);render();}));
 document.querySelector('[data-mod-select-all]')?.addEventListener('change',e=>{const ids=[...document.querySelectorAll('[data-mod-select]')].map(c=>c.dataset.modSelect);ids.forEach(id=>e.target.checked?modSelected.add(id):modSelected.delete(id));render();});
 document.querySelectorAll('[data-mod-tagedit]').forEach(b=>b.addEventListener('click',()=>openTagEditor([b.dataset.modTagedit])));
 document.querySelector('[data-mod-bulk-tag]')?.addEventListener('click',()=>openTagEditor([...modSelected]));
 document.querySelectorAll('[data-mod-return]').forEach(b=>b.addEventListener('click',async()=>{
  if(!window.confirm('Ẩn KUDOS này và mời người gửi bổ sung chi tiết?\n\nNgười gửi sẽ thấy lời nhắn: “'+QUALITY_MESSAGE+'”'))return;
  b.disabled=true;try{const res=await rpc('anKudos',b.dataset.modReturn,QUALITY_RETURN_REASON);takeAdminRecord(res.record);toast('Đã trả lại KUDOS để người gửi bổ sung.');render();}catch(e){b.disabled=false;toast(e.message);}
 }));
}
// ---- Admin: Nhân viên — số liệu và chi tiết KUDOS theo từng người ----
let peopleQuery='',peopleSort='sent',adminPerson='',personTab='received';
function peopleStats(){
 const recs=dashFiltered().filter(k=>!dashValue||(k.values||[]).includes(dashValue)),map={};
 const row=(email,name,dept)=>{const k=String(email||'').toLowerCase();if(!k)return null;if(!map[k]){const p=personByEmail(k);map[k]={email:k,name:p?p.name:(name||k),dept:p?p.dept:(dept||''),section:p?p.section:'',inData:!!p,sent:0,sentOk:0,received:0,receivedOk:0,held:0,last:''};}return map[k];};
 PEOPLE.forEach(p=>row(p.email,p.name,p.dept));
 recs.forEach(k=>{
  const ok=isApproved(k),held=modStatusOf(k)==='HELD';
  const s=k.senderEmail?row(k.senderEmail,k.senderName,k.senderDept):null;
  if(s){s.sent++;if(ok)s.sentOk++;if(held)s.held++;if(k.createdAt>s.last)s.last=k.createdAt;}
  const r=row(k.recipientEmail,k.recipientName,k.recipientDept);
  if(r){r.received++;if(ok)r.receivedOk++;if(k.createdAt>r.last)r.last=k.createdAt;}
 });
 return Object.values(map);
}
function fmtDateTime(iso){if(!iso)return '—';const d=new Date(iso);return isFinite(d.getTime())?d.toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
function peopleFiltered(){
 const q=normalizeSearch(peopleQuery);
 let list=peopleStats().filter(p=>(!dashDept||p.dept===dashDept)&&(!q||normalizeSearch(p.name+' '+p.email+' '+p.dept+' '+p.section).includes(q)));
 const by={sent:(a,b)=>b.sent-a.sent||b.received-a.received,received:(a,b)=>b.received-a.received||b.sent-a.sent,recent:(a,b)=>String(b.last).localeCompare(String(a.last)),name:(a,b)=>a.name.localeCompare(b.name,'vi')}[peopleSort];
 return list.sort(by||((a,b)=>0));
}
function normalizeSearch(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/gi,'d').toLowerCase().trim();}
function peopleRowsHtml(list){
 return list.slice(0,300).map(p=>`<tr class="people-row" data-person="${escapeHtml(p.email)}" tabindex="0" role="button" aria-label="Xem chi tiết ${escapeHtml(p.name)}">
   <td><div class="people-cell">${miniAvatar(p.email,p.name)}<div><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.email)}${p.inData?'':' · ngoài Master Data'}</span></div></div></td>
   <td>${escapeHtml(p.dept||'—')}${p.section?`<span class="people-sub">${escapeHtml(p.section)}</span>`:''}</td>
   <td><b>${p.sentOk}</b><span class="people-sub">/${p.sent} đã gửi</span></td>
   <td><b>${p.receivedOk}</b><span class="people-sub">/${p.received} đã nhận</span></td>
   <td>${p.held?`<span class="status-pill status-pending"><i></i>${p.held}</span>`:'—'}</td>
   <td>${escapeHtml(fmtDateTime(p.last))}</td>
   <td class="people-go">Chi tiết →</td>
 </tr>`).join('')||'<tr><td colspan="7" style="color:var(--muted);padding:16px">Không có nhân viên phù hợp.</td></tr>';
}
function adminPeople(){
 const gate=adminGate();if(gate)return gate;
 if(adminPerson)return adminPersonDetail(adminPerson);
 const all=peopleStats().filter(p=>!dashDept||p.dept===dashDept),list=peopleFiltered();
 const active=all.filter(p=>p.sent||p.received).length,senders=all.filter(p=>p.sent).length,receivers=all.filter(p=>p.received).length;
 const inData=all.filter(p=>p.inData).length;
 const tile=(ic,label,val,sub)=>`<article class="metric"><div class="metric-icon">${ic}</div><span>${label}</span><strong>${val}</strong><em>${sub||''}</em></article>`;
 return `<section class="page active">
  <div class="page-head"><div><div class="kicker">NHÂN VIÊN</div><h1>Hoạt động KUDOS theo từng nhân viên</h1><p class="page-sub">Toàn bộ nhân sự theo Master Data. Lọc theo thời gian, phòng ban, giá trị cốt lõi. Số đậm là KUDOS đã được duyệt; số nhỏ là tổng đã tạo. Bấm vào một người để xem chi tiết.</p>${dashValue?`<p class="sub">Đang lọc: KUDOS có giá trị <b>${CULTURE[dashValue]}</b>.</p>`:''}</div></div>
  ${filterBar('people')}
  <div class="metric-grid" style="margin-top:14px">
   ${tile('👥','Nhân viên trong Master Data',inData,dashDept?escapeHtml(dashDept):'tab DATA')}
   ${tile('✦','Có hoạt động',active,inData?Math.round(active/inData*100)+'% nhân viên':'')}
   ${tile('→','Đã gửi KUDOS',senders,'người')}
   ${tile('★','Đã nhận KUDOS',receivers,'người')}
  </div>
  <article class="card admin-card" style="padding:16px 18px;margin-top:14px">
   <div class="people-toolbar">
    <div class="search people-search"><input id="people-search" class="input" placeholder="Tìm theo tên, email, phòng ban…" value="${escapeHtml(peopleQuery)}" autocomplete="off" aria-label="Tìm nhân viên">${svg('search')}</div>
    <label class="people-sort">Sắp xếp <select id="people-sort" class="select">${[['sent','Gửi nhiều nhất'],['received','Nhận nhiều nhất'],['recent','Hoạt động gần nhất'],['name','Tên A → Z']].map(([v,l])=>`<option value="${v}" ${peopleSort===v?'selected':''}>${l}</option>`).join('')}</select></label>
   </div>
   <div class="table-wrap"><table class="people-table"><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Đã gửi</th><th>Đã nhận</th><th>Chờ duyệt</th><th>Hoạt động gần nhất</th><th></th></tr></thead>
    <tbody id="people-tbody">${peopleRowsHtml(list)}</tbody></table></div>
   <p class="sub" id="people-count">${list.length>300?'Hiển thị 300 / '+list.length+' nhân viên — dùng ô tìm kiếm để thu hẹp.':list.length+' nhân viên'}</p>
  </article>
 </section>`;
}
function adminPersonDetail(email){
 const st=peopleStats().find(p=>p.email===email)||{email,name:email,dept:'',section:'',inData:false,sent:0,sentOk:0,received:0,receivedOk:0,held:0,last:''};
 const recs=dashFiltered().filter(k=>!dashValue||(k.values||[]).includes(dashValue));
 const sent=recs.filter(k=>k.senderEmail===email),received=recs.filter(k=>k.recipientEmail===email);
 const valCount=list=>{const c=zeroValues();list.filter(isApproved).forEach(k=>(k.values||[]).forEach(v=>{if(c[v]!=null)c[v]++;}));return c;};
 const bars=c=>{const t=VALUE_IDS.reduce((a,v)=>a+c[v],0)||1;return VALUE_IDS.map(v=>`<div class="culture-item"><div class="culture-bar-head"><span>${CULTURE[v]}</span><b>${c[v]}</b></div><div class="culture-line"><i style="width:${Math.round(c[v]/t*100)}%"></i></div></div>`).join('');};
 const top=(list,key)=>{const m={};list.filter(isApproved).forEach(k=>{const n=k[key];if(n)m[n]=(m[n]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,3);};
 const pill=k=>{const st=modStatusOf(k);return `<span class="status-pill ${st==='APPROVED'?'status-public':st==='HELD'?'status-pending':'status-private'}"><i></i>${({HELD:'Chờ duyệt',APPROVED:'Đã duyệt',HIDDEN:'Đã ẩn'})[st]}</span>`;};
 const item=(k,dir)=>`<div class="person-kudos">
   <div class="person-kudos-head"><div><b>${dir==='in'?'Từ '+escapeHtml(k.senderName||''):'Gửi '+escapeHtml(k.recipientName||'')}</b><span>${escapeHtml(dir==='in'?k.senderDept||'':k.recipientDept||'')} · ${escapeHtml(fmtDateTime(k.createdAt))} · ${kudosTypeLabel(k.kudosType,k)}</span></div>${pill(k)}</div>
   <p>${escapeHtml(k.message||'')}</p>
   <div class="person-kudos-foot"><div class="value-tags">${(k.values||[]).map(v=>`<span>${escapeHtml(CULTURE[v]||v)}</span>`).join('')}</div><button class="link-btn" data-mod-detail="${escapeHtml(k.id)}">Xem thiệp →</button></div>
 </div>`;
 const list=personTab==='sent'?sent:received;
 const tile=(label,val,sub)=>`<article class="metric"><span>${label}</span><strong>${val}</strong><em>${sub||''}</em></article>`;
 const topSenders=top(received,'senderName'),topRecipients=top(sent,'recipientName');
 return `<section class="page active">
  <button class="kd-back" data-person-back>← Danh sách nhân viên</button>
  <div class="person-head card admin-card">
   ${miniAvatar(st.email,st.name,'person-avatar')}
   <div class="person-id"><h1>${escapeHtml(st.name)}</h1><p>${escapeHtml(st.email)}${st.dept?' · '+escapeHtml(st.dept):''}${st.section?' · '+escapeHtml(st.section):''}${st.inData?'':' · <b>ngoài Master Data</b>'}</p></div>
   <button class="btn secondary" data-person-export="${escapeHtml(email)}">⬇ Xuất CSV</button>
  </div>
  ${filterBar('people')}
  <div class="metric-grid" style="margin-top:14px">
   ${tile('Đã gửi (đã duyệt)',st.sentOk,st.sent+' KUDOS đã tạo')}
   ${tile('Đã nhận (đã duyệt)',st.receivedOk,st.received+' KUDOS gửi tới')}
   ${tile('Chờ duyệt',st.held,'KUDOS người này gửi')}
   ${tile('Hoạt động gần nhất',escapeHtml(fmtDateTime(st.last).split(' ')[0]||'—'),'')}
  </div>
  <div class="admin-grid" style="margin-top:14px">
   <article class="card admin-card"><div class="card-head"><div><div class="kicker">GIÁ TRỊ ĐƯỢC GHI NHẬN</div><h3>Qua KUDOS đã nhận</h3></div></div><div class="culture-bars">${bars(valCount(received))}</div>
    <div class="person-top"><b>Được ghi nhận nhiều nhất bởi</b>${topSenders.length?topSenders.map(([n,c])=>`<span>${escapeHtml(n)} · ${c}</span>`).join(''):'<span>—</span>'}</div></article>
   <article class="card admin-card"><div class="card-head"><div><div class="kicker">GIÁ TRỊ ĐÃ TRAO</div><h3>Qua KUDOS đã gửi</h3></div></div><div class="culture-bars">${bars(valCount(sent))}</div>
    <div class="person-top"><b>Ghi nhận nhiều nhất cho</b>${topRecipients.length?topRecipients.map(([n,c])=>`<span>${escapeHtml(n)} · ${c}</span>`).join(''):'<span>—</span>'}</div></article>
  </div>
  <article class="card admin-card" style="padding:16px 18px;margin-top:14px">
   <div class="tabs"><button class="tab ${personTab==='received'?'active':''}" data-person-tab="received">Đã nhận (${received.length})</button><button class="tab ${personTab==='sent'?'active':''}" data-person-tab="sent">Đã gửi (${sent.length})</button></div>
   <div class="person-kudos-list">${list.length?list.map(k=>item(k,personTab==='sent'?'out':'in')).join(''):'<div class="empty"><div class="icon">✦</div><h3>Chưa có KUDOS trong khoảng lọc</h3></div>'}</div>
  </article>
 </section>`;
}
function peopleExportCsv(){
 const head=['Nhan_vien','Email','Phong_ban','Bo_phan','Trong_Master_Data','Da_gui_duyet','Da_gui_tong','Da_nhan_duyet','Da_nhan_tong','Cho_duyet','Hoat_dong_gan_nhat'];
 const lines=[head.join(',')];peopleFiltered().forEach(p=>lines.push([p.name,p.email,p.dept,p.section,p.inData?'Co':'Khong',p.sentOk,p.sent,p.receivedOk,p.received,p.held,p.last].map(csvEsc).join(',')));
 downloadCsv(lines,'ahakudos_nhanvien_');
}
function personExportCsv(email){
 const recs=dashFiltered().filter(k=>k.senderEmail===email||k.recipientEmail===email);
 const head=['Thoi_gian','Chieu','Loai','Nguoi_gui','Nguoi_nhan','Trang_thai','Gia_tri','Noi_dung'];
 const lines=[head.join(',')];recs.forEach(k=>lines.push([k.createdAt,k.senderEmail===email?'Gui':'Nhan',({birthday:'Sinh nhat',anniversary:'Tham nien'})[k.kudosType]||'Dong nghiep',k.senderName,k.recipientName,modStatusOf(k),(k.values||[]).map(valueLabel).join(' | '),String(k.message||'').replace(/\r?\n/g,' ')].map(csvEsc).join(',')));
 downloadCsv(lines,'ahakudos_'+email.split('@')[0]+'_');
}
function bindAdminPeople(){
 const openPerson=email=>{adminPerson=email;personTab='received';render();window.scrollTo(0,0);};
 const bindRows=()=>document.querySelectorAll('[data-person]').forEach(r=>{r.addEventListener('click',()=>openPerson(r.dataset.person));r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPerson(r.dataset.person);}});});
 bindRows();
 const q=document.querySelector('#people-search');
 if(q)q.addEventListener('input',()=>{peopleQuery=q.value;const list=peopleFiltered();document.querySelector('#people-tbody').innerHTML=peopleRowsHtml(list);document.querySelector('#people-count').textContent=list.length>300?'Hiển thị 300 / '+list.length+' nhân viên — dùng ô tìm kiếm để thu hẹp.':list.length+' nhân viên';bindRows();});
 const sort=document.querySelector('#people-sort');if(sort)sort.addEventListener('change',()=>{peopleSort=sort.value;render();});
 document.querySelectorAll('[data-person-back]').forEach(b=>b.addEventListener('click',()=>{adminPerson='';render();window.scrollTo(0,0);}));
 document.querySelectorAll('[data-person-tab]').forEach(b=>b.addEventListener('click',()=>{personTab=b.dataset.personTab;render();}));
 document.querySelectorAll('[data-person-export]').forEach(b=>b.addEventListener('click',()=>personExportCsv(b.dataset.personExport)));
 document.querySelectorAll('[data-mod-detail]').forEach(b=>b.addEventListener('click',()=>openModDetail(b.dataset.modDetail)));
}
// ---- Admin: Cài đặt › Từ cấm ----
function adminWords(){
 const gate=adminGate();if(gate)return gate;
 return `<section class="page active">
  <div class="page-head"><div><div class="kicker">CÀI ĐẶT</div><h1>Danh sách từ cấm</h1><p class="page-sub">KUDOS chứa các từ này vẫn vào hàng chờ duyệt nhưng được gắn cờ để Admin chú ý.</p></div></div>
  <article class="card admin-card" style="padding:16px 18px"><div class="card-head"><div><div class="kicker">TỪ CẤM</div><h3>${ADMIN.blacklist.length} từ / cụm từ</h3><div class="sub">Mỗi từ hoặc cụm từ một dòng, hoặc ngăn cách bằng dấu phẩy.</div></div></div>
   <textarea id="mod-blacklist" class="textarea" style="min-height:220px;margin-top:10px">${escapeHtml(ADMIN.blacklist.join('\n'))}</textarea>
   <div class="form-actions" style="margin-top:10px;display:flex;justify-content:flex-end"><button class="btn primary" id="mod-blacklist-save">Lưu danh sách</button></div>
  </article>
 </section>`;
}
function bindAdminWords(){
 const save=document.querySelector('#mod-blacklist-save');
 if(save)save.addEventListener('click',async()=>{
  const list=document.querySelector('#mod-blacklist').value.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
  save.disabled=true;try{const res=await rpc('datTuCam',list);ADMIN.blacklist=res.blacklist||list;toast(res.notice||'Đã lưu danh sách.');render();}catch(e){save.disabled=false;toast(e.message);}
 });
}


function adminGalleryHtml(selected){
 const list=cardTemplates.concat(customBgTemplates());
 return list.map(t=>{const bg=bgFor(t.id);return `<button type="button" class="template-option ${selected===t.id?'selected':''}" data-admin-template="${escapeHtml(t.id)}" aria-label="Background ${escapeHtml(t.name)}" aria-pressed="${selected===t.id}" title="${escapeHtml(t.name)}"><span class="template-thumb" style="background:${bg.fallback}"><img class="art-img" src="${escapeHtml(bg.url)}" alt="" aria-hidden="true" loading="lazy"><span class="thumb-tick" aria-hidden="true">✓</span></span>${t.custom?`<span class="admin-bg-name">${escapeHtml(t.name)}</span>`:''}</button>`;}).join('')
  +`<button type="button" class="template-option admin-bg-add" id="admin-bg-upload-open" aria-label="Tải background mới"><span class="template-thumb"><b>＋</b><small>Tải background</small></span></button>`;
}
function adminBgListHtml(){
 if(!CUSTOM_BGS.length)return '';
 return `<div class="admin-bg-list"><div class="admin-bg-list-head">Background đã tải (${CUSTOM_BGS.length})</div>${CUSTOM_BGS.map(b=>`<div class="admin-bg-row"><span class="admin-bg-thumb"><img src="${escapeHtml(bgFor(b.id).url)}" alt="" loading="lazy"></span><div><b>${escapeHtml(b.name)}</b><span>${b.status==='ACTIVE'?'Đang dùng':'Đã lưu trữ — KUDOS cũ vẫn hiển thị'} · ${escapeHtml(fmtDateTime(b.createdAt).split(' ')[0])}</span></div><button type="button" class="btn secondary" data-bg-toggle="${escapeHtml(b.id)}" data-on="${b.status==='ACTIVE'?'':'1'}">${b.status==='ACTIVE'?'Lưu trữ':'Dùng lại'}</button></div>`).join('')}</div>`;
}
/** Center-crop to 16:9 and resize to 1672×941 JPEG in the browser before upload (keeps requests small). */
function prepareBackgroundImage(file){
 return new Promise((resolve,reject)=>{
  if(!/^image\/(png|jpeg|webp)$/.test(file.type))return reject(new Error('Chỉ nhận ảnh PNG, JPEG hoặc WebP.'));
  if(file.size>20*1024*1024)return reject(new Error('Ảnh gốc quá lớn (tối đa 20 MB).'));
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{
   const W=1672,H=941,r=Math.max(W/img.naturalWidth,H/img.naturalHeight),w=img.naturalWidth*r,h=img.naturalHeight*r;
   const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.drawImage(img,(W-w)/2,(H-h)/2,w,h);
   URL.revokeObjectURL(url);
   let q=0.86,data=c.toDataURL('image/jpeg',q);while(data.length>3200000&&q>0.5){q-=0.08;data=c.toDataURL('image/jpeg',q);}
   resolve(data);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Không đọc được ảnh.'));};
  img.src=url;
 });
}
function adminRecognition(){
 const gate=adminGate();if(gate)return gate;
 const recognitionTypes=[
  ['acting','Acting / Đảm nhận vai trò tạm thời','Ghi nhận một giai đoạn chủ động nhận thêm vai trò hoặc trách nhiệm.'],
  ['promotion','Thăng cấp / Thăng chức','Ghi dấu một bước phát triển trong hành trình nghề nghiệp.'],
  ['trainer','Trainer / Buddy','Ghi nhận đóng góp trong việc đồng hành và phát triển người khác.'],
  ['project','Milestone dự án','Ghi nhận một dấu mốc hoặc đóng góp nổi bật trong dự án.'],
  ['campaign','Hoạt động / Campaign nội bộ','Ghi nhận đóng góp cho hoạt động chung của công ty.'],
  ['other','Ghi nhận khác','Dành cho trường hợp Admin cần tạo một AHAKUDOS phù hợp khác.']
 ];
 return `<section class="page active">
   <div class="page-head">
     <div>
       <div class="kicker">AHAKUDOS MỞ RỘNG</div>
       <h1>Gửi AHAKUDOS từ Admin</h1>
       <p class="page-sub">Ghi nhận thêm vai trò, cột mốc phát triển và những đóng góp trong hoạt động nội bộ của Ahamovers.</p>
     </div>
   </div>
   <div class="admin-recognition-layout">
     <article class="card admin-recognition-form">
       <div class="admin-section-title"><span>1</span><div><b>Chọn nhân sự</b><p>Tìm bằng email Ahamove để đảm bảo gửi đúng người.</p></div></div>
       <div class="field recipient-search-field">
         <label class="recipient-mode-toggle"><input id="admin-no-company-email" type="checkbox"><span>Người nhận không có mail công ty</span></label>
         <div id="admin-company-mode">
           <div class="email-search-wrap">
             <input id="admin-recipient-email" class="input" type="email" autocomplete="off" placeholder="Nhập email Ahamove của nhân sự...">
             <span class="email-search-icon">⌕</span>
             <div id="admin-recipient-suggestions" class="recipient-suggestions hidden"></div>
           </div>
           <div id="admin-selected-recipient" class="selected-recipient hidden"></div>
         </div>
         <div id="admin-manual-mode" class="recipient-manual-mode hidden">
           <div class="recipient-manual-grid">
             <div><label for="admin-manual-name">Họ tên người nhận</label><input id="admin-manual-name" class="input" type="text" maxlength="120" placeholder="Nhập họ tên"></div>
             <div><label for="admin-manual-dept">Phòng ban / Bộ phận</label><input id="admin-manual-dept" class="input" type="text" maxlength="120" placeholder="Nhập phòng ban hoặc bộ phận"></div>
           </div>
           <label for="admin-manual-email">Email liên hệ</label><input id="admin-manual-email" class="input" type="email" placeholder="name@example.com">
           <span class="field-hint">Email ngoài @ahamove.com được phép nhập tự do. KUDOS này sẽ được giữ riêng tư.</span>
         </div>
       </div>
       <div class="admin-section-title"><span>2</span><div><b>Chọn nội dung ghi nhận</b><p>Chọn loại phù hợp với cột mốc hoặc đóng góp thực tế.</p></div></div>
       <div class="recognition-type-grid">
         ${recognitionTypes.map((t,i)=>`<button type="button" class="recognition-type ${i===0?'selected':''}" data-recognition-type="${t[0]}"><strong>${t[1]}</strong><span>${t[2]}</span></button>`).join('')}
       </div>
       <div class="admin-section-title"><span>3</span><div><b>Hoàn thiện lời ghi nhận</b><p>Nội dung sẽ được gửi đến nhân sự qua email và lưu trong Hồ sơ KUDOS.</p></div></div>
       <div class="field"><label>Tiêu đề AHAKUDOS</label><input id="admin-recognition-title" class="input" value="Cảm ơn bạn vì một hành trình đáng ghi nhận"></div>
       <div class="field"><label>Nội dung</label><textarea id="admin-recognition-message" class="textarea" placeholder="Chia sẻ cột mốc, đóng góp hoặc điều Ahamove muốn ghi nhận ở nhân sự..."></textarea></div>
       <div class="field admin-visibility-field"><label>Ai có thể xem AHAKUDOS này?</label>
         <div class="visibility-options">
           <button type="button" class="visibility-option selected" data-admin-visibility="public"><span class="visibility-icon">◎</span><div><b>CỘNG ĐỒNG KUDOS</b><p>Hiển thị họ tên + phòng ban người gửi sau khi Admin duyệt; không có chế độ ẩn danh.</p></div><i>✓</i></button>
           <button type="button" class="visibility-option" data-admin-visibility="private"><span class="visibility-icon lock">●</span><div><b>Chỉ người nhận biết</b><p>Không xuất hiện trên feed công khai; vẫn lưu trong Hồ sơ KUDOS của nhân sự.</p></div><i>✓</i></button>
         </div>
       </div>
       <div class="field"><label>Chọn background</label>
         <div class="template-gallery admin-template-gallery" id="admin-template-gallery">${adminGalleryHtml('wish')}</div>
         <span class="field-hint">4 mẫu có sẵn và các background dịp đặc biệt do Admin tải lên. Chỉ Admin dùng được background tải lên.</span>
         <div id="admin-bg-upload" class="admin-bg-upload hidden">
           <div class="admin-bg-upload-grid">
             <div><label for="admin-bg-name">Tên dịp / background</label><input id="admin-bg-name" class="input" maxlength="60" placeholder="VD: Tết Nguyên đán 2027"></div>
             <div><label>Ảnh (PNG, JPEG hoặc WebP)</label><label class="avatar-file-btn admin-bg-file-btn">Chọn ảnh<input id="admin-bg-file" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
           </div>
           <div class="admin-bg-preview" id="admin-bg-preview"><span>Ảnh sẽ được tự cắt về khung 16:9 (1672 × 941) giống các mẫu có sẵn. Nên dùng ảnh có vùng giữa trống để đặt nội dung.</span></div>
           <div class="form-actions"><button type="button" class="btn secondary" id="admin-bg-cancel">Huỷ</button><button type="button" class="btn primary" id="admin-bg-save" disabled>Tải lên</button></div>
         </div>
         <div id="admin-bg-list">${adminBgListHtml()}</div>
       </div>
       <div class="admin-recognition-note"><span>ⓘ</span><p><b>AHAKUDOS từ Admin</b> là lớp ghi nhận chính thức của chương trình. Background được chọn sẽ đi cùng email người nhận và bản lưu trong Hồ sơ KUDOS.</p></div>
       <div class="form-actions"><button class="btn secondary" id="admin-recognition-preview">Xem trước</button><button class="btn primary" id="admin-recognition-send">Gửi AHAKUDOS</button></div>
     </article>
     <aside class="card admin-recognition-preview">
       <div class="card-head"><div><div class="kicker">PREVIEW</div><h3>AHAKUDOS gửi đến nhân sự</h3></div></div>
       <div class="recipient-preview" id="admin-recipient-preview"><div class="mini-avatar">@</div><div><b>Chưa chọn người nhận</b><span>Nhập email nhân sự để tìm kiếm</span></div></div>
       <div class="kudos-preview-card admin-kudos-preview" id="admin-preview-card"></div>
       <div class="preview-visibility" id="admin-preview-visibility">◎ CỘNG ĐỒNG KUDOS</div>
       <div class="admin-email-preview-note"><span>✉</span><div><b>Email thông báo</b><p>Sau khi Admin duyệt, người nhận nhận email thông báo (không chứa nội dung) và mở lời ghi nhận trong AHAKUDOS với mẫu thiệp này.</p></div></div>
     </aside>
   </div>
 </section>`;
}
// ---- Admin: Email thông báo (EMAIL_QUEUE state per KUDOS) ------------------
let emailFilter='ALL';
function emailPill(status){
 const map={PENDING:['status-pending','Chờ gửi'],SENDING:['status-queued','Đang gửi'],SENT:['status-public','Đã gửi'],FAILED:['status-private','Lỗi'],CANCELLED:['status-private','Không gửi'],AWAITING_APPROVAL:['status-queued','Chờ duyệt']};
 const m=map[status]||['status-queued',status||'—'];
 return `<span class="status-pill ${m[0]}"><i></i>${escapeHtml(m[1])}</span>`;
}
function adminNotify(){
 const gate=adminGate();if(gate)return gate;
 const st=ADMIN.settings||{};
 const all=ADMIN.records.map(k=>({k,status:k.email?k.email.status:(modStatusOf(k)==='APPROVED'?'PENDING':'AWAITING_APPROVAL')}));
 const counts={};all.forEach(x=>{counts[x.status]=(counts[x.status]||0)+1;});
 const list=all.filter(x=>emailFilter==='ALL'||x.status===emailFilter);
 const filters=[['ALL','Tất cả'],['FAILED','Lỗi'],['PENDING','Chờ gửi'],['SENT','Đã gửi'],['CANCELLED','Không gửi'],['AWAITING_APPROVAL','Chờ duyệt']];
 const rows=list.slice(0,300).map(({k,status})=>{
   const e=k.email||{};
   const unknown=status==='FAILED'&&String(e.lastError||'').indexOf('UNKNOWN_OUTCOME')===0;
   const canSend=modStatusOf(k)==='APPROVED'&&(status==='PENDING'||(status==='FAILED'&&!unknown));
   const canResend=modStatusOf(k)==='APPROVED'&&(status==='SENT'||status==='FAILED');
   return `<div class="notif-row">
     <div class="notif-main">
       <div class="notif-top"><b>${escapeHtml(k.senderName||'')} → ${escapeHtml(k.recipientName||'')}</b><time>${escapeHtml(k.sentAtLabel||'')}</time></div>
       <div class="notif-sub"><span>Đến: ${escapeHtml(k.recipientEmail||'')}</span><span>· Lần gửi: ${Number(e.attempts||0)}</span>${e.sentAt?`<span>· Gửi lúc ${escapeHtml(new Date(e.sentAt).toLocaleString('vi-VN'))}</span>`:''}</div>
       ${e.lastError?`<p>${escapeHtml(e.lastError)}</p>`:''}
     </div>
     <div class="notif-actions">${emailPill(status)}
       <button class="link-btn" data-mail-preview="${escapeHtml(k.id)}">Xem email</button>
       ${canSend?`<button class="btn secondary" data-mail-send="${escapeHtml(k.id)}">Gửi</button>`:''}
       ${canResend?`<button class="btn secondary" data-mail-resend="${escapeHtml(k.id)}">Gửi lại (RESEND)</button>`:''}
     </div>
   </div>`;
 }).join('');
 return `<section class="page active admin-notify-page">
   <div class="page-head"><div><div class="kicker">EMAIL THÔNG BÁO</div><h1>Email thông báo người nhận</h1><p class="page-sub">Email chỉ gửi sau khi Admin duyệt. Mỗi KUDOS có đúng một trạng thái email theo (KUDOS ID + email người nhận); đã gửi thì không gửi lại trừ khi Admin chọn RESEND.</p></div><button class="btn secondary" id="mail-refresh">Làm mới</button></div>
   <article class="card admin-card notif-settings">
     <div class="notif-set-row"><div><b>Gửi email</b><span>${st.mailEnabled?'Đang BẬT':'Đang TẮT'} · đổi bằng hàm batGuiEmail / tatGuiEmail trong Apps Script</span></div><span class="status-pill ${st.mailEnabled?'status-public':'status-private'}"><i></i>${st.mailEnabled?'BẬT':'TẮT'}</span></div>
     <div class="notif-set-row"><div><b>Chế độ email</b><span>${st.emailMode==='IMAGE_ENHANCED'?'MODE B — có ảnh trang trí (nội dung vẫn đọc được khi chặn ảnh)':'MODE A — chỉ HTML, không phụ thuộc hình ảnh'}</span></div><span class="status-pill status-queued"><i></i>${escapeHtml(st.emailMode||'HTML_ONLY')}</span></div>
     <div class="notif-set-row"><div><b>Hạn mức hôm nay</b><span>${Number(st.sentToday||0)} / ${Number(st.dailyLimit||0)} email${st.googleRemainingQuota!=null?' · Google còn '+Number(st.googleRemainingQuota):''}</span></div><span class="status-pill status-queued"><i></i>${escapeHtml(String(st.env||'').toUpperCase())}</span></div>
     ${st.redirectTo?`<div class="notif-hint"><span>ⓘ</span> Môi trường ${escapeHtml(st.env)}: mọi email được chuyển tới hộp thư test <b>${escapeHtml(st.redirectTo)}</b>.</div>`:''}
   </article>
   <div class="dash-presets" style="margin:14px 0">${filters.map(([id,label])=>`<button class="chip-btn ${emailFilter===id?'active':''}" data-mail-filter="${id}">${label} (${id==='ALL'?all.length:(counts[id]||0)})</button>`).join('')}</div>
   <article class="card admin-card notif-list">${rows||`<div class="empty"><div class="icon">✉</div><h3>Không có email trong mục này</h3></div>`}</article>
 </section>`;
}
function bindAdminEmail(){
 document.querySelectorAll('[data-mail-filter]').forEach(b=>b.addEventListener('click',()=>{emailFilter=b.dataset.mailFilter;render();}));
 const refresh=document.querySelector('#mail-refresh');if(refresh)refresh.addEventListener('click',()=>{loadAdminData(true);});
 document.querySelectorAll('[data-mail-preview]').forEach(b=>b.addEventListener('click',()=>openModPreview(b.dataset.mailPreview)));
 const send=async(b,mode)=>{
   if(mode==='RESEND'&&!window.confirm('Gửi lại email thông báo cho KUDOS này? Người nhận có thể nhận 2 email.'))return;
   b.disabled=true;
   try{const res=await rpc('guiEmailKudos',b.dataset.mailSend||b.dataset.mailResend,mode);takeAdminRecord(res.record);toast(res.notice||'Đã xử lý.');render();loadAdminData(true);}
   catch(e){b.disabled=false;toast(e.message);}
 };
 document.querySelectorAll('[data-mail-send]').forEach(b=>b.addEventListener('click',()=>send(b,'SEND')));
 document.querySelectorAll('[data-mail-resend]').forEach(b=>b.addEventListener('click',()=>send(b,'RESEND')));
}

// ---- Admin: Sinh nhật & Thâm niên (from Master Data only) --------------------
// Sinh nhật & Thâm niên: Admin review nội dung mẫu, rồi tick tự động gửi đúng giờ (chayLichGui chạy mỗi 15 phút).
function opsDefaultMessage(r,type){const first=String(r.name||'').split(' ').slice(-1)[0]||'bạn';return type==='birthday'?`Chúc mừng sinh nhật ${first}! 🎂 Cảm ơn bạn đã luôn mang năng lượng tích cực đến Ahamove. Chúc bạn tuổi mới thật nhiều sức khoẻ, niềm vui và những hành trình đáng nhớ.`:`Chúc mừng ${first} tròn ${r.years} năm đồng hành cùng Ahamove! ✦ Cảm ơn bạn vì những đóng góp và năng lượng trên hành trình Always Moving. Chúc bạn tiếp tục có thêm nhiều dấu ấn phía trước.`;}
function scheduleFor(email,type,date){return (ADMIN.schedules||[]).filter(x=>x.email===email&&x.type===type&&(x.status==='SCHEDULED'||x.date===date)).sort((a,b)=>(a.status==='SCHEDULED'?-1:1))[0]||null;}
function adminOps(){
 const gate=adminGate();if(gate)return gate;
 const up=ADMIN.upcoming||{birthdays:[],anniversaries:[],windowDays:30};
 const fmt=d=>{const p=String(d||'').split('-');return p.length===3?p[2]+'/'+p[1]:'';};
 const when=n=>n===0?'Hôm nay':n===1?'Ngày mai':'Còn '+n+' ngày';
 const statusHtml=(sc)=>!sc?'':sc.status==='SCHEDULED'?`<span class="ops-sched ops-sched--on">⏰ Tự động gửi ${escapeHtml(sc.time)} · ${escapeHtml(fmt(sc.date))}</span>`:sc.status==='SENT'?`<span class="ops-sched ops-sched--sent">✓ Đã gửi tự động</span>`:sc.status==='FAILED'?`<span class="ops-sched ops-sched--fail" title="${escapeHtml(sc.note||'')}">⚠ Gửi lỗi</span>`:'';
 const row=(r,type)=>{const sc=scheduleFor(r.email,type,r.date);return `<div class="milestone-admin-row milestone-admin-row--live">${miniAvatar(r.email,r.name,type==='birthday'?'birthday-avatar':'')}<div class="milestone-admin-info"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.dept||'')}</span><em>${type==='birthday'?'':escapeHtml(r.years+' năm · ')}${escapeHtml(when(r.inDays))} · ${escapeHtml(fmt(r.date))}</em>${statusHtml(sc)}</div><div class="ops-actions">${sc&&sc.status==='SCHEDULED'?`<button class="link-btn" data-ops-review="${escapeHtml(r.email)}" data-ops-type="${type}">Sửa</button><button class="link-btn danger-link" data-ops-cancel="${escapeHtml(sc.id)}">Huỷ</button>`:sc&&sc.status==='SENT'?'':`<button class="btn secondary ops-review-btn" data-ops-review="${escapeHtml(r.email)}" data-ops-type="${type}">Review & hẹn giờ</button>`}<button class="link-btn" data-ops-send="${escapeHtml(r.email)}" data-ops-type="${type}">Gửi ngay →</button></div></div>`;};
 const empty=t=>`<div class="home-master-empty">${t}</div>`;
 const mi=(ADMIN.master&&ADMIN.master.issues)||{};
 const missingDob=(mi.missingOptional||[]).includes('dob');
 const unscheduled=[...up.birthdays.map(r=>[r,'birthday']),...up.anniversaries.map(r=>[r,'anniversary'])].filter(([r,t])=>!scheduleFor(r.email,t,r.date));
 return `<section class="page active">
   <div class="page-head"><div><div class="kicker">SINH NHẬT & THÂM NIÊN</div><h1>Cột mốc sắp tới từ Master Data</h1><p class="page-sub">Danh sách lấy trực tiếp từ tab DATA (Date of Birth, Onboard Day) trong ${Number(up.windowDays||30)} ngày tới. Admin review nội dung, chọn giờ và tick tự động gửi — hệ thống gửi AHAKUDOS + email đúng giờ.</p></div></div>
   <div class="ops-auto ${ADMIN.autoSend?'is-on':'is-off'}"><b>${ADMIN.autoSend?'● Tự động gửi đang BẬT':'○ Tự động gửi đang TẮT'}</b><span>${ADMIN.autoSend?'Hệ thống kiểm tra lịch mỗi 15 phút và gửi đúng giờ đã hẹn.':'Lịch vẫn được lưu, nhưng chỉ gửi khi bật: trong Apps Script chạy hàm <code>batTuDongGui</code> (một lần).'}</span>${unscheduled.length?`<button class="btn secondary" data-ops-bulk>Hẹn giờ tất cả (${unscheduled.length}) · nội dung mẫu, 09:00</button>`:''}</div>
   <div class="milestone-admin-summary">
     <article class="card milestone-summary-card"><div class="milestone-summary-icon">🎂</div><div><span>Sinh nhật sắp tới</span><strong>${up.birthdays.length}</strong><small>${missingDob?'DATA chưa có cột Date of Birth':'từ cột Date of Birth'}</small></div></article>
     <article class="card milestone-summary-card"><div class="milestone-summary-icon navy">✦</div><div><span>Kỷ niệm thâm niên</span><strong>${up.anniversaries.length}</strong><small>từ cột Onboard Day</small></div></article>
   </div>
   <div class="ops-grid milestone-ops-grid">
     <article class="card admin-card"><div class="card-head"><div><div class="kicker">SINH NHẬT</div><h3>Danh sách sắp tới</h3></div></div>
       <div class="milestone-admin-list">${up.birthdays.map(r=>row(r,'birthday')).join('')||empty(missingDob?'Tab DATA chưa có cột Date of Birth / DOB / Birthday.':'Không có sinh nhật nào trong khoảng này.')}</div></article>
     <article class="card admin-card"><div class="card-head"><div><div class="kicker">THÂM NIÊN</div><h3>Danh sách sắp tới</h3></div></div>
       <div class="milestone-admin-list">${up.anniversaries.map(r=>row(r,'anniversary')).join('')||empty('Không có kỷ niệm thâm niên nào trong khoảng này.')}</div></article>
   </div>
 </section>`;
}
function opsRecord(email,type){const up=ADMIN.upcoming||{};return (type==='birthday'?up.birthdays:up.anniversaries||[]).find(r=>r.email===email)||null;}
function openScheduleEditor(email,type){
 const r=opsRecord(email,type);if(!r)return;
 const sc=scheduleFor(email,type,r.date);const cur=sc&&sc.status==='SCHEDULED'?sc:null;
 const today=vnDay(new Date().toISOString());
 const tpls=allTemplates().concat(customBgTemplates());
 const tplDefault=cur?cur.templateId:(type==='birthday'?'birthday':(tpls.find(t=>t.id!=='birthday')||tpls[0]).id);
 const root=document.querySelector('#modal-root');
 root.innerHTML=`<div class="modal-backdrop"><div class="modal schedule-modal" role="dialog" aria-modal="true" aria-labelledby="sched-title"><button class="modal-close" data-sched-close aria-label="Đóng">×</button>
  <div class="kicker">${type==='birthday'?'🎂 SINH NHẬT':'✦ THÂM NIÊN'} · REVIEW & HẸN GIỜ</div><h2 id="sched-title">${escapeHtml(r.name)}</h2><p class="sub">${escapeHtml(r.dept||'')} · ${type==='birthday'?'Sinh nhật':escapeHtml(r.years+' năm')} ngày ${escapeHtml(r.date.split('-').reverse().join('/'))}</p>
  <div class="schedule-grid"><div class="schedule-form">
   <label for="sched-msg">Nội dung AHAKUDOS</label><textarea id="sched-msg" class="textarea" rows="5" maxlength="6000">${escapeHtml(cur?cur.message:opsDefaultMessage(r,type))}</textarea>
   <label for="sched-bg">Background</label><select id="sched-bg" class="select">${tpls.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===tplDefault?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>
   <div class="schedule-when"><div><label for="sched-date">Ngày gửi</label><input id="sched-date" class="input" type="date" min="${today}" value="${escapeHtml(cur?cur.date:(r.date<today?today:r.date))}"></div><div><label for="sched-time">Giờ gửi</label><input id="sched-time" class="input" type="time" step="900" value="${escapeHtml(cur?cur.time:'09:00')}"></div></div>
   <label>Phạm vi</label><div class="schedule-vis"><label><input type="radio" name="sched-vis" value="private" ${!cur||cur.visibility==='private'?'checked':''}> Riêng tư (người nhận có thể tự chia sẻ lên Cộng đồng)</label><label><input type="radio" name="sched-vis" value="public" ${cur&&cur.visibility==='public'?'checked':''}> CỘNG ĐỒNG KUDOS</label></div>
   <label class="schedule-auto"><input type="checkbox" id="sched-auto" checked> <span><b>Tự động gửi đúng giờ</b> — AHAKUDOS được duyệt sẵn và email thông báo gửi tới người nhận vào thời điểm đã hẹn.</span></label>
   ${ADMIN.autoSend?'':'<p class="schedule-warn">Tự động gửi đang TẮT trong Apps Script (chạy batTuDongGui). Lịch vẫn được lưu.</p>'}
  </div><div class="schedule-preview"><div class="kicker">XEM TRƯỚC</div><div id="sched-card"></div></div></div>
  <div class="kudos-success-actions"><button class="btn secondary" data-sched-close>Huỷ</button><button class="btn primary" data-sched-save>Lưu lịch gửi</button></div></div></div>`;
 const $=q=>root.querySelector(q);
 const preview=()=>{const box=$('#sched-card');box.innerHTML=buildKudosCard({senderName:'AHAKUDOS',senderDept:'Ahamove',recipientName:r.name,recipientDept:r.dept,message:$('#sched-msg').value.trim()||'Nội dung AHAKUDOS sẽ xuất hiện tại đây.',templateId:$('#sched-bg').value,values:[],kudosType:type,source:'ADMIN'});fitAllKudosCards(box);};
 preview();$('#sched-msg').addEventListener('input',preview);$('#sched-bg').addEventListener('change',preview);
 $('#sched-auto').addEventListener('change',e=>{$('[data-sched-save]').textContent=e.target.checked?'Lưu lịch gửi':'Mở trang Gửi ngay →';});
 root.querySelectorAll('[data-sched-close]').forEach(b=>b.addEventListener('click',()=>root.innerHTML=''));
 $('[data-sched-save]').addEventListener('click',async e=>{
  if(!$('#sched-auto').checked){root.innerHTML='';state.adminPrefill={email,template:$('#sched-bg').value,type};goToPage('admin-recognition');return;}
  const payload={id:cur?cur.id:'',type,email,date:$('#sched-date').value,time:$('#sched-time').value,message:$('#sched-msg').value.trim(),templateId:$('#sched-bg').value,visibility:(root.querySelector('[name="sched-vis"]:checked')||{}).value||'private'};
  e.target.disabled=true;e.target.textContent='Đang lưu…';
  try{const res=await rpc('datLichGui',payload);ADMIN.schedules=res.schedules||[];ADMIN.autoSend=!!res.autoSend;root.innerHTML='';render();toast(res.notice);}
  catch(err){e.target.disabled=false;e.target.textContent='Lưu lịch gửi';toast(err.message);}
 });
}
function bindAdminOps(){
 document.querySelectorAll('[data-ops-send]').forEach(b=>b.addEventListener('click',()=>{state.adminPrefill={email:b.dataset.opsSend,template:b.dataset.opsType==='birthday'?'birthday':'wish',type:b.dataset.opsType};goToPage('admin-recognition');}));
 document.querySelectorAll('[data-ops-review]').forEach(b=>b.addEventListener('click',()=>openScheduleEditor(b.dataset.opsReview,b.dataset.opsType)));
 document.querySelectorAll('[data-ops-cancel]').forEach(b=>b.addEventListener('click',async()=>{if(!window.confirm('Huỷ lịch gửi này?'))return;b.disabled=true;try{const res=await rpc('huyLichGui',b.dataset.opsCancel);ADMIN.schedules=res.schedules||[];render();toast(res.notice);}catch(e){b.disabled=false;toast(e.message);}}));
 document.querySelector('[data-ops-bulk]')?.addEventListener('click',async e=>{
  const up=ADMIN.upcoming||{};const today=vnDay(new Date().toISOString());
  const list=[...(up.birthdays||[]).map(r=>[r,'birthday']),...(up.anniversaries||[]).map(r=>[r,'anniversary'])].filter(([r,t])=>!scheduleFor(r.email,t,r.date));
  if(!window.confirm('Hẹn giờ tự động gửi cho '+list.length+' người với nội dung mẫu, 09:00 đúng ngày, phạm vi Riêng tư?\n\nBạn vẫn có thể Sửa / Huỷ từng lịch sau đó.'))return;
  e.target.disabled=true;let okN=0;const bgAnn=(allTemplates().find(t=>t.id!=='birthday')||{id:'wish'}).id;
  for(const [r,t] of list){try{const res=await rpc('datLichGui',{type:t,email:r.email,date:r.date<today?today:r.date,time:'09:00',message:opsDefaultMessage(r,t),templateId:t==='birthday'?'birthday':bgAnn,visibility:'private'});ADMIN.schedules=res.schedules||[];ADMIN.autoSend=!!res.autoSend;okN++;}catch(err){console.warn('[AHAKUDOS] schedule',r.email,err);}}
  render();toast('Đã hẹn giờ '+okN+'/'+list.length+' lịch gửi.');
 });
}

// ---- KUDOS 16:9 auto-fit ---------------------------------------------------
function fitKudosCard(card){
 if(!card)return;
 const content=card.querySelector('.kd-card-content');
 const msg=card.querySelector('.kd-card-msg');
 if(!content||!msg)return;
 msg.style.fontSize='';msg.style.lineHeight='';content.style.padding='';
 let size=parseFloat(getComputedStyle(msg).fontSize)||20;
 let line=1.48;let guard=0;
 const overflowing=()=>content.scrollHeight>content.clientHeight+1;
 while(overflowing()&&size>8.5&&guard<40){
   size-=0.5;line=Math.max(1.34,line-0.006);
   msg.style.fontSize=size+'px';msg.style.lineHeight=String(line);guard++;
 }
 if(overflowing()){
   content.style.padding='3.3cqw 2.2cqw';guard=0;
   while(overflowing()&&size>7.5&&guard<20){size-=0.4;msg.style.fontSize=size+'px';guard++;}
 }
}
function fitAllKudosCards(scope){
 const root=scope||document;
 requestAnimationFrame(()=>root.querySelectorAll('.kd-card-fullbg').forEach(fitKudosCard));
}

// ---- Router ----------------------------------------------------------------
function render(){
 clearTimeout(liveFeedTimer);
 let content='';
 if(state.mode==='employee'){
  content=state.page==='public-feed'?publicFeedPage():state.page==='send-kudos'?sendKudos():state.page==='kudos-profile'?profile():state.page==='kudos-detail'?kudosDetail():employeeHome();
 } else {
  const outdated=backendOutdated()?`<div class="backend-warn" role="alert"><b>⚠ Apps Script đang chạy bản cũ (${escapeHtml(String((BOOT.config&&BOOT.config.version)||'không rõ'))})</b><span>Web app cần ${REQUIRED_BACKEND} trở lên. Dán Code.gs mới vào Apps Script → Deploy → Manage deployments → Edit → Version: <b>New version</b>. Khi chưa cập nhật, gửi KUDOS có thể báo lỗi Giá trị.</span></div>`:'';
  const sub=outdated+adminSubtabs(),body=(state.page==='admin-people'?adminPeople():state.page==='admin-words'?adminWords():state.page==='admin-notify'?adminNotify():state.page==='admin-recognition'?adminRecognition():state.page==='admin-quality'?adminQuality():state.page==='admin-dept'?adminDept():state.page==='admin-culture'?adminCulture():state.page==='admin-ops'?adminOps():adminHome());
  // Sub-tabs live inside the page container so they share its width/gutters at every breakpoint.
  content=sub&&/^\s*<section class="page[^"]*"[^>]*>/.test(body)?body.replace(/^\s*<section class="page[^"]*"[^>]*>/,m=>m+sub):sub+body;
 }
 if(state.mode==='employee'&&state.page==='public-feed')markCommunitySeen();
 document.querySelector('#app').innerHTML=shell(content);
 bind();
 celebrateOnboard();
 fitAllKudosCards(document.querySelector('#app'));
}

function initials(name=''){
 return String(name).split(' ').filter(Boolean).slice(-2).map(x=>x[0]).join('').toUpperCase()||'AK';
}

// ---- Public feed reactions + periodic refresh --------------------------------
// Optimistic reactions: the button changes instantly; the server call runs in the background.
// Rapid taps on the same reaction are coalesced (tap-untap within 400ms sends nothing).
const reactionSync={};
function reactionTargets(id){return [store.received,store.sent,store.community].flatMap(l=>l.filter(k=>k.id===id)).concat(store.detail[id]?[store.detail[id]]:[]);}
function setReactionLocal(id,kind,on){
 reactionTargets(id).forEach(k=>{k.myReactions=Object.assign({},k.myReactions);k.reactions=Object.assign({heart:0,clap:0,cheer:0,spark:0},k.reactions);const was=!!k.myReactions[kind];if(was!==on){k.myReactions[kind]=on;k.reactions[kind]=Math.max(0,Number(k.reactions[kind]||0)+(on?1:-1));}});
 paintReactions(id);
}
function paintReactions(id){
 const k=reactionTargets(id)[0];if(!k)return;
 document.querySelectorAll(`[data-reaction][data-public-id="${CSS.escape(id)}"]`).forEach(b=>{const kind=b.dataset.reaction;b.classList.toggle('active',!!(k.myReactions&&k.myReactions[kind]));b.setAttribute('aria-pressed',String(!!(k.myReactions&&k.myReactions[kind])));const n=b.querySelector('b');if(n)n.textContent=Number((k.reactions&&k.reactions[kind])||0);});
}
function toggleReaction(id,kind){
 const k=reactionTargets(id)[0];if(!k)return;
 const key=id+':'+kind,on=!(k.myReactions&&k.myReactions[kind]);
 const st=reactionSync[key]||(reactionSync[key]={confirmed:!on,inflight:false,timer:null});
 st.desired=on;setReactionLocal(id,kind,on);
 clearTimeout(st.timer);st.timer=setTimeout(()=>flushReaction(id,kind),400);
}
async function flushReaction(id,kind){
 const key=id+':'+kind,st=reactionSync[key];if(!st||st.inflight)return;
 if(st.desired===st.confirmed){delete reactionSync[key];return;}
 st.inflight=true;
 try{
  const rec=await rpc('doiReaction',id,kind); // server toggles; only called when desired ≠ confirmed
  st.confirmed=!!(rec.myReactions&&rec.myReactions[kind]);
  // Take server counts, but keep any reaction the user is still changing on this KUDOS.
  const pending=Object.keys(reactionSync).filter(x=>x.startsWith(id+':')&&x!==key&&reactionSync[x].desired!==reactionSync[x].confirmed).map(x=>x.split(':').pop());
  reactionTargets(id).forEach(t=>{Object.keys(rec.reactions||{}).forEach(r=>{if(pending.includes(r))return;t.reactions=Object.assign({},t.reactions,{[r]:rec.reactions[r]});t.myReactions=Object.assign({},t.myReactions,{[r]:!!(rec.myReactions&&rec.myReactions[r])});});});
  if(st.desired!==st.confirmed)setReactionLocal(id,kind,st.desired);else paintReactions(id);
 }catch(e){st.desired=st.confirmed;setReactionLocal(id,kind,st.confirmed);toast(e.message);}
 finally{st.inflight=false;if(reactionSync[key]){if(st.desired!==st.confirmed)flushReaction(id,kind);else delete reactionSync[key];}}
}
// Community feed refresh: every 60s while the tab is visible (keeps Apps Script load bounded).
function schedulePublicFeedDemo(){
 clearTimeout(liveFeedTimer);
 if(state.page!=='public-feed'||state.mode!=='employee')return;
 liveFeedTimer=setTimeout(async()=>{
  if(document.visibilityState!=='visible'||Object.keys(reactionSync).length){schedulePublicFeedDemo();return;}
  try{await refreshEmployeeData();if(state.page==='public-feed')render();}
  catch(e){console.warn('[AHAKUDOS] feed refresh',e);schedulePublicFeedDemo();}
 },60000);
}
function bindPublicFeed(){
 document.querySelectorAll('[data-reaction][data-public-id]').forEach(btn=>btn.addEventListener('click',(e)=>{e.stopPropagation();toggleReaction(btn.dataset.publicId,btn.dataset.reaction);}));
 schedulePublicFeedDemo();
}

// ---- Intro banner (giữ nguyên vibe tím–xanh) ------------------------------
function showEmployeeHomeIntroBanner(){
 const existing=document.querySelector('.employee-home-intro-overlay');
 if(existing)existing.remove();
 const previousOverflow=document.body.style.overflow;
 document.body.style.overflow='hidden';
 const overlay=document.createElement('div');
 overlay.className='employee-home-intro-overlay';
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Giới thiệu AHAKUDOS');overlay.setAttribute('aria-modal','true');
 overlay.innerHTML=`
   <div class="employee-home-intro-banner centered-layout">
     <button class="home-intro-close" aria-label="Đóng">×</button>
     <div class="home-intro-header"><div class="home-intro-brandmark">${logo(true)}</div><div class="kicker">CHÀO MỪNG ĐẾN VỚI AHAKUDOS</div><p>AHAKUDOS là nơi bạn gửi lời ghi nhận đến đồng nghiệp, theo dõi những lời cảm ơn đang lan tỏa trong công ty và lưu lại hành trình ghi nhận của chính mình.</p></div>
     <div class="home-intro-card-grid">
       <div class="intro-showcase-card card-send"><div class="intro-showcase-icon" aria-hidden="true">🧡</div><h3>Gửi KUDOS</h3><p>Viết lời ghi nhận cho một hành động cụ thể mà bạn trân trọng ở đồng nghiệp.</p><button class="intro-showcase-btn" data-home-intro-action="send">Gửi ngay</button></div>
       <div class="intro-showcase-card card-feed"><div class="intro-showcase-icon" aria-hidden="true">🚀</div><h3>CỘNG ĐỒNG KUDOS</h3><p>Khám phá những lời ghi nhận đã được Admin duyệt để hiển thị công khai.</p><button class="intro-showcase-btn" data-home-intro-action="feed">Khám phá</button></div>
       <div class="intro-showcase-card card-profile"><div class="intro-showcase-icon" aria-hidden="true">🏆</div><h3>Hồ sơ KUDOS</h3><p>Xem lại những KUDOS bạn đã gửi, đã nhận và giữ lại để đọc về sau.</p><button class="intro-showcase-btn" data-home-intro-action="profile">Xem thêm</button></div>
       <div class="intro-showcase-card card-milestone"><div class="intro-showcase-icon" aria-hidden="true">🎁</div><h3>Lời chúc đặc biệt</h3><p>Gửi lời chúc cho sinh nhật và những dấu mốc đặc biệt của đồng nghiệp.</p><button class="intro-showcase-btn" data-home-intro-action="explore">Đã rõ</button></div>
     </div>
     <div class="home-intro-bottom-note">Bạn có thể bắt đầu bằng một lời ghi nhận nhỏ, nhưng đó có thể là điều rất ý nghĩa với người nhận.</div>
   </div>`;
 document.body.appendChild(overlay);
 requestAnimationFrame(()=>overlay.classList.add('show'));
 let closed=false;
 const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',onKeydown);overlay.classList.remove('show');document.body.style.overflow=previousOverflow;setTimeout(()=>overlay.remove(),220);};
 const onKeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const buttons=[...overlay.querySelectorAll('button')];const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
 document.addEventListener('keydown',onKeydown);
 requestAnimationFrame(()=>overlay.querySelector('.home-intro-close').focus({preventScroll:true}));
 overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
 overlay.querySelector('.home-intro-close').addEventListener('click',close);
 overlay.querySelectorAll('[data-home-intro-action]').forEach(btn=>btn.addEventListener('click',()=>{const action=btn.dataset.homeIntroAction;const destinations={send:'send-kudos',feed:'public-feed',profile:'kudos-profile'};close();if(destinations[action]){state.page=destinations[action];setTimeout(()=>{render();window.scrollTo(0,0);},230);}}));
}

// ---- Handbook directory search + rules modal ------------------------------
function bindHandbookUI(){
 const input=document.querySelector('#hb-directory-search');
 const results=document.querySelector('#hb-directory-results');
 if(input&&results){
  const normalize=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/gi,'d').toLowerCase();
  const hide=()=>{results.classList.add('hidden');input.setAttribute('aria-expanded','false');};
  input.addEventListener('input',()=>{
   const q=normalize(input.value.trim());
   if(!q){hide();return;}
   const pool=state.mode==='employee'?employees.filter(e=>e.email!==me().email):employees;
   const matches=pool.filter(e=>normalize(e.name+' '+e.email+' '+e.dept).includes(q)).slice(0,5);
   results.innerHTML=matches.length?matches.map(e=>`<button class="recipient-suggestion" data-directory-email="${escapeHtml(e.email)}">${miniAvatar(e.email,e.name)}<div><b>${escapeHtml(e.name)}</b><span>${escapeHtml(e.email)}</span><em>${escapeHtml(e.dept)}</em></div><i aria-hidden="true">↗</i></button>`).join(''):'<div class="recipient-no-result">Không có đồng nghiệp phù hợp trong Master Data.</div>';
   results.classList.remove('hidden');input.setAttribute('aria-expanded','true');
   results.querySelectorAll('[data-directory-email]').forEach(btn=>btn.addEventListener('click',()=>{
    const email=btn.dataset.directoryEmail;
    if(state.mode==='employee'){state.prefillRecipient=email;state.selectedRecipient=personByEmail(email);state.page='send-kudos';render();}
    else{state.page='admin-recognition';render();const target=document.querySelector('#admin-recipient-email');target.value=email;target.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(`[data-admin-email="${CSS.escape(email)}"]`)?.click();}
    window.scrollTo(0,0);
   }));
  });
  input.addEventListener('keydown',e=>{if(e.key==='Escape')hide();if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}});
  document.querySelector('.hb-directory').addEventListener('focusout',()=>setTimeout(()=>{if(!document.querySelector('.hb-directory')?.contains(document.activeElement))hide();},150));
 }
 document.querySelectorAll('.field').forEach(field=>{const label=field.querySelector('label');const control=field.querySelector('input[id],textarea[id],select[id]');if(label&&control)label.setAttribute('for',control.id);});
 const sendPreview=document.querySelector('#preview');
 if(sendPreview)sendPreview.addEventListener('click',()=>{const review=document.querySelector('#kudos-preview');review?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});document.querySelector('#kudos-review-title')?.focus({preventScroll:true});});
 const adminPreview=document.querySelector('#admin-recognition-preview');
 if(adminPreview)adminPreview.addEventListener('click',()=>{document.querySelector('.admin-recognition-preview')?.scrollIntoView({behavior:'smooth',block:'start'});});
 document.querySelectorAll('[data-modal="rules"]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="hb-rules-title"><button class="modal-close" aria-label="Đóng">×</button><div class="kicker">GỬI KUDOS</div><h2 id="hb-rules-title">Quy tắc ghi nhận</h2><div class="rules"><div class="rule"><b>Người nhận</b><span>Tìm email Ahamove trong Master Data; nếu không có mail công ty, tick lựa chọn và nhập thông tin người nhận thủ công.</span></div><div class="rule"><b>Nội dung</b><span>Theo Format tiêu chuẩn:<span class="rule-list"><span><b>01</b> Khoảnh khắc khiến bạn muốn ghi nhận</span><span><b>02</b> Sự hỗ trợ / Năng lượng mà bạn đã nhận được</span></span>Thư ký KUDOS sẽ hỗ trợ nếu nội dung KUDOS chưa đủ woah.</span></div><div class="rule"><b>Giá trị cốt lõi</b><span>Chọn từ 1 đến 3 giá trị (tham khảo định nghĩa ngay tại ô chọn):<span class="rule-list"><span><b>⚡ Tốc độ</b> · <b>🤝 Đồng hành</b> · <b>💡 Đổi mới</b></span></span></span></div><div class="rule"><b>KUDOS Khác</b><span><span class="rule-list"><span><b>🎂 Sinh nhật</b> — gửi trong vòng 2 ngày trước/sau ngày sinh.</span><span><b>✦ Thâm niên</b> — gửi trong vòng 2 ngày trước/sau ngày vào Ahamove (từ 1 năm).</span><span><b>✎ Dịp khác</b> — tự đặt tên dịp (Thăng chức, Chào mừng thành viên mới…).</span></span>Ngày lấy theo Master Data, hoặc nhập tay nếu người nhận không có trong Master Data. Giá trị cốt lõi không bắt buộc.</span></div><div class="rule"><b>Phạm vi</b><span>Mặc định được đề xuất lên CỘNG ĐỒNG KUDOS và chỉ hiển thị sau khi Admin duyệt.</span></div><div class="rule"><b>Hạn mức gửi</b><span>Mỗi nhân sự trong Master Data được gửi tối đa 5 KUDOS mỗi ngày.</span></div></div><button class="btn primary wide hb-rules-close">Đã hiểu</button></div></div>`;
  document.querySelectorAll('.modal-close,.hb-rules-close').forEach(b=>b.addEventListener('click',()=>document.querySelector('#modal-root').innerHTML=''));
 }));
}

// ---- Bind ------------------------------------------------------------------
function bind(){
 let introShown=true;try{introShown=!!sessionStorage.getItem('ahakudos-intro-shown');}catch(e){}
 if(state.mode==='employee'&&state.page==='employee-home'&&!introShown){try{sessionStorage.setItem('ahakudos-intro-shown','1');}catch(e){}showEmployeeHomeIntroBanner();}
 document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{goToPage(b.dataset.page);}));
 document.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',async()=>{
   state.mode=b.dataset.switch;state.page=state.mode==='employee'?'employee-home':'admin-home';
   if(state.mode==='employee'&&employeeStale){try{await refreshEmployeeData();}catch(e){toast(e.message);}}
   render();window.scrollTo(0,0);
 }));
 document.querySelectorAll('[data-admin-reload]').forEach(b=>b.addEventListener('click',()=>{ADMIN.error='';loadAdminData(true);render();}));
 document.querySelectorAll('[data-open-kudos]').forEach(el=>{
   const open=(e)=>{e.stopPropagation();openKudos(el.getAttribute('data-open-kudos'));};
   el.addEventListener('click',open);
   if(el.getAttribute('role')==='button')el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(e);}});
 });
 if(state.page==='send-kudos') bindSend();
 if(state.page==='public-feed') bindPublicFeed();
 if(state.page==='kudos-profile') bindTabs();
 if(state.page==='admin-recognition'&&ADMIN.loaded) bindAdminRecognition();
 if(state.page==='admin-ops'&&ADMIN.loaded) bindAdminOps();
 if(state.page==='admin-notify'&&ADMIN.loaded) bindAdminEmail();
 if(state.page==='admin-quality'&&ADMIN.loaded) bindAdminQuality();
 if(state.page==='admin-words'&&ADMIN.loaded) bindAdminWords();
 if(state.page==='admin-people'&&ADMIN.loaded) bindAdminPeople();
 if((state.page==='admin-home'||state.page==='admin-dept'||state.page==='admin-culture'||state.page==='admin-people')&&ADMIN.loaded) bindAdminFilters();
 document.querySelectorAll('[data-cta-route]').forEach(b=>b.addEventListener('click',()=>ctaGo(b.dataset.ctaRoute,b.dataset.ctaId)));
 document.querySelectorAll('[data-birthday]').forEach(b=>b.addEventListener('click',()=>{state.prefillRecipient=b.dataset.birthday;state.selectedRecipient=personByEmail(b.dataset.birthday)||null;state.kudosType='birthday';state.selectedTemplate=BIRTHDAY_TEMPLATE_IDS[0];state.page='send-kudos';render();toast('Đã chọn đồng nghiệp và mẫu Sinh nhật. Hãy viết lời chúc.');}));
 document.querySelectorAll('[data-avatar-edit]').forEach(b=>b.addEventListener('click',openAvatarEditor));
 document.querySelectorAll('[data-reply-quick]').forEach(b=>b.addEventListener('click',()=>{const t=document.querySelector('#reply-text');if(t){t.value=b.dataset.replyQuick;t.focus();}}));
 document.querySelectorAll('[data-reply-send]').forEach(b=>b.addEventListener('click',async()=>{const t=document.querySelector('#reply-text');const text=(t&&t.value||'').trim();if(!text){t&&t.focus();return;}b.disabled=true;try{const r=await rpc('guiPhanHoi',b.dataset.replySend,text);takeRecord(r.record);render();toast(r.notice);}catch(e){b.disabled=false;toast(e.message);}}));
 document.querySelectorAll('[data-fab]').forEach(b=>b.addEventListener('click',()=>openFab(b)));
 document.querySelectorAll('[data-share-community]').forEach(b=>b.addEventListener('click',async()=>{const share=b.dataset.share==='1';b.disabled=true;try{const r=await rpc('chiaSeCongDong',b.dataset.shareCommunity,share);takeRecord(r.record);if(share&&!store.community.some(x=>x.id===r.record.id))store.community.unshift(r.record);if(!share)store.community=store.community.filter(x=>x.id!==r.record.id);render();toast(r.notice);if(share)launchConfetti();}catch(e){b.disabled=false;toast(e.message);}}));
 document.querySelectorAll('[data-rewrite-kudos]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();rewriteKudos(b.dataset.rewriteKudos);}));
 bindHandbookUI();
}
function goToPage(page){adminPerson='';state.page=page;if(page!=='kudos-detail')state.viewKudosId=null;render();window.scrollTo(0,0);}
function openKudos(id){state.viewKudosId=id;state.page='kudos-detail';try{history.replaceState(null,'','#/k/'+id);}catch(e){}render();window.scrollTo(0,0);}

function bindTabs(){
 document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));document.querySelector('#tab-'+t.dataset.tab).classList.add('active');}));
}

function bindAdminRecognition(){
 const emailInput=document.querySelector('#admin-recipient-email');const suggestions=document.querySelector('#admin-recipient-suggestions');const selectedBox=document.querySelector('#admin-selected-recipient');const message=document.querySelector('#admin-recognition-message');const title=document.querySelector('#admin-recognition-title');
 const noCompany=document.querySelector('#admin-no-company-email');const companyMode=document.querySelector('#admin-company-mode');const manualMode=document.querySelector('#admin-manual-mode');const manualName=document.querySelector('#admin-manual-name');const manualDept=document.querySelector('#admin-manual-dept');const manualEmail=document.querySelector('#admin-manual-email');
 let selectedEmployee=null;let selectedTemplate='wish';let selectedType='acting';let selectedVisibility='public';let manualRecipient=false;
 function renderEmployee(emp){selectedEmployee=emp;if(!emp){selectedBox.classList.add('hidden');selectedBox.innerHTML='';document.querySelector('#admin-recipient-preview').innerHTML='<div class="mini-avatar">@</div><div><b>Chưa chọn người nhận</b><span>Nhập email nhân sự để tìm kiếm</span></div>';return;}selectedBox.innerHTML=`${miniAvatar(emp.email,emp.name)}<div><b>${escapeHtml(emp.name)}</b><span>${escapeHtml(emp.email)}</span><em>${escapeHtml(emp.dept||'')}</em></div><span class="recipient-ok">✓ Đã chọn</span>`;selectedBox.classList.remove('hidden');document.querySelector('#admin-recipient-preview').innerHTML=`${miniAvatar(emp.email,emp.name)}<div><b>${escapeHtml(emp.name)}</b><span>${escapeHtml(emp.email)}</span><em>${escapeHtml(emp.dept||'')}</em></div>`;}
 function visibilityUi(){document.querySelectorAll('[data-admin-visibility]').forEach(x=>{x.disabled=false;x.classList.remove('disabled');x.classList.toggle('selected',x.dataset.adminVisibility===selectedVisibility);});}
 function syncManualPreview(){if(!manualRecipient)return;const emp={name:manualName.value.trim(),dept:manualDept.value.trim(),email:manualEmail.value.trim(),manual:true};if(emp.name||emp.email)renderEmployee(emp);else renderEmployee(null);updatePreview();}
 function applyMode(on){manualRecipient=!!on;companyMode.classList.toggle('hidden',manualRecipient);manualMode.classList.toggle('hidden',!manualRecipient);if(manualRecipient){emailInput.value='';suggestions.classList.add('hidden');renderEmployee(null);}visibilityUi();syncManualPreview();updatePreview();}
 function updatePreview(){const card=document.querySelector('#admin-preview-card');if(card){card.innerHTML=buildKudosCard({senderName:'AHAKUDOS',senderDept:'Ahamove',message:message.value.trim()||'Nội dung AHAKUDOS sẽ xuất hiện tại đây.',templateId:selectedTemplate,values:[]},{mode:selectedVisibility==='public'?'public':''});fitAllKudosCards(card);}const visibility=document.querySelector('#admin-preview-visibility');if(visibility){visibility.textContent=selectedVisibility==='public'?'◎ CỘNG ĐỒNG KUDOS':'● Chỉ người nhận biết';visibility.classList.toggle('private',selectedVisibility==='private');}}
 noCompany?.addEventListener('change',()=>applyMode(noCompany.checked));
 [manualName,manualDept,manualEmail].forEach(el=>el?.addEventListener('input',syncManualPreview));
 emailInput.addEventListener('input',()=>{if(manualRecipient)return;selectedEmployee=null;renderEmployee(null);const q=emailInput.value.trim().toLowerCase();if(!q){suggestions.classList.add('hidden');suggestions.innerHTML='';return}const matches=employees.filter(e=>e.email.toLowerCase().includes(q)).slice(0,5);suggestions.innerHTML=matches.length?matches.map(e=>`<button type="button" class="recipient-suggestion" data-admin-email="${escapeHtml(e.email)}">${miniAvatar(e.email,e.name)}<div><b>${escapeHtml(e.name)}</b><span>${escapeHtml(e.email)}</span><em>${escapeHtml(e.dept)}</em></div></button>`).join(''):'<div class="recipient-no-result">Không tìm thấy email phù hợp. Có thể tick “không có mail công ty”.</div>';suggestions.classList.remove('hidden');suggestions.querySelectorAll('[data-admin-email]').forEach(btn=>btn.addEventListener('click',()=>{const emp=employees.find(e=>e.email===btn.dataset.adminEmail);emailInput.value=emp.email;suggestions.classList.add('hidden');renderEmployee(emp);}));});
 emailInput.addEventListener('blur',()=>setTimeout(()=>suggestions.classList.add('hidden'),150));
 document.querySelectorAll('[data-recognition-type]').forEach(btn=>btn.addEventListener('click',()=>{selectedType=btn.dataset.recognitionType;document.querySelectorAll('[data-recognition-type]').forEach(x=>x.classList.toggle('selected',x===btn));const defaults={acting:'Cảm ơn bạn đã chủ động đảm nhận thêm một vai trò',promotion:'Chúc mừng một bước phát triển mới',trainer:'Cảm ơn bạn đã đồng hành và phát triển người khác',project:'Ghi nhận một dấu mốc đáng nhớ của dự án',campaign:'Cảm ơn đóng góp của bạn cho hoạt động chung',other:'Một điều đáng được Ahamove ghi nhận'};title.value=defaults[selectedType]||defaults.other;updatePreview();}));
 function bindGallery(){
  document.querySelectorAll('[data-admin-template]').forEach(btn=>btn.addEventListener('click',()=>{selectedTemplate=btn.dataset.adminTemplate;document.querySelectorAll('[data-admin-template]').forEach(x=>{x.classList.toggle('selected',x===btn);x.setAttribute('aria-pressed',String(x===btn));});updatePreview();}));
  document.querySelector('#admin-bg-upload-open')?.addEventListener('click',()=>{document.querySelector('#admin-bg-upload').classList.remove('hidden');document.querySelector('#admin-bg-name').focus();});
  document.querySelectorAll('[data-bg-toggle]').forEach(b=>b.addEventListener('click',async()=>{
   b.disabled=true;
   try{const res=await rpc('doiTrangThaiAnhNen',b.dataset.bgToggle,b.dataset.on==='1');CUSTOM_BGS=res.backgrounds||CUSTOM_BGS;employeeStale=true;if(!customBgTemplates().some(t=>t.id===selectedTemplate)&&!cardTemplates.some(t=>t.id===selectedTemplate))selectedTemplate='wish';refreshGallery();toast(res.notice);}
   catch(e){b.disabled=false;toast(e.message);}
  }));
 }
 function refreshGallery(){document.querySelector('#admin-template-gallery').innerHTML=adminGalleryHtml(selectedTemplate);document.querySelector('#admin-bg-list').innerHTML=adminBgListHtml();bindGallery();updatePreview();}
 bindGallery();
 let pendingBg=null;
 const bgFile=document.querySelector('#admin-bg-file'),bgName=document.querySelector('#admin-bg-name'),bgSave=document.querySelector('#admin-bg-save'),bgPrev=document.querySelector('#admin-bg-preview');
 const syncBgSave=()=>{bgSave.disabled=!(pendingBg&&bgName.value.trim().length>=2);};
 bgName.addEventListener('input',syncBgSave);
 bgFile.addEventListener('change',async()=>{
  const f=bgFile.files&&bgFile.files[0];if(!f)return;
  try{pendingBg=await prepareBackgroundImage(f);bgPrev.innerHTML=`<img src="${pendingBg}" alt="Xem trước background">`;if(!bgName.value.trim())bgName.value=f.name.replace(/\.[a-z0-9]+$/i,'').slice(0,60);}
  catch(e){pendingBg=null;toast(e.message);}
  syncBgSave();
 });
 document.querySelector('#admin-bg-cancel').addEventListener('click',()=>{pendingBg=null;bgFile.value='';bgName.value='';bgPrev.innerHTML='<span>Ảnh sẽ được tự cắt về khung 16:9 (1672 × 941) giống các mẫu có sẵn.</span>';syncBgSave();document.querySelector('#admin-bg-upload').classList.add('hidden');});
 bgSave.addEventListener('click',async()=>{
  bgSave.disabled=true;bgSave.textContent='Đang tải lên…';
  try{const res=await rpc('taiAnhNen',{name:bgName.value.trim(),dataUrl:pendingBg});CUSTOM_BGS=res.backgrounds||CUSTOM_BGS;employeeStale=true;selectedTemplate=res.id;pendingBg=null;bgFile.value='';bgName.value='';document.querySelector('#admin-bg-upload').classList.add('hidden');refreshGallery();toast(res.notice);}
  catch(e){toast(e.message);syncBgSave();}
  finally{bgSave.textContent='Tải lên';}
 });
 document.querySelectorAll('[data-admin-visibility]').forEach(btn=>btn.addEventListener('click',()=>{selectedVisibility=btn.dataset.adminVisibility;visibilityUi();updatePreview();}));
 title.addEventListener('input',updatePreview);message.addEventListener('input',updatePreview);
 document.querySelector('#admin-recognition-preview').addEventListener('click',()=>{updatePreview();toast('Đã cập nhật bản xem trước.')});
 document.querySelector('#admin-recognition-send').addEventListener('click',async()=>{
  if(manualRecipient){const name=manualName.value.trim(),dept=manualDept.value.trim(),email=manualEmail.value.trim().toLowerCase();if(name.length<2||dept.length<2||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Điền đủ họ tên, phòng ban/đơn vị và email liên hệ hợp lệ.');return;}selectedEmployee={name,dept,email,manual:true};}
  if(!selectedEmployee||message.value.trim().length<20){toast('Chọn người nhận và viết lời ghi nhận trước.');return;}
  const btn=document.querySelector('#admin-recognition-send');btn.disabled=true;
  const payload={type:'admin',recipientEmail:selectedEmployee.email,recipientManual:!!selectedEmployee.manual,recipientName:selectedEmployee.name,recipientDept:selectedEmployee.dept,message:message.value.trim(),values:[],templateId:selectedTemplate,visibility:selectedVisibility};
  const fp=JSON.stringify(payload);if(!window.__ahakudosAdminPending||window.__ahakudosAdminPending.fp!==fp)window.__ahakudosAdminPending={fp,id:uid()};payload.requestId=window.__ahakudosAdminPending.id;
  showLoaderOverlay('Đang gửi AHAKUDOS…');
  try{const result=await rpc('taoKudos',payload);window.__ahakudosAdminPending=null;hideLoaderOverlay();loadAdminData(true);showAdminRecognitionSuccess(selectedEmployee,title.value.trim(),payload.visibility);toast(result.notice);}
  catch(e){hideLoaderOverlay();showActionError(e);}finally{hideLoaderOverlay();btn.disabled=false;}
 });
 applyMode(false);updatePreview();
 if(state.adminPrefill){
  const pre=state.adminPrefill;state.adminPrefill=null;
  const emp=employees.find(e=>e.email===pre.email);
  if(emp){emailInput.value=emp.email;renderEmployee(emp);}
  const tplBtn=document.querySelector(`[data-admin-template="${pre.template}"]`);if(tplBtn)tplBtn.click();
  if(pre.type==='birthday'){title.value='Chúc mừng sinh nhật bạn 🎂';}else if(pre.type==='anniversary'){title.value='Cảm ơn bạn vì một hành trình đáng nhớ cùng Ahamove';}
  updatePreview();
 }
}
function showAdminRecognitionSuccess(employee,title,visibility='public'){
 document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal admin-recognition-success"><div class="success-sticker"><span>✨</span><i>✦</i><i>★</i><i>●</i></div><div class="kicker">AHAKUDOS ĐÃ ĐƯỢC LƯU</div><h2>${escapeHtml(title||'Lời ghi nhận đã được lưu')}</h2><p>AHAKUDOS đã được lưu và sẽ xuất hiện trong Hồ sơ KUDOS của <b>${escapeHtml(employee.name)}</b>.</p><div class="sent-visibility-detail ${visibility==='public'?'public':'private'}">${visibility==='public'?'◎ CỘNG ĐỒNG KUDOS · Chờ Admin duyệt':'● Chỉ người nhận biết · Không hiển thị trên CỘNG ĐỒNG KUDOS'}</div><div class="email-delivery-note"><span>✉</span><div><b>Chờ Admin duyệt</b><p>AHAKUDOS được đưa vào hàng chờ duyệt. Sau khi duyệt, email thông báo sẽ gửi tới <strong>${escapeHtml(employee.email)}</strong>.</p></div></div><button class="btn primary wide admin-recognition-done">Hoàn tất</button></div></div>`;
 launchConfetti();
 document.querySelector('.admin-recognition-done').addEventListener('click',()=>{document.querySelector('#modal-root').innerHTML='';state.page='admin-home';render()});
}

// ---- Compose binding + coach + single-source preview ----------------------
function qualityCoach(text,ctx){
 // Rule-based WRITING COACH — surfaces ONE most-useful nudge.
 // Never scores, never blocks, never claims to verify sincerity. Swappable for a
 // real model later: keep signature (text, ctx) -> {nudge, note}.
 const low=(text||'').toLowerCase();
 const name=ctx&&ctx.recipientFirst?ctx.recipientFirst:'';
 const len=(text||'').trim().length;
 const q=kudosQuality(text);
 // Thư ký KUDOS: thân thiện, dễ thương, tích cực, không phán xét — góp ý nhẹ nhàng, cụ thể.
 const who=name?` ${name}`:'';
 const cheers=['Đỉnh nóc kịch trần! 🚀 KUDOS này đủ woah để gửi rồi đó ✨','KUDOS đủ woah để gửi rồi đó ✨ Gửi thôi nào!','Tuyệt cú mèo! 🧡 Có khoảnh khắc, có năng lượng — đồng nghiệp sẽ vui lắm đây.'];
 let nudge;
 if(len===0){nudge=`Chào bạn 👋 Thư ký đây! Kể mình nghe <b>khoảnh khắc</b> khiến bạn muốn ghi nhận${who} nha.`;}
 else if(len>=12&&!q.has.about){nudge=`Hình như nội dung này chưa nói về đồng nghiệp bạn muốn ghi nhận 🤔 KUDOS là lời <b>cảm ơn / ghi nhận dành cho một người cụ thể</b> — thử kể điều${who||' đồng nghiệp'} đã làm cho bạn hoặc team nhé.`;}
 else if(!q.has.moment||len<25){nudge=`Lời cảm ơn ấm áp quá 🧡 Mình thêm một <b>khoảnh khắc cụ thể</b> nữa nhé — lúc nào,${who||' đồng nghiệp'} đã làm gì — để lời KUDOS thật đáng nhớ.`;}
 else if(!q.has.energy){nudge=`Sắp xong rồi nè ✨ Điều đó đã mang lại <b>sự hỗ trợ / năng lượng</b> gì cho bạn hoặc team? Thêm một câu thôi là chạm tim luôn.`;}
 else if(!q.ok){nudge=`Gần xong rồi 🌱 Thêm vài chi tiết nhỏ (khoảng ${KUDOS_QUALITY.minWords} từ trở lên) để${who||' đồng nghiệp'} cảm nhận rõ hơn sự chân thành của bạn nha.`;}
 else{let h=0;for(const ch of String(text).slice(0,24))h=(h*31+ch.charCodeAt(0))>>>0;nudge=cheers[h%cheers.length];}
 return {nudge};
}
function updatePreview(){
 const card=document.querySelector('#kudos-preview-card');
 if(!card)return;
 const rec=composeRecord();
 const recipient=document.querySelector('#kudos-preview-recipient');
 if(recipient)recipient.textContent=rec.recipientName?`${rec.recipientName} · ${rec.recipientEmail}`:(rec.recipientEmail||'Chưa chọn người nhận');
 // Preview dùng đúng renderer của màn KUDOS detail để người gửi thấy chính xác nội dung + background người nhận sẽ mở ra.
 card.innerHTML=buildKudosCard(rec);
 fitAllKudosCards(card);
}
function renderSelectedRecipient(employee){
 syncCultureRequirement();
 const box=document.querySelector('#selected-recipient');if(!box)return;
 if(!employee){box.classList.add('hidden');box.innerHTML='';return;}
 box.innerHTML=`${miniAvatar(employee.email,employee.name)}<div class="sr-main"><b>${escapeHtml(employee.name)}</b><span>${escapeHtml(employee.email)} · ${escapeHtml(employee.dept)}</span></div><span class="recipient-ok">✓ Đã chọn</span><button type="button" class="sr-remove" id="recipient-remove" title="Đổi người nhận" aria-label="Bỏ chọn người nhận">×</button>`;
 box.classList.remove('hidden');
 const rm=document.querySelector('#recipient-remove');
 if(rm)rm.addEventListener('click',()=>{
   state.selectedRecipient=null;state.prefillRecipient='';
   const inp=document.querySelector('#recipient-email');if(inp){inp.value='';inp.focus();}
   renderSelectedRecipient(null);updatePreview();
 });
}
function runCoach(){
 const msg=document.querySelector('#message');if(!msg)return;
 const r=state.selectedRecipient;
 const out=qualityCoach(msg.value,{recipientFirst:r?r.name.split(' ').slice(-1)[0]:''});
 const nudge=document.querySelector('#coach-nudge');if(nudge)nudge.innerHTML=out.nudge;
 // Gợi ý Giá trị cốt lõi kèm lý do (chỉ làm nổi, không tự chọn). Không gợi ý khi nội dung chưa phải là lời ghi nhận.
 const text=msg.value,low=text.toLowerCase();
 const found={speed:[],together:[],innovation:[]};
 if(kudosQuality(text).has.about)Object.keys(VALUE_HINTS).forEach(v=>VALUE_HINTS[v].forEach(w=>{if(low.includes(w)&&found[v].length<3&&!found[v].includes(w))found[v].push(w);}));
 const sug=VALUE_IDS.filter(v=>found[v].length);
 document.querySelectorAll('.culture-chip').forEach(c=>c.classList.remove('suggested'));
 sug.forEach(v=>document.querySelector(`[data-value="${v}"]`)?.classList.add('suggested'));
 const hint=document.querySelector('#ai-values');
 if(hint){hint.classList.toggle('has-suggest',!!sug.length);hint.innerHTML=sug.length?`<div class="value-suggest-title">✦ Thư ký gợi ý Giá trị cốt lõi</div><ul>${sug.map(v=>`<li><img src="${CULTURE_IMG(v)}" alt="" width="28" height="28" data-hide-on-error><span><b>${CULTURE[v]}</b> ${escapeHtml(VALUE_WHY[v](found[v]))}</span></li>`).join('')}</ul><p>Bạn có thể tham khảo gợi ý, nhưng giá trị được chọn vẫn do bạn quyết định.</p>`:'Viết nội dung KUDOS, Thư ký sẽ gợi ý Giá trị cốt lõi phù hợp kèm lý do. Bạn có thể tham khảo gợi ý, nhưng giá trị được chọn vẫn do bạn quyết định.';}
}
function templateGalleryHtml(){
 const list=typeTemplates(state.kudosType);
 if(!list.some(t=>t.id===state.selectedTemplate))state.selectedTemplate=(list[0]||{id:'wish'}).id;
 return list.map(t=>`<button type="button" class="template-option ${state.selectedTemplate===t.id?'selected':''}" data-template="${escapeHtml(t.id)}" aria-label="Background ${escapeHtml(t.name)}" aria-pressed="${state.selectedTemplate===t.id}">
        <span class="template-thumb tpl-${escapeHtml(t.id)}" style="background:${bgFor(t.id).fallback}"><img class="art-img" src="${escapeHtml(bgFor(t.id).url)}" alt="" aria-hidden="true"><span class="thumb-tick" aria-hidden="true">✓</span></span>
      </button>`).join('');
}
/** Signed days from today to the nearest occurrence of a MM-DD birthday. */
function birthdayOffsetDays(md){
 if(!/^\d{2}-\d{2}$/.test(md||''))return null;
 const [mm,dd]=md.split('-').map(Number);const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 let best=null;
 for(const y of [today.getFullYear()-1,today.getFullYear(),today.getFullYear()+1]){
   let d=new Date(y,mm-1,dd);if(mm===2&&dd===29&&d.getMonth()!==1)d=new Date(y,1,28);
   const off=Math.round((d-today)/86400000);if(best===null||Math.abs(off)<Math.abs(best))best=off;
 }
 return best;
}
function mdLabel(md){return md?md.slice(3,5)+'/'+md.slice(0,2):'';}
/** Birthday rule (same as server): DOB from DATA, or typed when the recipient is not in DATA; within ±2 days. */
/** Occasion rule (same as server): date from DATA, or typed when the recipient is not in DATA; within ±2 days. */
function birthdayCheck(){
 const o=occasionOf(state.kudosType);
 if(!o)return {ok:true,msg:''};
 if(o.custom){const l=(document.querySelector('#occasion-label')?.value??state.occasionLabel??'').trim();return l.length>=3&&l.length<=60?{ok:true,msg:''}:{ok:false,msg:'Nhập tên dịp (3–60 ký tự), ví dụ: Thăng chức, Chào mừng thành viên mới.',neutral:!l,focus:'#occasion-label'};}
 let md='',name='';
 if(state.manualRecipient){
   const v=(document.querySelector('#recipient-manual-dob')?.value||'').trim();md=/^\d{4}-\d{2}-\d{2}$/.test(v)?v.slice(5):'';
   name=(document.querySelector('#recipient-manual-name')?.value||'').trim()||'người nhận';
   if(!md)return {ok:false,msg:'Nhập '+o.manualLabel.toLowerCase()+' (người nhận không có trong Master Data).'};
 }else{
   const r=state.selectedRecipient&&personByEmail(state.selectedRecipient.email);
   if(!r)return {ok:false,msg:'Chọn đồng nghiệp nhận KUDOS '+o.label+'.',neutral:true};
   name=r.name;md=r[o.field]||'';
   if(!md)return {ok:false,msg:'Master Data chưa có '+o.dataName+' của '+name+'. Vui lòng liên hệ L&OD.'};
 }
 const off=birthdayOffsetDays(md);
 if(off===null||Math.abs(off)>BIRTHDAY_WINDOW_DAYS)return {ok:false,msg:`${o.what} của ${name} là ${mdLabel(md)}. Chỉ gửi KUDOS ${o.label} trong vòng ${BIRTHDAY_WINDOW_DAYS} ngày trước hoặc sau ngày này.`};
 const when=off===0?'hôm nay':off>0?`còn ${off} ngày`:`${-off} ngày trước`;
 return {ok:true,msg:`${o.icon} ${o.what} của ${name}: ${mdLabel(md)} (${when}). Bạn có thể gửi KUDOS.`};
}
function cultureOptional(){return isOccasion();}
function syncCultureRequirement(){
 const optional=cultureOptional();
 const birthday=isOccasion(), occ=occasionOf(state.kudosType);
 // KUDOS Khác (Sinh nhật / Thâm niên / Dịp khác): không cần Format tiêu chuẩn, Thư ký hỗ trợ nội dung và Giá trị cốt lõi.
 ['.kudos-content-format','.coach','#culture-field'].forEach(sel=>document.querySelector(sel)?.classList.toggle('hidden',birthday));
 if(birthday&&state.values.size){state.values.clear();document.querySelectorAll('.culture-chip').forEach(c=>{c.classList.remove('selected','suggested');c.setAttribute('aria-pressed','false');});}
 const msg=document.querySelector('#message');
 if(msg)msg.placeholder=occ?occ.placeholder:'Ví dụ: Cảm ơn bạn đã chủ động hỗ trợ team xử lý gấp đầu việc trước deadline. Nhờ vậy cả team kịp tiến độ và tránh được một lỗi quan trọng. Mình rất trân trọng sự chủ động và tinh thần đồng đội của bạn.';
 const label=document.querySelector('#culture-picker-label .optional-label');
 if(label)label.textContent=optional?'· không bắt buộc':'· chọn từ 1 đến 3';
 const dated=occ&&!occ.custom;
 const dobWrap=document.querySelector('#recipient-manual-dob-wrap');if(dobWrap)dobWrap.classList.toggle('hidden',!dated);
 document.querySelector('#occasion-custom-wrap')?.classList.toggle('hidden',!(occ&&occ.custom));
 const hint=document.querySelector('#occasion-hint');if(hint)hint.textContent=occ&&occ.custom?'Tự đặt tên dịp và viết lời chúc phù hợp.':'Chỉ gửi được trong vòng '+BIRTHDAY_WINDOW_DAYS+' ngày trước hoặc sau ngày kỷ niệm.';
 const dobLabel=document.querySelector('#recipient-manual-dob-label');if(dobLabel&&dated)dobLabel.textContent=occ.manualLabel;
 document.querySelector('#occasion-row')?.classList.toggle('hidden',!occ);
 document.querySelectorAll('[data-occasion]').forEach(b=>{const on=b.dataset.occasion===state.kudosType;b.classList.toggle('selected',on);b.setAttribute('aria-checked',String(on));});
 document.querySelectorAll('[data-kudos-type]').forEach(b=>{const on=b.dataset.kudosType===typeGroup();b.classList.toggle('selected',on);b.setAttribute('aria-checked',String(on));});
 const box=document.querySelector('#birthday-status');
 if(box){
   const c=birthdayCheck();
   box.classList.toggle('hidden',!occ||!c.msg);
   box.classList.toggle('is-ok',!!c.ok);box.classList.toggle('is-warn',!c.ok&&!c.neutral);
   box.textContent=c.msg||'';
 }
}
function bindSend(){
 const msg=document.querySelector('#message');
 const emailInput=document.querySelector('#recipient-email');
 const suggestions=document.querySelector('#recipient-suggestions');
 const noCompany=document.querySelector('#recipient-no-company-email');
 const companyMode=document.querySelector('#recipient-company-mode');
 const manualMode=document.querySelector('#recipient-manual-mode');
 const manualInputs=['#recipient-manual-name','#recipient-manual-dept','#recipient-manual-email'].map(x=>document.querySelector(x));
 let coachTimer=null;
 function setVisibilityUi(){document.querySelectorAll('[data-visibility]').forEach(x=>{x.disabled=false;x.removeAttribute('aria-disabled');x.classList.remove('disabled');x.classList.toggle('selected',x.dataset.visibility===state.sendVisibility);x.setAttribute('aria-pressed',String(x.dataset.visibility===state.sendVisibility));});}
 function applyRecipientMode(on){
   state.manualRecipient=!!on;
   companyMode?.classList.toggle('hidden',state.manualRecipient);
   manualMode?.classList.toggle('hidden',!state.manualRecipient);
   if(state.manualRecipient){
     state.selectedRecipient=null;state.prefillRecipient='';
     if(emailInput)emailInput.value='';
     suggestions?.classList.add('hidden');renderSelectedRecipient(null);
     }
   setVisibilityUi();syncCultureRequirement();updatePreview();runCoach();
 }
 function syncPrefill(){if(state.manualRecipient||!emailInput)return;const exact=employees.find(e=>e.email.toLowerCase()===emailInput.value.trim().toLowerCase()&&e.email!==me().email);if(exact){state.selectedRecipient=exact;renderSelectedRecipient(exact);}}
 syncPrefill();applyRecipientMode(!!noCompany?.checked);
 noCompany?.addEventListener('change',()=>applyRecipientMode(noCompany.checked));
 manualInputs.forEach(el=>el?.addEventListener('input',()=>{updatePreview();runCoach();}));
 emailInput?.addEventListener('input',()=>{
   if(state.manualRecipient)return;
   state.selectedRecipient=null;renderSelectedRecipient(null);
   const q=emailInput.value.trim().toLowerCase();
   if(!q){suggestions.classList.add('hidden');suggestions.innerHTML='';updatePreview();return;}
   const matches=employees.filter(e=>e.email.toLowerCase().includes(q)&&e.email!==me().email).slice(0,5);
   suggestions.innerHTML=matches.length?matches.map(e=>`<button type="button" class="recipient-suggestion" data-email="${escapeHtml(e.email)}">${miniAvatar(e.email,e.name)}<div><b>${escapeHtml(e.name)}</b><span>${escapeHtml(e.email)}</span><em>${escapeHtml(e.dept)}</em></div></button>`).join(''):`<div class="recipient-no-result">Không tìm thấy email phù hợp. Nếu người nhận không có mail công ty, tick lựa chọn phía trên.</div>`;
   suggestions.classList.remove('hidden');
   suggestions.querySelectorAll('[data-email]').forEach(btn=>btn.addEventListener('click',()=>{const employee=employees.find(e=>e.email===btn.dataset.email);state.selectedRecipient=employee;emailInput.value=employee.email;suggestions.classList.add('hidden');renderSelectedRecipient(employee);updatePreview();runCoach();}));
   const exact=employees.find(e=>e.email.toLowerCase()===q&&e.email!==me().email);if(exact){state.selectedRecipient=exact;renderSelectedRecipient(exact);}
   updatePreview();runCoach();
 });
 emailInput?.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==emailInput&&!suggestions?.contains(document.activeElement))suggestions?.classList.add('hidden');},150));
 msg.addEventListener('input',()=>{document.querySelector('#count').textContent=msg.value.trim().length+' ký tự';updatePreview();clearTimeout(coachTimer);coachTimer=setTimeout(runCoach,160);});
 function bindTemplateGallery(){document.querySelectorAll('[data-template]').forEach(c=>c.addEventListener('click',()=>{state.selectedTemplate=c.dataset.template;document.querySelectorAll('.template-option').forEach(x=>{x.classList.toggle('selected',x===c);x.setAttribute('aria-pressed',String(x===c));});syncCultureRequirement();updatePreview();}));}
 bindTemplateGallery();
 document.querySelectorAll('[data-kudos-type]').forEach(b=>b.addEventListener('click',()=>{
   if(typeGroup()===b.dataset.kudosType)return;
   state.kudosType=b.dataset.kudosType==='other'?(state.lastOccasion||'birthday'):'recognition';
   const g=document.querySelector('.kudos-background-gallery');if(g){g.innerHTML=templateGalleryHtml();g.scrollLeft=0;}
   bindTemplateGallery();syncCultureRequirement();updatePreview();
 }));
 document.querySelectorAll('[data-occasion]').forEach(b=>b.addEventListener('click',()=>{
   if(state.kudosType===b.dataset.occasion)return;
   state.kudosType=b.dataset.occasion;state.lastOccasion=b.dataset.occasion;
   const g=document.querySelector('.kudos-background-gallery');if(g){g.innerHTML=templateGalleryHtml();g.scrollLeft=0;}
   bindTemplateGallery();syncCultureRequirement();updatePreview();
 }));
 document.querySelector('#recipient-manual-dob')?.addEventListener('input',syncCultureRequirement);
 const occLabel=document.querySelector('#occasion-label');
 occLabel?.addEventListener('input',()=>{state.occasionLabel=occLabel.value;syncCultureRequirement();updatePreview();});
 document.querySelectorAll('[data-occasion-suggest]').forEach(b=>b.addEventListener('click',()=>{if(!occLabel)return;occLabel.value=b.dataset.occasionSuggest;state.occasionLabel=occLabel.value;syncCultureRequirement();updatePreview();occLabel.focus();}));
 document.querySelector('#recipient-manual-name')?.addEventListener('input',syncCultureRequirement);
 document.querySelectorAll('.culture-chip').forEach(c=>c.addEventListener('click',()=>{const v=c.dataset.value;if(state.values.has(v)){state.values.delete(v);c.classList.remove('selected')}else if(state.values.size<3){state.values.add(v);c.classList.add('selected')}c.setAttribute('aria-pressed',String(state.values.has(v)));updatePreview();}));
 document.querySelectorAll('[data-visibility]').forEach(btn=>btn.addEventListener('click',()=>{state.sendVisibility=btn.dataset.visibility;setVisibilityUi();updatePreview();}));
 const coachToggle=document.querySelector('#coach-toggle');
 coachToggle.addEventListener('click',()=>{const ex=coachToggle.getAttribute('aria-expanded')!=='true';coachToggle.setAttribute('aria-expanded',String(ex));document.querySelector('#coach-more').classList.toggle('hidden',!ex);coachToggle.textContent=ex?'Thu gọn':'Xem thêm';});
 const gallery=document.querySelector('.kudos-background-gallery');
 document.querySelectorAll('[data-bg-nav]').forEach(btn=>btn.addEventListener('click',()=>{if(!gallery)return;const step=(gallery.querySelector('.template-option')?.offsetWidth||160)+14;gallery.scrollBy({left:Number(btn.dataset.bgNav)*step*2,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}));
 const cont=document.querySelector('#continue-visibility');
 if(cont)cont.addEventListener('click',()=>{const vf=document.querySelector('#visibility-field');vf?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});vf?.querySelector('.visibility-option:not(:disabled)')?.focus?.();});
 document.querySelector('#send').addEventListener('click',send);
 syncCultureRequirement();updatePreview();runCoach();
}
let sending=false;
async function send(){
 if(sending)return;
 const btn=document.querySelector('#send'),text=document.querySelector('#message').value.trim();
 let recipient=null;
 if(state.manualRecipient){
   const name=(document.querySelector('#recipient-manual-name')?.value||'').trim();
   const dept=(document.querySelector('#recipient-manual-dept')?.value||'').trim();
   const email=(document.querySelector('#recipient-manual-email')?.value||'').trim().toLowerCase();
   if(name.length<2){toast('Nhập họ tên người nhận.');return;}
   if(dept.length<2){toast('Nhập Phòng ban / Bộ phận người nhận.');return;}
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Nhập email liên hệ hợp lệ.');return;}
   if(email===me().email.toLowerCase()){toast('Bạn không thể gửi cho chính mình.');return;}
   recipient={name,dept,email,manual:true};
 }else{
   const email=(document.querySelector('#recipient-email')?.value||'').trim().toLowerCase();
   const exact=employees.find(e=>e.email.toLowerCase()===email);
   if(!exact||!state.selectedRecipient){toast('Hãy tìm và chọn đúng email đồng nghiệp trong Master Data.');return;}
   if(exact.email===me().email){toast('Bạn không thể gửi cho chính mình.');return;}
   recipient=exact;
 }
 if(text.length<15||text.length>6000){toast('Nội dung KUDOS cần từ 15 đến 6.000 ký tự.');return;}
 if(QUOTA&&QUOTA.limit&&QUOTA.remaining<=0){toast('Bạn đã dùng đủ '+QUOTA.limit+' lượt gửi KUDOS hôm nay. Hạn mức được làm mới vào ngày mai.');return;}
 if(isOccasion()){const c=birthdayCheck();if(!c.ok){toast(c.msg);const el=document.querySelector(c.focus||'#birthday-status');el?.scrollIntoView({block:'center'});if(c.focus)el?.focus();return;}}
 if(!cultureOptional()&&state.values.size===0){toast('Hãy chọn ít nhất 1 Giá trị cốt lõi.');document.querySelector('#culture-field')?.scrollIntoView({block:'center'});return;}
 if(!typeTemplates(state.kudosType).some(t=>t.id===state.selectedTemplate)){toast('Chọn một background phù hợp với loại KUDOS.');return;}
 let qualityAcknowledged=false;
 if(state.kudosType==='recognition'&&!kudosQuality(text).ok){const sendAnyway=await confirmQuality();qualityAcknowledged=sendAnyway;if(!sendAnyway){const m=document.querySelector('#message');document.querySelector('.kudos-content-format')?.scrollIntoView({block:'center'});m?.focus();return;}}
 const first=sentBy(me().email).length===0;
 const payload={kudosType:state.kudosType,recipientEmail:recipient.email,recipientManual:!!recipient.manual,recipientName:recipient.name,recipientDept:recipient.dept,message:text,values:[...state.values],templateId:state.selectedTemplate,visibility:'public'};
 if(qualityAcknowledged)payload.qualityAcknowledged=true;
 const occ=occasionOf(state.kudosType);
 if(occ&&occ.custom)payload.occasionLabel=(document.querySelector('#occasion-label')?.value||'').trim();
 else if(occ&&recipient.manual)payload[occ.payloadKey]=(document.querySelector('#recipient-manual-dob')?.value||'').trim();
 const fingerprint=JSON.stringify(payload);
 if(!window.__ahakudosPendingSend||window.__ahakudosPendingSend.fingerprint!==fingerprint)window.__ahakudosPendingSend={fingerprint,requestId:uid()};
 payload.requestId=window.__ahakudosPendingSend.requestId;
 sending=true;btn.disabled=true;btn.textContent='Đang gửi KUDOS…';showLoaderOverlay('Đang gửi KUDOS…');
 try{
  const result=await rpc('taoKudos',payload);window.__ahakudosPendingSend=null;
  takeRecord(result.record);if(result.quota)QUOTA=result.quota;
  state.prefillRecipient='';state.selectedRecipient=null;state.manualRecipient=false;state.values.clear();state.sendVisibility='public';state.kudosType='recognition';state.occasionLabel='';state.selectedTemplate=(typeTemplates('recognition')[0]||{id:'wish'}).id;
  state.page='kudos-detail';state.viewKudosId=result.record.id;
  try{history.replaceState(null,'','#/k/'+result.record.id);}catch(e){}
  hideLoaderOverlay();render();window.scrollTo(0,0);showSuccessBanner(result.record,first,REVIEW?result.notice:''); // the modal already explains the approval step, so no extra toast
 }catch(e){if(e.code==='QUOTA'&&QUOTA)QUOTA.remaining=0;if(e.code==='REVIEW_DISABLED'){toast(e.message);return;}window.alert((e.code==='TIMEOUT'||e.code==='NETWORK'?e.message+'\nBấm Gửi lại sẽ KHÔNG tạo bản trùng (cùng mã lần gửi).':e.message)+(backendOutdated()?'\n\nAHAKUDOS đang được cập nhật phiên bản. Nếu lỗi lặp lại, vui lòng báo L&OD.':''));}
 finally{hideLoaderOverlay();sending=false;if(document.contains(btn)){btn.disabled=false;btn.textContent='Gửi KUDOS';}}
}
function escapeHtml(str=''){return String(str).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function showSuccessBanner(record,isFirst,reviewNotice){
 const root=document.querySelector('#modal-root');
 const who=`<span class="nowrap-name">${record&&record.recipientName?escapeHtml(record.recipientName):'đồng nghiệp'}</span>`;
 root.innerHTML=`<div class="modal-backdrop kudos-success-backdrop"><div class="modal kudos-success-modal${isFirst?' first-kudos':''}" role="dialog" aria-modal="true" aria-labelledby="kudos-success-title">
  <button class="modal-close" data-success-close aria-label="Đóng">×</button>
  <div class="kudos-success-art" aria-hidden="true"><img src="${BASE}/illustrations/success-mascot.webp" alt="" width="560" height="464" data-hide-on-error></div>
  <div class="kicker">${isFirst?'KUDOS ĐẦU TIÊN CỦA BẠN':'GỬI KUDOS THÀNH CÔNG'}</div>
  <h2 id="kudos-success-title">${isFirst?'Chúc mừng! Bạn vừa gửi KUDOS đầu tiên 🎉':'Đã gửi KUDOS đến<br>'+who+'&nbsp;🎉'}</h2>
  <p>Cảm ơn bạn đã lan tỏa sự ghi nhận.<br>${reviewNotice?'Trên bản thật, KUDOS sẽ chờ Admin duyệt rồi mới gửi email tới '+who+'.':'KUDOS đang chờ Admin duyệt; sau khi duyệt, '+who+' sẽ nhận email thông báo.'}</p>${reviewNotice?'<p class="kudos-success-review">🧪 '+escapeHtml(reviewNotice)+'</p>':''}
  <div class="kudos-success-actions"><button class="btn secondary" data-success-more>Gửi thêm KUDOS</button><button class="btn primary" data-success-close>Xem KUDOS vừa gửi</button></div>
 </div></div>`;
 const close=()=>{root.innerHTML='';document.removeEventListener('keydown',onKey);};
 const onKey=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',onKey);
 root.querySelectorAll('[data-success-close]').forEach(b=>b.addEventListener('click',close));
 root.querySelector('.kudos-success-backdrop').addEventListener('click',e=>{if(e.target===e.currentTarget)close();});
 root.querySelector('[data-success-more]').addEventListener('click',()=>{close();state.page='send-kudos';state.mode='employee';try{history.replaceState(null,'',location.pathname);}catch(e){}render();window.scrollTo(0,0);});
 root.querySelector('.kudos-success-actions .btn.primary').focus();
 launchConfetti();
}
// Lightweight canvas confetti (no library). Skipped when the user prefers reduced motion.
function launchConfetti(){
 try{if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;}catch(e){}
 document.querySelectorAll('.aha-confetti').forEach(c=>c.remove());
 const c=document.createElement('canvas');c.className='aha-confetti';c.setAttribute('aria-hidden','true');document.body.appendChild(c);
 const dpr=Math.min(window.devicePixelRatio||1,2),W=innerWidth,H=innerHeight;c.width=W*dpr;c.height=H*dpr;const g=c.getContext('2d');g.scale(dpr,dpr);
 const colors=['#FF7F32','#FFB347','#FFC940','#0E4174','#4F8FE0','#FF6F91','#3BC48A'];
 const parts=[];const burst=(x,dir)=>{for(let i=0;i<90;i++){const a=(-90+dir*35+(Math.random()-.5)*70)*Math.PI/180,v=9+Math.random()*9;parts.push({x,y:H*.62,vx:Math.cos(a)*v,vy:Math.sin(a)*v,w:6+Math.random()*6,h:8+Math.random()*8,r:Math.random()*6,vr:(Math.random()-.5)*.35,c:colors[i%colors.length],shape:Math.random()<.25?1:0});}};
 burst(W*.12,1);burst(W*.88,-1);
 for(let i=0;i<70;i++)parts.push({x:Math.random()*W,y:-20-Math.random()*H*.4,vx:(Math.random()-.5)*2,vy:2+Math.random()*3,w:6+Math.random()*5,h:8+Math.random()*7,r:Math.random()*6,vr:(Math.random()-.5)*.3,c:colors[i%colors.length],shape:Math.random()<.3?1:0});
 const t0=performance.now(),DUR=3600;
 const tick=t=>{const el=t-t0;g.clearRect(0,0,W,H);const fade=el>DUR-900?Math.max(0,(DUR-el)/900):1;g.globalAlpha=fade;
  parts.forEach(p=>{p.vy+=.28;p.vx*=.985;p.vy*=.985;p.x+=p.vx+Math.sin((el/260)+p.r)*.6;p.y+=p.vy;p.r+=p.vr;
   g.save();g.translate(p.x,p.y);g.rotate(p.r);g.fillStyle=p.c;if(p.shape){g.beginPath();g.arc(0,0,p.w/2,0,Math.PI*2);g.fill();}else g.fillRect(-p.w/2,-p.h/2,p.w,p.h*Math.abs(Math.cos(p.r*1.7))+2);g.restore();});
  if(el<DUR)requestAnimationFrame(tick);else c.remove();};
 requestAnimationFrame(tick);
}
function openAvatarEditor(){
 let tempData=state.avatarData;let tempScale=state.avatarScale;
 document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal avatar-modal"><button class="modal-close avatar-cancel">×</button><div class="kicker">HỒ SƠ CÁ NHÂN</div><h2>Cập nhật ảnh đại diện</h2><p>Chọn ảnh và điều chỉnh mức zoom. Ảnh được lưu trên hệ thống AHAKUDOS nên vẫn giữ nguyên khi bạn đăng xuất hoặc dùng thiết bị khác.</p><div class="avatar-editor-preview" id="avatar-preview">${tempData?`<img src="${tempData}" alt="Ảnh đại diện xem trước" style="transform:scale(${tempScale})">`:`<span>${initials(me().name)}</span>`}</div><label class="avatar-file-btn">Chọn ảnh<input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="zoom-row"><label for="avatar-zoom">Thu nhỏ</label><input id="avatar-zoom" type="range" min="0.8" max="2.4" step="0.05" value="${tempScale}"><label>Phóng to</label></div><div class="avatar-actions">${state.avatarData?'<button class="btn secondary" id="avatar-remove">Bỏ ảnh</button>':''}<button class="btn secondary avatar-cancel">Hủy</button><button class="btn primary" id="avatar-save">Lưu ảnh</button></div></div></div>`;
 const file=document.querySelector('#avatar-file');const zoom=document.querySelector('#avatar-zoom');const preview=document.querySelector('#avatar-preview');const saveBtn=document.querySelector('#avatar-save');
 const draw=()=>{preview.innerHTML=tempData?`<img src="${escapeHtml(tempData)}" alt="Ảnh đại diện xem trước" style="transform:scale(${tempScale})">`:`<span>${initials(me().name)}</span>`;};
 file.addEventListener('change',()=>{const f=file.files?.[0];if(!f)return;if(!/^image\/(png|jpeg|webp)$/.test(f.type)){toast('Chọn ảnh PNG, JPEG hoặc WebP.');return;}if(f.size>15*1024*1024){toast('Ảnh quá lớn (tối đa 15 MB).');return;}const reader=new FileReader();reader.onload=()=>{tempData=String(reader.result);tempScale=1;zoom.value='1';draw()};reader.readAsDataURL(f);});
 zoom.addEventListener('input',()=>{tempScale=Number(zoom.value);draw()});
 const close=()=>{document.querySelector('#modal-root').innerHTML='';};
 document.querySelectorAll('.avatar-cancel').forEach(b=>b.addEventListener('click',close));
 const busy=(on,label)=>{document.querySelectorAll('.avatar-modal button').forEach(b=>b.disabled=on);saveBtn.textContent=on?label:'Lưu ảnh';};
 saveBtn.addEventListener('click',async()=>{
  if(!tempData){close();return;}
  if(tempData===state.avatarData&&tempScale===state.avatarScale){close();return;}
  busy(true,'Đang lưu…');
  try{const dataUrl=await bakeAvatar(tempData,tempScale);await uploadAvatar(dataUrl);close();render();toast('Đã lưu ảnh đại diện.');}
  catch(e){busy(false);toast(e.message||'Chưa lưu được ảnh đại diện.');}
 });
 const rm=document.querySelector('#avatar-remove');
 if(rm)rm.addEventListener('click',async()=>{busy(true,'Đang xoá…');try{await rpc('xoaAnhDaiDien');delete AVATARS[me().email];state.avatarData='';state.avatarScale=1;clearLegacyAvatar();close();render();toast('Đã bỏ ảnh đại diện.');}catch(e){busy(false);toast(e.message);}});
}
// Crops to a centred square at the chosen zoom (same framing as the preview) → 320×320 JPEG, so the server stores the final image.
function bakeAvatar(src,scale){
 return new Promise((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>{const N=320,c=document.createElement('canvas');c.width=c.height=N;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,N,N);
   const side=Math.min(img.naturalWidth,img.naturalHeight)/Math.max(scale||1,0.1);
   const sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;
   // scale<1 shows the whole image smaller inside the frame (matches CSS transform on the preview)
   if(scale<1){const d=N*scale,o=(N-d)/2,s0=Math.min(img.naturalWidth,img.naturalHeight);g.drawImage(img,(img.naturalWidth-s0)/2,(img.naturalHeight-s0)/2,s0,s0,o,o,d,d);}
   else g.drawImage(img,sx,sy,side,side,0,0,N,N);
   resolve(c.toDataURL('image/jpeg',0.86));};
  img.onerror=()=>reject(new Error('Không đọc được ảnh này.'));
  img.src=src;
 });
}
async function uploadAvatar(dataUrl){
 const r=await rpc('datAnhDaiDien',{dataUrl});
 AVATARS[me().email]=r.v;state.avatarData=avatarUrl(me().email);state.avatarScale=1;clearLegacyAvatar();
}
function clearLegacyAvatar(){safeSet(AVATAR_KEY,null);safeSet(AVATAR_SCALE_KEY,null);}
// One-time migration of a browser-only avatar (older versions) to the server.
function migrateLegacyAvatar(){
 if(avatarUrl(me().email))return;const legacy=safeGet(AVATAR_KEY);if(!legacy||!/^data:image\//.test(legacy))return;
 bakeAvatar(legacy,Number(safeGet(AVATAR_SCALE_KEY)||1)||1).then(uploadAvatar).then(()=>render()).catch(e=>console.warn('[AHAKUDOS] avatar migration',e));
}
function toast(text){const t=document.createElement('div');t.className='toast';t.textContent=text;document.querySelector('#toast-root').appendChild(t);setTimeout(()=>t.remove(),2200)}

function initHomeHandbookProgress(){
 const root=document.querySelector('.home-handbook-progress');
 if(!root||root.dataset.bound==='1')return;
 root.dataset.bound='1';
 const links=[...root.querySelectorAll('a[href^="#home-"]')];
 const count=root.querySelector('.home-progress-count b');
 const bar=root.querySelector('.home-progress-count span');
 const update=(index)=>{
   links.forEach((a,i)=>a.classList.toggle('active',i===index));
   if(count)count.textContent=`${index+1}/3`;
   if(bar)bar.style.setProperty('--progress',`${(index+1)/3*100}%`);
 };
 links.forEach((a,i)=>a.addEventListener('click',()=>update(i)));
 const byHash=()=>{
   const idx=links.findIndex(a=>a.getAttribute('href')===location.hash);
   update(idx>=0?idx:0);
 };
 window.addEventListener('hashchange',byHash);
 byHash();
}

// ---- Deep link (#/k/<id>) --------------------------------------------------
function handleDeepLink(){
 let id=((location.hash||'').match(/^#\/k\/([A-Za-z0-9_-]{3,90})$/)||[])[1]||'';
 if(!id&&legacyLinkId&&!window.__ahakudosLegacyLinkUsed&&/^[A-Za-z0-9_-]{3,90}$/.test(legacyLinkId)){window.__ahakudosLegacyLinkUsed=true;id=legacyLinkId;try{history.replaceState(null,'',location.pathname+'#/k/'+id);}catch(e){}}
 if(id){state.mode='employee';state.page='kudos-detail';state.viewKudosId=id;return true;}
 return false;
}
window.addEventListener('hashchange',()=>{if(handleDeepLink())render();initHomeHandbookProgress();});
// Re-fit KUDOS cards when the window size changes (rotation, split view, resized pane).
let fitTimer=null;window.addEventListener('resize',()=>{clearTimeout(fitTimer);fitTimer=setTimeout(()=>fitAllKudosCards(document.body),150);});

// ---- Typography: never leave a single last word alone on the final line ----
// CSS text-wrap handles modern browsers; this joins the last two words with a no-break space everywhere else.
const GLUE_SELECTOR='h1,h2,h3,h4,h5,p,li,label,button,a,span,b,strong,em,small,td,th,blockquote,.field-hint,.page-sub,.sub,.kicker,.birthday-status,.notif-hint';
function glueLastWords(root){
 if(!root)return;
 root.querySelectorAll(GLUE_SELECTOR).forEach(el=>{
  if(el.closest('textarea,select,script,style,svg,.kd-card-msg'))return;
  const words=(el.textContent||'').trim().split(/\s+/);
  if(words.length<3)return;
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let last=null,n;
  while((n=walker.nextNode())){if(n.nodeValue.trim())last=n;}
  if(!last)return;
  const m=last.nodeValue.match(/^([\s\S]*\S)[ \t]+(\S+[\s]*)$/);
  if(m)last.nodeValue=m[1]+'\u00A0'+m[2];
 });
}
let glueQueued=false;
function queueGlue(){if(glueQueued)return;glueQueued=true;requestAnimationFrame(()=>{glueQueued=false;glueLastWords(document.body);});}
const glueObserver=new MutationObserver(queueGlue);
glueObserver.observe(document.body,{childList:true,subtree:true}); // text edits are characterData, so no feedback loop

// ---- 8. Start ---------------------------------------------------------------
handleDeepLink();
if(REVIEW)window.AhaKudosApp=Object.freeze({isAdmin:()=>!!BOOT.isAdmin,page:()=>state.page,mode:()=>state.mode,go(page){if(!page)return;const admin=/^admin-/.test(page);if(admin&&!BOOT.isAdmin){toast('Mục này thuộc Giao diện Admin — chọn kịch bản "Admin".');return;}state.mode=admin?'admin':'employee';if(page==='kudos-detail')return;goToPage(page);}});
render();
initHomeHandbookProgress();
window.AhaKudosBoot.ready();
migrateLegacyAvatar();
window.addEventListener('error',e=>{if(e.target&&e.target!==window)return;console.error('[AHAKUDOS] runtime error',e.error||e.message);toast('Có lỗi hiển thị. Nếu màn hình không phản hồi, vui lòng tải lại trang.');});
window.addEventListener('unhandledrejection',e=>{console.error('[AHAKUDOS] unhandled',e.reason);});
})();
