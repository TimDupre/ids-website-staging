/* Gated downloads: a short form (sent to the site's Formspree inbox, like Contact), then the file downloads directly. */
(function(){
  var ENDPOINT='https://formspree.io/f/xoevzboa';
  var G='/assets/uploads/docs/guides/';
  var CATALOG={
    'es-deepfakes':{title:'Deepfakes',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-deepfakes-ai-on-the-stand.pdf']]},
    'es-evidence-real':{title:'Is Your Evidence Real?',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-is-your-evidence-real.pdf']]},
    'es-emerging-trends':{title:'Emerging Trends',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-emerging-trends.pdf']]},
    'es-in-the-shadows':{title:'In the Shadows',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-in-the-shadows.pdf']]},
    'es-employees-rogue':{title:'Employees Going Rogue',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-employees-going-rogue.pdf']]},
    'es-ai-investigations':{title:'AI in Investigations',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-ai-in-investigations.pdf']]},
    'es-economics-contract':{title:'The Economics Hidden in the Contract',type:'Executive Summary',files:[['Download PDF',G+'ids-executive-summary-economics-hidden-in-the-contract.pdf']]},
    'future-of-evidence':{title:'The Future of Evidence',type:'Report',files:[['Download PDF',G+'ids-report-future-of-evidence.pdf']]},
    'testifying-expert-checklist':{title:'Testifying Expert Checklist',type:'Checklist',files:[['Download PDF',G+'ids-checklist-testifying-experts-ai.pdf']]},
    'data-source-checklist':{title:'Data Source Evaluation Checklist',type:'Checklist',files:[['Download PDF',G+'ids-checklist-data-source-evaluation.pdf']]},
    'fact-crashing-ebook':{title:'Fact Crashing',type:'eBook',files:[['Download the eBook',G+'ids-fact-crashing-ebook.pdf'],['Download the executive summary',G+'ids-fact-crashing-executive-summary.pdf']]}
  };
  var PUCK='<svg viewBox="0 0 270 270" aria-hidden="true"><circle cx="135" cy="135" r="135" fill="#DB6015" mask="url(#puck-cut)"/></svg>';
  function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function cover(d){return '<div class="gd-cover"><span class="gd-type">'+d.type+'</span><span class="gd-title">'+d.title+'</span>'+PUCK+'</div>';}
  var m=document.createElement('div'); m.className='gd-modal'; m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true'); m.setAttribute('aria-label','Download');
  document.body.appendChild(m);
  var last=null;
  function open(id,trigger){
    var d=CATALOG[id]; if(!d) return; last=trigger;
    var btns=d.files.map(function(f,i){return '<a class="gd-btn'+(i?' gd-btn-alt':'')+'" href="'+f[1]+'" download>'+f[0]+'</a>';}).join(' ');
    m.innerHTML='<div class="gd-box"><button type="button" class="gd-close" aria-label="Close">&times;</button>'+cover(d)+
      '<div class="gd-form"><div class="gd-ask"><h3>Download the '+d.type.toLowerCase()+'</h3>'+
      '<p>Share a few details and <strong>'+d.title+'</strong> downloads right away.</p>'+
      '<form novalidate><label for="gd-n">Name</label><input id="gd-n" name="name" required autocomplete="name" />'+
      '<label for="gd-e">Work email</label><input id="gd-e" name="email" type="email" required autocomplete="email" />'+
      '<label for="gd-f">Firm or organization</label><input id="gd-f" name="Firm" autocomplete="organization" />'+
      '<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" style="display:none" />'+
      '<button class="gd-btn" type="submit">Get the download</button></form></div>'+
      '<div class="gd-done"><h3>Thanks<span class="gd-who"></span>. Your download is ready.</h3><p>If it did not start on its own, use the button below.</p><div class="gd-dl">'+btns+'</div></div></div></div>';
    m.classList.add('open'); document.body.style.overflow='hidden';
    var f=m.querySelector('form'), box=m.querySelector('.gd-box');
    m.querySelector('#gd-n').focus();
    f.addEventListener('submit',function(e){
      e.preventDefault(); var n=f.name.value.trim(), em=f.email.value.trim();
      if(!n){ f.name.style.borderColor='#DB6015'; f.name.focus(); return; }
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ f.email.style.borderColor='#DB6015'; f.email.focus(); return; }
      var fd=new FormData(f); fd.append('Download',d.type+': '+d.title); fd.append('Page',location.pathname); fd.append('_subject','Download request: '+d.title);
      try{ fetch(ENDPOINT,{method:'POST',body:fd,headers:{'Accept':'application/json'}}).catch(function(){}); }catch(err){}
      m.querySelector('.gd-who').textContent=', '+n.split(/\s+/)[0]; box.classList.add('sent');
      var a=document.createElement('a'); a.href=d.files[0][1]; a.download=''; document.body.appendChild(a); a.click(); a.remove();
    });
    m.querySelector('.gd-close').addEventListener('click',close);
  }
  function close(){ m.classList.remove('open'); m.innerHTML=''; document.body.style.overflow=''; if(last&&last.focus) last.focus(); }
  m.addEventListener('click',function(e){ if(e.target===m) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&m.classList.contains('open')) close(); });
  document.addEventListener('click',function(e){ var t=e.target.closest('[data-gate]'); if(!t) return; e.preventDefault(); open(t.getAttribute('data-gate'),t); });
  window.iDSGated={catalog:CATALOG};
})();
