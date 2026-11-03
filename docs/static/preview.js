/* Isolated live-preview helpers; not shipped in the offline station package. */
(function(){
  'use strict';
  const banner=document.createElement('div');
  banner.className='demo-banner';
  banner.innerHTML='<div class="demo-banner-row"><span><strong>پیش‌نمایش تعاملی</strong> — همه عددها و وضعیت‌ها نمونه‌اند.</span><span>نسخه ۵.۰.۱</span></div><details><summary>راهنمای پیش‌نمایش</summary><p>روی موتورها بزنید، مقدار وارد کنید و با تب‌ها بخش‌های دیگر را ببینید. تغییرات فقط روی داده نمونه انجام می‌شود. ارسال واقعی به بله/ایتا، تغییر تنظیمات امنیتی، بازیابی و بروزرسانی غیرفعال است. این پیش‌نمایش هیچ اطلاعات واقعی ایستگاه ندارد.</p></details>';
  document.body.prepend(banner);

  function notify(text){
    if(typeof window.toast==='function'){window.toast(text);return;}
    const t=document.createElement('div');t.className='toast';t.textContent=text;document.body.appendChild(t);setTimeout(()=>t.remove(),3500);
  }
  window.addEventListener('unhandledrejection',function(e){
    const msg=e.reason&&e.reason.message?e.reason.message:'خطا در پیش‌نمایش';
    notify(msg);e.preventDefault();
  });

  async function quickLogin(group,pin){
    try{
      const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group,pin})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'ورود ناموفق');
      location.href='/';
    }catch(e){notify(e.message||'خطا در ورود نمایشی');}
  }
  const loginCard=document.querySelector('.lock-card #login-btn');
  if(loginCard){
    const box=document.createElement('div');box.className='demo-quick';
    const op=document.createElement('button');op.className='btn';op.textContent='ورود سریع اپراتور نمونه';op.onclick=()=>quickLogin('A','1111');
    const admin=document.createElement('button');admin.className='btn primary';admin.textContent='ورود سریع ادمین نمونه';admin.onclick=()=>quickLogin('admin','9999');
    box.append(op,admin);loginCard.before(box);
    const note=document.createElement('p');note.className='demo-quick-note';note.textContent='برای دیدن همه شش تب، «ورود سریع ادمین نمونه» را بزنید.';box.after(note);
  }

  function wrapTables(root){
    if(!root||root.nodeType!==1)return;
    const tables=[];
    if(root.matches&&root.matches('table.table'))tables.push(root);
    if(root.querySelectorAll)tables.push(...root.querySelectorAll('table.table'));
    tables.forEach(table=>{
      if(table.parentElement&&table.parentElement.classList.contains('table-scroll'))return;
      const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('aria-label','جدول قابل پیمایش افقی');
      table.before(wrap);wrap.appendChild(table);
    });
  }
  wrapTables(document);
  const observer=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)wrapTables(n);});
  observer.observe(document.body,{childList:true,subtree:true});

  document.addEventListener('click',function(e){
    const interval=e.target.closest('.interval');
    if(interval){document.querySelectorAll('.interval').forEach(x=>x.classList.remove('demo-selected'));interval.classList.add('demo-selected');}
  });

  // Mobile browsers often block window.open after an async request. Show PDFs
  // in an accessible dialog instead, with an explicit download/open link.
  if(document.getElementById('main')){
    window.printPdf=function(url){
      let dialog=document.getElementById('demo-pdf-dialog');
      if(!dialog){
        dialog=document.createElement('dialog');dialog.id='demo-pdf-dialog';dialog.className='demo-pdf-dialog';
        dialog.innerHTML='<div class="demo-pdf-head"><a id="demo-pdf-open" target="_blank" rel="noopener">باز کردن / دانلود PDF</a><button class="btn small" id="demo-pdf-close">بستن ✕</button></div><iframe id="demo-pdf-frame" title="پیش‌نمایش PDF"></iframe>';
        document.body.appendChild(dialog);
        document.getElementById('demo-pdf-close').onclick=()=>dialog.close();
      }
      document.getElementById('demo-pdf-open').href=url;
      document.getElementById('demo-pdf-frame').src=url;
      dialog.showModal();
    };
    document.querySelectorAll('button[onclick="sendDaily(true)"]').forEach(b=>{
      b.textContent='ارسال آزمایشی (بدون ارسال واقعی)';b.setAttribute('onclick','sendDaily(false)');b.title='در پیش‌نمایش فقط PDF ساخته می‌شود و چیزی به بله/ایتا ارسال نمی‌شود.';
    });
    document.querySelectorAll('button[onclick="auxPdf(true)"]').forEach(b=>{
      b.textContent='PDF آزمایشی';b.setAttribute('onclick','auxPdf(false)');
    });
  }
})();
